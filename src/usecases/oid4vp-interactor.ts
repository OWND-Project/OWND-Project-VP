import { fetch } from "undici";

import { Result, VoidResult } from "../tool-box/index.js";
import getLogger from "../services/logging-service.js";
import {
  Verifier,
  ResponseEndpoint,
  generateClientMetadata,
  GenerateRequestObjectOptions,
} from "../oid4vp/index.js";
import {
  AuthRequestPresenter,
  AuthResponsePresenter,
  ExchangeResponseCodePresenter,
  PostStatePresenter,
  WaitCommitData,
} from "./types.js";
import {
  PostStateRepository,
  SessionRepository,
} from "./oid4vp-repository.js";
// Deprecated imports - kept for backward compatibility
// import {
//   INPUT_DESCRIPTOR_AFFILIATION,
//   INPUT_DESCRIPTOR_ID2,
//   submissionRequirementAffiliation,
// } from "./internal/input-descriptor.js";
import {
  handleEndpointError,
  handleRequestError,
} from "./internal/error-handlers.js";
import {
  // processCredential2, // Deprecated - using extractCredentialFromVpToken instead
  extractCredentialFromVpToken,
} from "./internal/credential2-processor.js";
import { NotSuccessResult } from "../types/app-types.js";
import { certificateStr2Array } from "../tool-box/x509/x509.js";

const logger = getLogger();

export type OID4VPInteractor = ReturnType<typeof initOID4VPInteractor>;

export const initOID4VPInteractor = (
  verifier: Verifier,
  responseEndpoint: ResponseEndpoint,
  stateRepository: PostStateRepository,
  sessionRepository: SessionRepository,
) => {
  const Env = () => {
    return {
      clientId: process.env.OID4VP_CLIENT_ID || "",
      clientIdScheme: (process.env.OID4VP_CLIENT_ID_SCHEME ||
        "redirect_uri") as "redirect_uri" | "x509_san_dns" | "x509_hash",
      verifier: {
        jwk: process.env.OID4VP_VERIFIER_JWK || "VERIFIER_JWK_IS_NOT_SET",
        x5c: certificateStr2Array(
          process.env.OID4VP_VERIFIER_X5C || "VERIFIER_X5C_IS_NOT_SET",
        ),
      },
      requestUri: process.env.OID4VP_REQUEST_URI || "",
      responseUri: process.env.OID4VP_RESPONSE_URI || "",
      presentationDefinitionUri:
        process.env.OID4VP_PRESENTATION_DEFINITION_URI ||
        "INVALID_PRESENTATION_DEFINITION_URI",
      redirectUriReturnedByResponseUri:
        process.env.OID4VP_REDIRECT_URI_RETURNED_BY_RESPONSE_URI || "",
      apiHost: process.env.API_HOST || "http://localhost:3000",
      enableEncryption: process.env.OID4VP_VP_TOKEN_ENCRYPTION_ENABLED === "true",
      expiredIn: {
        requestAtVerifier: Number(
          process.env.OID4VP_REQUEST_EXPIRED_IN_AT_VERIFIER || "600",
        ),
        requestAtResponseEndpoint: Number(
          process.env.OID4VP_REQUEST_EXPIRED_IN_AT_RESPONSE_ENDPOINT || "600",
        ),
        response: Number(process.env.OID4VP_RESPONSE_EXPIRED_IN || "600"),
        postSession: Number(process.env.POST_SESSION_EXPIRED_IN || "600"),
      },
    };
  };

  const clientId = Env().clientId;
  const responseUri = Env().responseUri;

  /**
   * Generate OID4VP authorization request
   * @param presenter
   * @param dcqlCredentialQueries - Optional DCQL credential queries. If not provided, all Learning Credential claims will be requested.
   */
  const generateAuthRequest = async <T>(
    presenter: AuthRequestPresenter<T>,
    dcqlCredentialQueries?: any[],
  ): Promise<Result<T, NotSuccessResult>> => {
    logger.info("generateAuthRequest start");

    const responseType = "vp_token";
    // initiate transaction
    const request = await responseEndpoint.initiateTransaction({
      responseType,
      redirectUriReturnedByResponseUri:
        Env().redirectUriReturnedByResponseUri,
      expiredIn: Env().expiredIn.requestAtResponseEndpoint,
      enableEncryption: Env().enableEncryption,
    });

    // Generate nonce at request creation time (only once)
    const { v4: uuidv4 } = await import("uuid");
    const nonce = uuidv4();
    logger.info(`Generated nonce for request ${request.id}: ${nonce}`);

    // Generate DCQL query for learning credential
    // Use provided queries or default to all claims
    const defaultQueries = [
      {
        id: "learning_credential",
        format: "dc+sd-jwt",
        meta: {
          vct_values: ["urn:eu.europa.ec.eudi:learning:credential:1"],
        },
        claims: [
          { path: ["issuing_authority"] },
          { path: ["issuing_country"] },
          { path: ["date_of_issuance"] },
          { path: ["family_name"] },
          { path: ["given_name"] },
          { path: ["achievement_title"] },
          { path: ["achievement_description"] },
          { path: ["learning_outcomes"] },
          { path: ["assessment_grade"] },
        ],
      },
    ];
    const dcqlQuery = verifier.generateDcqlQuery(dcqlCredentialQueries || defaultQueries);

    const clientIdScheme = Env().clientIdScheme;
    const f = async () => {
      if (clientIdScheme === "x509_san_dns" || clientIdScheme === "x509_hash") {
        // For x509-based schemes, use request_uri to reference a signed Request Object
        const requestUri = `${Env().requestUri}?id=${request.id}`;
        return { clientId, requestUri };
      } else {
        const opts: GenerateRequestObjectOptions = {
          responseType,
          responseMode: "direct_post.jwt",
          responseUri,
          clientMetadata: getClientMetadata(),
          dcqlQuery, // Use DCQL instead of Presentation Definition
        };

        // start vp request with pre-generated nonce
        const startRequestOpts: Record<string, any> = {
          requestObject: opts,
          expiredIn: Env().expiredIn.requestAtVerifier,
          generateId: () => nonce, // Pass pre-generated nonce to prevent regeneration
        };
        return await verifier.startRequest(request, clientId, startRequestOpts);
      }
    };
    const vpRequest = await f();

    // Save nonce and DCQL query to requests table
    // This ensures they are persisted and can be retrieved later in getRequestObject()
    await responseEndpoint.saveRequest({
      ...request,
      nonce,
      dcqlQuery: JSON.stringify(dcqlCredentialQueries || defaultQueries),
    });

    // Initialize post_state to "started" when Authorization Request is created
    // This allows /oid4vp/states endpoint to return a valid status before Wallet responds
    await stateRepository.putState(request.id, "started", {
      expiredIn: Env().expiredIn.postSession,
    });

    logger.info("generateAuthRequest end");
    return {
      ok: true,
      payload: presenter(vpRequest, request.id, request.transactionId),
    };
  };

  /**
   * Get Request Object JWT for x509-based schemes
   * Used by GET /oid4vp/request endpoint when using request_uri
   * Uses saved nonce and DCQL query to ensure consistency
   */
  const getRequestObject = async (
    requestId: string,
    presentationDefinitionId: string,
  ): Promise<Result<string, NotSuccessResult>> => {
    const request = await responseEndpoint.getRequest(requestId);

    if (!request) {
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    // Verify that nonce exists (should have been saved during generateAuthRequest)
    if (!request.nonce) {
      logger.error(`Request ${requestId} does not have a saved nonce`);
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    const responseType = "vp_token";
    const clientIdScheme = Env().clientIdScheme;

    // Retrieve DCQL query from saved request data
    // If not found, use default query with all claims
    let dcqlCredentialQueries: any[];
    if (request.dcqlQuery) {
      try {
        dcqlCredentialQueries = JSON.parse(request.dcqlQuery);
      } catch (e) {
        logger.error(`Failed to parse dcqlQuery: ${e}`);
        dcqlCredentialQueries = [];
      }
    } else {
      // Fallback to default query with all claims
      dcqlCredentialQueries = [
        {
          id: "learning_credential",
          format: "dc+sd-jwt",
          meta: {
            vct_values: ["urn:eu.europa.ec.eudi:learning:credential:1"],
          },
          claims: [
            { path: ["issuing_authority"] },
            { path: ["issuing_country"] },
            { path: ["date_of_issuance"] },
            { path: ["family_name"] },
            { path: ["given_name"] },
            { path: ["achievement_title"] },
            { path: ["achievement_description"] },
            { path: ["learning_outcomes"] },
            { path: ["assessment_grade"] },
          ],
        },
      ];
    }

    // Generate DCQL query for Learning Credential
    const dcqlQuery = verifier.generateDcqlQuery(dcqlCredentialQueries);

    // Prepare client metadata with encryption support if enabled
    let clientMetadata = getClientMetadata();
    if (request.encryptionPrivateJwk) {
      // Generate public key from saved private key
      const { publicJwkFromPrivate } = await import("elliptic-jwk");
      const encryptionPrivateJwk = JSON.parse(request.encryptionPrivateJwk);
      const publicJwk = publicJwkFromPrivate(encryptionPrivateJwk);
      // Add encryption metadata (required for ECDH-ES)
      const encryptionPublicJwk = {
        ...publicJwk,
        use: "enc",
        alg: "ECDH-ES",
      } as any;
      clientMetadata = {
        ...clientMetadata,
        jwks: {
          keys: [encryptionPublicJwk],
        },
        encryptedResponseEncValuesSupported: ["A128GCM"],
      };
    }

    const opts: GenerateRequestObjectOptions = {
      responseType,
      responseMode: "direct_post.jwt",
      responseUri: responseUri,
      clientMetadata,
      dcqlQuery,
      state: request.id,
      nonce: request.nonce, // Use saved nonce instead of generating new one
      x509CertificateInfo: { x5c: Env().verifier.x5c },
    };

    // Generate Request Object JWT directly without calling verifier.startRequest
    // This prevents nonce regeneration
    const { generateRequestObjectJwt } = await import("../oid4vp/auth-request.js");
    const issuerJwk = JSON.parse(Env().verifier.jwk);
    const requestObjectJwt = await generateRequestObjectJwt(clientId, issuerJwk, opts);

    logger.info(`Generated Request Object JWT for request ${requestId} with saved nonce ${request.nonce}`);

    return {
      ok: true,
      payload: requestObjectJwt,
    };
  };

  /**
   * @deprecated PEX-related method. DCQL flow doesn't use Presentation Definition.
   * @param presentationDefinitionId
   */
  const getPresentationDefinition = async (
    presentationDefinitionId: string,
  ) => {
    // Return null since Presentation Definition is not used in DCQL flow
    logger.warn('getPresentationDefinition called but PEX is deprecated. Returning null.');
    return null;
  };

  /**
   *
   * @param payload
   * @param presenter
   */
  const receiveAuthResponse = async <T>(
    payload: any,
    presenter: AuthResponsePresenter<T>,
  ): Promise<Result<T, NotSuccessResult>> => {
    logger.info("receiveAuthResponse start");

    const result = await responseEndpoint.receiveAuthResponse(payload, {
      expiredIn: Env().expiredIn.response,
    });

    logger.info("receiveAuthResponse end");
    if (result.ok) {
      const { redirectUri, responseCode } = result.payload;
      return { ok: true, payload: presenter(redirectUri!, responseCode!) };
    } else {
      const { type } = result.error;
      console.error(type);
      if (type === "REQUEST_ID_IS_NOT_FOUND") {
        return { ok: false, error: { type: "NOT_FOUND" } };
      } else if (type === "REQUEST_ID_IS_EXPIRED") {
        return { ok: false, error: { type: "EXPIRED" } };
      } else {
        return { ok: false, error: { type: "INVALID_PARAMETER" } };
      }
    }
  };

  const updateState2InvalidSubmission = async (requestId: string) => {
    await stateRepository.putState(requestId, "invalid_submission");
  };

  /**
   * Exchange response code for auth response and process credential
   * VP Token検証成功後、自動的にcommitted状態に遷移
   * @param responseCode
   * @param transactionId
   * @param presenter
   */
  const exchangeAuthResponse = async <T>(
    responseCode: string,
    transactionId: string | undefined,
    presenter: ExchangeResponseCodePresenter<T>,
  ): Promise<Result<T, NotSuccessResult>> => {
    logger.info("consumeAuthResponse start");

    // exchange response code for auth response
    logger.info(`exchangeResponseCode: code=${responseCode}, transactionId=${transactionId}`);
    const exchange = await responseEndpoint.exchangeResponseCodeForAuthResponse(
      responseCode,
      transactionId,
    );
    if (!exchange.ok) {
      logger.info(`exchange failed: ${JSON.stringify(exchange.error)}`);
      return { ok: false, error: handleEndpointError(exchange.error) };
    }
    logger.info(`exchange success: requestId=${exchange.payload.requestId}`);

    // id token
    const { requestId, payload } = exchange.payload;

    // nonce
    logger.info(`getRequest for requestId=${requestId}`);
    const getRequest = await verifier.getRequest(requestId);
    if (!getRequest.ok) {
      logger.info(`getRequest failed: ${JSON.stringify(getRequest.error)}`);
      return {
        ok: false,
        error: handleRequestError(requestId, getRequest.error),
      };
    }
    logger.info(`getRequest success, nonce=${getRequest.payload.nonce}`);
    const { nonce } = getRequest.payload;

    // id token (SIOPv2 validation removed - use standard OID4VP validation)
    const { idToken } = payload;

    logger.info("extractCredentialFromVpToken start");
    // Process learning credential using DCQL flow (direct VP Token extraction)
    const credentialQueryId = "learning_credential";
    const cred = await extractCredentialFromVpToken(
      payload.vpToken,
      credentialQueryId,
      nonce
    );
    if (!cred.ok) {
      logger.info(`credential extraction failed : ${JSON.stringify(cred.error)}`);
      await updateState2InvalidSubmission(requestId);
      return { ok: false, error: cred.error };
    }

    // consume vp_token
    const consumeRequest = await verifier.consumeRequest(requestId);
    if (!consumeRequest.ok) {
      logger.info(
        `consumeRequest is not ok : ${JSON.stringify(consumeRequest.error)}`,
      );
      return {
        ok: false,
        error: handleRequestError(requestId, consumeRequest.error),
      };
    }

    // Extract credential data
    const { learningCredential } = cred.payload;

    // Save session data
    await sessionRepository.putWaitCommitData(
      requestId,
      idToken!,
      learningCredential,
      { expiredIn: Env().expiredIn.postSession },
    );

    // VP Token検証成功後、自動的にcommitted状態に遷移
    await stateRepository.putState(requestId, "committed");

    logger.info("consumeAuthResponse end");
    return {
      ok: true,
      payload: presenter(requestId, {
        sub: "", // ID token validation removed
        id_token: idToken!,
        learningCredential: learningCredential,
      }),
    };
  };

  /**
   * Get current state of the request
   * @param requestId
   * @param presenter
   */
  const getStates = async <T>(
    requestId: string,
    presenter: PostStatePresenter<T>,
  ): Promise<T> => {
    const state = await stateRepository.getState(requestId);
    return presenter(state);
  };

  /**
   * Get credential data from session by request ID
   * @param requestId
   */
  const getCredentialData = async (
    requestId: string,
  ): Promise<Result<any, NotSuccessResult>> => {
    const sessionResult = await sessionRepository.getSessionByRequestId<WaitCommitData>(requestId);

    if (!sessionResult.ok) {
      if (sessionResult.error.type === "NOT_FOUND") {
        return { ok: false, error: { type: "NOT_FOUND" } };
      }
      if (sessionResult.error.type === "EXPIRED") {
        return { ok: false, error: { type: "EXPIRED" } };
      }
      return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
    }

    const session = sessionResult.payload;
    const { idToken, learningCredentialJwt } = session.data;

    // Decode Learning Credential SD-JWT if present
    let learningCredential: any = null;
    if (learningCredentialJwt) {
      try {
        logger.info(`Attempting to decode Learning Credential JWT`);

        // Use verifySdJwt to expand disclosures and get complete payload
        const { verifySdJwt } = await import("../helpers/jwt-helper.js");
        const verifiedResult = await verifySdJwt(learningCredentialJwt, {});

        logger.info(`Verified SD-JWT result keys: ${Object.keys(verifiedResult).join(', ')}`);

        // Extract the decoded payload with all disclosed claims
        const payload: any = verifiedResult.decodedPayload || verifiedResult;
        logger.info(`Decoded payload keys: ${Object.keys(payload).join(', ')}`);

        // Extract credential fields
        learningCredential = {
          rawJwt: learningCredentialJwt,
          fields: {
            issuing_authority: payload.issuing_authority,
            issuing_country: payload.issuing_country,
            date_of_issuance: payload.date_of_issuance,
            family_name: payload.family_name,
            given_name: payload.given_name,
            achievement_title: payload.achievement_title,
            achievement_description: payload.achievement_description,
            learning_outcomes: payload.learning_outcomes,
            assessment_grade: payload.assessment_grade,
          }
        };
        logger.info(`Successfully decoded Learning Credential with fields: ${Object.keys(learningCredential.fields).filter(k => learningCredential.fields[k]).join(', ')}`);
      } catch (error) {
        logger.error(`Failed to decode Learning Credential: ${error}`);
        logger.error(`Error stack: ${(error as Error).stack}`);
        learningCredential = {
          rawJwt: learningCredentialJwt,
          error: `Failed to decode credential: ${(error as Error).message}`
        };
      }
    }

    return {
      ok: true,
      payload: {
        idToken,
        learningCredentialJwt,
        learningCredential
      },
    };
  };

  return {
    generateAuthRequest,
    getRequestObject,
    getPresentationDefinition,
    receiveAuthResponse,
    exchangeAuthResponse,
    getStates,
    getCredentialData,
  };
};


/**
 *
 */
export const getClientMetadata = () => {
  const clientId = process.env.OID4VP_CLIENT_ID || "INVALID_CLIENT_ID";
  const clientName =
    process.env.OID4VP_CLIENT_METADATA_NAME || "INVALID_CLIENT_NAME";
  const logoUri =
    process.env.OID4VP_CLIENT_METADATA_LOGO_URI ||
    "INVALID_CLIENT_METADATA_LOGO_URI";
  const policyUri =
    process.env.OID4VP_CLIENT_METADATA_POLICY_URI ||
    "INVALID_CLIENT_METADATA_POLICY_URI";
  const tosUri =
    process.env.OID4VP_CLIENT_METADATA_TOS_URI ||
    "INVALID_CLIENT_METADATA_TOS_URI";
  return generateClientMetadata(clientId, {
    clientName,
    logoUri,
    policyUri,
    tosUri,
  });
};

export interface EntityWithLifeCycleOption {
  issuedAt?: number;
  expiredIn?: number;
}
export interface PostStateOption extends EntityWithLifeCycleOption {
  targetId?: string;
}
