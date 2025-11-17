import { v4 as uuidv4 } from "uuid";
import { Result } from "../tool-box/index.js";
import { ExpiredError, NotFoundError, UnexpectedError } from "./types.js";
import getLogger from "../services/logging-service.js";
import { isExpired } from "../utils/data-util.js";

const logger = getLogger();

export interface VpRequest {
  id: string;
  responseType: ResponseType;
  redirectUriReturnedByResponseUri?: string;
  transactionId?: string;
  issuedAt: number;
  expiredIn: number;
}

export interface AuthResponsePayload {
  vpToken: string | string[];
  presentationSubmission: string;
  idToken?: string;
}

export interface AuthResponse {
  id: string;
  requestId: string;
  payload: AuthResponsePayload;
  issuedAt: number;
  expiredIn: number;
}

export interface ResponseEndpointDatastore {
  saveRequest: (request: VpRequest) => Promise<void>;
  getRequest: (requestId: string) => Promise<VpRequest | null>;
  saveResponse: (response: AuthResponse) => Promise<void>;
  getResponse: (responseCode: string) => Promise<AuthResponse | null>;
}

type InvalidAuthResponsePayload = "INVALID_AUTH_RESPONSE_PAYLOAD";
type RequestIdIsNotFound = "REQUEST_ID_IS_NOT_FOUND";
type RequestIdIsExpired = "REQUEST_ID_IS_EXPIRED";
type ResponseIsNotFound = "RESPONSE_IS_NOT_FOUND";
type ResponseIsExpired = "RESPONSE_IS_EXPIRED";
type TransactionIdDoesNotMatch = "TRANSACTION_ID_DOES_NOT_MATCH";

interface ReceiveAuthResponseError {
  type:
    | InvalidAuthResponsePayload
    | RequestIdIsNotFound
    | RequestIdIsExpired
    | UnexpectedError;
}
interface InvalidAuthResponsePayloadError {
  type: InvalidAuthResponsePayload;
}

export type ResponseType = "vp_token" | "vp_token id_token" | "id_token";
export type EndpointError =
  | NotFoundError
  | ExpiredError
  | InvalidAuthResponsePayloadError
  | UnexpectedError;

export type ResponseEndpoint = ReturnType<typeof initResponseEndpoint>;
/**
 * The ResponseEndpoint function provides functionality to initiate a transaction and save the corresponding request in the datastore.
 * @param datastore - A datastore object used to save request data
 * @returns An object with the `initiateTransaction` method
 */
export const initResponseEndpoint = (datastore: ResponseEndpointDatastore) => {
  /**
   * Initiates a transaction and saves the request in the datastore.
   * Creates a unique request ID, sets the issued time, and optionally assigns a transaction ID and expiration time.
   * @param config - Configuration object where you can specify whether to use a transaction ID (useTransactionId) and set an expiration time (expiredIn).
   * @returns A Promise that resolves to a `VpRequest` containing the request data
   */
  const initiateTransaction = async (config: {
    responseType: ResponseType;
    redirectUriReturnedByResponseUri?: string;
    useTransactionId?: boolean;
    expiredIn?: number;
    generateId?: () => string;
  }): Promise<VpRequest> => {
    const __request: VpRequest = {
      id: config.generateId ? config.generateId() : uuidv4(),
      responseType: config.responseType,
      redirectUriReturnedByResponseUri: config.redirectUriReturnedByResponseUri,
      issuedAt: new Date().getTime() / 1000,
      expiredIn: config?.expiredIn ?? 3600,
    };
    if (config.useTransactionId) {
      __request.transactionId = config.generateId
        ? config.generateId()
        : uuidv4();
    }
    await datastore.saveRequest(__request);

    return __request;
  };

  /**
   *
   * @param state
   */
  const getRequest = async (state: string) => {
    return await datastore.getRequest(state);
  };

  /**
   *
   * @param payload
   * @param opts
   */
  const receiveAuthResponse = async (
    payload: any,
    // authResponse: AuthResponsePayload,
    opts?: {
      expiredIn?: number;
      generateId?: () => string;
    },
  ): Promise<
    Result<
      { redirectUri?: string; responseCode?: string },
      ReceiveAuthResponseError
    >
  > => {
    const { state, vp_token, presentation_submission, id_token } = payload;

    const error: InvalidAuthResponsePayloadError = {
      type: "INVALID_AUTH_RESPONSE_PAYLOAD",
    };
    if (!state) {
      return { ok: false, error };
    }
    const __request = await datastore.getRequest(state);
    if (!__request) {
      return { ok: false, error: { type: "REQUEST_ID_IS_NOT_FOUND" } };
    }
    const { id, responseType, redirectUriReturnedByResponseUri } = __request;
    if (responseType === "vp_token") {
      if (!vp_token || !presentation_submission) {
        return { ok: false, error };
      }
    } else if (responseType === "vp_token id_token") {
      if (!vp_token || !presentation_submission || !id_token) {
        return { ok: false, error };
      }
    } else if (responseType === "id_token") {
      if (!id_token) {
        return { ok: false, error };
      }
    } else {
      return { ok: false, error };
    }
    const authResponse: Partial<AuthResponsePayload> = {};
    if (vp_token) {
      authResponse.vpToken = vp_token;
      authResponse.presentationSubmission = presentation_submission;
    }
    if (id_token) {
      authResponse.idToken = id_token;
    }

    const __response: AuthResponse = {
      id: opts?.generateId ? opts.generateId() : uuidv4(),
      requestId: state,
      payload: authResponse as AuthResponsePayload,
      issuedAt: new Date().getTime() / 1000,
      expiredIn: opts?.expiredIn ?? 3600,
    };
    await datastore.saveResponse(__response);
    // return __response.id;
    return {
      ok: true,
      payload: {
        redirectUri: redirectUriReturnedByResponseUri,
        responseCode: __response.id,
      },
    };
  };

  /**
   *
   * @param responseCode
   * @param transactionId
   */
  const exchangeResponseCodeForAuthResponse = async (
    responseCode: string,
    transactionId?: string,
  ): Promise<Result<AuthResponse, EndpointError>> => {
    try {
      const __authResponse = await datastore.getResponse(responseCode);
      if (__authResponse) {
        const subject = "VpResponse";
        const identifier = responseCode;
        if (isExpired(__authResponse.issuedAt, __authResponse.expiredIn)) {
          return { ok: false, error: { type: "EXPIRED", subject, identifier } };
        }
        const __request = await datastore.getRequest(__authResponse.requestId);
        if (
          __request!.transactionId &&
          __request!.transactionId !== transactionId
        ) {
          return {
            ok: false,
            error: { type: "NOT_FOUND", subject: "transaction-id" },
          };
        }

        const error: InvalidAuthResponsePayloadError = {
          type: "INVALID_AUTH_RESPONSE_PAYLOAD",
        };
        const { responseType } = __request!;
        const { vpToken, presentationSubmission, idToken } =
          __authResponse.payload;
        if (responseType === "vp_token") {
          if (!vpToken || !presentationSubmission) {
            return { ok: false, error };
          }
        } else if (responseType === "vp_token id_token") {
          if (!vpToken || !presentationSubmission || !idToken) {
            return { ok: false, error };
          }
        } else if (responseType === "id_token") {
          if (!idToken) {
            return { ok: false, error };
          }
        } else {
          return { ok: false, error };
        }
        logger.info(
          `vpToken type at exchangeResponseCodeForAuthResponse : ${typeof vpToken}`,
        );
        let parsedVpToken = vpToken;
        if (typeof vpToken === "string") {
          try {
            parsedVpToken = JSON.parse(vpToken);
          } catch {
            // noop
          }
        }
        logger.info(`parsed vpToken type : ${typeof parsedVpToken}`);
        return {
          ok: true,
          payload: {
            ...__authResponse,
            payload: {
              ...__authResponse.payload,
              vpToken: parsedVpToken,
            },
          },
        };
      } else {
        // return { ok: false, error: { type: "RESPONSE_IS_NOT_FOUND" } };
        return {
          ok: false,
          error: { type: "NOT_FOUND", subject: "response-code" },
        };
      }
    } catch (err) {
      return {
        ok: false,
        error: { type: "UNEXPECTED_ERROR", cause: err },
      };
    }
  };

  return {
    initiateTransaction,
    getRequest,
    receiveAuthResponse,
    exchangeResponseCodeForAuthResponse,
  };
};
