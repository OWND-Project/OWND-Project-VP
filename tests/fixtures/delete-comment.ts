import { OID4VPInteractor } from "../../src/usecases/oid4vp-interactor.js";
import { AuthorizationRequest } from "../../src/oid4vp/index.js";
import { createIdToken, createKeyPair } from "../test-utils.js";
import {
  AuthRequestPresenter,
  AuthResponsePresenter,
} from "../../src/usecases/types.js";
import { OkResult } from "../../src/tool-box/index.js";
import { setupEnv } from "./setenv.js";

type RetSIOP = {
  requestId: string;
  nonce: string;
};

const authRequest4DeletePresenter: AuthRequestPresenter<RetSIOP> = (
  authRequest: AuthorizationRequest,
  requestId: string,
) => {
  let nonce = "";
  if (authRequest.params) {
    nonce = authRequest.params.nonce;
  }
  // todo support signed request jwt
  return { requestId, nonce };
};

const authResponsePresenter: AuthResponsePresenter<string> = (
  redirectUri,
  responseCode,
) => {
  return responseCode;
};

export type DeleteFixture = ReturnType<typeof initDeleteFixture>;
export const initDeleteFixture = (interactor: OID4VPInteractor) => {
  /**
   *
   * @param id
   */
  const startFlow = async (id: string) => {
    setupEnv();
    const result = await interactor.generateAuthRequest4Delete<RetSIOP>(
      { id },
      authRequest4DeletePresenter,
    );
    return (result as OkResult<RetSIOP>).payload;
  };

  /**
   *
   * @param vpRequest
   * @param authResponse
   */
  const receiveAuthResponse = async (
    vpRequest: RetSIOP,
    authResponse?: { state: string; id_token: string },
  ) => {
    const { requestId, nonce } = vpRequest;

    const payload =
      authResponse ?? (await testAuthResponsePayload4SIOPv2(requestId, nonce));
    const result = await interactor.receiveAuthResponse<string>(
      payload,
      authResponsePresenter,
    );
    if (result.ok) {
      return result.payload;
    }
    return undefined;
  };
  return { startFlow, receiveAuthResponse };
};

export const testAuthResponsePayload4SIOPv2 = async (
  requestId: string,
  nonce: string,
) => {
  const keyPair = createKeyPair("secp256k1");
  const idToken = await createIdToken({ privateJwk: keyPair, nonce });

  return {
    state: requestId,
    id_token: idToken,
  };
};
