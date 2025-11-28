import { decodeSDJWT } from "@meeco/sd-jwt";
import { decodeJwt, decodeProtectedHeader } from "jose";

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
 * @returns Learning Credential JWT if successful
 */
export const extractCredentialFromVpToken = async (
  vpToken: Record<string, string[]>,
  credentialQueryId: string,
  nonce: string,
): Promise<Result<{ learningCredential?: string }, NotSuccessResult>> => {
  try {
    // DCQL format: JSON object with credential query ID as key
    const presentations = vpToken[credentialQueryId];

    if (!presentations || presentations.length === 0) {
      logger.info(`No credential found for query ID: ${credentialQueryId}`);
      return { ok: true, payload: { learningCredential: undefined } };
    }

    const token = presentations[0];

    if (!token) {
      logger.info('VP Token is empty');
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    // Decode SD-JWT
    const decoded = decodeSDJWT(token);

    // Extract Issuer JWT from SD-JWT (first part before ~)
    const issuerJwt = token.split("~")[0];

    // Log SD-JWT Issuer JWT header information
    const issuerHeader = decodeProtectedHeader(issuerJwt);
    logger.info(
      `[SD-JWT] Issuer JWT Header: alg=${issuerHeader.alg || "none"}, ` +
        `kid=${issuerHeader.kid || "none"}, ` +
        `x5c=${Array.isArray(issuerHeader.x5c) ? `present (${issuerHeader.x5c.length} certs)` : "none"}, ` +
        `jwk=${issuerHeader.jwk ? `present (kty=${issuerHeader.jwk.kty}, crv=${issuerHeader.jwk.crv || "N/A"})` : "none"}`,
    );
    logger.info(
      `[SD-JWT] Structure: disclosures=${decoded.disclosures?.length || 0}, ` +
        `keyBindingJWT=${decoded.keyBindingJWT ? "present" : "none"}`,
    );

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
    try {
      await verifySdJwt(token, {});
    } catch (err) {
      logger.info(`SD-JWT verification failed: ${err}`);
      return { ok: false, error: { type: "INVALID_PARAMETER" } };
    }

    // Learning Credential doesn't include portrait field
    // All credential data is contained in the SD-JWT token itself

    return {
      ok: true,
      payload: {
        learningCredential: token
      }
    };
  } catch (err) {
    logger.error(`Error extracting credential from VP Token: ${err}`);
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }
};

// processCredential2 removed - replaced by extractCredentialFromVpToken (DCQL flow)
