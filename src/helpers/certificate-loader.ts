/**
 * Certificate Loader
 *
 * EC秘密鍵ファイルとX.509証明書ファイルから、
 * OID4VP Verifierに必要な設定値を動的に生成します。
 */

import * as fs from "fs";
import * as crypto from "crypto";
import { execSync } from "child_process";

export interface CertificateConfig {
  jwk: string;           // JWK形式の秘密鍵（JSON文字列）
  x5c: string;           // Base64エンコードされたDER形式の証明書
  x509Hash: string;      // 証明書のSHA-256ハッシュ（Base64URL）
  clientId: string;      // x509_hash:プレフィックス付きのClient ID
}

/**
 * EC秘密鍵ファイルをJWK形式に変換
 */
export function privateKeyToJwk(privateKeyPath: string): object {
  const pemContent = fs.readFileSync(privateKeyPath, "utf8");
  const privateKey = crypto.createPrivateKey(pemContent);
  return privateKey.export({ format: "jwk" });
}

/**
 * X.509証明書ファイルをBase64 DER形式に変換
 */
export function certificateToBase64Der(certificatePath: string): string {
  // opensslコマンドで変換（Node.jsのcryptoでは直接DERに変換できないため）
  const result = execSync(
    `openssl x509 -in "${certificatePath}" -outform DER | base64 | tr -d '\\n'`,
    { encoding: "utf8" }
  );
  return result.trim();
}

/**
 * X.509証明書のSHA-256ハッシュを計算（Base64URL形式）
 */
export function calculateX509Hash(certificatePath: string): string {
  // opensslコマンドで証明書をDER形式に変換し、SHA-256ハッシュを計算
  const result = execSync(
    `openssl x509 -in "${certificatePath}" -outform DER | openssl dgst -sha256 -binary | base64 | tr '+/' '-_' | tr -d '='`,
    { encoding: "utf8" }
  );
  return result.trim();
}

/**
 * 秘密鍵と証明書ファイルから全ての設定値を生成
 */
export function loadCertificateConfig(
  privateKeyPath: string,
  certificatePath: string
): CertificateConfig {
  console.log(`Loading certificate config from:`);
  console.log(`  Private key: ${privateKeyPath}`);
  console.log(`  Certificate: ${certificatePath}`);

  // ファイルの存在確認
  if (!fs.existsSync(privateKeyPath)) {
    throw new Error(`Private key file not found: ${privateKeyPath}`);
  }
  if (!fs.existsSync(certificatePath)) {
    throw new Error(`Certificate file not found: ${certificatePath}`);
  }

  const jwk = privateKeyToJwk(privateKeyPath);
  const x5c = certificateToBase64Der(certificatePath);
  const x509Hash = calculateX509Hash(certificatePath);
  const clientId = `x509_hash:${x509Hash}`;

  console.log(`Generated certificate config:`);
  console.log(`  Client ID: ${clientId}`);

  return {
    jwk: JSON.stringify(jwk),
    x5c,
    x509Hash,
    clientId,
  };
}

/**
 * 環境変数から証明書ファイルパスを読み込み、設定を生成してprocess.envにセット
 *
 * 使用する環境変数:
 * - OID4VP_VERIFIER_PRIVATE_KEY_PATH: EC秘密鍵ファイルへのパス
 * - OID4VP_VERIFIER_CERTIFICATE_PATH: X.509証明書ファイルへのパス
 *
 * 生成される環境変数:
 * - OID4VP_VERIFIER_JWK: JWK形式の秘密鍵
 * - OID4VP_VERIFIER_X5C: Base64 DER形式の証明書
 * - OID4VP_CLIENT_ID: x509_hash:xxx形式のClient ID（x509_hashスキームの場合）
 */
export function initCertificateFromFiles(): boolean {
  const privateKeyPath = process.env.OID4VP_VERIFIER_PRIVATE_KEY_PATH;
  const certificatePath = process.env.OID4VP_VERIFIER_CERTIFICATE_PATH;

  // パスが指定されていない場合はスキップ（従来の直接指定方式を使用）
  if (!privateKeyPath || !certificatePath) {
    console.log("Certificate file paths not configured, using direct env values");
    return false;
  }

  try {
    const config = loadCertificateConfig(privateKeyPath, certificatePath);

    // 環境変数にセット
    process.env.OID4VP_VERIFIER_JWK = config.jwk;
    process.env.OID4VP_VERIFIER_X5C = config.x5c;

    // x509_hashスキームの場合、Client IDも自動生成
    const clientIdScheme = process.env.OID4VP_CLIENT_ID_SCHEME;
    if (clientIdScheme === "x509_hash") {
      process.env.OID4VP_CLIENT_ID = config.clientId;
      console.log(`Auto-generated Client ID: ${config.clientId}`);
    }

    console.log("Certificate config loaded successfully from files");
    return true;
  } catch (error) {
    console.error("Failed to load certificate config:", error);
    throw error;
  }
}
