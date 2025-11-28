# OID4VP実装ドキュメント

## 概要

このドキュメントでは、OID4VP VerifierシステムにおけるOpenID for Verifiable Presentations (OID4VP)の実装詳細について説明します。OID4VPは、Identity Walletから検証可能なクレデンシャルを受け取り、検証済みデータを安全に取得するための認証プロトコルです。

**関連ドキュメント**:
- [VP Token検証プロセス](./oid4vp-verification.md) - SD-JWT検証、DCQL Query定義
- [VP Token暗号化](./oid4vp-encryption.md) - HAIP準拠の暗号化フロー
- [リファレンス](./oid4vp-reference.md) - セッション管理、環境変数、エラーハンドリング

## OID4VPとは

**OpenID for Verifiable Presentations (OID4VP)** は、W3C Verifiable Credentials (VC) をOAuth 2.0/OpenID Connectフレームワークで利用するためのプロトコルです。

### 主な特徴

- **Verifier**: クレデンシャルの検証を行うサーバー（本システム）
- **Holder**: クレデンシャルを保持するウォレットアプリ（ユーザーのIdentity Wallet）
- **Presentation**: ウォレットがVerifierに提示するクレデンシャルのセット
- **DCQL Query**: Verifierが要求するクレデンシャルの条件（OID4VP 1.0で導入）
- **SD-JWT**: Selective Disclosure JWT（選択的開示）

### OID4VP 1.0への移行

本システムはOID4VP 1.0仕様に準拠しており、以下の変更が適用されています:
- **Presentation Exchange (PEX)廃止**: Presentation DefinitionとPresentation Submissionは使用されません
- **DCQL導入**: クレデンシャル要求はDigital Credentials Query Language (DCQL)で記述されます
- **VP Token構造変更**: DCQL形式（JSON object with credential query ID as key）を使用

### プロトコルフロー（簡易版）

```
┌─────────────┐                                      ┌──────────────┐
│   Wallet    │                                      │  OID4VP      │
│    (Holder) │                                      │   Verifier   │
└──────┬──────┘                                      └──────┬───────┘
       │                                                     │
       │ 1. POST /oid4vp/auth-request                       │
       │───────────────────────────────────────────────────>│
       │                                                     │
       │   { authRequest, requestId, transactionId }        │
       │<───────────────────────────────────────────────────│
       │                                                     │
       │ 2. Parse authRequest (oid4vp://...)                │
       │                                                     │
       │ 3. GET /oid4vp/request?id=...                      │
       │───────────────────────────────────────────────────>│
       │                                                     │
       │   Request Object (JWT with dcql_query)             │
       │<───────────────────────────────────────────────────│
       │                                                     │
       │ 4. User selects credentials in Wallet              │
       │                                                     │
       │ 5. POST /oid4vp/responses                          │
       │    (vp_token as JSON object, state)                │
       │───────────────────────────────────────────────────>│
       │                                                     │
       │   { redirect_uri: "...#response_code=..." }        │
       │<───────────────────────────────────────────────────│
       │                                                     │
       │ 6. Redirect to response_code                       │
       │                                                     │
       │ 7. POST /oid4vp/response-code/exchange             │
       │    ?response_code=...                              │
       │    (VP Token検証成功後、自動的にcommitted状態へ)   │
       │───────────────────────────────────────────────────>│
       │                                                     │
       │   { claimer: { id_token, organization, icon } }    │
       │<───────────────────────────────────────────────────│
       │                                                     │
```

**注**: OID4VP 1.0では、Presentation Definition エンドポイント (Step 4) は廃止されました。DCQL queryはRequest Object内に直接含まれます。

## アーキテクチャ

### コンポーネント構成

```
┌──────────────────────────────────────────────────┐
│        OID4VP Verifier (src/oid4vp/)             │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  OID4VP Interactor                       │   │
│  │  (usecases/oid4vp-interactor.ts)         │   │
│  │  - generateAuthRequest()                 │   │
│  │  - receiveAuthResponse()                 │   │
│  │  - exchangeAuthResponse()                │   │
│  │  - getStates()                           │   │
│  └────────┬─────────────────────────────────┘   │
│           │                                      │
│           ├──────────┬──────────┬───────────┐   │
│           ▼          ▼          ▼           ▼   │
│  ┌────────────┐ ┌──────────┐ ┌─────────┐ ┌────┴──────┐
│  │  Verifier  │ │ Response │ │  State  │ │  Session  │
│  │            │ │ Endpoint │ │   Repo  │ │    Repo   │
│  │ (verifier) │ │(response-│ │(SQLite) │ │ (SQLite)  │
│  │    .ts)    │ │endpoint) │ │         │ │           │
│  └────────────┘ └──────────┘ └─────────┘ └───────────┘
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Credential Processors                   │   │
│  │  - credential2-processor.ts              │   │
│  │  - extractCredentialFromVpToken (DCQL)   │   │
│  │  - Learning Credential検証               │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  SQLite Database                         │   │
│  │  - sessions                              │   │
│  │  - requests                              │   │
│  │  - response_codes                        │   │
│  │  - post_states                           │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
└──────────────────────────────────────────────────┘
```

### データストア

OID4VP VerifierはSQLiteデータベースを使用してOID4VP関連データを管理：

| テーブル名 | 用途 |
|-----------|------|
| `sessions` | OID4VPセッション状態管理（vp_token, credential_dataなど） |
| `requests` | VP requestメタデータ（response_type, transaction_idなど） |
| `response_codes` | Authorization response codes（payload, usedフラグ） |
| `post_states` | 認証フローの状態追跡（started/committed/expired/invalid_submissionなど） |

**注**: `presentation_definitions`テーブルはOID4VP 1.0への移行に伴い廃止されました（DCQL導入のため）。

## 認証フロー詳細

### 1. 認証リクエスト生成（generateAuthRequest）

**エンドポイント**: `POST /oid4vp/auth-request`

**処理フロー**:

```typescript
// src/usecases/oid4vp-interactor.ts
const generateAuthRequest = async (presenter) => {
  // 1. トランザクション開始（Response Endpoint）
  const request = await responseEndpoint.initiateTransaction({
    responseType: "vp_token id_token",
    redirectUriReturnedByResponseUri: "...",
    expiredIn: 600,
  });
  // request.id, request.transactionId が生成される

  // 2. DCQL Query生成（OID4VP 1.0）
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

  // 3. Verifierリクエスト開始
  // OID4VP 1.0: clientIdにプレフィックスを含める
  const clientIdWithPrefix = `x509_san_dns:${clientId}`;
  const authRequest = await verifier.startRequest(request, clientIdWithPrefix, {
    expiredIn: 600,
    issuerJwk: verifierJwk,
    x5c: verifierX5c,
    requestObject: {
      responseUri: responseUri,
      dcqlQuery,  // DCQL Query（Presentation Definitionの代わり）
      clientMetadata: generateClientMetadata(),
    },
  });

  // 4. ポストステート作成
  await stateRepository.putState(request.id, "started");

  // 5. レスポンス返却
  return presenter(authRequest, request.id, request.transactionId);
};
```

**生成されるデータ**:

1. **Request @ Response Endpoint**:
   ```json
   {
     "id": "req-123",
     "responseType": "vp_token id_token",
     "transactionId": "tx-456",
     "issuedAt": 1705300000,
     "expiredIn": 600
   }
   ```

2. **Request @ Verifier**:
   ```json
   {
     "id": "req-123",
     "nonce": "7f8a9b0c1d2e3f4g5h6i7j8k9l0m1n2o",
     "issuedAt": 1705300000,
     "expiredIn": 600,
     "consumedAt": 0
   }
   ```

3. **Authorization Request** (JWTとして返却):
   ```
   oid4vp://localhost/request?client_id=http://localhost&request_uri=http://localhost/oid4vp/request?id=req-123
   ```

### 2. リクエストオブジェクト取得（getRequestObject）

**エンドポイント**: `GET /oid4vp/request?id=req-123`

**注**: OID4VP 1.0では`presentationDefinitionId`パラメータは不要です（DCQL queryはRequest Object内に含まれます）。

**処理フロー**:

```typescript
const getRequestObject = async (requestId) => {
  // 1. リクエスト検証
  const request = await getRequest(requestId);
  if (!request) return { ok: false, error: { type: "NOT_FOUND" } };
  if (isExpired(request)) return { ok: false, error: { type: "EXPIRED" } };
  if (request.consumedAt > 0) return { ok: false, error: { type: "CONSUMED" } };

  // 2. DCQL Queryを含むRequest Object (JWT)生成
  // OID4VP 1.0: clientIdにプレフィックスを含める
  const clientIdWithPrefix = `x509_san_dns:${clientId}`;
  const requestObjectJwt = await generateRequestObjectJwt(
    clientIdWithPrefix,
    {
      nonce: request.nonce,
      state: request.id,
      responseUri: responseUri,
      dcqlQuery: request.dcql_query,  // DCQL Query（DB保存済み）
      clientMetadata: generateClientMetadata(),
    },
    verifierJwk,
    verifierX5c,
  );

  return { ok: true, payload: requestObjectJwt };
};
```

**Request Object (JWT)**:

ヘッダー:
```json
{
  "alg": "ES256",
  "typ": "JWT",
  "x5c": ["MIICx..."]
}
```

ペイロード（OID4VP 1.0形式）:
```json
{
  "client_id": "x509_san_dns:example.com",
  "response_type": "vp_token",
  "response_mode": "direct_post.jwt",
  "response_uri": "http://localhost/oid4vp/responses",
  "nonce": "7f8a9b0c1d2e3f4g5h6i7j8k9l0m1n2o",
  "state": "req-123",
  "dcql_query": {
    "credentials": [...]
  },
  "client_metadata": {
    "vp_formats": { "dc+sd-jwt": {} },
    "client_name": "boolcheck.com",
    "logo_uri": "http://localhost/logo.png",
    "client_purpose": "学習証明書を検証します"
  }
}
```

**注**: OID4VP 1.0では`client_id_scheme`パラメータは使用せず、`client_id`にプレフィックスを含めます。

### 3. レスポンス受信（receiveAuthResponse）

**エンドポイント**: `POST /oid4vp/responses`

**リクエスト** (application/x-www-form-urlencoded):

暗号化レスポンスの場合:
```
response=eyJhbGciOiJFQ0RILUVTIiwiZW5jIjoiQTEyOEdDTSIsImVwayI6...（JWE）&
state=req-123
```

非暗号化レスポンスの場合（DCQL形式）:
```
vp_token={"learning_credential":["eyJhbGciOiJFUzI1NiIsInR5cCI6ImRjK3NkLWp3dCJ9..."]}&
state=req-123
```

**処理フロー**:

```typescript
const receiveAuthResponse = async (payload, presenter) => {
  const { response, vp_token, state } = payload;

  // 1. リクエスト検証
  const request = await getRequest(state);
  if (!request) return { ok: false, error: { type: "REQUEST_ID_IS_NOT_FOUND" } };
  if (isExpired(request)) return { ok: false, error: { type: "REQUEST_ID_IS_EXPIRED" } };

  // 2. 暗号化レスポンスの場合はJWE復号化
  let actualPayload;
  if (response) {
    const privateJwk = JSON.parse(request.encryption_private_jwk);
    actualPayload = await decryptJWE(response, privateJwk);
  } else {
    actualPayload = { vp_token, state };
  }

  // 3. レスポンス保存
  const responseCode = uuidv4();
  await saveResponse({
    id: responseCode,
    requestId: actualPayload.state || state,
    payload: { vpToken: actualPayload.vp_token },
    issuedAt: Date.now() / 1000,
    expiredIn: 600,
  });

  // 4. リダイレクトURI返却
  const redirectUri = request.redirectUriReturnedByResponseUri;
  return presenter(redirectUri, responseCode);
};
```

**レスポンス**:
```json
{
  "redirect_uri": "https://client.example.org/cb#response_code=091535f699ea575c7937fa5f0f454aee"
}
```

### 4. レスポンスコード交換（exchangeAuthResponse）

**エンドポイント**: `POST /oid4vp/response-code/exchange?response_code=091535f699ea575c7937fa5f0f454aee`

**処理フロー**:

```typescript
const exchangeAuthResponse = async (responseCode, transactionId, presenter) => {
  // 1. レスポンス取得
  const response = await getResponse(responseCode);
  if (!response) return { ok: false, error: { type: "RESPONSE_IS_NOT_FOUND" } };
  if (isExpired(response)) return { ok: false, error: { type: "RESPONSE_IS_EXPIRED" } };

  // 2. リクエスト取得（nonceを含む）
  const request = await getRequest(response.requestId);
  const { nonce } = request;

  // 3. VP Token処理（DCQL形式）
  // VP Tokenは { "learning_credential": ["SD-JWT..."] } の形式
  const vpToken = response.payload.vpToken;

  // 4. Learning Credential抽出・検証
  const credential = await extractCredentialFromVpToken(
    vpToken,
    "learning_credential",  // credentialQueryId
    nonce
  );
  if (!credential.ok) {
    await updatePostState(response.requestId, "invalid_submission");
    return { ok: false, error: credential.error };
  }

  // 5. リクエストを消費（再利用防止）
  await verifier.consumeRequest(response.requestId);

  // 6. セッション保存
  await saveSession({
    id: response.requestId,
    learningCredentialJwt: credential.payload.learningCredential,
  });

  // 7. VP Token検証成功時、自動的にcommitted状態に遷移
  await updatePostState(response.requestId, "committed");

  // 8. レスポンス返却
  return presenter(response.requestId, {
    learningCredential: credential.payload.learningCredential,
  });
};
```

**レスポンス**:
```json
{
  "requestId": "req-123",
  "learningCredential": "eyJhbGciOiJFUzI1NiIsInR5cCI6ImRjK3NkLWp3dCJ9..."
}
```

## まとめ

OID4VP Verifierの実装は、以下の特徴を持ちます：

1. **OID4VP 1.0準拠**: OpenID for Verifiable Presentations 1.0仕様に準拠
2. **DCQL対応**: Digital Credentials Query Languageによるクレデンシャル要求
3. **X.509ベース認証**: `x509_san_dns`/`x509_hash`スキームによるVerifier認証
4. **SD-JWT対応**: Selective Disclosure JWTによる選択的開示
5. **2層検証**: SD-JWT署名検証 + Key Binding JWT検証（nonce/aud確認）
6. **Learning Credential検証**: 学習証明書の検証に対応
7. **自動状態遷移**: VP Token検証成功時に自動的にcommitted状態へ遷移
8. **セッション管理**: SQLiteベースのステートフル認証フロー
9. **単一ノード構成**: シンプルな単一プロセスで動作
10. **VP Token暗号化対応**: HAIP準拠のECDH-ES + A128GCM暗号化サポート

この実装により、Identity Walletから学習証明書（Learning Credential）を安全に受け取り、検証することが可能になっています。
