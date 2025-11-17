import * as jose from "jose";
import { JWK, KeyLike } from "jose";

import { Result } from "../tool-box/index.js";
import { ExpiredError, NotFoundError, UnexpectedError } from "./types.js";
import { ValidateFailure } from "./verifier.js";
import { InvalidParameterResult } from "../types/app-types.js";

export interface IdTokenPayload {
  nonce: string;
  sub: string;
  sub_jwk: Record<string, string>;
}

export interface IdTokenPublicKeySetting {
  jwk?: JWK;
  alg?: string;
  did?: string;
}

export type IdTokenError =
  | InvalidParameterResult
  | NotFoundError
  | ExpiredError
  | ValidateFailure;

export const getIdToken = async (
  idToken?: string,
  nonce?: string,
): Promise<
  Result<{ idToken: Awaited<ReturnType<typeof verifyIdToken>> }, IdTokenError>
> => {
  if (!idToken) {
    return {
      ok: false,
      error: {
        type: "NOT_FOUND",
        subject: "id_token",
      },
    };
  }
  try {
    // todo support did
    const decodedIdToken = jose.decodeJwt<{ sub_jwk: Record<string, string> }>(
      idToken,
    );
    const subJwk = decodedIdToken.sub_jwk;
    const publicKeySetting = { jwk: subJwk, alg: "ES256K" };
    const payload = await verifyIdToken(idToken, publicKeySetting);
    if (nonce) {
      if (payload.nonce !== nonce) {
        return {
          ok: false,
          error: { type: "INVALID_PARAMETER", message: "mismatch nonce error" },
        };
      }
    }
    return { ok: true, payload: { idToken: payload } };
  } catch (err) {
    console.error(err);
    return { ok: false, error: { type: "VALIDATE_FAILURE" } };
  }
};

export const verifyIdToken = async (
  idToken: string,
  publicKeySetting: IdTokenPublicKeySetting,
) => {
  const { jwk, alg, did } = publicKeySetting;
  let publicKey: KeyLike | Uint8Array;
  if (jwk) {
    publicKey = await jose.importJWK(jwk, alg);
  } else {
    // todo support did
    throw new Error("Public key types other than jwk are not supported.");
  }

  /*
    // https://openid.net/specs/openid-connect-self-issued-v2-1_0.html
    example

    {
      "iss": "urn:ietf:params:oauth:jwk-thumbprint:sha-256:NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs",
      "sub": "urn:ietf:params:oauth:jwk-thumbprint:sha-256:NzbLsXh8uDCcd-6MNwXF4W_7noWXFZAfHkxZsRGC9Xs",
      "aud": "https://client.example.org/cb",
      "nonce": "n-0S6_WzA2Mj",
      "exp": 1311281970,
      "iat": 1311280970,
      "sub_jwk": {
        "kty": "RSA",
        "n": "0vx7agoebGcQSuuPiLJXZptN9nndrQmbXEps2aiAFbWhM78LhWx4cbbfAAt
        VT86zwu1RK7aPFFxuhDR1L6tSoc_BJECPebWKRXjBZCiFV4n3oknjhMstn64tZ_2W
        -5JsGY4Hc5n9yBXArwl93lqt7_RN5w6Cf0h4QyQ5v-65YGjQR0_FDW2QvzqY368QQ
        MicAtaSqzs8KJZgnYb9c7d0zgdAZHzu6qMQvRL5hajrn1n91CbOpbISD08qNLyrdk
        t-bFTWhAI4vMQFh6WeZu0fM4lFd2NcRwr3XPksINHaQ-G_xBniIqbw0Ls1jF44-cs
        FCur-kEgU8awapJzKnqDKgw",
        "e": "AQAB"
      }
    }
     */
  const { payload } = await jose.jwtVerify<IdTokenPayload>(idToken, publicKey);
  return payload;
};

export default { getIdToken };
