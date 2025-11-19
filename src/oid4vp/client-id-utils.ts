import { createHash } from "crypto";
import { X509Certificate } from "crypto";

/**
 * Client Identifier Prefixの種別
 */
export type ClientIdPrefix = "redirect_uri" | "x509_san_dns" | "x509_hash";

/**
 * パース済みClient Identifier
 */
export interface ParsedClientId {
  prefix: ClientIdPrefix;
  value: string; // prefix除去後の値
  raw: string; // 元の値
}

/**
 * Client Identifierをパース
 * @param clientId - Client Identifier (prefixを含む)
 * @returns パース結果、またはprefixがない場合はnull
 */
export function parseClientId(clientId: string): ParsedClientId | null {
  const prefixes: ClientIdPrefix[] = [
    "redirect_uri",
    "x509_san_dns",
    "x509_hash",
  ];

  for (const prefix of prefixes) {
    const prefixWithColon = `${prefix}:`;
    if (clientId.startsWith(prefixWithColon)) {
      return {
        prefix,
        value: clientId.substring(prefixWithColon.length),
        raw: clientId,
      };
    }
  }

  return null;
}

/**
 * Client Identifierをフォーマット
 * @param prefix - Client Identifier Prefix
 * @param value - prefix除去後の値
 * @returns フォーマット済みClient Identifier
 */
export function formatClientId(prefix: ClientIdPrefix, value: string): string {
  return `${prefix}:${value}`;
}

/**
 * X.509証明書のSHA-256ハッシュを計算（Base64URL）
 * @param certPem - PEM形式の証明書
 * @returns Base64URLエンコードされたSHA-256ハッシュ
 */
export function calculateX509Hash(certPem: string): string {
  const cert = new X509Certificate(certPem);
  const der = cert.raw; // DERエンコード済みバイナリ
  const hash = createHash("sha256").update(der).digest();

  // Base64URL エンコード
  return hash
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=/g, "");
}

/**
 * Client Identifierの検証結果
 */
export interface ValidationResult {
  valid: boolean;
  error?: string;
}

/**
 * Client Identifierを検証
 * @param clientId - Client Identifier
 * @param x5c - X.509証明書チェーン (x509系のprefixを使う場合)
 * @returns 検証結果
 */
export function validateClientId(
  clientId: string,
  x5c?: string[],
): ValidationResult {
  const parsed = parseClientId(clientId);

  if (!parsed) {
    return { valid: false, error: "No valid Client Identifier Prefix found" };
  }

  const { prefix, value } = parsed;

  switch (prefix) {
    case "redirect_uri":
      // redirect_uri形式の検証（URLとして有効か）
      try {
        new URL(value);
        return { valid: true };
      } catch {
        return { valid: false, error: "Invalid URL in redirect_uri prefix" };
      }

    case "x509_san_dns":
      if (!x5c || x5c.length === 0) {
        return {
          valid: false,
          error: "x5c header is required for x509_san_dns prefix",
        };
      }

      // SAN DNS名の検証
      try {
        const cert = new X509Certificate(x5c[0]);
        const sanDnsNames =
          cert.subjectAltName
            ?.split(", ")
            .filter((san) => san.startsWith("DNS:"))
            .map((san) => san.substring(4)) || [];

        if (!sanDnsNames.includes(value)) {
          return {
            valid: false,
            error: `Client ID DNS name '${value}' does not match SAN DNS names: ${sanDnsNames.join(", ")}`,
          };
        }

        return { valid: true };
      } catch (error) {
        return {
          valid: false,
          error: `Failed to validate SAN DNS name: ${error}`,
        };
      }

    case "x509_hash":
      if (!x5c || x5c.length === 0) {
        return {
          valid: false,
          error: "x5c header is required for x509_hash prefix",
        };
      }

      // ハッシュの検証
      try {
        const calculatedHash = calculateX509Hash(x5c[0]);
        if (calculatedHash !== value) {
          return {
            valid: false,
            error: `Certificate hash mismatch. Expected: ${value}, Got: ${calculatedHash}`,
          };
        }

        return { valid: true };
      } catch (error) {
        return {
          valid: false,
          error: `Failed to calculate certificate hash: ${error}`,
        };
      }

    default:
      return {
        valid: false,
        error: `Unsupported Client Identifier Prefix: ${prefix}`,
      };
  }
}
