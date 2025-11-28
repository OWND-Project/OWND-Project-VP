# VP Token検証プロセス

このドキュメントでは、VP Token（Verifiable Presentation Token）の検証プロセス、SD-JWT処理、およびDCQL Query定義について説明します。

**関連ドキュメント**:
- [OID4VP実装ドキュメント](./oid4vp-implementation.md) - メインドキュメント
- [VP Token暗号化](./oid4vp-encryption.md) - HAIP準拠の暗号化フロー
- [リファレンス](./oid4vp-reference.md) - セッション管理、環境変数
- [ADR-001: VP Token検証の実行場所](./decisions/001-vp-token-verification-location.md) - 設計決定

## 検証実行タイミング

VP Token検証は **`POST /oid4vp/responses`** エンドポイントで実行されます（`/exchange`ではない）。

```
Wallet → POST /responses → JWE復号化 → VP Token検証 → 結果保存 → response_code返却
                                              ↓
                                      検証成功: committed
                                      検証失敗: invalid_submission
```

### 検証コールバックパターン

検証ロジックはコールバックとして注入されます。これにより、ライブラリ化時に検証ロジックをカスタマイズ可能です：

```typescript
export interface VpTokenVerificationCallback {
  verifyCredential: (
    credential: string,
    nonce: string,
  ) => Promise<Result<{ verified: true; decodedPayload?: any }, string>>;
}

// 使用例
const verificationCallback: VpTokenVerificationCallback = {
  verifyCredential: async (credential, nonce) => {
    try {
      const result = await verifySdJwt(credential, {});
      return { ok: true, payload: { verified: true, decodedPayload: result } };
    } catch (err) {
      return { ok: false, error: String(err) };
    }
  },
};

await responseEndpoint.receiveAuthResponse(payload, {
  verificationCallback,
});
```

## Learning Credential処理（DCQL）

### 処理フロー

```typescript
// extractCredentialFromVpToken の実装

// 1. DCQL形式からCredential取得
// VP Tokenは { "learning_credential": ["SD-JWT..."] } の形式
const presentations = vpToken[credentialQueryId];
if (!presentations || presentations.length === 0) {
  return { ok: true, payload: { learningCredential: undefined } };
}
const token = presentations[0];

// 2. SD-JWTデコード
const decoded = decodeSDJWT(token);

// 3. Issuer JWTヘッダー情報のログ出力
const issuerJwt = token.split("~")[0];
const issuerHeader = decodeProtectedHeader(issuerJwt);
logger.info(`[SD-JWT] Issuer JWT Header: alg=${issuerHeader.alg}, x5c=${issuerHeader.x5c ? 'present' : 'none'}`);

// 4. Key Binding JWT検証（nonce確認）
if (!decoded.keyBindingJWT) {
  return { ok: false, error: { type: "INVALID_PARAMETER" } };
}
const kbPayload = decodeJwt(decoded.keyBindingJWT);
if (kbPayload.nonce !== nonce) {
  return { ok: false, error: { type: "INVALID_PARAMETER" } };
}

// 5. SD-JWT署名検証（X.509証明書チェーン含む）
await verifySdJwt(token, {});

// 6. Learning Credential返却
return { ok: true, payload: { learningCredential: token } };
```

## 検証レイヤー

```
┌─────────────────────────────────────────────────┐
│  1. DCQL形式検証                                │
│     - VP Tokenが正しいJSON形式か確認            │
│     - credentialQueryIdに対応するCredential取得 │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  2. SD-JWT検証                                  │
│     - SD-JWTデコード（disclosures展開）         │
│     - Issuer JWT署名検証                        │
│     - X.509証明書チェーン検証                   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  3. Key Binding JWT検証                         │
│     - nonce検証                                 │
│     - aud検証（必要な場合）                     │
│     - Holder公開鍵による署名検証                │
└─────────────────────────────────────────────────┘
```

## SD-JWT処理

### SD-JWTとは

**Selective Disclosure JWT** は、JWTのクレームを選択的に開示できる仕組みです。

**構造**:
```
<Issuer-signed JWT>~<Disclosure 1>~<Disclosure 2>~...~<KB-JWT>
```

### デコード処理

```typescript
import { decodeSDJWT } from "@meeco/sd-jwt";

const decoded = decodeSDJWT(token);
// {
//   jwt: { header, payload, signature },
//   disclosures: [...],
//   kbJwt: { ... }
// }
```

### CredentialSubject抽出（Learning Credential）

```typescript
// verifySdJwtでdisclosuresを展開し、完全なペイロードを取得
const verifiedResult = await verifySdJwt(learningCredentialJwt, {});
const payload = verifiedResult.decodedPayload || verifiedResult;

// Learning Credentialフィールド抽出
const learningCredential = {
  issuing_authority: payload.issuing_authority,
  issuing_country: payload.issuing_country,
  date_of_issuance: payload.date_of_issuance,
  family_name: payload.family_name,
  given_name: payload.given_name,
  achievement_title: payload.achievement_title,
  achievement_description: payload.achievement_description,
  learning_outcomes: payload.learning_outcomes,
  assessment_grade: payload.assessment_grade,
};
```

### ログ出力

SD-JWT検証時には以下のログが出力されます：

```
[SD-JWT] Issuer JWT Header: alg=ES256, kid=none, x5c=present (1 certs), jwk=none
[SD-JWT] Structure: disclosures=6, keyBindingJWT=present
[KB-JWT Verification] Header: alg=ES256, kid=none
[KB-JWT Verification] Holder key: kty=EC, crv=P-256
[JWT Verification] Key source: x5c, alg=ES256
[JWT Verification] Signature verification successful
```

## DCQL Query定義

### Learning Credential用DCQL Query

**ファイル**: `src/usecases/oid4vp-interactor.ts`

```typescript
// DCQL Query生成
const dcqlQuery = verifier.generateDcqlQuery([
  {
    id: "learning_credential",
    format: "dc+sd-jwt",
    meta: {
      vct_values: ["urn:eu.europa.ec.eudi:learning:credential:1"],
    },
    claims: [
      { path: ["issuing_authority"] },
      { path: ["issuing_country"] },
      { path: ["date_of_issuance"] },
      { path: ["family_name"] },
      { path: ["given_name"] },
      { path: ["achievement_title"] },
      { path: ["achievement_description"] },
      { path: ["learning_outcomes"] },
      { path: ["assessment_grade"] },
    ],
  },
]);
```

### DCQLの構造

| フィールド | 説明 |
|-----------|------|
| `id` | Credential Query ID（VP Token内でこのIDがキーになる） |
| `format` | クレデンシャル形式（`dc+sd-jwt`など） |
| `meta.vct_values` | 許可されるVerifiable Credential Type |
| `claims` | 要求するクレーム（pathで指定） |

### VP Token形式（DCQL）

Walletからのレスポンス:
```json
{
  "learning_credential": [
    "eyJhbGciOiJFUzI1NiIsInR5cCI6ImRjK3NkLWp3dCIsIng1YyI6WyJNSUlD...~eyJfc2QiOlsi...~eyJhbGciOiJFUzI1NiJ9..."
  ]
}
```

- キー: DCQL Query IDに対応
- 値: SD-JWT配列（通常は1つ）

### PEXとの違い

| 項目 | PEX (廃止) | DCQL |
|------|-----------|------|
| クレデンシャル要求 | `presentation_definition` + `input_descriptors` | `dcql_query` + `credentials` |
| クレーム指定 | `constraints.fields[].path` | `claims[].path` |
| VP Token形式 | JWT with `vp.verifiableCredential` | JSON object with query ID as key |
| Submission | `presentation_submission` | 不要 |

## X.509証明書チェーン検証

### 検証フロー

```typescript
// src/tool-box/verify.ts
const verifyJwt = async (jwt, options) => {
  const { x5c, jwk, alg } = decodeProtectedHeader(jwt);

  if (x5c) {
    // 1. 証明書チェーン検証
    await verifyCertificateChain(x5c);

    // 2. リーフ証明書から公開鍵抽出
    const x509 = `-----BEGIN CERTIFICATE-----\n${x5c[0]}\n-----END CERTIFICATE-----`;
    const key = await importX509(x509, alg || "ES256");

    // 3. JWT署名検証
    const { payload } = await jwtVerify(jwt, key);
    return { ok: true, payload };
  }
  // ...
};
```

### カスタムトラストアンカー

環境変数 `OID4VP_TRUST_ANCHOR_CERTIFICATES` でカスタムトラストアンカーを指定可能:

```bash
export OID4VP_TRUST_ANCHOR_CERTIFICATES=/path/to/root.cer,/path/to/intermediate.cer
```

## JWT検証ログ

JWT検証時のログ出力例:

**X.509証明書チェーンで署名されたクレデンシャル**:
```
[JWT Verification] Header: alg=ES256, kid=none, jwk=none, x5c=present (1 certs)
[JWT Verification] Key source: x5c (certificate chain), verifying certificate chain...
[Certificate Chain] Starting verification: 1 certificate(s) in chain
[Certificate Chain] Trust anchors: system=150, custom=3, total=153
[Certificate Chain] Leaf certificate: subject.CN=Cyber Security Cloud, Inc., ...
[Certificate Chain] Verification SUCCESS
[JWT Verification] Certificate chain verified, extracting public key from leaf certificate, alg=ES256
[JWT Verification] Signature verification successful
[requestId=xxx] Credential 1 verified for queryId: learning_credential (keySource=x5c, alg=ES256, certChainVerified=true)
```

**埋め込みJWKで署名されたクレデンシャル**:
```
[JWT Verification] Header: alg=ES256K, kid=none, jwk=present, x5c=none
[JWT Verification] Key source: jwk (embedded key), no certificate chain verification needed, kty=EC, crv=secp256k1, alg=ES256K
[JWT Verification] Signature verification successful
[requestId=xxx] Credential 1 verified for queryId: learning_credential (keySource=jwk, alg=ES256K, certChainVerified=N/A)
```

### 検証失敗時

**署名検証失敗**:
```
[JWT Verification] Signature verification failed: JWSSignatureVerificationFailed: signature verification failed
```

**証明書チェーン検証失敗**（トラストアンカー不一致）:
```
[JWT Verification] Header: alg=ES256, kid=none, jwk=none, x5c=present (1 certs)
[JWT Verification] Key source: x5c (certificate chain), verifying certificate chain...
[Certificate Chain] Starting verification: 1 certificate(s) in chain
[Certificate Chain] Trust anchors: system=150, custom=3, total=153
[Certificate Chain] Leaf certificate: subject.CN=Learning Credential Issuer, subject.O=Educational Institution, issuer.CN=Learning Credential Issuer, issuer.O=Educational Institution
[Certificate Chain] Executing certificate chain verification...
[Certificate Chain] Verification FAILED: No valid certificate paths found
[JWT Verification] Certificate chain verification failed: Error: Certificate chain verification failed: No valid certificate paths found
```

**原因と解決方法**:
- 自己署名証明書がトラストアンカーに登録されていない
- 中間証明書がチェーンに含まれていない
- 解決: `OID4VP_TRUST_ANCHOR_CERTIFICATES`環境変数でカスタムトラストアンカーを追加

## 検証結果の型

### VerificationMetadata

検証結果には、クレデンシャルがどのように検証されたかを示すメタデータが含まれます：

```typescript
export interface VerificationMetadata {
  /** 鍵のソース: x5c（証明書チェーン）, jwk（埋め込みJWK）, secret */
  keySource: "x5c" | "jwk" | "secret";
  /** 使用されたアルゴリズム */
  algorithm?: string;
  /** 証明書チェーン検証の結果（x5cの場合のみ） */
  certificateChainVerified?: boolean;
}
```

### VpTokenVerificationResult

```typescript
export interface VpTokenVerificationResult {
  credentials: Record<string, CredentialVerificationResult[]>;
}

export type CredentialVerificationResult =
  | { status: "verified"; credential: string; payload?: any; verificationMetadata?: VerificationMetadata }
  | { status: "invalid"; error: string; verificationMetadata?: VerificationMetadata }
  | { status: "not_found" };
```

### 検証結果の例

**X.509証明書チェーンで署名されたクレデンシャル**:
```json
{
  "credentials": {
    "learning_credential": [
      {
        "status": "verified",
        "credential": "eyJhbGciOiJFUzI1NiIsInR5cCI6ImRjK3NkLWp3dCIsIng1YyI6Wy4uLl19...",
        "payload": {
          "vct": "urn:eu.europa.ec.eudi:learning:credential:1",
          "issuing_authority": "Test University",
          "family_name": "田中",
          "given_name": "太郎"
        },
        "verificationMetadata": {
          "keySource": "x5c",
          "algorithm": "ES256",
          "certificateChainVerified": true
        }
      }
    ]
  }
}
```

**埋め込みJWKで署名されたクレデンシャル**:
```json
{
  "credentials": {
    "learning_credential": [
      {
        "status": "verified",
        "credential": "eyJhbGciOiJFUzI1NksiLCJ0eXAiOiJkYytzZC1qd3QiLCJqd2siOnsuLi59fQ...",
        "payload": {
          "vct": "urn:eu.europa.ec.eudi:learning:credential:1",
          "issuing_authority": "Test University"
        },
        "verificationMetadata": {
          "keySource": "jwk",
          "algorithm": "ES256K"
        }
      }
    ]
  }
}
```

### エラーケース

| status | error | 説明 |
|--------|-------|------|
| `invalid` | `nonce_mismatch` | Key Binding JWTのnonceがリクエストと一致しない |
| `invalid` | `SD-JWT signature verification failed` | SD-JWT署名検証に失敗 |
| `invalid` | `Certificate chain verification failed` | X.509証明書チェーン検証に失敗 |
| `not_found` | - | 指定されたcredentialQueryIdに対応するクレデンシャルがない |

## リクエストIDによるログトレース

すべての検証ログにはリクエストIDプレフィックスが付与され、処理の追跡が可能です：

```
[requestId=2a6fa0be-8e89-4be8-ab44-804cf755cdee] Starting VP Token verification
[requestId=2a6fa0be-8e89-4be8-ab44-804cf755cdee] Credential 1 verified for queryId: learning_credential
[requestId=2a6fa0be-8e89-4be8-ab44-804cf755cdee] VP Token verification completed: [{"queryId":"learning_credential","results":["verified"]}]
[requestId=2a6fa0be-8e89-4be8-ab44-804cf755cdee] VP Token verification succeeded
```

### ログのフィルタリング

特定のリクエストのログを抽出する例：

```bash
grep "requestId=2a6fa0be-8e89-4be8-ab44-804cf755cdee" app.log
```
