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
    skipVerifyChain: publicKeySetting.skipVerifyChain,
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
  options: { skipVerifyChain?: boolean; secret?: Uint8Array } = {
    skipVerifyChain: false,
  },
): Promise<Result<T & JWTPayload, unknown>> => {
  const { skipVerifyChain, secret } = options;
  let key: KeyLike | Uint8Array;
  const protectedHeader = decodeProtectedHeader(__jwt);
  const { jwk, x5c, alg } = protectedHeader;
  if (x5c) {
    if (skipVerifyChain !== true) {
      await verifyCertificateChain(x5c);
    }
    const x509 = `-----BEGIN CERTIFICATE-----\n${x5c![0]}\n-----END CERTIFICATE-----`;
    key = await importX509(x509, alg || "ES256");
  } else if (jwk) {
    key = await importJWK(jwk, alg);
  } else if (secret) {
    key = secret;
  } else {
    throw new Error("Unsupported public key type");
  }
  try {
    const { payload } = await jose.jwtVerify<T>(__jwt, key);
    return { ok: true, payload };
  } catch (error) {
    return { ok: false, error };
  }
};
