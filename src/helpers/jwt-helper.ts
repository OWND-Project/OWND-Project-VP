import crypto from "crypto";
import {
  compactDecrypt,
  decodeProtectedHeader,
  exportJWK,
  generateKeyPair,
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
  JWK as SDJWT_JWK,
  verifySDJWT,
} from "@meeco/sd-jwt";
import { PublicKeySetting } from "../oid4vp/types.js";
import { verifyCertificateChain } from "../tool-box/x509/x509.js";
import { verifyJwt, JwtVerificationMetadata } from "../tool-box/verify.js";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

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
    // Ensure only public key is included in cnf (extract public key if private key is provided)
    const publicKey = (holderKeyPair as any).d
      ? publicJwkFromPrivate(holderKeyPair as PrivateJwk)
      : holderKeyPair;
    opts.cnf = { jwk: publicKey as unknown as SDJWT_JWK };
  }
  return await issueSDJWT(header, payload, disclosureFrame, opts);
};

/**
 * SD-JWT検証結果（メタデータ付き）
 */
export interface SdJwtVerificationResult {
  decodedPayload: any;
  verificationMetadata: JwtVerificationMetadata;
}

export const verifySdJwt = async (
  compactSDJWT: string,
  publicKeySetting: PublicKeySetting = {},
): Promise<SdJwtVerificationResult> => {
  // 検証メタデータをキャプチャするための変数
  let capturedMetadata: JwtVerificationMetadata | undefined;

  // https://github.com/Meeco/sd-jwt?tab=readme-ov-file#verifysdjwt-example
  const verifier = async (__jwt: string) => {
    const result = await verifyJwt(__jwt, {
      secret: publicKeySetting.secret,
    });
    if (result.ok) {
      capturedMetadata = result.payload.verificationMetadata;
    }
    return result.ok;
  };

  const keyBindingVerifier = async (kbjwt: string, holderJWK: JWK) => {
    // check against kb-jwt.aud && kb-jwt.nonce
    const protectedHeader = decodeProtectedHeader(kbjwt);
    const { alg, kid } = protectedHeader;

    // Log KB-JWT header information
    logger.info(
      `[KB-JWT Verification] Header: alg=${alg || "none"}, kid=${kid || "none"}`,
    );

    // Log holder public key information
    logger.info(
      `[KB-JWT Verification] Holder key: kty=${holderJWK.kty || "unknown"}, ` +
        `crv=${holderJWK.crv || "N/A"}, kid=${holderJWK.kid || "none"}`,
    );

    const holderKey = await importJWK(holderJWK, alg);
    const verifiedKbJWT = await jwtVerify(kbjwt, holderKey);

    logger.info(`[KB-JWT Verification] Key binding verification successful`);
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

  // 検証メタデータが取得できなかった場合のフォールバック
  const verificationMetadata = capturedMetadata || {
    keySource: "jwk" as const,
    algorithm: undefined,
  };

  return {
    decodedPayload: sdJWTwithDisclosedClaims,
    verificationMetadata,
  };
};

export const decodeSdJwt = (sdjwt: string) => {
  const {
    unverifiedInputSDJWT: jwt,
    disclosures,
    keyBindingJWT,
  } = decodeSDJWT(sdjwt);
  return { issueJwt: jwt, disclosures };
};

/**
 * エフェメラル鍵ペア生成（ECDH-ES + P-256）
 *
 * VP Token暗号化のためのエフェメラル鍵ペアを生成します。
 * 生成された鍵ペアは1回限りの使用を想定しています。
 *
 * @returns 公開鍵JWK、秘密鍵JWK、およびkid
 */
export const generateEphemeralKeyPair = async (): Promise<{
  publicJwk: JWK;
  privateJwk: JWK;
  kid: string;
}> => {
  // ECDH-ES用の鍵ペア生成（P-256曲線）
  const { publicKey, privateKey } = await generateKeyPair("ECDH-ES", {
    extractable: true,
    crv: "P-256",
  });

  // JWK形式にエクスポート
  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  // Key ID生成
  const kid = crypto.randomUUID();

  // 公開鍵にメタデータ追加
  publicJwk.kid = kid;
  publicJwk.use = "enc";
  publicJwk.alg = "ECDH-ES";

  // 秘密鍵にもkid追加
  privateJwk.kid = kid;

  return { publicJwk, privateJwk, kid };
};

/**
 * JWE復号化（ECDH-ES + A128GCM）
 *
 * @param jwe - JWE Compact Serialization形式の文字列
 * @param privateJwk - Verifierのエフェメラル秘密鍵（JWK形式）
 * @returns 復号化されたペイロード
 *
 * 処理内容:
 * 1. JWE Protected Headerからアルゴリズム情報を検証
 * 2. compactDecrypt内で自動的にECDH鍵交換が実行される
 *    - JWE Headerのepk（Walletのエフェメラル公開鍵）を使用
 *    - 提供された秘密鍵とepkでECDH-ESによる共有秘密を導出
 * 3. A128GCMで復号化（アルゴリズムはJWE Headerから自動読み取り）
 * 4. 認証タグの検証（GCM）
 */
export const decryptJWE = async (
  jwe: string,
  privateJwk: JWK,
): Promise<any> => {
  // 1. Protected Header検証（復号化前）
  const protectedHeader = decodeProtectedHeader(jwe);

  // 2. アルゴリズム検証（アルゴリズム代替攻撃対策）
  if (protectedHeader.alg !== "ECDH-ES") {
    throw new Error(`Unsupported JWE algorithm: ${protectedHeader.alg}`);
  }
  if (protectedHeader.enc !== "A128GCM") {
    throw new Error(`Unsupported JWE encryption: ${protectedHeader.enc}`);
  }

  // 3. 秘密鍵インポート
  const privateKey = await importJWK(privateJwk, "ECDH-ES");

  // 4. JWE復号化
  //    - ECDH鍵交換（epkと秘密鍵から共有秘密を導出）
  //    - A128GCMで復号化
  //    - 認証タグ検証
  //    これらは全てcompactDecrypt内で自動実行される
  const { plaintext } = await compactDecrypt(jwe, privateKey);

  // 5. ペイロードをJSONとしてパース
  return JSON.parse(new TextDecoder().decode(plaintext));
};
