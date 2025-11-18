import { decodeSDJWT } from "@meeco/sd-jwt";
import { decodeJwt } from "jose";

import { Result } from "../../tool-box/index.js";
import { verifySdJwt } from "../../helpers/jwt-helper.js";

import { NotSuccessResult } from "../../types/app-types.js";
import getLogger from "../../services/logging-service.js";

const logger = getLogger();

/**
 * Extract SD-JWT credential directly from VP Token (DCQL flow)
 * @param vpToken - VP Token in DCQL format (JSON object with credential query ID as key)
 * @param credentialQueryId - The credential query ID to extract
 * @param nonce - Expected nonce value
 * @returns Affiliation JWT and icon if successful
 */
export const extractCredentialFromVpToken = async (
  vpToken: Record<string, string[]>,
  credentialQueryId: string,
  nonce: string,
): Promise<Result<{ affiliation?: string; icon?: string }, NotSuccessResult>> => {
  try {
    // DCQL format: JSON object with credential query ID as key
    const presentations = vpToken[credentialQueryId];

    if (!presentations || presentations.length === 0) {
      logger.info(`No credential found for query ID: ${credentialQueryId}`);
      return { ok: true, payload: { affiliation: undefined, icon: undefined } };
    }

    const token = presentations[0];

    if (!token) {
      logger.info('VP Token is empty');
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    // Decode SD-JWT
    const decoded = decodeSDJWT(token);

    // Verify key binding JWT contains correct nonce
    if (!decoded.keyBindingJWT) {
      logger.info('Key binding JWT is missing');
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    const kbPayload = decodeJwt<{ nonce: string }>(decoded.keyBindingJWT);
    if (kbPayload.nonce !== nonce) {
      logger.info(`Nonce mismatch: expected ${nonce}, got ${kbPayload.nonce}`);
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    // Verify SD-JWT signature
    const env = process.env.ENVIRONMENT;
    try {
      await verifySdJwt(token, {
        skipVerifyChain: env !== "prod",
      });
    } catch (err) {
      logger.info(`SD-JWT verification failed: ${err}`);
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    // Extract icon from disclosures
    let icon: string | undefined = undefined;
    if (decoded.disclosures) {
      decoded.disclosures.forEach((disclosure: any) => {
        if (disclosure.key === "portrait") {
          icon = disclosure.value;
        }
      });
    }

    return {
      ok: true,
      payload: {
        affiliation: token,
        icon
      }
    };
  } catch (err) {
    logger.error(`Error extracting credential from VP Token: ${err}`);
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }
};

// processCredential2 removed - replaced by extractCredentialFromVpToken (DCQL flow)
