import crypto from "crypto";
import {
  decodeProtectedHeader,
  importJWK,
  importX509,
  JWK,
  JWTHeaderParameters,
  JWTPayload,
  jwtVerify,
  KeyLike,
  SignJWT,
} from "jose";
import { PrivateJwk, PublicJwk, publicJwkFromPrivate } from "elliptic-jwk";
import {
  decodeSDJWT,
  DisclosureFrame,
  issueSDJWT,
  IssueSDJWTOptions,
  verifySDJWT,
} from "@meeco/sd-jwt";
import { PublicKeySetting } from "../oid4vp/types.js";
import { verifyCertificateChain } from "../tool-box/x509/x509.js";
import { verifyJwt } from "../tool-box/verify.js";

// interface JWTHeader {
//   alg: string;
//   kid: string;
//   [key: string]: string;
// }

export const currentTime = () => {
  const SEC_IN_MS = 1000;
  return Math.floor(Date.now() / SEC_IN_MS);
};

export const issueJwt = async (
  header: JWTHeaderParameters,
  payload: any,
  keyPair: PrivateJwk | Uint8Array,
) => {
  if (!payload.iat) {
    payload.iat = currentTime();
  }
  if (!payload.exp) {
    const SEC_IN_MS = 600; // default 10 minutes
    payload.exp = payload.iat + SEC_IN_MS;
  }
  const issuerPrivateKey =
    keyPair instanceof (await Uint8Array)
      ? keyPair
      : await importJWK(keyPair, header.alg);
  return await new SignJWT(payload)
    .setProtectedHeader(header)
    .sign(issuerPrivateKey);
};

export const issueSdJwt = async (
  header: JWTHeaderParameters,
  payload: any,
  disclosureFrame: DisclosureFrame,
  issuerKeyPair: PrivateJwk,
  holderKeyPair?: PublicJwk,
) => {
  const signer = async (header: JWTHeaderParameters, payload: JWTPayload) => {
    // Only the signature value should be returned.
    return (await issueJwt(header, payload, issuerKeyPair)).split(".").pop()!;
  };

  const hasher = (data: string) => {
    const digest = crypto.createHash("sha256").update(data).digest();
    return Buffer.from(digest).toString("base64url");
  };

  const opts: IssueSDJWTOptions = {
    hash: {
      alg: "sha-256",
      callback: hasher,
    },
    signer,
  };
  // Optional
  if (holderKeyPair) {
    const holderKey = publicJwkFromPrivate(holderKeyPair);
    opts.cnf = { jwk: holderKey };
  }
  return await issueSDJWT(header, payload, disclosureFrame, opts);
};

export const verifySdJwt = async (
  compactSDJWT: string,
  publicKeySetting: PublicKeySetting,
) => {
  // https://github.com/Meeco/sd-jwt?tab=readme-ov-file#verifysdjwt-example
  const verifier = async (__jwt: string) => {
    const result = await verifyJwt(__jwt, {
      skipVerifyChain: publicKeySetting.skipVerifyChain,
    });
    return result.ok;
  };

  const keyBindingVerifier = async (kbjwt: string, holderJWK: JWK) => {
    // check against kb-jwt.aud && kb-jwt.nonce
    const protectedHeader = decodeProtectedHeader(kbjwt);
    const { alg } = protectedHeader;
    const holderKey = await importJWK(holderJWK, alg);
    const verifiedKbJWT = await jwtVerify(kbjwt, holderKey);
    return !!verifiedKbJWT;
  };

  const getHasher = async (hashAlg: string) => {
    const alg = hashAlg ? hashAlg.toLowerCase() : "sha256";
    return (data: string) => {
      const digest = crypto.createHash(alg).update(data).digest();
      return Buffer.from(digest).toString("base64url");
    };
  };

  const opts = {
    kb: {
      verifier: keyBindingVerifier,
    },
  };

  const sdJWTwithDisclosedClaims = await verifySDJWT(
    compactSDJWT,
    verifier,
    getHasher,
    opts,
  );

  return sdJWTwithDisclosedClaims;
  // todo error handling
  // try {
  // } catch (e) {
  //   console.log("Could not verify SD-JWT", e);
  // }
};

export const decodeSdJwt = (sdjwt: string) => {
  const {
    unverifiedInputSDJWT: jwt,
    disclosures,
    keyBindingJWT,
  } = decodeSDJWT(sdjwt);
  return { issueJwt: jwt, disclosures };
};
