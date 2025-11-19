import { v4 as uuidv4 } from "uuid";
import { PrivateJwk } from "elliptic-jwk";

import { Result } from "../tool-box/index.js";
import {
  ConsumedError,
  DcqlCredentialQuery,
  DcqlQuery,
  ExpiredError,
  UnexpectedError,
  NotFoundError,
} from "./types.js";

import { AuthResponsePayload, VpRequest } from "./response-endpoint.js";
import {
  camelToSnake,
  generateRequestObjectJwt,
  GenerateRequestObjectOptions,
  generateRequestObjectPayload,
  MissingSignerKey,
  UnsupportedClientIdSchemeError,
} from "./auth-request.js";
// Removed unused imports: extractNestedCredential, extractCredential, extractPresentation, getDescriptorMap
// These were only used by deprecated PEX methods
import { getCurrentUnixTimeInSeconds, isExpired } from "../utils/data-util.js";

export interface VpRequestAtVerifier {
  id: string;
  nonce: string;
  session?: string;
  transactionId?: string;
  issuedAt: number;
  expiredIn: number;
  consumedAt: number;
  encryptionPublicJwk?: string; // エフェメラル公開鍵（JWK形式、JSON文字列） - Response Endpointから受け取る
  encryptionPrivateJwk?: string; // エフェメラル秘密鍵（JWK形式、JSON文字列） - Response Endpointで生成
}

export interface VerifierDatastore {
  saveRequest: (request: VpRequestAtVerifier) => Promise<void>;
  getRequest: (requestId: string) => Promise<VpRequestAtVerifier | null>;
  // Removed: savePresentationDefinition and getPresentationDefinition (PEX deprecated)
}

export type AuthorizationRequest = {
  clientId: string;
  params?: Record<string, any>;
  requestUri?: string;
};

export interface InvalidSubmission {
  type: "INVALID_SUBMISSION";
  reason: string;
}
export interface NoSubmission {
  type: "NO_SUBMISSION";
}
export interface ValidateFailure {
  type: "VALIDATE_FAILURE";
}

export type DescriptorError =
  | NotFoundError
  | ExpiredError
  | UnexpectedError
  | InvalidSubmission
  | NoSubmission;
export type PresentationError =
  | ExpiredError
  | UnexpectedError
  | InvalidSubmission
  | NoSubmission;
export type CredentialError = InvalidSubmission;

export type GetRequestError =
  | NotFoundError
  | ExpiredError
  | ConsumedError
  | UnexpectedError;

export type Verifier = ReturnType<typeof initVerifier>;
/**
 * The Verifier function provides functionality to start vp requests and generate presentation definitions using the provided datastore.
 * @param datastore - A datastore object used to save request data
 * @returns An object that provides two methods: `startRequest` and `generatePresentationDefinition`
 */
export const initVerifier = (datastore: VerifierDatastore) => {
  const state: { authResponse?: AuthResponsePayload } = {};
  /**
   * Starts a vp request and saves it in the datastore.
   * Generates a unique nonce for the request, sets the issued time, and specifies an expiration time.
   * @param request - The verification request data
   * @param clientId
   * @param opts - Optional object where you can specify an expiration time (expiredIn).
   * @returns A Promise that resolves to `VpRequestAtVerifier` type with the request data
   */
  const startRequest = async (
    request: VpRequest,
    clientId: string,
    opts?: {
      expiredIn?: number;
      issuerJwk?: PrivateJwk;
      requestObject?: GenerateRequestObjectOptions;
      generateId?: () => string;
      x5c?: string[];
    },
  ) => {
    const nonce = opts?.generateId ? opts.generateId() : uuidv4();
    const __request: VpRequestAtVerifier = {
      id: request.id,
      nonce,
      issuedAt: new Date().getTime() / 1000,
      expiredIn: opts?.expiredIn ?? 3600,
      consumedAt: 0,
    };
    if (request.transactionId) {
      __request.transactionId = request.transactionId;
    }

    // エフェメラル鍵ペアはResponse Endpoint側で生成される
    // request.encryptionPublicJwkがあればclient_metadataに追加
    if (request.encryptionPublicJwk) {
      __request.encryptionPrivateJwk = request.encryptionPrivateJwk;
    }

    await datastore.saveRequest(__request);

    const __opts: GenerateRequestObjectOptions = {
      ...opts?.requestObject,
      state: opts?.requestObject?.state || __request.id,
      nonce: opts?.requestObject?.nonce || __request.nonce,
    };

    // client_metadataに暗号化情報を追加
    if (request.encryptionPublicJwk) {
      const encryptionPublicJwk = JSON.parse(request.encryptionPublicJwk);
      __opts.responseMode = "direct_post.jwt";
      __opts.clientMetadata = {
        ...(__opts.clientMetadata || {}),
        jwks: {
          keys: [encryptionPublicJwk],
        },
        encryptedResponseEncValuesSupported: ["A128GCM"],
      };
    }

    // https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#name-verifier-metadata-managemen
    const clientIdScheme =
      opts?.requestObject?.clientIdScheme || "redirect_uri";
    if (clientIdScheme === "redirect_uri") {
      const authRequest = generateRequestObjectPayload(clientId, __opts);
      return {
        clientId,
        params: camelToSnake(authRequest),
      };
    } else if (
      clientIdScheme === "x509_san_dns" ||
      clientIdScheme === "x509_san_uri"
    ) {
      if (opts && opts.issuerJwk) {
        const { issuerJwk } = opts;
        return {
          clientId,
          request: await generateRequestObjectJwt(clientId, issuerJwk, {
            ...__opts,
            x509CertificateInfo: { x5c: opts.x5c },
          }),
        };
      } else {
        throw new MissingSignerKey(
          "The provided client_id_scheme needs to sign request object",
        );
      }
    } else {
      throw new UnsupportedClientIdSchemeError(
        "The provided client_id_scheme is not supported in the current implementation.",
      );
    }
  };
  const getRequest = async (
    requestId: string,
  ): Promise<Result<VpRequestAtVerifier, GetRequestError>> => {
    const subject = "VpRequest";
    const identifier = requestId;
    try {
      const request = await datastore.getRequest(requestId);
      if (!request) {
        return { ok: false, error: { type: "NOT_FOUND", subject, identifier } };
      } else {
        if (isExpired(request.issuedAt, request.expiredIn)) {
          return { ok: false, error: { type: "EXPIRED", subject, identifier } };
        }
        if (0 < request.consumedAt) {
          return {
            ok: false,
            error: { type: "CONSUMED", subject, identifier },
          };
        }
      }
      return { ok: true, payload: request };
    } catch (err) {
      console.error(err);
      return { ok: false, error: { type: "UNEXPECTED_ERROR", cause: err } };
    }
  };

  const consumeRequest = async (
    requestId: string,
  ): Promise<Result<VpRequestAtVerifier, GetRequestError>> => {
    // const request = await datastore.getRequest(requestId);
    const request = await getRequest(requestId);
    if (!request.ok) {
      return request;
    }
    const __request = {
      ...request.payload,
      consumedAt: getCurrentUnixTimeInSeconds(),
    };
    try {
      await datastore.saveRequest(__request);
      return { ok: true, payload: __request };
    } catch (err) {
      console.error(err);
      return { ok: false, error: { type: "UNEXPECTED_ERROR", cause: err } };
    }
  };

  // Removed: generatePresentationDefinition, getPresentationDefinition, getPresentationDefinitionMap
  // These methods are part of the deprecated PEX flow and replaced by DCQL

  // Deprecated PEX methods removed (getOptionalDescriptor, getDescriptor, getPresentation, getCredential)
  // Use extractCredentialFromVpToken for DCQL-based VP Token processing

  const setAuthResponse = (authResponse: AuthResponsePayload) => {
    state.authResponse = authResponse;
  };
  const getAuthResponse = () => {
    return state.authResponse;
  };

  /**
   * Generates a DCQL query from credential queries
   * @param credentialQueries - An array of credential queries
   * @returns A DCQL query object
   */
  const generateDcqlQuery = (
    credentialQueries: DcqlCredentialQuery[],
  ): DcqlQuery => {
    return {
      credentials: credentialQueries,
    };
  };

  return {
    startRequest,
    getRequest,
    consumeRequest,
    setAuthResponse,
    getAuthResponse,
    generateDcqlQuery,
    // Removed: generatePresentationDefinition, getPresentationDefinition, getPresentationDefinitionMap
    // Removed: getCredential, getDescriptor, getOptionalDescriptor, getPresentation (PEX deprecated methods)
  };
};
