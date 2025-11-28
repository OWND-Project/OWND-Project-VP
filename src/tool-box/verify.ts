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

/**
 * JWT検証メタデータ
 */
export interface JwtVerificationMetadata {
  /** 鍵のソース: x5c（証明書チェーン）, jwk（埋め込みJWK）, secret */
  keySource: "x5c" | "jwk" | "secret";
  /** 使用されたアルゴリズム */
  algorithm?: string;
  /** 証明書チェーン検証の結果（x5cの場合のみ） */
  certificateChainVerified?: boolean;
}

/**
 * JWT検証結果（メタデータ付き）
 */
export interface JwtVerificationResult<T> {
  payload: T;
  verificationMetadata: JwtVerificationMetadata;
}

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
    return result.payload.payload;
  } else {
    throw result.error;
  }
};

/**
 * Verify jwt string
 * @param __jwt
 * @param options
 * @returns 検証結果（メタデータ付き）
 */
export const verifyJwt = async <T>(
  __jwt: string,
  options: { secret?: Uint8Array } = {},
): Promise<Result<JwtVerificationResult<T & JWTPayload>, unknown>> => {
  const { secret } = options;
  let key: KeyLike | Uint8Array;
  const protectedHeader = decodeProtectedHeader(__jwt);
  const { jwk, x5c, alg, kid } = protectedHeader;

  // 検証メタデータを構築
  const verificationMetadata: JwtVerificationMetadata = {
    keySource: "secret", // default
    algorithm: alg,
  };

  // Log JWT header information
  logger.info(
    `[JWT Verification] Header: alg=${alg || "none"}, kid=${kid || "none"}, ` +
      `jwk=${jwk ? "present" : "none"}, x5c=${x5c ? `present (${x5c.length} certs)` : "none"}`,
  );

  if (x5c) {
    verificationMetadata.keySource = "x5c";
    logger.info(
      `[JWT Verification] Key source: x5c (certificate chain), verifying certificate chain...`,
    );
    // Always verify certificate chain using system + custom trusted certificates
    try {
      await verifyCertificateChain(x5c);
      verificationMetadata.certificateChainVerified = true;
    } catch (certError) {
      verificationMetadata.certificateChainVerified = false;
      logger.error(
        `[JWT Verification] Certificate chain verification failed: ${certError}`,
      );
      throw certError;
    }
    const x509 = `-----BEGIN CERTIFICATE-----\n${x5c![0]}\n-----END CERTIFICATE-----`;
    key = await importX509(x509, alg || "ES256");
    logger.info(
      `[JWT Verification] Certificate chain verified, extracting public key from leaf certificate, alg=${alg || "ES256"}`,
    );
  } else if (jwk) {
    verificationMetadata.keySource = "jwk";
    logger.info(
      `[JWT Verification] Key source: jwk (embedded key), no certificate chain verification needed, ` +
        `kty=${jwk.kty || "unknown"}, crv=${jwk.crv || "N/A"}, alg=${alg || "none"}`,
    );
    key = await importJWK(jwk, alg);
  } else if (secret) {
    verificationMetadata.keySource = "secret";
    key = secret;
    logger.info(`[JWT Verification] Key source: secret`);
  } else {
    throw new Error("Unsupported public key type");
  }
  try {
    const { payload } = await jose.jwtVerify<T>(__jwt, key);
    logger.info(`[JWT Verification] Signature verification successful`);
    return { ok: true, payload: { payload, verificationMetadata } };
  } catch (error) {
    logger.info(`[JWT Verification] Signature verification failed: ${error}`);
    return { ok: false, error };
  }
};
