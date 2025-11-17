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
  CommitDataPresenter,
  ExchangeResponseCodePresenter,
  PostStatePresenter,
  UrlDocument,
  WaitCommitData,
} from "./types.js";
import {
  initPostStateRepository,
  initSessionRepository,
  PostStateRepository,
  SessionRepository,
} from "./oid4vp-repository.js";
import siopv2 from "../oid4vp/siop-v2.js";
import {
  INPUT_DESCRIPTOR_AFFILIATION,
  INPUT_DESCRIPTOR_ID1,
  INPUT_DESCRIPTOR_ID2,
  inputDescriptorClaim,
  submissionRequirementAffiliation,
  submissionRequirementClaim,
} from "./internal/input-descriptor.js";
import {
  checkStateForDelete,
  handleEndpointError,
  handleIdTokenError,
  handleRequestError,
} from "./internal/error-handlers.js";
import { processCredential1 } from "./internal/credential1-processor.js";
import { processCredential2 } from "./internal/credential2-processor.js";
import { NotSuccessResult } from "../types/app-types.js";
import {
  callDelete,
  callGetUrl,
  callGetUrlMetadata,
  callPostUrl,
} from "./internal/api-node-caller.js";
import { certificateStr2Array } from "../tool-box/x509/x509.js";

const logger = getLogger();

export const KeyValueType = {
  requestsAtResponseEndpoint: { name: "requests@response_endpoint" },
  responsesAtResponseEndpoint: { name: "responses@response_endpoint" },
  requestsAtVerifier: { name: "requests@verifier" },
  presentationDefinitions: {
    name: "presentation_definitions",
  },
  sessions: {
    name: "sessions",
  },
  states: {
    name: "states",
  },
};

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
      mainNodeHost: process.env.MAIN_NODE_HOST || "http://localhost:3000",
      expiredIn: {
        requestAtVerifier: Number(
          process.env.OID4VP_REQUEST_EXPIRED_IN_AT_VERIFIER || "600",
        ),
        requestAtResponseEndpoint: Number(
          process.env.OID4VP_REQUEST_EXPIRED_IN_AT_RESPONSE_ENDPOINT || "600",
        ),
        response: Number(process.env.OID4VP_RESPONSE_EXPIRED_IN || "600"),
        postSession: Number(process.env.POST_SESSION_EXPIRED_IN || "600"),
        postState: Number(process.env.POST_STATE_EXPIRED_IN || "600"),
      },
    };
  };

  const clientId = Env().clientId;
  const responseUri = Env().responseUri;

  /**
   *
   * @param payload
   * @param presenter
   */
  const generateAuthRequest = async <T>(
    payload: {
      url: string;
      comment: string;
      boolValue: number;
    },
    presenter: AuthRequestPresenter<T>,
  ): Promise<Result<T, NotSuccessResult>> => {
    logger.info("generateAuthRequest start");
    const { url, comment, boolValue } = payload;
    if (!url || 2 < boolValue || boolValue < 0) {
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    const responseType = "vp_token id_token";
    // initiate transaction
    const request = await responseEndpoint.initiateTransaction({
      responseType,
      redirectUriReturnedByResponseUri:
        Env().redirectUriReturnedByResponseUri + "?type=post_comment",
      expiredIn: Env().expiredIn.requestAtResponseEndpoint,
    });

    // generate pd and pd_id
    const pd = await verifier.generatePresentationDefinition(
      [
        inputDescriptorClaim(url, comment, boolValue),
        INPUT_DESCRIPTOR_AFFILIATION,
      ],
      [submissionRequirementClaim, submissionRequirementAffiliation],
      "真偽コメントに署名します",
      "投稿に信頼性を持たせるために身元を証明するクレデンシャルと共に真偽表明を行います",
    );
    const clientIdScheme = Env().clientIdScheme;
    const f = async () => {
      if (clientIdScheme === "x509_san_dns") {
        const requestUri = `${Env().requestUri}?type=post_comment&id=${request.id}&presentationDefinitionId=${pd.id}`;
        return { clientId, requestUri };
      } else {
        const presentationDefinitionUri =
          Env().presentationDefinitionUri + `?id=${pd.id}`;
        const opts: GenerateRequestObjectOptions = {
          responseType,
          responseMode: "direct_post",
          clientIdScheme,
          responseUri,
          clientMetadata: getClientMetadata(),
          presentationDefinitionUri,
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

    await stateRepository.putState(request.id, "started", {
      expiredIn: Env().expiredIn.postState,
    });

    logger.info("generateAuthRequest end");
    return {
      ok: true,
      payload: presenter(vpRequest, request.id, request.transactionId),
    };
  };

  const generateAuthRequest4Delete = async <T>(
    payload: {
      id: string;
    },
    presenter: AuthRequestPresenter<T>,
  ): Promise<Result<T, NotSuccessResult>> => {
    logger.info("generateAuthRequest start");
    const { id } = payload;
    if (!id) {
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    // initiate transaction
    const request = await responseEndpoint.initiateTransaction({
      responseType: "id_token",
      redirectUriReturnedByResponseUri:
        Env().redirectUriReturnedByResponseUri + "?type=delete_comment",
      expiredIn: Env().expiredIn.requestAtResponseEndpoint,
    });
    const clientId = Env().clientId;
    const clientIdScheme = Env().clientIdScheme;
    const f = async () => {
      if (clientIdScheme === "x509_san_dns") {
        const requestUri = `${Env().requestUri}?type=delete_comment&id=${request.id}`;
        return { clientId, requestUri };
      } else {
        const responseType = "id_token";
        const opts: GenerateRequestObjectOptions = {
          responseType,
          responseMode: "direct_post",
          clientIdScheme,
          responseUri,
          clientMetadata: getClientMetadata(),
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

    await stateRepository.putState(request.id, "started", {
      targetId: id,
      expiredIn: Env().expiredIn.postState,
    });
    logger.info("generateAuthRequest end");
    return {
      ok: true,
      payload: presenter(vpRequest, request.id, request.transactionId),
    };
  };

  const getRequestObject = async (
    requestId: string,
    presentationDefinitionId: string,
  ): Promise<Result<string, NotSuccessResult>> => {
    const request = await responseEndpoint.getRequest(requestId);
    const presentationDefinition = await verifier.getPresentationDefinitionMap(
      presentationDefinitionId,
    );

    if (!request || !presentationDefinition) {
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    const responseType = "vp_token id_token";
    const clientIdScheme = Env().clientIdScheme;
    const opts: GenerateRequestObjectOptions = {
      responseType,
      responseMode: "direct_post",
      clientIdScheme,
      responseUri: responseUri,
      clientMetadata: getClientMetadata(),
      presentationDefinition,
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

  const getRequestObject4Delete = async (
    requestId: string,
  ): Promise<Result<string, NotSuccessResult>> => {
    const request = await responseEndpoint.getRequest(requestId);

    if (!request) {
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    const responseType = "id_token";
    const clientIdScheme = Env().clientIdScheme;
    const opts: GenerateRequestObjectOptions = {
      responseType,
      responseMode: "direct_post",
      clientIdScheme,
      responseUri: responseUri,
      clientMetadata: getClientMetadata(),
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
   *
   * @param presentationDefinitionId
   */
  const getPresentationDefinition = async (
    presentationDefinitionId: string,
  ) => {
    return await verifier.getPresentationDefinitionMap(
      presentationDefinitionId,
    );
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
    await stateRepository.putState(requestId, "invalid_submission", {
      expiredIn: Env().expiredIn.postState,
    });
  };

  /**
   *
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

    // id token
    const { idToken } = payload;
    const getIdToken = await siopv2.getIdToken(idToken, nonce);
    if (!getIdToken.ok) {
      await updateState2InvalidSubmission(requestId);
      return {
        ok: false,
        error: handleIdTokenError(getIdToken.error),
      };
    }

    logger.info("processCredential1 start");
    // credential 1
    const cred1 = await processCredential1(
      verifier,
      INPUT_DESCRIPTOR_ID1,
      payload,
      nonce,
    );
    if (!cred1.ok) {
      logger.info(`cred1 is not ok : ${JSON.stringify(cred1.error)}`);
      await updateState2InvalidSubmission(requestId);
      return { ok: false, error: cred1.error };
    }

    logger.info("processCredential2 start");
    // credential 2
    const cred2 = await processCredential2(
      verifier,
      INPUT_DESCRIPTOR_ID2,
      payload,
      nonce,
    );
    if (!cred2.ok) {
      logger.info(`cred2 is not ok : ${JSON.stringify(cred2.error)}`);
      await updateState2InvalidSubmission(requestId);
      return { ok: false, error: cred2.error };
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

    // save data to session
    const { url } = cred1.payload.decoded.vc.credentialSubject;
    const urlResources = await callGetUrl(Env().apiHost, url);
    let urlResource: UrlDocument | undefined = undefined;
    if (urlResources.length === 0) {
      const ret = await callPostUrl(Env().mainNodeHost, url);
      if (ret.code === 200) {
        urlResource = ret.urlDoc;
      } else if (ret.code === 409) {
        urlResource = await callGetUrlMetadata(Env().apiHost, ret.id);
      } else {
        return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
      }
    } else {
      urlResource = urlResources[0];
    }

    const comment = cred1.payload.raw;
    const { affiliation, icon } = cred2.payload;

    await sessionRepository.putWaitCommitData(
      requestId,
      idToken!,
      comment,
      affiliation,
      { expiredIn: Env().expiredIn.postSession },
    );

    // update post state
    await stateRepository.putState(requestId, "consumed");

    logger.info("consumeAuthResponse end");
    return {
      ok: true,
      payload: presenter(requestId, comment, urlResource, {
        sub: getIdToken.payload.idToken.sub,
        id_token: idToken!,
        icon,
        organization: affiliation,
      }),
    };
  };

  /**
   *
   * @param responseCode
   * @param transactionId
   */
  const exchangeAuthResponse4Delete = async (
    responseCode: string,
    transactionId: string | undefined,
  ): Promise<VoidResult<NotSuccessResult>> => {
    logger.info("consumeAuthResponse start");

    // exchange response code for auth response
    const exchange = await responseEndpoint.exchangeResponseCodeForAuthResponse(
      responseCode,
      transactionId,
    );
    if (!exchange.ok) {
      return { ok: false, error: handleEndpointError(exchange.error) };
    }
    const { requestId, payload } = exchange.payload;

    const updateState2InvalidSubmission = async () => {
      await stateRepository.putState(requestId, "invalid_submission", {
        expiredIn: Env().expiredIn.postState,
      });
    };

    // vp request
    const getRequest = await verifier.getRequest(requestId);
    if (!getRequest.ok) {
      const { type } = getRequest.error;
      if (type !== "CONSUMED" && type !== "EXPIRED") {
        await updateState2InvalidSubmission();
      }
      return {
        ok: false,
        error: handleRequestError(requestId, getRequest.error),
      };
    }
    const { nonce } = getRequest.payload;

    // get and check state
    const state = await stateRepository.getState(requestId);
    const checkedState = checkStateForDelete(state);
    if (!checkedState.ok) {
      if (checkedState.error.type !== "CONFLICT") {
        await updateState2InvalidSubmission();
      }
      return { ok: false, error: checkedState.error };
    }

    // id token
    const { idToken } = payload;
    const getIdToken = await siopv2.getIdToken(idToken, nonce);
    if (!getIdToken.ok) {
      await updateState2InvalidSubmission();
      return {
        ok: false,
        error: handleIdTokenError(getIdToken.error),
      };
    }

    // call delete
    const statusCode = await callDelete(
      Env().mainNodeHost,
      idToken!,
      checkedState.payload.id,
    );
    let error: NotSuccessResult | null = null;
    if (!statusCode) {
      return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
    } else if (statusCode === 204) {
      // consume request
      const consumeRequest = await verifier.consumeRequest(requestId);
      if (!consumeRequest.ok) {
        error = handleRequestError(requestId, consumeRequest.error);
      }
      // update state
      await stateRepository.putState(requestId, "committed", {
        expiredIn: Env().expiredIn.postState,
      });
    } else if (400 <= statusCode && statusCode < 500) {
      // update state
      await updateState2InvalidSubmission();
      error = { type: "INVALID_PARAMETER", message: "failed delete call." };
      // consume request
      const consumeRequest = await verifier.consumeRequest(requestId);
      if (!consumeRequest.ok) {
        error = handleRequestError(requestId, consumeRequest.error);
      }
    } else {
      logger.error("unexpected status code", statusCode);
      error = { type: "UNEXPECTED_ERROR", message: "failed delete call." };
    }
    logger.info("consumeAuthResponse end");
    if (error) {
      return { ok: false, error };
    } else {
      return { ok: true };
    }
  };

  /**
   *
   * @param requestId
   * @param presenter
   */
  const confirmComment = async <T>(
    requestId: string | undefined,
    presenter: CommitDataPresenter<T>,
  ): Promise<Result<T, NotSuccessResult>> => {
    if (!requestId) {
      return {
        ok: false,
        error: {
          type: "INVALID_HEADER",
          message: "request-id should be sent.",
        },
      };
    }
    const getData = await getSessionData(requestId, sessionRepository);
    if (getData.ok) {
      const { claimJwt, idToken, affiliationJwt } = getData.payload.data;
      const register = async () => {
        // https://node.boolcheck.com/database/claims
        const input = Env().mainNodeHost + "/database/claims";
        const body = JSON.stringify({
          comment: claimJwt,
          id_token: idToken,
          affiliation: affiliationJwt,
        });
        try {
          const response = await fetch(input, {
            method: "POST",
            headers: {
              "Content-Type": "application/json; charset=utf-8",
            },
            body,
          });
          const data = (await response.json()) as unknown as { id: string };
          return data.id;
        } catch (error) {
          console.error(error);
          return undefined;
        }
      };
      const newId = await register();
      if (newId) {
        await stateRepository.putState(requestId, "committed");
        return { ok: true, payload: presenter(newId) };
      } else {
        return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
      }
    } else {
      return { ok: false, error: getData.error };
    }
  };

  /**
   *
   * @param requestId
   */
  const cancelComment = async (
    requestId: string | undefined,
  ): Promise<VoidResult<NotSuccessResult>> => {
    if (!requestId) {
      return {
        ok: false,
        error: {
          type: "INVALID_HEADER",
          message: "session-id should be sent.",
        },
      };
    }
    const getData = await getSessionData(requestId, sessionRepository);
    if (getData.ok) {
      await stateRepository.putState(requestId, "canceled");
      return { ok: true };
    } else {
      return { ok: false, error: getData.error };
    }
  };

  /**
   *
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
    generateAuthRequest4Delete,
    getRequestObject,
    getRequestObject4Delete,
    getPresentationDefinition,
    receiveAuthResponse,
    exchangeAuthResponse,
    exchangeAuthResponse4Delete,
    confirmComment,
    cancelComment,
    getStates,
  };
};

export type CommitData = (
  data: WaitCommitData,
) => Promise<Result<{ newId: string }, NotSuccessResult>>;

const getSessionData = async (
  sessionId: string,
  sessionRepository: ReturnType<typeof initSessionRepository>,
): Promise<
  Result<WaitCommitData, { type: "NOT_FOUND" | "EXPIRED"; message: string }>
> => {
  const getData = await sessionRepository.getSession<WaitCommitData>(sessionId);
  if (getData.ok) {
    return getData;
  } else {
    const { type } = getData.error;
    let message: string = "";
    if (type === "NOT_FOUND") {
      message = "session data is not found.";
    }
    if (type === "EXPIRED") {
      message = "session data is expired.";
    }
    return { ok: false, error: { type, message } };
  }
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

interface IdGenerable {
  generateId?: () => string;
}
