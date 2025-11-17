import {
  Result,
  verifyVcForW3CVcDataV1,
  verifyVpForW3CVcDataV1,
} from "../../tool-box/index.js";
import {
  AuthResponsePayload,
  VerifiableCredential,
  Verifier,
  VerifiablePresentationJWTPayload,
} from "../../oid4vp/index.js";
import {
  handleCredentialError,
  handleDescriptorError,
  handlePresentationError,
} from "./error-handlers.js";

import { TokenType } from "../types.js";
import { NotSuccessResult } from "../../types/app-types.js";
import getLogger from "../../services/logging-service.js";

const logger = getLogger();

export type VC_DATA = VerifiableCredential<TrueFalseComment>;

interface TrueFalseComment {
  url: string;
  comment: string;
  boolValue: number;
}

export const verifyVpFunction = async (credential: string) => {
  return await verifyVpForW3CVcDataV1<string>(credential);
};

export const verifyFunction = async (credential: string) => {
  const env = process.env.ENVIRONMENT;
  return await verifyVcForW3CVcDataV1<TrueFalseComment>(credential, {
    skipVerifyChain: env != "prod",
  });
};

type Decoded1 = VerifiablePresentationJWTPayload;

export const processCredential1 = async (
  verifier: Verifier,
  inputDescriptorId: string,
  authResponse: AuthResponsePayload,
  nonce: string,
): Promise<Result<{ raw: string; decoded: VC_DATA }, NotSuccessResult>> => {
  // get descriptor map
  const descriptor = await verifier.getDescriptor(
    inputDescriptorId,
    authResponse,
  );
  if (!descriptor.ok) {
    logger.info(`descriptor is not ok : ${JSON.stringify(descriptor.error)}`);
    return { ok: false, error: handleDescriptorError(descriptor.error) };
  }

  // get presentation
  const { descriptorMap } = descriptor.payload;
  const presentation = await verifier.getPresentation<string, Decoded1>(
    descriptorMap,
    verifyVpFunction,
  );

  if (!presentation.ok) {
    // return handlePresentationError(presentationResult.error);
    logger.info(
      `presentation is not ok : ${JSON.stringify(presentation.error)}`,
    );
    return { ok: false, error: handlePresentationError(presentation.error) };
  }

  // check nonce
  const { vp } = presentation.payload;
  if (vp.decoded.nonce !== nonce) {
    logger.info(`nonce is not matched : ${vp.decoded.nonce} != ${nonce}`);
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }

  const credential = await verifier.getCredential<TokenType, VC_DATA>(
    presentation.payload,
    verifyFunction,
  );
  if (!credential.ok) {
    logger.info(
      `unable to get credential : ${JSON.stringify(credential.error)}`,
    );
    return {
      ok: false,
      error: handleCredentialError(credential.error),
    };
  }
  const { decoded, raw } = credential.payload;
  const { comment, boolValue } = decoded.vc.credentialSubject;
  console.log(comment, boolValue);

  return { ok: true, payload: { raw, decoded } };
};
