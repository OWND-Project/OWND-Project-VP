# VP Token検証プロセス

このドキュメントでは、VP Token（Verifiable Presentation Token）の検証プロセス、SD-JWT処理、およびDCQL Query定義について説明します。

**関連ドキュメント**:
- [OID4VP実装ドキュメント](./oid4vp-implementation.md) - メインドキュメント
- [VP Token暗号化](./oid4vp-encryption.md) - HAIP準拠の暗号化フロー
- [リファレンス](./oid4vp-reference.md) - セッション管理、環境変数

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

```
[JWT Verification] Header: alg=ES256, kid=none, jwk=none, x5c=present (1 certs)
[JWT Verification] Key source: x5c, alg=ES256
[JWT Verification] Signature verification successful
```

### 検証失敗時

```
[JWT Verification] Signature verification failed: JWSSignatureVerificationFailed: signature verification failed
```
