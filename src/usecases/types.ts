import { AuthorizationRequest } from "../oid4vp/verifier.js";
import { AggregatedUrl } from "../local-data/local-data-handler.js";

export interface ImageDocument {
  height?: number;
  width?: number;
  type?: string;
  url: string;
  alt?: string;
}

export interface UrlDocument {
  id: string;
  url: string;
  domain?: string;
  title?: string;
  content_type?: string;
  description?: string;
  search?: string;
  image?: string;
  ogp?: any;
  created_at: string;
}

export interface ClaimerDocument {
  id: string;
  sub: string;
  id_token: string;
  icon: string;
  created_at: string;
}

export interface AffiliationDocument {
  id: string;
  claimer_id: string;
  claimer_sub: string;
  organization: string;
  created_at: string;
}

export interface ClaimDocument {
  id: string;
  url: string;
  claimer_id: string;
  affiliation_id?: string;
  comment: string;
  created_at: string;
  deleted_at?: string;
}

export interface AggregateResult {
  true_count: number;
  false_count: number;
  else_count: number;
  verified_true_count: number;
  verified_false_count: number;
  verified_else_count: number;
}

export type UrlPresenter<T> = (url: AggregatedUrl) => T;
export type UrlMetadataPresenter<T> = (url: UrlDocument) => T;

export type NewClaimPresenter<T> = (claim: ClaimDocument) => T;
export type ClaimPresenter<T> = (
  claim: ClaimDocument,
  url: AggregatedUrl,
  claimer: ClaimerDocument,
  organization?: string,
) => T;

export type ClaimerPresenter<T> = (
  claimer: ClaimerDocument,
  organization?: string,
) => T;

export type BackupPresenter<T> = (
  urls: UrlDocument[],
  claimers: ClaimerDocument[],
  affiliationDocuments: AffiliationDocument[],
  claims: ClaimDocument[],
) => T;

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
  comment: string,
  url: any,
  claimer: {
    sub: string;
    id_token: string;
    organization?: string;
    icon?: string;
  },
) => T;
export type CommitDataPresenter<T> = (newClaimId: string) => T;
export type PostStatePresenter<T> = (state: PostState | null) => T;

export interface SortOptions {
  sortKey?: "true_count" | "false_count" | "created_at";
  desc?: boolean;
}

export interface FilterOptions {
  filter?: string;
  startDate?: Date;
}

export type ListOptions = FilterOptions & SortOptions;

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
    claimJwt: string;
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
