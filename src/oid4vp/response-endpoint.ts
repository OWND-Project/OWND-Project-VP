import { v4 as uuidv4 } from "uuid";
import { decodeProtectedHeader, decodeJwt } from "jose";
import { decodeSDJWT } from "@meeco/sd-jwt";
import { Result } from "../tool-box/index.js";
import { ExpiredError, NotFoundError, UnexpectedError } from "./types.js";
import getLogger from "../services/logging-service.js";
import { isExpired } from "../utils/data-util.js";
import { decryptJWE } from "../helpers/jwt-helper.js";

const logger = getLogger();

export interface VpRequest {
  id: string;
  nonce?: string; // Nonce for replay protection
  responseType: ResponseType;
  redirectUriReturnedByResponseUri?: string;
  transactionId?: string;
  issuedAt: number;
  expiredIn: number;
  encryptionPublicJwk?: string; // エフェメラル公開鍵（JWK形式、JSON文字列）
  encryptionPrivateJwk?: string; // エフェメラル秘密鍵（JWK形式、JSON文字列）
  dcqlQuery?: string; // DCQL credential queries (JSON文字列)
}

export interface AuthResponsePayload {
  vpToken: Record<string, string[]>; // DCQL: JSON object with credential query ID as key
  presentationSubmission?: string; // Deprecated: Not used in DCQL flow
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

// ============================================
// VP Token Verification Types
// ============================================

/**
 * 検証メタデータ
 */
export interface VerificationMetadata {
  /** 鍵のソース: x5c（証明書チェーン）, jwk（埋め込みJWK）, secret */
  keySource: "x5c" | "jwk" | "secret";
  /** 使用されたアルゴリズム */
  algorithm?: string;
  /** 証明書チェーン検証の結果（x5cの場合のみ） */
  certificateChainVerified?: boolean;
}

/**
 * クレデンシャル検証結果
 */
export type CredentialVerificationResult =
  | { status: "verified"; credential: string; payload?: any; verificationMetadata?: VerificationMetadata }
  | { status: "invalid"; error: string; verificationMetadata?: VerificationMetadata }
  | { status: "not_found" };

/**
 * VP Token全体の検証結果
 */
export interface VpTokenVerificationResult {
  credentials: Record<string, CredentialVerificationResult[]>;
}

/**
 * クレデンシャル検証コールバック
 * SD-JWT署名検証などのアプリケーション固有ロジックを注入
 */
export interface VpTokenVerificationCallback {
  /**
   * VP Token内のクレデンシャルを検証
   * @param credential - SD-JWT形式のクレデンシャル
   * @param nonce - 期待されるnonce値
   * @returns 検証結果（検証メタデータ含む）
   */
  verifyCredential: (
    credential: string,
    nonce: string,
  ) => Promise<
    | { ok: true; payload: { verified: true; decodedPayload?: any; verificationMetadata?: VerificationMetadata } }
    | { ok: false; error: string; verificationMetadata?: VerificationMetadata }
  >;
}

/**
 * receiveAuthResponseのオプション
 */
export interface ReceiveAuthResponseOptions {
  expiredIn?: number;
  generateId?: () => string;
  /** VP Token検証コールバック（オプション） */
  verificationCallback?: VpTokenVerificationCallback;
}

/**
 * receiveAuthResponseの戻り値
 */
export interface ReceiveAuthResponseResult {
  redirectUri?: string;
  responseCode?: string;
  requestId: string;
  verificationResult?: VpTokenVerificationResult;
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

// ============================================
// VP Token Verification Helper Functions
// ============================================

/**
 * Key Binding JWT nonce検証
 * SD-JWTからKey Binding JWTを抽出し、nonceを検証
 * @param sdJwt - SD-JWT形式のクレデンシャル
 * @param expectedNonce - 期待されるnonce値
 * @param requestId - リクエストID（ログ用）
 * @returns nonce検証結果
 */
const verifyKeyBindingNonce = (
  sdJwt: string,
  expectedNonce: string,
  requestId: string,
): boolean => {
  try {
    const decoded = decodeSDJWT(sdJwt);
    if (!decoded.keyBindingJWT) {
      logger.info(`[requestId=${requestId}] Key binding JWT is missing`);
      return false;
    }
    const kbPayload = decodeJwt<{ nonce: string }>(decoded.keyBindingJWT);
    if (kbPayload.nonce !== expectedNonce) {
      logger.info(
        `[requestId=${requestId}] Nonce mismatch: expected ${expectedNonce}, got ${kbPayload.nonce}`,
      );
      return false;
    }
    return true;
  } catch (err) {
    logger.error(`[requestId=${requestId}] Failed to verify key binding nonce: ${err}`);
    return false;
  }
};

/**
 * VP Token検証（コールバック経由）
 * DCQL形式のVP Tokenを解析し、各クレデンシャルを検証
 * @param vpToken - DCQL形式のVP Token
 * @param nonce - 期待されるnonce値
 * @param callback - 検証コールバック
 * @param requestId - リクエストID（ログ用）
 * @returns 検証結果
 */
const verifyVpTokenWithCallback = async (
  vpToken: Record<string, string[]>,
  nonce: string,
  callback: VpTokenVerificationCallback,
  requestId: string,
): Promise<VpTokenVerificationResult> => {
  const results: Record<string, CredentialVerificationResult[]> = {};

  for (const [queryId, credentials] of Object.entries(vpToken)) {
    if (!credentials || credentials.length === 0) {
      logger.info(`[requestId=${requestId}] No credentials found for queryId: ${queryId}`);
      results[queryId] = [{ status: "not_found" }];
      continue;
    }

    // 全クレデンシャルを検証
    const queryResults: CredentialVerificationResult[] = [];
    for (let i = 0; i < credentials.length; i++) {
      const credential = credentials[i];
      // Key Binding JWT nonce検証
      const nonceValid = verifyKeyBindingNonce(credential, nonce, requestId);
      if (!nonceValid) {
        queryResults.push({ status: "invalid", error: "nonce_mismatch" });
        continue;
      }

      // コールバックで検証（SD-JWT署名検証など）
      try {
        const verifyResult = await callback.verifyCredential(credential, nonce);
        if (verifyResult.ok) {
          const metadata = verifyResult.payload.verificationMetadata;
          const metadataStr = metadata
            ? `keySource=${metadata.keySource}, alg=${metadata.algorithm || "N/A"}, certChainVerified=${metadata.certificateChainVerified ?? "N/A"}`
            : "N/A";
          logger.info(`[requestId=${requestId}] Credential ${i + 1} verified for queryId: ${queryId} (${metadataStr})`);
          queryResults.push({
            status: "verified",
            credential,
            payload: verifyResult.payload.decodedPayload,
            verificationMetadata: metadata,
          });
        } else {
          const metadata = verifyResult.verificationMetadata;
          const metadataStr = metadata
            ? `keySource=${metadata.keySource}, alg=${metadata.algorithm || "N/A"}`
            : "";
          logger.info(`[requestId=${requestId}] Credential ${i + 1} invalid for queryId: ${queryId}: ${verifyResult.error}${metadataStr ? ` (${metadataStr})` : ""}`);
          queryResults.push({
            status: "invalid",
            error: verifyResult.error,
            verificationMetadata: metadata,
          });
        }
      } catch (err) {
        logger.error(`[requestId=${requestId}] Credential verification failed: ${err}`);
        queryResults.push({
          status: "invalid",
          error: String(err),
        });
      }
    }
    results[queryId] = queryResults;
  }

  return { credentials: results };
};

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
    enableEncryption?: boolean; // VP Token暗号化を有効化
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

    // エフェメラル鍵ペア生成（暗号化有効時）
    if (config.enableEncryption) {
      const { generateEphemeralKeyPair } = await import(
        "../helpers/jwt-helper.js"
      );
      const { publicJwk, privateJwk } = await generateEphemeralKeyPair();
      __request.encryptionPublicJwk = JSON.stringify(publicJwk);
      __request.encryptionPrivateJwk = JSON.stringify(privateJwk);
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
   * Walletからの認証レスポンスを受信・処理
   * @param payload - Walletからのレスポンスペイロード
   * @param opts - オプション（検証コールバック含む）
   */
  const receiveAuthResponse = async (
    payload: any,
    opts?: ReceiveAuthResponseOptions,
  ): Promise<Result<ReceiveAuthResponseResult, ReceiveAuthResponseError>> => {
    // JWE暗号化レスポンスの検出と復号化
    let decryptedPayload = payload;
    if (payload.response) {
      // JWE形式（direct_post.jwt）
      const state = payload.state;
      if (!state) {
        return {
          ok: false,
          error: { type: "INVALID_AUTH_RESPONSE_PAYLOAD" },
        };
      }

      // stateからrequestを取得
      const __request = await datastore.getRequest(state);
      if (!__request) {
        return { ok: false, error: { type: "REQUEST_ID_IS_NOT_FOUND" } };
      }

      if (!__request.encryptionPrivateJwk) {
        logger.error(`[requestId=${state}] Encrypted response received but no encryption key found`);
        return {
          ok: false,
          error: { type: "INVALID_AUTH_RESPONSE_PAYLOAD" },
        };
      }

      // JWE復号化
      try {
        logger.info(`[requestId=${state}] Attempting JWE decryption`);
        const privateJwk = JSON.parse(__request.encryptionPrivateJwk);
        const decrypted = await decryptJWE(payload.response, privateJwk);
        // 復号化されたペイロードにstateを追加
        decryptedPayload = {
          ...decrypted,
          state,
        };
        logger.info(`[requestId=${state}] JWE decryption successful`);
      } catch (error) {
        logger.error(`[requestId=${state}] JWE decryption failed:`, error);
        return {
          ok: false,
          error: { type: "INVALID_AUTH_RESPONSE_PAYLOAD" },
        };
      }
    }

    const { state, vp_token, id_token } = decryptedPayload;

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
    const { responseType, redirectUriReturnedByResponseUri } = __request;
    if (responseType === "vp_token") {
      if (!vp_token) {
        return { ok: false, error };
      }
    } else if (responseType === "vp_token id_token") {
      if (!vp_token || !id_token) {
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

    // VP Token検証（コールバックが提供されている場合）
    let verificationResult: VpTokenVerificationResult | undefined;
    if (opts?.verificationCallback && vp_token && __request.nonce) {
      logger.info(`[requestId=${state}] Starting VP Token verification`);
      verificationResult = await verifyVpTokenWithCallback(
        vp_token,
        __request.nonce,
        opts.verificationCallback,
        state,
      );
      logger.info(
        `[requestId=${state}] VP Token verification completed: ${JSON.stringify(
          Object.keys(verificationResult.credentials).map((k) => ({
            queryId: k,
            results: verificationResult!.credentials[k].map((r) => r.status),
          })),
        )}`,
      );
    }

    return {
      ok: true,
      payload: {
        redirectUri: redirectUriReturnedByResponseUri,
        responseCode: __response.id,
        requestId: state,
        verificationResult,
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
        const { vpToken, idToken } = __authResponse.payload;
        // Note: presentationSubmission validation removed (DCQL flow doesn't use it)
        if (responseType === "vp_token") {
          if (!vpToken) {
            return { ok: false, error };
          }
        } else if (responseType === "vp_token id_token") {
          if (!vpToken || !idToken) {
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
    saveRequest: datastore.saveRequest,
    receiveAuthResponse,
    exchangeResponseCodeForAuthResponse,
  };
};
