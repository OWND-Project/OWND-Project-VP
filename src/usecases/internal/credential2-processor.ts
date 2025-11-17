import { SDJWT, SDJWTPayload } from "@meeco/sd-jwt";
import { decodeJwt } from "jose";

import { Result } from "../../tool-box/index.js";
import { AuthResponsePayload, Verifier } from "../../oid4vp/index.js";
import { verifySdJwt } from "../../helpers/jwt-helper.js";
import {
  handleCredentialError,
  handleDescriptorError,
  handlePresentationError,
} from "./error-handlers.js";

import { TokenType } from "../types.js";
import { NotSuccessResult } from "../../types/app-types.js";
import getLogger from "../../services/logging-service.js";

const logger = getLogger();

export const processCredential2 = async (
  verifier: Verifier,
  inputDescriptorId: string,
  authResponse: AuthResponsePayload,
  nonce: string,
): Promise<
  Result<{ affiliation?: string; icon?: string }, NotSuccessResult>
> => {
  logger.info(`vpToken type at processCredential2 : ${typeof authResponse.vpToken}`)
  let affiliationJwt = undefined;

  // get descriptor map
  const descriptor = await verifier.getOptionalDescriptor(
    inputDescriptorId,
    authResponse,
  );
  if (!descriptor.ok) {
    logger.info(`descriptor is not ok : ${JSON.stringify(descriptor.error)}`);
    return { ok: false, error: handleDescriptorError(descriptor.error) };
  }

  const { descriptorMap } = descriptor.payload;
  if (!descriptorMap) {
    logger.info(`descriptor is falsy : ${JSON.stringify(descriptorMap)}`);
    return { ok: true, payload: { affiliation: undefined, icon: undefined } };
  }

  // get presentation
  const presentation = await verifier.getPresentation<TokenType, SDJWT>(
    descriptorMap,
  );
  if (!presentation.ok) {
    logger.info(
      `presentation is not ok : ${JSON.stringify(presentation.error)}`,
    );
    return { ok: false, error: handlePresentationError(presentation.error) };
  }
  const { vp } = presentation.payload;
  if (!vp.decoded.keyBindingJWT) {
    logger.info(`keyBindingJwt is falsy`);
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }

  let icon: string | undefined = undefined;
  vp.decoded.disclosures.forEach((disclosure) => {
    if (disclosure.key === "portrait") {
      icon = disclosure.value;
    }
  });
  try {
    const __nonce = decodeJwt<{ nonce: string }>(
      vp.decoded.keyBindingJWT,
    ).nonce;

    // check nonce
    if (__nonce !== nonce) {
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }
  } catch (err) {
    console.error(err);
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }
  affiliationJwt = vp.raw;

  // get credential
  const credential = await verifier.getCredential<TokenType, SDJWTPayload>(
    presentation.payload,
    verifySdJwtWrapper,
  );
  if (!credential.ok) {
    logger.info(`credential is not ok : ${JSON.stringify(credential.error)}`);
    return {
      ok: false,
      error: handleCredentialError(credential.error),
    };
  }
  return { ok: true, payload: { affiliation: affiliationJwt, icon } };
};

export const verifySdJwtWrapper = async (credential: any) => {
  const env = process.env.ENVIRONMENT;
  return await verifySdJwt(credential, {
    skipVerifyChain: env != "prod",
  });
};
