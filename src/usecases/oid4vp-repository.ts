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
  PresentationDefinition,
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
         (id, presentation_definition, nonce, client_id, response_uri, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          request.id,
          JSON.stringify(request.presentationDefinition),
          request.nonce,
          request.clientId,
          request.responseUri,
          getCurrentUnixTimeInSeconds(),
          getCurrentUnixTimeInSeconds() + 600, // デフォルト10分
        ]
      );
    },
    getRequest: async (requestId: string) => {
      const row = await db.get<any>(
        "SELECT * FROM requests WHERE id = ?",
        [requestId]
      );
      if (!row) return undefined;

      return {
        id: row.id,
        presentationDefinition: JSON.parse(row.presentation_definition),
        nonce: row.nonce,
        clientId: row.client_id,
        responseUri: row.response_uri,
      } as VpRequest;
    },
    saveResponse: async (response: AuthResponse) => {
      await db.run(
        `INSERT OR REPLACE INTO response_codes
         (code, request_id, vp_token, created_at, expires_at, used)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          response.id,
          response.requestId,
          response.vpToken,
          getCurrentUnixTimeInSeconds(),
          getCurrentUnixTimeInSeconds() + 600,
          0,
        ]
      );
    },
    getResponse: async (responseCode: string) => {
      const row = await db.get<any>(
        "SELECT * FROM response_codes WHERE code = ? AND used = 0",
        [responseCode]
      );
      if (!row) return undefined;

      // 使用済みフラグを立てる
      await db.run(
        "UPDATE response_codes SET used = 1 WHERE code = ?",
        [responseCode]
      );

      return {
        id: row.code,
        requestId: row.request_id,
        vpToken: row.vp_token,
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
         (id, presentation_definition, nonce, client_id, response_uri, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          request.id,
          JSON.stringify(request.presentationDefinition),
          request.nonce || "",
          request.clientId || "",
          request.responseUri || "",
          getCurrentUnixTimeInSeconds(),
          getCurrentUnixTimeInSeconds() + 600,
        ]
      );
    },
    getRequest: async (requestId: string) => {
      const row = await db.get<any>(
        "SELECT * FROM requests WHERE id = ?",
        [requestId]
      );
      if (!row) return undefined;

      return {
        id: row.id,
        presentationDefinition: JSON.parse(row.presentation_definition),
        nonce: row.nonce,
        clientId: row.client_id,
        responseUri: row.response_uri,
      } as VpRequestAtVerifier;
    },
    savePresentationDefinition: async (
      presentationDefinition: PresentationDefinition
    ) => {
      await db.run(
        `INSERT OR REPLACE INTO presentation_definitions
         (id, definition, created_at)
         VALUES (?, ?, ?)`,
        [
          presentationDefinition.id,
          JSON.stringify(presentationDefinition),
          getCurrentUnixTimeInSeconds(),
        ]
      );
    },
    getPresentationDefinition: async (presentationDefinitionId: string) => {
      const row = await db.get<any>(
        "SELECT * FROM presentation_definitions WHERE id = ?",
        [presentationDefinitionId]
      );
      if (!row) return undefined;

      return JSON.parse(row.definition) as PresentationDefinition;
    },
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
    claimJwt: string,
    affiliationJwt?: string,
    opts?: EntityWithLifeCycleOption
  ) => {
    const issuedAt = opts?.issuedAt ?? getCurrentUnixTimeInSeconds();
    const expiredIn = opts?.expiredIn ?? 600;

    const credentialData = {
      idToken,
      claimJwt,
      affiliationJwt,
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
        claimJwt,
        affiliationJwt,
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

  return {
    putRequestId,
    putWaitCommitData,
    getSession,
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
