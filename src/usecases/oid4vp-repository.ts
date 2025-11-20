/**
 * OID4VP Repository
 * SQLiteベースのOID4VPデータリポジトリ
 */

import { v4 as uuidv4 } from "uuid";
import { Database } from "sqlite";
import {
  PostState,
  PostStateValue,
  RequestId,
  WaitCommitData,
  EntityWithLifeCycle,
} from "./types.js";
import { getCurrentUnixTimeInSeconds, isExpired } from "../utils/data-util.js";
import {
  EntityWithLifeCycleOption,
  PostStateOption,
} from "./oid4vp-interactor.js";
import { Result } from "../tool-box/index.js";
import {
  AuthResponse,
  ResponseEndpointDatastore,
  VpRequest,
  VerifierDatastore,
  VpRequestAtVerifier,
} from "../oid4vp/index.js";

/**
 * ResponseEndpointDatastoreの初期化
 * SQLiteベースのレスポンスエンドポイント用データストア
 */
export const initResponseEndpointDatastore = (
  db: Database
): ResponseEndpointDatastore => {
  const responseEndpointDatastore: ResponseEndpointDatastore = {
    saveRequest: async (request: VpRequest) => {
      await db.run(
        `INSERT OR REPLACE INTO requests
         (id, nonce, response_type, redirect_uri_returned_by_response_uri, transaction_id, created_at, expires_at, consumed_at, encryption_private_jwk, dcql_query)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          request.id,
          (request as any).nonce || null,
          request.responseType,
          request.redirectUriReturnedByResponseUri || null,
          request.transactionId || null,
          request.issuedAt,
          request.issuedAt + request.expiredIn,
          (request as any).consumedAt || 0,
          request.encryptionPrivateJwk || null,
          request.dcqlQuery || null,
        ]
      );
    },
    getRequest: async (requestId: string) => {
      const row = await db.get<any>(
        "SELECT * FROM requests WHERE id = ?",
        [requestId]
      );
      if (!row) return null;

      return {
        id: row.id,
        nonce: row.nonce,
        responseType: row.response_type,
        redirectUriReturnedByResponseUri: row.redirect_uri_returned_by_response_uri,
        transactionId: row.transaction_id,
        issuedAt: row.created_at,
        expiredIn: row.expires_at - row.created_at,
        encryptionPublicJwk: row.encryption_public_jwk,
        encryptionPrivateJwk: row.encryption_private_jwk,
        dcqlQuery: row.dcql_query,
      } as VpRequest;
    },
    saveResponse: async (response: AuthResponse) => {
      await db.run(
        `INSERT OR REPLACE INTO response_codes
         (code, request_id, payload, created_at, expires_at, used)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          response.id,
          response.requestId,
          JSON.stringify(response.payload),
          response.issuedAt,
          response.issuedAt + response.expiredIn,
          0,
        ]
      );
    },
    getResponse: async (responseCode: string) => {
      const row = await db.get<any>(
        "SELECT * FROM response_codes WHERE code = ? AND used = 0",
        [responseCode]
      );
      if (!row) return null;

      // 使用済みフラグを立てる
      await db.run(
        "UPDATE response_codes SET used = 1 WHERE code = ?",
        [responseCode]
      );

      return {
        id: row.code,
        requestId: row.request_id,
        payload: JSON.parse(row.payload),
        issuedAt: row.created_at,
        expiredIn: row.expires_at - row.created_at,
      } as AuthResponse;
    },
  };
  return responseEndpointDatastore;
};

/**
 * VerifierDatastoreの初期化
 * SQLiteベースのVerifier用データストア
 */
export const initVerifierDatastore = (db: Database): VerifierDatastore => {
  const verifierDatastore: VerifierDatastore = {
    saveRequest: async (request: VpRequestAtVerifier) => {
      await db.run(
        `INSERT OR REPLACE INTO requests
         (id, nonce, response_type, redirect_uri_returned_by_response_uri, transaction_id, created_at, expires_at, consumed_at, encryption_private_jwk, dcql_query)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          request.id,
          request.nonce,
          (request as any).responseType || null,
          (request as any).redirectUriReturnedByResponseUri || null,
          request.transactionId || null,
          request.issuedAt,
          request.issuedAt + request.expiredIn,
          request.consumedAt,
          request.encryptionPrivateJwk || null,
          (request as any).dcqlQuery || null,
        ]
      );
    },
    getRequest: async (requestId: string) => {
      const row = await db.get<any>(
        "SELECT * FROM requests WHERE id = ?",
        [requestId]
      );
      if (!row) return null;

      return {
        id: row.id,
        nonce: row.nonce,
        transactionId: row.transaction_id,
        issuedAt: row.created_at,
        expiredIn: row.expires_at - row.created_at,
        consumedAt: row.consumed_at,
        encryptionPrivateJwk: row.encryption_private_jwk,
      } as VpRequestAtVerifier;
    },
    // Removed: savePresentationDefinition and getPresentationDefinition (PEX deprecated)
  };
  return verifierDatastore;
};

/**
 * SessionRepositoryの型定義
 */
export type SessionRepository = ReturnType<typeof initSessionRepository>;

/**
 * SessionRepositoryの初期化
 * SQLiteベースのセッション管理リポジトリ
 */
export const initSessionRepository = (db: Database) => {
  const putRequestId = async (
    requestId: string,
    opts?: EntityWithLifeCycleOption
  ) => {
    const sessionId = uuidv4();
    const issuedAt = opts?.issuedAt ?? getCurrentUnixTimeInSeconds();
    const expiredIn = opts?.expiredIn ?? 600;

    await db.run(
      `INSERT OR REPLACE INTO sessions
       (id, request_id, state, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        sessionId,
        requestId,
        "started",
        issuedAt,
        issuedAt + expiredIn,
      ]
    );

    const session: RequestId = {
      id: sessionId,
      data: { requestId },
      issuedAt,
      expiredIn,
    };

    return session;
  };

  const putWaitCommitData = async (
    requestId: string,
    idToken: string,
    learningCredentialJwt?: string,
    opts?: EntityWithLifeCycleOption
  ) => {
    const issuedAt = opts?.issuedAt ?? getCurrentUnixTimeInSeconds();
    const expiredIn = opts?.expiredIn ?? 600;

    const credentialData = {
      idToken,
      learningCredentialJwt,
    };

    await db.run(
      `UPDATE sessions
       SET credential_data = ?, consumed_at = ?
       WHERE request_id = ?`,
      [
        JSON.stringify(credentialData),
        issuedAt,
        requestId,
      ]
    );

    const session: WaitCommitData = {
      id: requestId,
      data: {
        idToken,
        learningCredentialJwt,
      },
      issuedAt,
      expiredIn,
    };

    return session;
  };

  const getSession = async <T extends EntityWithLifeCycle>(
    sessionId: string
  ): Promise<Result<T, { type: "NOT_FOUND" | "EXPIRED" }>> => {
    const row = await db.get<any>(
      "SELECT * FROM sessions WHERE id = ?",
      [sessionId]
    );

    if (!row) {
      return { ok: false, error: { type: "NOT_FOUND" } };
    }

    const session: any = {
      id: row.id,
      data: row.credential_data ? JSON.parse(row.credential_data) : { requestId: row.request_id },
      issuedAt: row.created_at,
      expiredIn: row.expires_at - row.created_at,
    };

    if (isExpired(session.issuedAt, session.expiredIn)) {
      return { ok: false, error: { type: "EXPIRED" } };
    }

    return { ok: true, payload: session as T };
  };

  const getSessionByRequestId = async <T extends EntityWithLifeCycle>(
    requestId: string
  ): Promise<Result<T, { type: "NOT_FOUND" | "EXPIRED" }>> => {
    const row = await db.get<any>(
      "SELECT * FROM sessions WHERE request_id = ?",
      [requestId]
    );

    if (!row) {
      return { ok: false, error: { type: "NOT_FOUND" } };
    }

    const session: any = {
      id: row.id,
      data: row.credential_data ? JSON.parse(row.credential_data) : { requestId: row.request_id },
      issuedAt: row.created_at,
      expiredIn: row.expires_at - row.created_at,
    };

    if (isExpired(session.issuedAt, session.expiredIn)) {
      return { ok: false, error: { type: "EXPIRED" } };
    }

    return { ok: true, payload: session as T };
  };

  return {
    putRequestId,
    putWaitCommitData,
    getSession,
    getSessionByRequestId,
  };
};

/**
 * PostStateRepositoryの型定義
 */
export type PostStateRepository = ReturnType<typeof initPostStateRepository>;

/**
 * PostStateRepositoryの初期化
 * SQLiteベースの投稿状態管理リポジトリ
 */
export const initPostStateRepository = (db: Database) => {
  const putState = async (
    requestId: string,
    value: PostStateValue,
    opts?: PostStateOption
  ) => {
    let issuedAt = opts?.issuedAt ?? getCurrentUnixTimeInSeconds();
    let expiredIn = opts?.expiredIn ?? 600;

    // 既存の状態を取得
    const prevState = await db.get<any>(
      "SELECT * FROM post_states WHERE id = ?",
      [requestId]
    );

    if (prevState) {
      issuedAt = prevState.created_at;
      expiredIn = prevState.expires_at - prevState.created_at;
    }

    const state: PostState = {
      id: requestId,
      value,
      issuedAt,
      expiredIn,
      targetId: opts?.targetId,
    };

    await db.run(
      `INSERT OR REPLACE INTO post_states
       (id, value, target_id, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [
        requestId,
        value,
        opts?.targetId || null,
        issuedAt,
        issuedAt + expiredIn,
      ]
    );

    return state;
  };

  const getState = async (requestId: string): Promise<PostState | null> => {
    const row = await db.get<any>(
      "SELECT * FROM post_states WHERE id = ?",
      [requestId]
    );

    if (!row) {
      return null;
    }

    const issuedAt = row.created_at;
    const expiredIn = row.expires_at - row.created_at;

    if (isExpired(issuedAt, expiredIn)) {
      return await putState(requestId, "expired", {
        issuedAt,
        expiredIn,
        targetId: row.target_id,
      });
    }

    const state: PostState = {
      id: row.id,
      value: row.value as PostStateValue,
      issuedAt,
      expiredIn,
      targetId: row.target_id,
    };

    return state;
  };

  return {
    putState,
    getState,
  };
};
