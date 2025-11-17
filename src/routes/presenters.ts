import querystring from "querystring";

import {
  AggregateResult,
  ClaimDocument,
  ClaimerDocument,
  ExchangeResponseCodePresenter,
  PostStatePresenter,
  PostStateValue,
  UrlDocument,
} from "../usecases/types.js";
import { ClaimerResource, ClaimResource, UrlResource } from "./types.js";
import { AuthorizationRequest } from "../oid4vp/verifier.js";
import { AggregatedUrl } from "../local-data/local-data-handler.js";

export const urlPresenter = (url: AggregatedUrl) => {
  const urlResource: UrlResource = {
    id: url.id,
    url: url.url,
    domain: url.domain,
    title: url.title,
    content_type: url.content_type,
    description: url.description,
    image: url.image ? JSON.parse(url.image) : undefined,
    created_at: url.oldest_created_at,
    true_count: url.true_count,
    false_count: url.false_count,
    else_count: url.else_count,
    verified_true_count: url.verified_true_count,
    verified_false_count: url.verified_false_count,
    verified_else_count: url.verified_else_count,
  };
  return urlResource;
};

export const urlMetadataPresenter = (url: UrlDocument) => {
  return {
    id: url.id,
    url: url.url,
    domain: url.domain,
    title: url.title,
    content_type: url.content_type,
    description: url.description,
    image: url.image ? JSON.parse(url.image) : undefined,
    created_at: url.created_at,
  };
};

export const newClaimPresenter = (claim: ClaimDocument) => {
  return { id: claim.id, status: "Created" };
};
export const claimPresenter = (
  claim: ClaimDocument,
  url: AggregatedUrl,
  claimer: ClaimerDocument,
  organization?: string,
) => {
  const claimResource: ClaimResource = {
    id: claim.id,
    url: {
      id: url.id,
      url: url.url,
      domain: url.domain,
      title: url.title,
      content_type: url.content_type,
      description: url.description,
      image: url.image ? JSON.parse(url.image) : undefined,
      created_at: url.created_at,
      true_count: url.true_count,
      false_count: url.false_count,
      else_count: url.else_count,
    },
    claimer: {
      id: claimer.id,
      id_token: claimer.id_token,
      icon: claimer.icon,
      organization,
      created_at: claim.created_at,
    },
    comment: claim.comment,
    created_at: claim.created_at,
  };
  return claimResource;
};

export const claimerPresenter = (
  claimer: ClaimerDocument,
  organization?: string,
) => {
  const claimerResource: ClaimerResource = {
    id: claimer.id,
    id_token: claimer.id_token,
    icon: claimer.icon,
    organization: organization,
    created_at: claimer.created_at,
  };
  return claimerResource;
};

export const authRequestPresenter = (
  authRequest: AuthorizationRequest,
  requestId: string,
  transactionId?: string,
) => {
  if (authRequest.requestUri) {
    const { clientId, requestUri } = authRequest;
    const value = `client_id=${encodeURIComponent(clientId)}&request_uri=${encodeURIComponent(requestUri)}`;
    return { authRequest: value, requestId, transactionId };
  } else {
    const { clientId } = authRequest;
    const params = authRequest.params!;
    if (params.client_metadata && typeof params.client_metadata === "object") {
      params.client_metadata = JSON.stringify(params.client_metadata);
    }
    const rest = querystring.stringify(params);
    // return `client_id=${encodeURIComponent(clientId)}&${rest}`;
    const value = `client_id=${encodeURIComponent(clientId)}&${rest}`;
    return { authRequest: value, requestId, transactionId };
  }
};

export const authResponsePresenter = (
  redirectUri: string,
  responseCode: string,
) => {
  /*
    https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#section-6.2
    {
      "redirect_uri": "https://client.example.org/cb#response_code=091535f699ea575c7937fa5f0f454aee"
    }
   */
  return { redirect_uri: `${redirectUri}#response_code=${responseCode}` };
};
export const exchangeResponseCodePresenter: ExchangeResponseCodePresenter<{
  requestId: string;
  claim: {};
}> = (requestId, comment, url, claimer) => {
  const claim = {
    url,
    claimer: {
      id_token: claimer.id_token,
      sub: claimer.sub,
      icon: claimer.icon,
      organization: claimer.organization,
    },
    comment: comment,
  };
  return { requestId, claim };
};

export const confirmCommentPresenter = (newClaimId: string) => {
  return { id: newClaimId };
};

export const postStatePresenter: PostStatePresenter<
  { value: PostStateValue } | null
> = (state) => {
  return state ? { value: state.value } : null;
};
