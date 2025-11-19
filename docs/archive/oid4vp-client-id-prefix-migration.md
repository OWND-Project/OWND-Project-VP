# OID4VP 1.0 Client Identifier Prefix 移行ガイド

## 概要

OID4VP 1.0では、`client_id_scheme`パラメータが廃止され、`client_id`にプレフィックスを含める方式に変更されました。本ドキュメントでは、この変更への対応方針と実装計画を説明します。

**参考仕様**: [OpenID for Verifiable Presentations 1.0 - Section 5.9](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#section-5.9)

## 1. 現在の実装状況

### 影響を受けるファイル

- `src/oid4vp/auth-request.ts`: Request Object生成ロジック
- `src/oid4vp/verifier.ts`: Verifier本体
- `src/oid4vp/types.ts`: 型定義
- テストファイル群

### 現在の実装 (OID4VP 0.x)

```typescript
// 現在: client_id_schemeパラメータを使用
interface GenerateRequestObjectOptions {
  clientIdScheme?: "x509_san_dns" | "x509_san_uri" | "redirect_uri";
}

// Request Objectペイロード
{
  "client_id": "http://localhost:3000",
  "client_id_scheme": "x509_san_dns",  // ← 廃止されたパラメータ
  "response_mode": "direct_post",
  ...
}
```

## 2. 変更後の仕様 (OID4VP 1.0)

### Client Identifier Prefix方式

```typescript
// 変更後: client_idにprefixを含める
{
  "client_id": "x509_san_dns:client.example.org",  // ← prefixを含める
  "response_mode": "direct_post",
  // client_id_schemeパラメータは削除
  ...
}
```

### Client Identifier Prefix種別

| Prefix | 説明 | 署名要否 | 例 |
|--------|------|----------|---|
| `redirect_uri:` | Redirect URI/Response URIベース | 不可 | `redirect_uri:https://client.example.org/cb` |
| `x509_san_dns:` | X.509証明書のSAN DNS名ベース | 必須 | `x509_san_dns:client.example.org` |
| `x509_hash:` | X.509証明書のSHA-256ハッシュベース | 必須 | `x509_hash:Uvo3HtuIxuhC92rShpgqcT3YXwrqRxWEviRiA0OZszk` |

## 3. 各Prefixの詳細仕様

### 3.1 redirect_uri: プレフィックス

**仕様**:
- prefixを除いた部分がVerifierのRedirect URI (または Response URI)
- Verifierは`redirect_uri` (または`response_uri`) パラメータを省略可能
- 全てのVerifierメタデータは`client_metadata`パラメータで渡す必要がある
- Request Objectは署名不可（Walletが検証用の信頼できる鍵を取得できないため）

**制約**:
- 署名付きリクエストを要求する実装では使用不可

**使用例**:
```json
{
  "client_id": "redirect_uri:https://client.example.org/cb",
  "response_type": "vp_token id_token",
  "response_mode": "direct_post",
  "client_metadata": {
    "client_name": "Example Verifier",
    "vp_formats": {
      "vc+sd-jwt": {
        "alg": ["ES256"]
      }
    }
  },
  "dcql_query": { ... }
}
```

**Request Objectヘッダー** (署名不可):
```json
{
  "alg": "none",  // 署名なし
  "typ": "JWT"
}
```

### 3.2 x509_san_dns: プレフィックス

**仕様**:
- prefixを除いた部分はDNS名で、X.509証明書のSAN (Subject Alternative Name) dNSNameエントリと一致する必要がある
- Request ObjectはX.509証明書チェーンの秘密鍵で署名必須
- `x5c` JOSEヘッダーで証明書チェーンを渡す
- Walletは署名と証明書チェーンを検証する
- 公開鍵以外のVerifierメタデータは`client_metadata`から取得

**redirect_uri制約** (DC API使用時を除く):
- Walletが Client Identifierを信頼できる場合（例: 信頼リストに含まれる）:
  - redirect_uriは自由に選択可能
- 信頼できない場合:
  - redirect_uriのFQDNはClient Identifier (prefixなし) と一致する必要がある

**使用例**:
```json
{
  "client_id": "x509_san_dns:client.example.org",
  "response_type": "vp_token id_token",
  "response_mode": "direct_post",
  "response_uri": "https://client.example.org/oid4vp/responses",
  "client_metadata": {
    "client_name": "Example Verifier",
    "vp_formats": { ... }
  },
  "dcql_query": { ... }
}
```

**Request Objectヘッダー**:
```json
{
  "alg": "ES256",
  "typ": "JWT",
  "x5c": [
    "MIICx...",  // リーフ証明書 (SAN dNSName: client.example.org)
    "MIIDy..."   // 中間CA証明書
  ]
}
```

**検証**:
```typescript
// Wallet側の検証処理
const cert = new X509Certificate(x5c[0]);
const sanDnsNames = cert.subjectAltName?.split(", ")
  .filter(san => san.startsWith("DNS:"))
  .map(san => san.substring(4));

const clientIdValue = clientId.replace("x509_san_dns:", "");
if (!sanDnsNames.includes(clientIdValue)) {
  throw new Error("Client ID does not match SAN DNS name");
}
```

### 3.3 x509_hash: プレフィックス (新規実装)

**仕様**:
- prefixを除いた部分は、リーフ証明書のSHA-256ハッシュ (Base64URL エンコード)
- ハッシュ計算: `base64url(SHA-256(DER-encoded-X.509-certificate))`
- Request ObjectはX.509証明書チェーンの秘密鍵で署名必須
- `x5c` JOSEヘッダーで証明書チェーンを渡す
- Walletは署名、証明書チェーン、ハッシュを検証する
- 公開鍵以外のVerifierメタデータは`client_metadata`から取得

**ハッシュ計算方法**:
```typescript
import { createHash } from "crypto";
import { X509Certificate } from "crypto";

/**
 * X.509証明書のSHA-256ハッシュを計算（Base64URL）
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
```

**使用例**:
```json
{
  "client_id": "x509_hash:Uvo3HtuIxuhC92rShpgqcT3YXwrqRxWEviRiA0OZszk",
  "response_type": "vp_token id_token",
  "response_mode": "direct_post",
  "response_uri": "https://verifier.example.org/oid4vp/responses",
  "client_metadata": {
    "client_name": "Example Verifier",
    "vp_formats": { ... }
  },
  "dcql_query": { ... }
}
```

**Request Objectヘッダー**:
```json
{
  "alg": "ES256",
  "typ": "JWT",
  "x5c": [
    "MIICx..."  // リーフ証明書（このハッシュがclient_idと一致する必要がある）
  ]
}
```

**検証**:
```typescript
// Wallet側の検証処理
const leafCert = x5c[0];
const calculatedHash = calculateX509Hash(leafCert);
const clientIdHash = clientId.replace("x509_hash:", "");

if (calculatedHash !== clientIdHash) {
  throw new Error("Certificate hash does not match Client ID");
}
```

## 4. 実装タスク

### 4.1 ユーティリティ関数の追加

**ファイル**: `src/oid4vp/client-id-utils.ts` (新規作成)

```typescript
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
  const prefixes: ClientIdPrefix[] = ["redirect_uri", "x509_san_dns", "x509_hash"];

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
 * Client Identifierを検証
 * @param clientId - Client Identifier
 * @param x5c - X.509証明書チェーン (x509系のprefixを使う場合)
 * @returns 検証結果
 */
export function validateClientId(
  clientId: string,
  x5c?: string[]
): { valid: boolean; error?: string } {
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
        return { valid: false, error: "x5c header is required for x509_san_dns prefix" };
      }

      // SAN DNS名の検証
      try {
        const cert = new X509Certificate(x5c[0]);
        const sanDnsNames = cert.subjectAltName?.split(", ")
          .filter(san => san.startsWith("DNS:"))
          .map(san => san.substring(4)) || [];

        if (!sanDnsNames.includes(value)) {
          return {
            valid: false,
            error: `Client ID DNS name '${value}' does not match SAN DNS names: ${sanDnsNames.join(", ")}`
          };
        }

        return { valid: true };
      } catch (error) {
        return { valid: false, error: `Failed to validate SAN DNS name: ${error}` };
      }

    case "x509_hash":
      if (!x5c || x5c.length === 0) {
        return { valid: false, error: "x5c header is required for x509_hash prefix" };
      }

      // ハッシュの検証
      try {
        const calculatedHash = calculateX509Hash(x5c[0]);
        if (calculatedHash !== value) {
          return {
            valid: false,
            error: `Certificate hash mismatch. Expected: ${value}, Got: ${calculatedHash}`
          };
        }

        return { valid: true };
      } catch (error) {
        return { valid: false, error: `Failed to calculate certificate hash: ${error}` };
      }

    default:
      return { valid: false, error: `Unsupported Client Identifier Prefix: ${prefix}` };
  }
}
```

### 4.2 auth-request.ts の変更

**変更点**:
1. `clientIdScheme`パラメータを非推奨化 (後方互換性のため残す)
2. `clientId`からprefixを自動検出
3. 旧方式から新方式への自動変換
4. `x509_hash`計算ロジックの統合

**主要な変更**:

```typescript
import { parseClientId, formatClientId, calculateX509Hash } from "./client-id-utils.js";

export interface GenerateRequestObjectOptions {
  // ... 既存フィールド

  /**
   * @deprecated Use Client Identifier Prefix in clientId instead (OID4VP 1.0)
   * Client Identifier should include prefix: "redirect_uri:", "x509_san_dns:", or "x509_hash:"
   */
  clientIdScheme?: "x509_san_dns" | "x509_san_uri" | "redirect_uri";

  // ... 残りのフィールド
}

export const generateRequestObjectPayload = (
  clientId: string,
  options: GenerateRequestObjectOptions = {},
): RequestObject => {
  let finalClientId = clientId;

  // 後方互換性: 旧clientIdSchemeから新prefix方式に自動変換
  if (options.clientIdScheme && !parseClientId(clientId)) {
    const scheme = options.clientIdScheme === "x509_san_uri"
      ? "x509_san_dns"  // x509_san_uri は x509_san_dns にマッピング
      : options.clientIdScheme;

    // x509_hash の場合は証明書からハッシュを計算
    if (scheme === "x509_hash" && options.x509CertificateInfo?.x5c?.[0]) {
      const hash = calculateX509Hash(options.x509CertificateInfo.x5c[0]);
      finalClientId = formatClientId("x509_hash", hash);
    } else {
      finalClientId = formatClientId(scheme as ClientIdPrefix, clientId);
    }

    console.warn(
      `[Deprecated] clientIdScheme is deprecated. Use Client Identifier Prefix instead: ${finalClientId}`
    );
  }

  // prefixの検証
  const parsed = parseClientId(finalClientId);
  if (!parsed) {
    throw new UnsupportedClientIdSchemeError(
      `Client ID must include a valid prefix (redirect_uri:, x509_san_dns:, or x509_hash:). Got: ${finalClientId}`
    );
  }

  // redirect_uri: プレフィックスは署名不可
  if (parsed.prefix === "redirect_uri" && options.x509CertificateInfo) {
    console.warn(
      "[Warning] redirect_uri prefix cannot be used with signed requests. Signature will be ignored."
    );
  }

  const payload: RequestObject = {
    clientId: finalClientId,  // prefixを含む
    nonce: options.nonce || generateRandomString(),
    state: options.state || generateRandomString(),
    responseType: options.responseType || "vp_token",
    responseMode: options.responseMode || "fragment",
    // client_id_scheme は削除
  };

  // ... 残りのロジック

  return payload;
};
```

### 4.3 verifier.ts の変更

**変更点**:
1. Client Identifier Prefixの検証ロジック追加
2. redirect_uri制約の検証 (x509_san_dns使用時)
3. `x509_hash`の検証

**主要な追加**:

```typescript
import { parseClientId, validateClientId } from "./client-id-utils.js";

// Request Object取得時の検証
const getRequestObject = async (requestId: string, x5c?: string[]) => {
  const request = await datastore.getRequest(requestId);

  if (!request) {
    return { ok: false, error: { type: "NOT_FOUND" } };
  }

  // Client Identifier検証 (x509系の場合は証明書も検証)
  const validationResult = validateClientId(request.clientId, x5c);
  if (!validationResult.valid) {
    return {
      ok: false,
      error: {
        type: "INVALID_CLIENT_ID",
        message: validationResult.error
      }
    };
  }

  // x509_san_dns: redirect_uri制約の検証
  const parsed = parseClientId(request.clientId);
  if (parsed?.prefix === "x509_san_dns" && request.redirectUri) {
    const redirectUrl = new URL(request.redirectUri);
    const clientIdValue = parsed.value;

    // 簡易的な検証 (実際にはWalletの信頼リストチェックが必要)
    if (redirectUrl.hostname !== clientIdValue) {
      console.warn(
        `[Warning] redirect_uri hostname (${redirectUrl.hostname}) does not match Client ID (${clientIdValue})`
      );
    }
  }

  // ... 残りのロジック
};
```

### 4.4 型定義の更新

**types.ts**: 新しいエラータイプを追加

```typescript
export interface InvalidClientIdError {
  type: "INVALID_CLIENT_ID";
  message: string;
}

export type GetRequestError =
  | NotFoundError
  | ExpiredError
  | ConsumedError
  | UnexpectedError
  | InvalidClientIdError;  // 追加
```

## 5. テスト計画

### 5.1 新規テスト

**ファイル**: `tests/oid4vp/client-id-prefix.test.ts` (新規)

```typescript
import { describe, it } from "mocha";
import { assert } from "chai";
import {
  parseClientId,
  formatClientId,
  calculateX509Hash,
  validateClientId,
} from "../../src/oid4vp/client-id-utils.js";
import { createKeyPair, createX509Certificate } from "../test-utils.js";

describe("Client Identifier Prefix", () => {
  describe("parseClientId", () => {
    it("should parse redirect_uri prefix", () => {
      const result = parseClientId("redirect_uri:https://example.org/cb");
      assert.isNotNull(result);
      assert.equal(result?.prefix, "redirect_uri");
      assert.equal(result?.value, "https://example.org/cb");
    });

    it("should parse x509_san_dns prefix", () => {
      const result = parseClientId("x509_san_dns:client.example.org");
      assert.isNotNull(result);
      assert.equal(result?.prefix, "x509_san_dns");
      assert.equal(result?.value, "client.example.org");
    });

    it("should parse x509_hash prefix", () => {
      const result = parseClientId("x509_hash:Uvo3HtuIxuhC92rShpgqcT3YXwrqRxWEviRiA0OZszk");
      assert.isNotNull(result);
      assert.equal(result?.prefix, "x509_hash");
      assert.equal(result?.value, "Uvo3HtuIxuhC92rShpgqcT3YXwrqRxWEviRiA0OZszk");
    });

    it("should return null for invalid prefix", () => {
      const result = parseClientId("http://example.org");
      assert.isNull(result);
    });
  });

  describe("formatClientId", () => {
    it("should format redirect_uri prefix", () => {
      const result = formatClientId("redirect_uri", "https://example.org/cb");
      assert.equal(result, "redirect_uri:https://example.org/cb");
    });

    it("should format x509_san_dns prefix", () => {
      const result = formatClientId("x509_san_dns", "client.example.org");
      assert.equal(result, "x509_san_dns:client.example.org");
    });
  });

  describe("calculateX509Hash", () => {
    it("should calculate SHA-256 hash correctly", () => {
      const certPem = createX509Certificate({
        subject: "CN=Test",
        san: ["DNS:example.org"],
      });

      const hash = calculateX509Hash(certPem);

      // Base64URL形式の検証
      assert.match(hash, /^[A-Za-z0-9_-]+$/);
      assert.equal(hash.length, 43); // SHA-256 (32 bytes) → Base64URL (43 chars)
    });

    it("should produce consistent hashes", () => {
      const certPem = createX509Certificate({
        subject: "CN=Test",
      });

      const hash1 = calculateX509Hash(certPem);
      const hash2 = calculateX509Hash(certPem);

      assert.equal(hash1, hash2);
    });
  });

  describe("validateClientId", () => {
    describe("redirect_uri prefix", () => {
      it("should validate valid redirect_uri", () => {
        const result = validateClientId("redirect_uri:https://example.org/cb");
        assert.isTrue(result.valid);
      });

      it("should reject invalid URL", () => {
        const result = validateClientId("redirect_uri:not-a-url");
        assert.isFalse(result.valid);
        assert.include(result.error!, "Invalid URL");
      });
    });

    describe("x509_san_dns prefix", () => {
      it("should validate matching SAN DNS name", () => {
        const certPem = createX509Certificate({
          subject: "CN=Test",
          san: ["DNS:client.example.org"],
        });

        const result = validateClientId(
          "x509_san_dns:client.example.org",
          [certPem]
        );
        assert.isTrue(result.valid);
      });

      it("should reject non-matching SAN DNS name", () => {
        const certPem = createX509Certificate({
          subject: "CN=Test",
          san: ["DNS:other.example.org"],
        });

        const result = validateClientId(
          "x509_san_dns:client.example.org",
          [certPem]
        );
        assert.isFalse(result.valid);
        assert.include(result.error!, "does not match SAN DNS names");
      });

      it("should require x5c header", () => {
        const result = validateClientId("x509_san_dns:client.example.org");
        assert.isFalse(result.valid);
        assert.include(result.error!, "x5c header is required");
      });
    });

    describe("x509_hash prefix", () => {
      it("should validate matching certificate hash", () => {
        const certPem = createX509Certificate({
          subject: "CN=Test",
        });
        const hash = calculateX509Hash(certPem);

        const result = validateClientId(
          `x509_hash:${hash}`,
          [certPem]
        );
        assert.isTrue(result.valid);
      });

      it("should reject non-matching certificate hash", () => {
        const certPem = createX509Certificate({
          subject: "CN=Test",
        });

        const result = validateClientId(
          "x509_hash:InvalidHashValue123",
          [certPem]
        );
        assert.isFalse(result.valid);
        assert.include(result.error!, "Certificate hash mismatch");
      });

      it("should require x5c header", () => {
        const result = validateClientId("x509_hash:SomeHash123");
        assert.isFalse(result.valid);
        assert.include(result.error!, "x5c header is required");
      });
    });
  });

  describe("backward compatibility", () => {
    it("should convert old client_id_scheme to redirect_uri prefix", () => {
      // generateRequestObjectPayloadのテスト
      // 旧方式のclientIdSchemeを使った場合の自動変換を確認
    });

    it("should convert old client_id_scheme to x509_san_dns prefix", () => {
      // generateRequestObjectPayloadのテスト
    });
  });
});
```

### 5.2 既存テストの更新

**全テストファイル**で`client_id`にprefixを含める形式に更新:

```typescript
// Before
const clientId = "http://localhost:3000";
const options = {
  clientIdScheme: "x509_san_dns",
  ...
};

// After
const clientId = "x509_san_dns:localhost";
// clientIdSchemeは削除（後方互換性テストを除く）
```

**対象ファイル**:
- `tests/oid4vp/verifier.test.ts`
- `tests/oid4vp/auth-request.test.ts`
- `tests/oid4vp/response-endpoint.test.ts`
- `tests/usecases/oid4vp-interactor.test.ts`

## 6. ドキュメント更新

### 6.1 api-specification.md

Request Objectの例を更新:

```json
{
  "client_id": "x509_san_dns:verifier.example.org",
  "response_type": "vp_token id_token",
  "response_mode": "direct_post",
  "response_uri": "https://verifier.example.org/oid4vp/responses",
  "nonce": "n-0S6_WzA2Mj",
  "state": "req_abc123",
  "dcql_query": { ... }
}
```

### 6.2 oid4vp-implementation.md

**新規セクション**: "Client Identifier Prefix"

```markdown
## Client Identifier Prefix (OID4VP 1.0)

OID4VP 1.0では、`client_id`にプレフィックスを含めることで、Verifierの認証方式を指定します。

### サポートするPrefix

| Prefix | 用途 | 署名要否 |
|--------|------|----------|
| `redirect_uri:` | Redirect URI/Response URIベース | 不可 |
| `x509_san_dns:` | X.509証明書のSAN DNS名ベース | 必須 |
| `x509_hash:` | X.509証明書のSHA-256ハッシュベース | 必須 |

### 使用例

... (詳細例を記載)
```

### 6.3 security.md

**新規セクション**: "x509_hash検証"

```markdown
## x509_hash Client Identifier Prefix

### ハッシュ計算

x509_hashプレフィックスでは、リーフ証明書のSHA-256ハッシュを使用します。

**計算手順**:
1. X.509証明書をDERエンコード形式で取得
2. SHA-256ハッシュを計算
3. Base64URLエンコード

### セキュリティ考慮事項

- ハッシュ衝突攻撃への耐性: SHA-256は現在安全と考えられている
- 証明書更新時の影響: 証明書を更新すると`client_id`も変更される
...
```

## 7. 環境変数

新規追加 (オプション):

```bash
# Client Identifier Prefix (default: x509_san_dns)
OID4VP_CLIENT_ID_PREFIX=x509_san_dns  # or redirect_uri, x509_hash

# Client ID value (prefix will be added automatically)
OID4VP_CLIENT_ID=verifier.example.org
# → Result: x509_san_dns:verifier.example.org
```

## 8. マイグレーションガイド

### 既存コードの移行

#### 8.1 Verifier実装側

```typescript
// Before (OID4VP 0.x)
const clientId = "http://localhost:3000";
const requestObject = await generateRequestObjectJwt(clientId, jwk, {
  clientIdScheme: "x509_san_dns",
  responseMode: "direct_post",
  responseUri: "http://localhost:3000/oid4vp/responses",
  ...
});

// After (OID4VP 1.0)
const clientId = "x509_san_dns:localhost";  // prefixを含める
const requestObject = await generateRequestObjectJwt(clientId, jwk, {
  // clientIdScheme削除
  responseMode: "direct_post",
  responseUri: "http://localhost:3000/oid4vp/responses",
  ...
});
```

#### 8.2 後方互換性の維持

旧方式も引き続きサポート（非推奨）:

```typescript
// 旧方式（非推奨だが動作する）
const clientId = "http://localhost:3000";
const requestObject = await generateRequestObjectJwt(clientId, jwk, {
  clientIdScheme: "x509_san_dns",  // 自動的にprefixに変換される
  ...
});
// → client_id: "x509_san_dns:http://localhost:3000"
```

#### 8.3 x509_hash への移行

```typescript
// x509_hashを使う場合
const certPem = process.env.OID4VP_VERIFIER_X5C;
const hash = calculateX509Hash(certPem);
const clientId = `x509_hash:${hash}`;

const requestObject = await generateRequestObjectJwt(clientId, jwk, {
  responseMode: "direct_post",
  x509CertificateInfo: {
    x5c: [certPem],
  },
  ...
});
```

## 9. 実装スケジュール

1. **Phase 1**: ユーティリティ関数実装
   - `client-id-utils.ts`作成
   - 単体テスト作成

2. **Phase 2**: auth-request.ts更新
   - prefix対応
   - 後方互換性実装
   - テスト更新

3. **Phase 3**: verifier.ts更新
   - 検証ロジック追加
   - テスト更新

4. **Phase 4**: ドキュメント更新
   - API仕様
   - 実装ガイド
   - セキュリティドキュメント

5. **Phase 5**: 統合テスト
   - E2Eテスト
   - 後方互換性確認

## 10. リスクと対策

| リスク | 影響 | 対策 |
|--------|------|------|
| 既存のWalletが新形式に対応していない | Walletが接続できない | 後方互換性を維持（clientIdScheme対応） |
| x509_hash計算ミス | 認証失敗 | 十分なテストケース、リファレンス実装との比較 |
| redirect_uri制約の誤実装 | セキュリティリスク | 仕様の厳密な実装、セキュリティレビュー |

## 11. 参考資料

- [OpenID for Verifiable Presentations 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- [RFC 5280 - X.509 Certificate and CRL Profile](https://datatracker.ietf.org/doc/html/rfc5280)
- [RFC 7515 - JSON Web Signature (JWS)](https://datatracker.ietf.org/doc/html/rfc7515)

---

## 実施結果

### 実装完了日
2025-11-19

### 実装方針の変更
当初計画では後方互換性（`clientIdScheme`パラメータ）を維持する予定でしたが、ユーザー要望により**後方互換性は実装せず**、OID4VP 1.0仕様に完全準拠する方針に変更しました。

### 実装内容

#### Phase 1: ユーティリティ関数実装 ✅
- **ファイル作成**:
  - `src/oid4vp/client-id-utils.ts` (173行)
  - `tests/oid4vp/client-id-prefix.test.ts` (268行)
- **実装機能**:
  - `parseClientId()`: Client IDからプレフィックスを抽出
  - `formatClientId()`: プレフィックス付きClient ID生成
  - `calculateX509Hash()`: X.509証明書のSHA-256ハッシュ計算（Base64URL）
  - `validateClientId()`: Client IDとX.509証明書の検証
- **テスト**: 37個のテスト全てパス

#### Phase 2: auth-request.ts更新 ✅
- **変更内容**:
  - `clientIdScheme`パラメータを`GenerateRequestObjectOptions`から完全削除
  - `generateRequestObjectPayload()`でプレフィックス検証追加
  - `redirect_uri:`プレフィックスで署名使用時に警告出力
- **削減**: 約45行削減（後方互換性コード削除）

#### Phase 3: verifier.ts更新 ✅
- **変更内容**:
  - `startRequest()`で`parseClientId()`による新形式検出実装
  - プレフィックスに応じて署名付き/なしリクエスト生成
  - エラーメッセージを新形式に対応
- **テスト更新**: `tests/oid4vp/verifier.test.ts`、`tests/oid4vp/end-to-end-encryption.test.ts`

#### Phase 4: ドキュメント更新 ✅
- **更新ファイル**:
  - `docs/api-specification.md`: 新形式の例とプレフィックス説明追加
  - `docs/oid4vp-implementation.md`: コード例を新形式に更新
  - `docs/security.md`: Client Identifier Prefix説明追加、設定例更新

#### Phase 5: 統合テスト ✅
- **テスト結果**: 74個全テスト通過（1個はskip）
- **E2Eテスト**: 暗号化機能との統合テスト含めて全てパス
- **カバレッジ**: 全3種類のプレフィックスをテスト

### コミット履歴
- `3efd410`: feat: implement Client Identifier Prefix (OID4VP 1.0)
- `fb53684`: refactor: remove deprecated client_id_scheme backward compatibility (OID4VP 1.0)

### 影響範囲
- **変更ファイル**: 7ファイル
- **追加ファイル**: 2ファイル
- **コード削減**: -89行、+80行（差分: -9行）

### 使用方法

```typescript
// OID4VP 1.0の新形式（プレフィックス必須）
const clientId = "x509_san_dns:your-verifier.com";

const authRequest = await verifier.startRequest(request, clientId, {
  issuerJwk: verifierJwk,
  x5c: verifierX5c,
  requestObject: {
    responseUri: "https://your-verifier.com/oid4vp/responses",
    dcqlQuery: query,
  },
});
```

### 対応完了項目
- ✅ `redirect_uri:` プレフィックス対応
- ✅ `x509_san_dns:` プレフィックス対応
- ✅ `x509_hash:` プレフィックス対応
- ✅ プレフィックス検証機能
- ✅ X.509証明書ハッシュ計算
- ✅ SAN DNS名検証
- ✅ 包括的なテストカバレッジ
- ✅ ドキュメント更新
- ✅ 後方互換性削除（ユーザー要望）

### 備考
- 後方互換性を削除したため、全てのClient IDはプレフィックスを含む必要があります
- 旧形式（`client_id_scheme`パラメータ使用）はサポートされません
- OID4VP 1.0仕様に完全準拠
