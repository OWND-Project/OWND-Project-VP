import querystring from "querystring";

import {
  ExchangeResponseCodePresenter,
  PostStatePresenter,
  PostStateValue,
} from "../usecases/types.js";
import { AuthorizationRequest } from "../oid4vp/verifier.js";

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
  claimer: {};
}> = (requestId, claimer) => {
  return {
    requestId,
    claimer: {
      id_token: claimer.id_token,
      sub: claimer.sub,
      learningCredential: claimer.learningCredential,
    },
  };
};

export const postStatePresenter: PostStatePresenter<
  { value: PostStateValue } | null
> = (state) => {
  return state ? { value: state.value } : null;
};
