import * as jose from "jose";
import {
  decodeProtectedHeader,
  importJWK,
  importX509,
  JWK,
  JWTPayload,
  KeyLike,
} from "jose";
import {
  PublicKeySetting,
  VerifiableCredential,
  VerifiablePresentationJWTPayload,
} from "../oid4vp/index.js";
import { verifyCertificateChain } from "./x509/x509.js";
import getLogger from "../services/logging-service.js";
import { Result } from "./generic-result.js";

const logger = getLogger();

class OID4VpError extends Error {
  constructor(message: string) {
    super(message);
  }
}

export const verifyVpForW3CVcDataV1 = async <T>(
  vpJwt: string,
  opts?: { jwk?: JWK; alg?: string },
) => {
  let jwk: JWK, alg: string | undefined;
  if (!opts?.jwk) {
    const protectedHeader = jose.decodeProtectedHeader(vpJwt);
    if (!protectedHeader.jwk) {
      // return { ok: false, error: { type: "INVALID_PARAMETER" } };
      throw new OID4VpError(
        "jwk property is not found in jwt header of vp_token",
      );
    }
    jwk = protectedHeader.jwk;
    alg = protectedHeader.alg;
  } else {
    jwk = opts.jwk;
    alg = opts.alg;
  }

  const publicKey = await jose.importJWK(jwk, alg);

  const { payload } = await jose.jwtVerify<VerifiablePresentationJWTPayload<T>>(
    vpJwt,
    publicKey,
  );
  /*
          vp: {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            type: ["VerifiablePresentation"],
            verifiableCredential: [<vcJwt>],
          },
       */
  return payload;
};

export const verifyVcForW3CVcDataV1 = async <T>(
  vcJwt: string,
  publicKeySetting: PublicKeySetting = {},
) => {
  /*
          vc: {
            "@context": ["https://www.w3.org/2018/credentials/v1"],
            type: ["TicketCredential"],
            credentialSubject: {...},
          },
       */
  const result = await verifyJwt<VerifiableCredential<T>>(vcJwt, {
    secret: publicKeySetting.secret,
  });
  if (result.ok) {
    return result.payload;
  } else {
    throw result.error;
  }
};

/**
 * Verify jwt string
 * @param __jwt
 * @param options
 */
export const verifyJwt = async <T>(
  __jwt: string,
  options: { secret?: Uint8Array } = {},
): Promise<Result<T & JWTPayload, unknown>> => {
  const { secret } = options;
  let key: KeyLike | Uint8Array;
  const protectedHeader = decodeProtectedHeader(__jwt);
  const { jwk, x5c, alg, kid } = protectedHeader;

  // Log JWT header information
  logger.info(
    `[JWT Verification] Header: alg=${alg || "none"}, kid=${kid || "none"}, ` +
      `jwk=${jwk ? "present" : "none"}, x5c=${x5c ? `present (${x5c.length} certs)` : "none"}`,
  );

  if (x5c) {
    // Always verify certificate chain using system + custom trusted certificates
    await verifyCertificateChain(x5c);
    const x509 = `-----BEGIN CERTIFICATE-----\n${x5c![0]}\n-----END CERTIFICATE-----`;
    key = await importX509(x509, alg || "ES256");
    logger.info(
      `[JWT Verification] Key source: x5c, alg=${alg || "ES256"}`,
    );
  } else if (jwk) {
    key = await importJWK(jwk, alg);
    // Log JWK key details (kty, crv for EC keys)
    logger.info(
      `[JWT Verification] Key source: jwk, kty=${jwk.kty || "unknown"}, ` +
        `crv=${jwk.crv || "N/A"}, kid=${kid || "none"}, alg=${alg || "none"}`,
    );
  } else if (secret) {
    key = secret;
    logger.info(`[JWT Verification] Key source: secret`);
  } else {
    throw new Error("Unsupported public key type");
  }
  try {
    const { payload } = await jose.jwtVerify<T>(__jwt, key);
    logger.info(`[JWT Verification] Signature verification successful`);
    return { ok: true, payload };
  } catch (error) {
    logger.info(`[JWT Verification] Signature verification failed: ${error}`);
    return { ok: false, error };
  }
};
