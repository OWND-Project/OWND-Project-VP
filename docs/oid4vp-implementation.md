# OID4VP実装ドキュメント

## 概要

このドキュメントでは、boolcheckシステムにおけるOpenID for Verifiable Presentations (OID4VP)の実装詳細について説明します。OID4VPは、アイデンティティウォレットから検証可能なクレデンシャルを受け取り、真偽情報（Claims）を安全に登録するための認証プロトコルです。

## OID4VPとは

**OpenID for Verifiable Presentations (OID4VP)** は、W3C Verifiable Credentials (VC) をOAuth 2.0/OpenID Connectフレームワークで利用するためのプロトコルです。

### 主な特徴

- **Verifier**: クレデンシャルの検証を行うサーバー（boolcheckではVERIFIER_NODE）
- **Holder**: クレデンシャルを保持するウォレットアプリ（ユーザーのアイデンティティウォレット）
- **Presentation**: ウォレットがVerifierに提示するクレデンシャルのセット
- **Presentation Definition**: Verifierが要求するクレデンシャルの条件
- **SD-JWT**: Selective Disclosure JWT（選択的開示）

### プロトコルフロー

```
┌─────────────┐                                      ┌──────────────┐
│   Wallet    │                                      │  VERIFIER    │
│    (Holder) │                                      │     NODE     │
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
       │   Request Object (JWT)                             │
       │<───────────────────────────────────────────────────│
       │                                                     │
       │ 4. GET /oid4vp/presentation-definition?id=...      │
       │───────────────────────────────────────────────────>│
       │                                                     │
       │   Presentation Definition                          │
       │<───────────────────────────────────────────────────│
       │                                                     │
       │ 5. User selects credentials in Wallet              │
       │                                                     │
       │ 6. POST /oid4vp/responses                          │
       │    (vp_token, presentation_submission, state)      │
       │───────────────────────────────────────────────────>│
       │                                                     │
       │   { redirect_uri: "...#response_code=..." }        │
       │<───────────────────────────────────────────────────│
       │                                                     │
       │ 7. Redirect to response_code                       │
       │                                                     │
       │ 8. POST /oid4vp/response-code/exchange             │
       │    ?response_code=...                              │
       │───────────────────────────────────────────────────>│
       │                                                     │
       │   { claim: { url, claimer, comment } }             │
       │<───────────────────────────────────────────────────│
       │                                                     │
       │ 9. POST /oid4vp/comment/confirm                    │
       │───────────────────────────────────────────────────>│
       │                                                     │
       │   { id: "claim789..." }                            │
       │<───────────────────────────────────────────────────│
       │                                                     │
       │                                  10. POST /database/claims (to BOOL_NODE)
       │                                     ───────────────>
```

## アーキテクチャ

### コンポーネント構成

```
┌──────────────────────────────────────────────────┐
│           VERIFIER_NODE (src/oid4vp/)            │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  OID4VP Interactor                       │   │
│  │  (usecases/oid4vp-interactor.ts)         │   │
│  │  - generateAuthRequest()                 │   │
│  │  - receiveAuthResponse()                 │   │
│  │  - exchangeAuthResponse()                │   │
│  │  - confirmComment()                      │   │
│  └────────┬─────────────────────────────────┘   │
│           │                                      │
│           ├──────────┬──────────┬───────────┐   │
│           ▼          ▼          ▼           ▼   │
│  ┌────────────┐ ┌──────────┐ ┌─────────┐ ┌────┴──────┐
│  │  Verifier  │ │ Response │ │  State  │ │  Session  │
│  │            │ │ Endpoint │ │   Repo  │ │    Repo   │
│  │ (verifier) │ │(response-│ │         │ │           │
│  │    .ts)    │ │endpoint) │ │         │ │           │
│  └────────────┘ └──────────┘ └─────────┘ └───────────┘
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  Credential Processors                   │   │
│  │  - credential1-processor.ts (Claim)      │   │
│  │  - credential2-processor.ts (Affiliation)│   │
│  │  - input-descriptor.ts                   │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
│  ┌──────────────────────────────────────────┐   │
│  │  OrbitDB (OID4VP用)                      │   │
│  │  - requestsAtResponseEndpoint            │   │
│  │  - requestsAtVerifier                    │   │
│  │  - presentationDefinitions               │   │
│  │  - responsesAtResponseEndpoint           │   │
│  │  - sessions                              │   │
│  │  - states                                │   │
│  └──────────────────────────────────────────┘   │
│                                                  │
└──────────────────────────────────────────────────┘
```

### データストア

VERIFIER_NODEは、独立したOrbitDBインスタンスを使用してOID4VP関連データを管理：

| KeyValue名 | 用途 |
|-----------|------|
| `requests@response_endpoint` | レスポンスエンドポイントでのリクエスト |
| `requests@verifier` | Verifierでのリクエスト（nonce含む） |
| `presentation_definitions` | Presentation Definition |
| `responses@response_endpoint` | VP Tokenレスポンス |
| `sessions` | セッション情報（クレーム待機データ） |
| `states` | ポストステート（認証フローの状態） |

## 認証フロー詳細

### 1. 認証リクエスト生成（generateAuthRequest）

**エンドポイント**: `POST /oid4vp/auth-request`

**処理フロー**:

```typescript
// src/usecases/oid4vp-interactor.ts
const generateAuthRequest = async (payload, presenter) => {
  const { url, comment, boolValue } = payload;

  // 1. トランザクション開始（Response Endpoint）
  const request = await responseEndpoint.initiateTransaction({
    responseType: "vp_token id_token",
    redirectUriReturnedByResponseUri: "...",
    expiredIn: 600,
  });
  // request.id, request.transactionId が生成される

  // 2. Presentation Definition生成
  const pd = await verifier.generatePresentationDefinition(
    [
      inputDescriptorClaim(url, comment, boolValue),
      INPUT_DESCRIPTOR_AFFILIATION,
    ],
    [submissionRequirementClaim, submissionRequirementAffiliation],
    "真偽コメントに署名します",
    "投稿に信頼性を持たせるために身元を証明するクレデンシャルと共に真偽表明を行います",
  );

  // 3. Verifierリクエスト開始
  const authRequest = await verifier.startRequest(request, clientId, {
    expiredIn: 600,
    issuerJwk: verifierJwk,
    x5c: verifierX5c,
    requestObject: {
      clientIdScheme: "x509_san_dns",
      responseUri: responseUri,
      presentationDefinitionUri: `${presentationDefinitionUri}?id=${pd.id}`,
      clientMetadata: generateClientMetadata(),
    },
  });

  // 4. レスポンス返却
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

3. **Presentation Definition**:
   ```json
   {
     "id": "pd-789",
     "input_descriptors": [
       {
         "id": "id1",
         "format": { "vc+sd-jwt": {} },
         "constraints": {
           "fields": [
             { "path": ["$.vc.credentialSubject.url"], "filter": { "const": "https://example.com" } },
             { "path": ["$.vc.credentialSubject.comment"], "filter": { "const": "..." } },
             { "path": ["$.vc.credentialSubject.bool_value"], "filter": { "const": 1 } }
           ]
         }
       },
       {
         "id": "Affiliation",
         "format": { "vc+sd-jwt": {} },
         "constraints": {
           "fields": [
             { "path": ["$.vc.credentialSubject.organization"], "filter": { "type": "string" } }
           ]
         }
       }
     ],
     "submission_requirements": [
       { "rule": "all", "from": "A" },
       { "rule": "pick", "count": 1, "from": "B" }
     ]
   }
   ```

4. **Authorization Request** (JWTとして返却):
   ```
   oid4vp://localhost/request?client_id=http://localhost&request_uri=http://localhost/oid4vp/request?id=req-123&presentationDefinitionId=pd-789
   ```

### 2. リクエストオブジェクト取得（getRequestObject）

**エンドポイント**: `GET /oid4vp/request?id=req-123&presentationDefinitionId=pd-789`

**処理フロー**:

```typescript
const getRequestObject = async (requestId, presentationDefinitionId) => {
  // 1. リクエスト検証
  const request = await getRequest(requestId);
  if (!request) return { ok: false, error: { type: "NOT_FOUND" } };
  if (isExpired(request)) return { ok: false, error: { type: "EXPIRED" } };
  if (request.consumedAt > 0) return { ok: false, error: { type: "CONSUMED" } };

  // 2. Presentation Definition取得
  const pd = await getPresentationDefinition(presentationDefinitionId);

  // 3. Request Object (JWT)生成
  const requestObjectJwt = await generateRequestObjectJwt(
    clientId,
    {
      nonce: request.nonce,
      state: request.id,
      responseUri: responseUri,
      presentationDefinitionUri: `${presentationDefinitionUri}?id=${pd.id}`,
      clientIdScheme: "x509_san_dns",
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

ペイロード:
```json
{
  "client_id": "http://localhost",
  "client_id_scheme": "x509_san_dns",
  "response_type": "vp_token id_token",
  "response_mode": "direct_post",
  "response_uri": "http://localhost/oid4vp/responses",
  "nonce": "7f8a9b0c1d2e3f4g5h6i7j8k9l0m1n2o",
  "state": "req-123",
  "presentation_definition_uri": "http://localhost/oid4vp/presentation-definition?id=pd-789",
  "client_metadata": {
    "vp_formats": { "vc+sd-jwt": {} },
    "client_name": "boolcheck.com",
    "logo_uri": "http://localhost/logo.png",
    "client_purpose": "真偽コメントに署名します"
  }
}
```

### 3. レスポンス受信（receiveAuthResponse）

**エンドポイント**: `POST /oid4vp/responses`

**リクエスト** (application/x-www-form-urlencoded):
```
vp_token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...&
presentation_submission={"id":"...","definition_id":"pd-789","descriptor_map":[...]}&
state=req-123
```

**処理フロー**:

```typescript
const receiveAuthResponse = async (payload, presenter) => {
  const { vp_token, presentation_submission, state } = payload;

  // 1. リクエスト検証
  const request = await getRequest(state);
  if (!request) return { ok: false, error: { type: "REQUEST_ID_IS_NOT_FOUND" } };
  if (isExpired(request)) return { ok: false, error: { type: "REQUEST_ID_IS_EXPIRED" } };

  // 2. レスポンス保存
  const responseCode = uuidv4();
  await saveResponse({
    id: responseCode,
    requestId: state,
    payload: { vpToken: vp_token, presentationSubmission: presentation_submission },
    issuedAt: Date.now() / 1000,
    expiredIn: 600,
  });

  // 3. リダイレクトURI返却
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

  // 3. VP Token検証
  const authResponse = {
    vpToken: response.payload.vpToken,
    presentationSubmission: response.payload.presentationSubmission,
  };

  // 4. Credential1（Claim）処理
  const credential1 = await processCredential1(
    verifier,
    INPUT_DESCRIPTOR_ID1,
    authResponse,
    request.nonce,
  );
  if (!credential1.ok) return { ok: false, error: credential1.error };

  // 5. Credential2（Affiliation）処理（任意）
  const credential2 = await processCredential2(
    verifier,
    INPUT_DESCRIPTOR_AFFILIATION,
    authResponse,
    request.nonce,
  );

  // 6. Claimer情報抽出
  const claimerInfo = extractClaimerInfo(authResponse, credential2);

  // 7. URL情報取得
  const urlResult = await callGetUrlMetadata(credential1.payload.decoded.vc.credentialSubject.url);

  // 8. セッション保存
  await saveSession({
    id: response.requestId,
    idToken: claimerInfo.id_token,
    claimJwt: credential1.payload.raw,
    affiliationJwt: credential2?.payload?.raw,
  });

  // 9. ポストステート更新
  await updatePostState(response.requestId, "consumed");

  // 10. レスポンス返却
  return presenter(
    response.requestId,
    credential1.payload.raw,
    urlResult,
    claimerInfo,
  );
};
```

**レスポンス**:
```json
{
  "url": "https://example.com/article/123",
  "claimer": {
    "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
    "sub": "user@example.com",
    "icon": "https://example.com/icon.png",
    "organization": "Example Org"
  },
  "comment": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

### 5. クレーム確定（confirmComment）

**エンドポイント**: `POST /oid4vp/comment/confirm`

**処理フロー**:

```typescript
const confirmComment = async (requestId, presenter) => {
  // 1. セッション取得
  const session = await getSession(requestId);
  if (!session) return { ok: false, error: { type: "NOT_FOUND" } };

  // 2. URL取得
  const claimJwt = decodeJwt(session.claimJwt);
  const url = claimJwt.vc.credentialSubject.url;

  // 3. Claimer情報抽出
  const claimerInfo = extractClaimerSub(session.idToken);
  const affiliationInfo = session.affiliationJwt
    ? extractOrgInfo(session.affiliationJwt)
    : undefined;

  // 4. BOOL_NODEにClaim登録
  const result = await callPostClaim({
    url,
    claimer: {
      id_token: session.idToken,
      sub: claimerInfo.sub,
      icon: claimerInfo.icon,
      organization: affiliationInfo?.organization,
    },
    comment: session.claimJwt,
  });

  // 5. ポストステート更新
  await updatePostState(requestId, "committed");

  // 6. セッション削除
  await deleteSession(requestId);

  return presenter(result.id);
};
```

**レスポンス**:
```json
{
  "id": "claim789..."
}
```

## VP Token検証プロセス

### Credential1処理（Claim）

**ファイル**: `src/usecases/internal/credential1-processor.ts`

**処理フロー**:

```typescript
export const processCredential1 = async (
  verifier,
  inputDescriptorId,
  authResponse,
  nonce,
) => {
  // 1. Descriptor Map取得
  const descriptor = await verifier.getDescriptor(inputDescriptorId, authResponse);
  if (!descriptor.ok) return descriptor;

  // 2. Presentation取得・検証
  const presentation = await verifier.getPresentation(
    descriptor.payload.descriptorMap,
    verifyVpFunction,  // VP署名検証
  );
  if (!presentation.ok) return presentation;

  // 3. Nonce検証
  if (presentation.payload.vp.decoded.nonce !== nonce) {
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }

  // 4. Credential取得・検証
  const credential = await verifier.getCredential(
    presentation.payload,
    verifyFunction,  // VC署名検証 + X.509証明書チェーン検証
  );
  if (!credential.ok) return credential;

  // 5. CredentialSubject抽出
  const { decoded, raw } = credential.payload;
  const { comment, boolValue } = decoded.vc.credentialSubject;

  return { ok: true, payload: { raw, decoded } };
};
```

**VP Token検証関数**:

```typescript
// src/usecases/internal/credential1-processor.ts
const verifyVpFunction = async (credential: string) => {
  return await verifyVpForW3CVcDataV1<string>(credential);
};
```

**VC検証関数**:

```typescript
const verifyFunction = async (credential: string) => {
  const env = process.env.ENVIRONMENT;
  return await verifyVcForW3CVcDataV1<TrueFalseComment>(credential, {
    skipVerifyChain: env != "prod",  // 本番環境のみX.509チェーン検証
  });
};
```

### 検証レイヤー

```
┌─────────────────────────────────────────────────┐
│  1. Presentation Submission検証                 │
│     - descriptor_mapの整合性チェック             │
│     - input_descriptorとの対応確認              │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  2. VP (Verifiable Presentation) 検証           │
│     - JWT署名検証                               │
│     - nonce検証                                 │
│     - 有効期限検証                              │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  3. VC (Verifiable Credential) 検証             │
│     - SD-JWTデコード                            │
│     - JWT署名検証                               │
│     - X.509証明書チェーン検証（本番のみ）       │
│     - CredentialSubject抽出                     │
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

### CredentialSubject抽出

```typescript
const claimJwt = decodeJwt(comment);
const credentialSubject = claimJwt.vc.credentialSubject;
// {
//   url: "https://example.com/article/123",
//   comment: "コメントテキスト",
//   bool_value: 1  // 1: TRUE, 0: FALSE, 2: ELSE
// }
```

## Input Descriptor定義

### Claim用Input Descriptor

**ファイル**: `src/usecases/internal/input-descriptor.ts`

```typescript
export const inputDescriptorClaim = (
  url: string,
  comment: string,
  boolValue: number,
): InputDescriptor => ({
  id: "id1",
  name: "TrueFalseComment",
  purpose: "真偽コメントを検証します",
  group: ["A"],
  format: {
    "vc+sd-jwt": {},
  },
  constraints: {
    fields: [
      {
        path: ["$.vc.type"],
        filter: {
          type: "array",
          contains: { const: "TrueFalseComment" },
        },
      },
      {
        path: ["$.vc.credentialSubject.url"],
        filter: { const: url },
      },
      {
        path: ["$.vc.credentialSubject.comment"],
        filter: { const: comment },
      },
      {
        path: ["$.vc.credentialSubject.bool_value"],
        filter: { const: boolValue },
      },
    ],
  },
});
```

### Affiliation用Input Descriptor

```typescript
export const INPUT_DESCRIPTOR_AFFILIATION: InputDescriptor = {
  id: "Affiliation",
  name: "OrganizationVerifiableID",
  purpose: "所属組織を検証します",
  group: ["B"],
  format: {
    "vc+sd-jwt": {},
  },
  constraints: {
    fields: [
      {
        path: ["$.vc.type"],
        filter: {
          type: "array",
          contains: { const: "OrganizationVerifiableID" },
        },
      },
      {
        path: ["$.vc.credentialSubject.organization"],
        filter: { type: "string" },
      },
    ],
  },
};
```

### Submission Requirements

```typescript
export const submissionRequirementClaim: SubmissionRequirement = {
  name: "TrueFalseComment",
  rule: "all",
  from: "A",
};

export const submissionRequirementAffiliation: SubmissionRequirement = {
  name: "OrganizationVerifiableID",
  rule: "pick",
  count: 1,
  from: "B",
};
```

**意味**:
- グループAのInput Descriptor（Claim）は**すべて必須**
- グループBのInput Descriptor（Affiliation）は**1つ選択**（任意）

## セッション管理

### セッション構造

```typescript
interface WaitCommitData extends EntityWithLifeCycle {
  data: {
    idToken: string;           // Claimer ID Token
    claimJwt: string;          // Claim SD-JWT
    affiliationJwt?: string;   // Affiliation SD-JWT（任意）
  };
}
```

### ポストステート

```typescript
type PostStateValue =
  | "started"              // 認証リクエスト生成済み
  | "consumed"             // レスポンスコード交換済み
  | "committed"            // クレーム確定済み
  | "expired"              // セッション期限切れ
  | "canceled"             // キャンセル済み
  | "invalid_submission";  // 無効な提出

interface PostState extends EntityWithLifeCycle {
  value: PostStateValue;
  targetId?: string;
}
```

### ライフサイクル

```
started → consumed → committed
   ↓         ↓          ↓
expired   expired    (session cleared)
   ↓         ↓
canceled  canceled
```

## クライアントメタデータ

### Client Metadata生成

```typescript
export const generateClientMetadata = (): ClientMetadata => ({
  vp_formats: {
    "vc+sd-jwt": {},
  },
  client_name: process.env.OID4VP_CLIENT_METADATA_NAME || "boolcheck.com",
  logo_uri: process.env.OID4VP_CLIENT_METADATA_LOGO_URI || "http://localhost/logo.png",
  client_purpose: "真偽コメントに署名します",
  policy_uri: process.env.OID4VP_CLIENT_METADATA_POLICY_URI,
  tos_uri: process.env.OID4VP_CLIENT_METADATA_TOS_URI,
});
```

### X.509証明書

**client_id_scheme**: `x509_san_dns` を使用

- Verifierの証明書（X.509）を使用してRequest ObjectをJWTとして署名
- ウォレットはX.509証明書のSAN（Subject Alternative Name）でVerifierを検証

**JWK with X5C**:

```json
{
  "kty": "EC",
  "crv": "P-256",
  "x": "...",
  "d": "..."
}
```

**X5C** (X.509 Certificate Chain):
```
["MIICx...", "MIICy...", ...]
```

## エラーハンドリング

### エラータイプ

| エラータイプ | HTTPステータス | 説明 |
|-------------|---------------|------|
| `NOT_FOUND` | 404 | リクエスト/レスポンスが見つからない |
| `EXPIRED` | 410 | リクエスト/レスポンスが期限切れ |
| `CONSUMED` | 410 | リクエストが既に使用済み |
| `INVALID_PARAMETER` | 400 | パラメータが不正 |
| `INVALID_SUBMISSION` | 400 | Presentation Submissionが不正 |
| `NO_SUBMISSION` | 400 | Presentation Submissionが欠落 |
| `VALIDATE_FAILURE` | 400 | 署名検証失敗 |

### Descriptor Error処理

```typescript
const handleDescriptorError = (error: DescriptorError): NotSuccessResult => {
  switch (error.type) {
    case "NOT_FOUND":
      return { type: "NOT_FOUND", message: "Descriptor not found" };
    case "EXPIRED":
      return { type: "EXPIRED", message: "Request expired" };
    case "INVALID_SUBMISSION":
      return { type: "INVALID_PARAMETER", message: error.reason };
    case "NO_SUBMISSION":
      return { type: "INVALID_PARAMETER", message: "No submission" };
    default:
      return { type: "UNEXPECTED_ERROR" };
  }
};
```

## 環境変数

### OID4VP設定

| 環境変数 | 説明 | デフォルト値 |
|---------|------|------------|
| `OID4VP_CLIENT_ID` | クライアントID | `http://localhost` |
| `OID4VP_CLIENT_ID_SCHEME` | クライアントIDスキーム | `x509_san_dns` |
| `OID4VP_VERIFIER_JWK` | Verifier JWK（JSON文字列） | - |
| `OID4VP_VERIFIER_X5C` | Verifier X.509証明書（PEM形式） | - |
| `OID4VP_REQUEST_HOST` | リクエストホスト | `oid4vp://localhost/request` |
| `OID4VP_REQUEST_URI` | リクエストURI | `http://localhost/oid4vp/request` |
| `OID4VP_RESPONSE_URI` | レスポンスURI | `http://localhost/oid4vp/responses` |
| `OID4VP_REDIRECT_URI` | リダイレクトURI | `http://localhost/oid4vp/redirect` |
| `OID4VP_PRESENTATION_DEFINITION_URI` | Presentation Definition URI | `http://localhost/oid4vp/presentation-definitions` |
| `OID4VP_REQUEST_EXPIRED_IN_AT_VERIFIER` | Verifierリクエスト有効期限（秒） | `600` |
| `OID4VP_REQUEST_EXPIRED_IN_AT_RESPONSE_ENDPOINT` | レスポンスエンドポイントリクエスト有効期限（秒） | `600` |
| `OID4VP_RESPONSE_EXPIRED_IN` | レスポンス有効期限（秒） | `600` |
| `POST_SESSION_EXPIRED_IN` | セッション有効期限（秒） | `600` |
| `POST_STATE_EXPIRED_IN` | ステート有効期限（秒） | `600` |
| `COOKIE_SECRET` | クッキー暗号化キー | `some secret hurr` |
| `OID4VP_CLIENT_METADATA_NAME` | クライアント名 | `boolcheck.com` |
| `OID4VP_CLIENT_METADATA_LOGO_URI` | クライアントロゴURI | `http://localhost/logo.png` |
| `OID4VP_CLIENT_METADATA_POLICY_URI` | ポリシーURI | - |
| `OID4VP_CLIENT_METADATA_TOS_URI` | 利用規約URI | - |

## まとめ

boolcheckのOID4VP実装は、以下の特徴を持ちます：

1. **標準準拠**: OpenID for Verifiable Presentations仕様に準拠
2. **X.509ベース認証**: `x509_san_dns`スキームによるVerifier認証
3. **SD-JWT対応**: Selective Disclosure JWTによる選択的開示
4. **多段階検証**: Presentation → VP → VCの3段階検証
5. **柔軟なInput Descriptor**: 必須・任意のクレデンシャルを柔軟に要求
6. **セッション管理**: OrbitDBベースのステートフル認証フロー
7. **BOOL_NODE連携**: 検証済みクレームを自動的にBOOL_NODEに登録

この実装により、アイデンティティウォレットから信頼性の高い真偽情報を安全に受け取り、分散データベースに永続化することが可能になっています。
