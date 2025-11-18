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
        "redirect_uri") as "redirect_uri" | "x509_san_dns",
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
   */
  const generateAuthRequest = async <T>(
    presenter: AuthRequestPresenter<T>,
  ): Promise<Result<T, NotSuccessResult>> => {
    logger.info("generateAuthRequest start");

    const responseType = "vp_token id_token";
    // initiate transaction
    const request = await responseEndpoint.initiateTransaction({
      responseType,
      redirectUriReturnedByResponseUri:
        Env().redirectUriReturnedByResponseUri,
      expiredIn: Env().expiredIn.requestAtResponseEndpoint,
    });

    // Generate DCQL query for affiliation credential
    const dcqlQuery = verifier.generateDcqlQuery([
      {
        id: "affiliation_credential",
        format: "vc+sd-jwt",
        meta: {
          vct_values: ["OrganizationalAffiliationCertificate"],
        },
        claims: [
          { path: ["organization_name"] },
          { path: ["family_name"] },
          { path: ["given_name"] },
          { path: ["portrait"] },
        ],
      },
    ]);

    const clientIdScheme = Env().clientIdScheme;
    const f = async () => {
      if (clientIdScheme === "x509_san_dns") {
        const requestUri = `${Env().requestUri}?id=${request.id}`;
        return { clientId, requestUri };
      } else {
        const opts: GenerateRequestObjectOptions = {
          responseType,
          responseMode: "direct_post",
          clientIdScheme,
          responseUri,
          clientMetadata: getClientMetadata(),
          dcqlQuery, // Use DCQL instead of Presentation Definition
        };

        // start vp request
        const startRequestOpts: Record<string, any> = {
          requestObject: opts,
          expiredIn: Env().expiredIn.requestAtVerifier,
        };
        return await verifier.startRequest(request, clientId, startRequestOpts);
      }
    };
    const vpRequest = await f();

    logger.info("generateAuthRequest end");
    return {
      ok: true,
      payload: presenter(vpRequest, request.id, request.transactionId),
    };
  };

  /**
   * @deprecated PEX-related method. DCQL flow doesn't use Presentation Definition endpoint.
   */
  const getRequestObject = async (
    requestId: string,
    presentationDefinitionId: string,
  ): Promise<Result<string, NotSuccessResult>> => {
    const request = await responseEndpoint.getRequest(requestId);

    if (!request) {
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    const responseType = "vp_token id_token";
    const clientIdScheme = Env().clientIdScheme;

    // Generate DCQL query instead of using Presentation Definition
    const dcqlQuery = verifier.generateDcqlQuery([
      {
        id: "affiliation_credential",
        format: "vc+sd-jwt",
        meta: {
          vct_values: ["OrganizationalAffiliationCertificate"],
        },
      },
    ]);

    const opts: GenerateRequestObjectOptions = {
      responseType,
      responseMode: "direct_post",
      clientIdScheme,
      responseUri: responseUri,
      clientMetadata: getClientMetadata(),
      dcqlQuery, // Use DCQL instead of Presentation Definition
    };

    // start vp request
    const startRequestOpts: Record<string, any> = {
      requestObject: opts,
      expiredIn: Env().expiredIn.requestAtVerifier,
    };
    startRequestOpts.issuerJwk = JSON.parse(Env().verifier.jwk);
    startRequestOpts.x5c = Env().verifier.x5c;
    const vpRequest = await verifier.startRequest(
      request,
      clientId,
      startRequestOpts,
    );
    return {
      ok: true,
      payload: vpRequest.request!,
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
    const exchange = await responseEndpoint.exchangeResponseCodeForAuthResponse(
      responseCode,
      transactionId,
    );
    if (!exchange.ok) {
      return { ok: false, error: handleEndpointError(exchange.error) };
    }

    // id token
    const { requestId, payload } = exchange.payload;

    // nonce
    const getRequest = await verifier.getRequest(requestId);
    if (!getRequest.ok) {
      return {
        ok: false,
        error: handleRequestError(requestId, getRequest.error),
      };
    }
    const { nonce } = getRequest.payload;

    // id token (SIOPv2 validation removed - use standard OID4VP validation)
    const { idToken } = payload;

    logger.info("extractCredentialFromVpToken start");
    // Process affiliation credential using DCQL flow (direct VP Token extraction)
    const cred = await extractCredentialFromVpToken(payload.vpToken, nonce);
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
    const { affiliation, icon } = cred.payload;

    // Save session data
    await sessionRepository.putWaitCommitData(
      requestId,
      idToken!,
      affiliation,
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
        icon,
        organization: affiliation,
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

  return {
    generateAuthRequest,
    getRequestObject,
    getPresentationDefinition,
    receiveAuthResponse,
    exchangeAuthResponse,
    getStates,
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
