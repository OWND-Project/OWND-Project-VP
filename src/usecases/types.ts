import { AuthorizationRequest } from "../oid4vp/verifier.js";

export type AuthRequestPresenter<T> = (
  authRequest: AuthorizationRequest,
  requestId: string,
  transactionId?: string,
) => T;
export type AuthResponsePresenter<T> = (
  redirectUri: string,
  responseCode: string,
) => T;
export type ExchangeResponseCodePresenter<T> = (
  requestId: string,
  claimer: {
    sub: string;
    id_token: string;
    organization?: string;
    icon?: string;
  },
) => T;
export type PostStatePresenter<T> = (state: PostState | null) => T;

export interface Entity {
  id: string;
}
export interface EntityWithLifeCycle extends Entity {
  issuedAt: number;
  expiredIn: number;
}

export interface RequestId extends EntityWithLifeCycle {
  data: {
    requestId: string;
  };
}

export interface WaitCommitData extends EntityWithLifeCycle {
  data: {
    idToken: string;
    affiliationJwt?: string;
  };
}

export type PostStateValue =
  | "started"
  | "consumed"
  | "committed"
  | "expired"
  | "canceled"
  | "invalid_submission";

export interface PostState extends EntityWithLifeCycle {
  value: PostStateValue;
  targetId?: string;
}

export type TokenType = string;
