# OID4VP Verifier - コンポーネント設計ドキュメント

## 概要

OID4VP Verifierシステムは、レイヤードアーキテクチャに基づいて設計されており、各層が明確な責務を持っています。このドキュメントでは、主要なコンポーネントの設計、インターフェース、依存関係について説明します。

## アーキテクチャレイヤー

```
┌─────────────────────────────────────────────────┐
│             Presentation Layer                  │
│  (routes/, middlewares/)                        │
│  - HTTP Request/Response処理                    │
│  - ルーティング                                 │
│  - エラーハンドリング                           │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│             Use Case Layer                      │
│  (usecases/)                                    │
│  - OID4VP認証フロー                             │
│  - ビジネスロジック                             │
│  - トランザクション制御                         │
│  - プレゼンテーション変換                       │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│             Repository Layer                    │
│  (usecases/oid4vp-repository.ts)                │
│  - SQLiteセッション管理                         │
│  - リクエスト・レスポンス永続化                 │
│  - 状態管理                                     │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│             Infrastructure Layer                │
│  (oid4vp/, helpers/, tool-box/, database/)      │
│  - OID4VP Core                                  │
│  - SQLiteアクセス                               │
│  - ロギング                                     │
│  - 暗号化・署名検証                             │
└─────────────────────────────────────────────────┘
```

## 主要コンポーネント

### 1. OID4VP Core Layer (`oid4vp/`)

**責務**:
- OID4VPプロトコル実装
- Verifier機能
- Response Endpoint機能
- VP Token検証

**主要ファイル**:
- `verifier.ts`: Verifier実装
- `response-endpoint.ts`: Response Endpoint実装
- `verify.ts`: VP Token検証
- `auth-request.ts`: Authorization Request生成
- `types.ts`: 型定義

#### Verifier (`verifier.ts`)

**責務**:
- DCQL Query生成
- Authorization Request生成
- VP Token検証
- クレデンシャル抽出

**主要関数**:

##### initVerifier()

**シグネチャ**:
```typescript
export const initVerifier = (datastore: VerifierDatastore): Verifier
```

**実装**:
```typescript
const verifier: Verifier = {
  generateDcqlQuery: (credentialRequirements) => {
    return {
      credentials: credentialRequirements.map((req) => ({
        id: req.id,
        format: req.format,
        meta: req.meta,
        claims: req.claims,
      })),
    };
  },

  startRequest: async (request, clientId, options) => {
    const nonce = generateNonce();
    const verifierRequest = {
      id: request.id,
      nonce,
      issuedAt: Date.now() / 1000,
      expiredIn: options.expiredIn,
      consumedAt: 0,
    };
    await datastore.saveRequest(verifierRequest);
    return await generateAuthRequest(clientId, verifierRequest, options);
  },

  getDescriptor: async (inputDescriptorId, authResponse) => {
    const descriptorMap = authResponse.presentationSubmission.descriptor_map.find(
      d => d.id === inputDescriptorId
    );
    if (!descriptorMap) {
      return { ok: false, error: { type: "NOT_FOUND" } };
    }
    return { ok: true, payload: { descriptorMap } };
  },

  getPresentation: async (descriptorMap, verifyVpFunction) => {
    const vpToken = extractVpToken(authResponse.vpToken, descriptorMap.path);
    const verified = await verifyVpFunction(vpToken);
    return { ok: true, payload: { vp: verified } };
  },

  getCredential: async (presentation, verifyFunction) => {
    const credential = extractCredential(presentation.vp, descriptorMap.path_nested);
    const verified = await verifyFunction(credential);
    return { ok: true, payload: verified };
  },
};
```

**データストア**:
- `VerifierDatastore`: SQLiteベースのデータストア
  - `saveRequest(request)`: リクエスト保存（DCQL Query含む）
  - `getRequest(id)`: リクエスト取得
  - ~~`savePresentationDefinition(pd)`~~: **廃止**（DCQL移行のため不要）
  - ~~`getPresentationDefinition(id)`~~: **廃止**（DCQL移行のため不要）

#### Response Endpoint (`response-endpoint.ts`)

**責務**:
- VP Tokenの受信
- レスポンスコード発行
- リダイレクトURI生成

**主要関数**:

##### initResponseEndpoint()

**シグネチャ**:
```typescript
export const initResponseEndpoint = (datastore: ResponseEndpointDatastore): ResponseEndpoint
```

**実装**:
```typescript
const responseEndpoint: ResponseEndpoint = {
  initiateTransaction: async (options) => {
    const request = {
      id: uuidv4(),
      responseType: options.responseType,
      redirectUriReturnedByResponseUri: options.redirectUriReturnedByResponseUri,
      transactionId: uuidv4(),
      issuedAt: Date.now() / 1000,
      expiredIn: options.expiredIn,
    };
    await datastore.saveRequest(request);
    return request;
  },

  saveResponse: async (responseCode, requestId, payload) => {
    const response = {
      code: responseCode,
      requestId,
      payload,
      issuedAt: Date.now() / 1000,
      expiredIn: 600,
      used: false,
    };
    await datastore.saveResponse(response);
  },

  getResponse: async (responseCode) => {
    return await datastore.getResponse(responseCode);
  },
};
```

**データストア**:
- `ResponseEndpointDatastore`: SQLiteベースのデータストア
  - `saveRequest(request)`: リクエスト保存
  - `getRequest(id)`: リクエスト取得
  - `saveResponse(response)`: レスポンス保存
  - `getResponse(code)`: レスポンス取得

#### VP Token検証 (`verify.ts`)

**責務**:
- JWT署名検証
- X.509証明書チェーン検証
- SD-JWT処理
- Nonce検証

**主要関数**:

- `verifyJwt()` - JWT署名とX.509証明書チェーンの検証
- `verifyVcForW3CVcDataV1()` - SD-JWT形式のVerifiable Credentialの検証と展開

詳細な実装とセキュリティ考慮事項については、[security.md](security.md#2-jwtjwk処理)を参照してください。

**依存関係**:
- `jose`: JWT処理
- `@meeco/sd-jwt`: SD-JWT処理
- `tool-box/x509/x509.ts`: X.509証明書検証

---

### 2. Use Case Layer (`usecases/`)

**責務**:
- OID4VP認証フローの実装
- VP Token検証と処理
- セッション管理
- トランザクション制御

**主要ファイル**:
- `oid4vp-interactor.ts`: OID4VP認証フロー
- `oid4vp-repository.ts`: SQLiteリポジトリ
- `types.ts`: 型定義

#### OID4VPInteractor

**ファイル**: `oid4vp-interactor.ts`

**責務**:
- Authorization Request生成
- VP Token受信
- Response Code交換
- データ確定

**主要メソッド**:

##### generateAuthRequest()

**シグネチャ**:
```typescript
const generateAuthRequest = async <T>(
  payload: any,
  presenter: (authRequest: string, requestId: string, transactionId?: string) => T
): Promise<Result<T, NotSuccessResult>>
```

**処理フロー**:
```typescript
// 1. トランザクション開始（Response Endpoint）
const request = await responseEndpoint.initiateTransaction({
  responseType: "vp_token",
  redirectUriReturnedByResponseUri: process.env.OID4VP_REDIRECT_URI,
  expiredIn: 600,
});

// 2. DCQL Query生成
const dcqlQuery = verifier.generateDcqlQuery([
  {
    id: "learning_credential",
    format: "dc+sd-jwt",
    meta: {
      vct_values: ["urn:eu.europa.ec.eudi:learning:credential:1"]
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
      { path: ["assessment_grade"] }
    ]
  }
]);

// 3. Authorization Request生成
const authRequest = await verifier.startRequest(request, clientId, {
  expiredIn: 600,
  issuerJwk: verifierJwk,
  x5c: verifierX5c,
  requestObject: {
    clientIdScheme: "x509_san_dns",
    responseUri: process.env.OID4VP_RESPONSE_URI,
    dcqlQuery,  // DCQL Query埋め込み
  },
});

// 4. セッション保存
await sessionRepository.putRequestId(request.id);

// 5. Presenter変換
return { ok: true, payload: presenter(authRequest, request.id, request.transactionId) };
```

##### receiveAuthResponse()

**シグネチャ**:
```typescript
const receiveAuthResponse = async <T>(
  payload: { vp_token: string; presentation_submission: string; state: string },
  presenter: (redirectUri: string, responseCode: string) => T
): Promise<Result<T, NotSuccessResult>>
```

**処理フロー**:
```typescript
// 1. リクエスト検証
const request = await responseEndpointDatastore.getRequest(payload.state);
if (!request) {
  return { ok: false, error: { type: "NOT_FOUND" } };
}

// 2. VP Token検証（基本検証のみ）
const presentationSubmission = JSON.parse(payload.presentation_submission);

// 3. レスポンスコード生成
const responseCode = uuidv4();
await responseEndpoint.saveResponse(responseCode, request.id, {
  vpToken: payload.vp_token,
  presentationSubmission,
});

// 4. セッション更新
await sessionRepository.updateState(request.id, "consumed");

// 5. リダイレクトURI返却
const redirectUri = request.redirectUriReturnedByResponseUri;
return { ok: true, payload: presenter(redirectUri, responseCode) };
```

##### exchangeAuthResponse()

**シグネチャ**:
```typescript
const exchangeAuthResponse = async <T>(
  responseCode: string,
  transactionId: string | undefined,
  presenter: (requestId: string, credentialData: any) => T
): Promise<Result<T, NotSuccessResult>>
```

**処理フロー**:
```typescript
// 1. レスポンスコード取得
const response = await responseEndpointDatastore.getResponse(responseCode);
if (!response) {
  return { ok: false, error: { type: "NOT_FOUND" } };
}

// 2. レスポンスコードを使用済みに設定
await responseEndpointDatastore.markResponseAsUsed(responseCode);

// 3. リクエスト取得（nonce含む）
const request = await verifierDatastore.getRequest(response.requestId);

// 4. VP Token検証
const authResponse = {
  vpToken: response.payload.vpToken,
  presentationSubmission: response.payload.presentationSubmission,
};

// 5. Descriptor取得
const descriptor = await verifier.getDescriptor(inputDescriptorId, authResponse);
if (!descriptor.ok) {
  return descriptor;
}

// 6. Presentation取得・検証
const presentation = await verifier.getPresentation(
  descriptor.payload.descriptorMap,
  verifyVpFunction
);
if (!presentation.ok) {
  return presentation;
}

// 7. Nonce検証
if (presentation.payload.vp.decoded.nonce !== request.nonce) {
  return { ok: false, error: { type: "INVALID_PARAMETER" } };
}

// 8. Credential取得・検証
const credential = await verifier.getCredential(
  presentation.payload,
  verifyFunction
);
if (!credential.ok) {
  return credential;
}

// 9. セッション保存
await sessionRepository.putWaitCommitData(response.requestId, {
  vpToken: authResponse.vpToken,
  credentialData: credential.payload,
});

// 10. Presenter変換
return { ok: true, payload: presenter(response.requestId, credential.payload) };
```

##### getStates()

**シグネチャ**:
```typescript
const getStates = async <T>(
  requestId: string,
  presenter: PostStatePresenter<T>
): Promise<T>
```

**処理フロー**:
```typescript
// 1. 状態取得
const state = await stateRepository.getState(requestId);

// 2. Presenter変換
return presenter(state);
```

**説明**: リクエストの現在の状態を取得します。状態はVP Token検証フローの進行を追跡します。

**依存関係**:
- `oid4vp/verifier.ts`: Verifier機能
- `oid4vp/response-endpoint.ts`: Response Endpoint
- `usecases/oid4vp-repository.ts`: SQLiteリポジトリ

---

### 3. Repository Layer (`usecases/oid4vp-repository.ts`)

**責務**:
- SQLiteセッション管理
- リクエスト・レスポンス永続化
- 状態管理

**主要リポジトリ**:

#### SessionRepository

**責務**: OID4VPセッション管理

**主要メソッド**:
```typescript
interface SessionRepository {
  putRequestId(requestId: string): Promise<void>;
  getSession(requestId: string): Promise<Session | null>;
  putWaitCommitData(requestId: string, data: WaitCommitData): Promise<void>;
  updateState(requestId: string, state: SessionState): Promise<void>;
}
```

**実装**:
```typescript
export const initSessionRepository = (db: Database): SessionRepository => ({
  putRequestId: async (requestId) => {
    await db.run(
      `INSERT INTO sessions (id, request_id, state, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [uuidv4(), requestId, "started", Date.now(), Date.now() + 600000]
    );
  },

  getSession: async (requestId) => {
    return await db.get(
      `SELECT * FROM sessions WHERE request_id = ?`,
      [requestId]
    );
  },

  putWaitCommitData: async (requestId, data) => {
    await db.run(
      `UPDATE sessions
       SET vp_token = ?, credential_data = ?, consumed_at = ?
       WHERE request_id = ?`,
      [data.vpToken, JSON.stringify(data.credentialData), Date.now(), requestId]
    );
  },

  updateState: async (requestId, state) => {
    await db.run(
      `UPDATE sessions SET state = ? WHERE request_id = ?`,
      [state, requestId]
    );
  },
});
```

#### PostStateRepository

**責務**: 認証フロー状態追跡

**主要メソッド**:
```typescript
interface PostStateRepository {
  putState(requestId: string, value: PostStateValue): Promise<void>;
  getState(requestId: string): Promise<PostState | null>;
}
```

**実装**:
```typescript
export const initPostStateRepository = (db: Database): PostStateRepository => ({
  putState: async (requestId, value) => {
    await db.run(
      `INSERT OR REPLACE INTO post_states (id, value, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      [requestId, value, Date.now(), Date.now() + 600000]
    );
  },

  getState: async (requestId) => {
    return await db.get(
      `SELECT * FROM post_states WHERE id = ?`,
      [requestId]
    );
  },
});
```

#### VerifierDatastore

**責務**: Verifierリクエスト管理

**主要メソッド**:
```typescript
interface VerifierDatastore {
  saveRequest(request: VerifierRequest): Promise<void>;
  getRequest(id: string): Promise<VerifierRequest | null>;
  // savePresentationDefinition/getPresentationDefinition: DCQL移行により廃止
}
```

**実装**:
```typescript
export const initVerifierDatastore = (db: Database): VerifierDatastore => ({
  saveRequest: async (request) => {
    await db.run(
      `INSERT INTO requests (id, response_type, created_at, expires_at)
       VALUES (?, ?, ?, ?)`,
      [request.id, request.responseType, request.issuedAt, request.expiredIn]
    );
  },

  getRequest: async (id) => {
    return await db.get(
      `SELECT * FROM requests WHERE id = ?`,
      [id]
    );
  },

  // savePresentationDefinition/getPresentationDefinition: 廃止（DCQL移行のため）
});
```

#### ResponseEndpointDatastore

**責務**: Response Endpointリクエスト・レスポンス管理

**主要メソッド**:
```typescript
interface ResponseEndpointDatastore {
  saveRequest(request: ResponseEndpointRequest): Promise<void>;
  getRequest(id: string): Promise<ResponseEndpointRequest | null>;
  saveResponse(response: ResponseCode): Promise<void>;
  getResponse(code: string): Promise<ResponseCode | null>;
  markResponseAsUsed(code: string): Promise<void>;
}
```

**実装**:
```typescript
export const initResponseEndpointDatastore = (db: Database): ResponseEndpointDatastore => ({
  saveRequest: async (request) => {
    await db.run(
      `INSERT INTO requests (id, response_type, transaction_id, redirect_uri_returned_by_response_uri, created_at, expires_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [request.id, request.responseType, request.transactionId, request.redirectUriReturnedByResponseUri, request.issuedAt, request.expiredIn]
    );
  },

  getRequest: async (id) => {
    return await db.get(
      `SELECT * FROM requests WHERE id = ?`,
      [id]
    );
  },

  saveResponse: async (response) => {
    await db.run(
      `INSERT INTO response_codes (code, request_id, payload, created_at, expires_at, used)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [response.code, response.requestId, JSON.stringify(response.payload), response.issuedAt, response.expiredIn, 0]
    );
  },

  getResponse: async (code) => {
    const row = await db.get(
      `SELECT * FROM response_codes WHERE code = ?`,
      [code]
    );
    if (!row) return null;
    return {
      ...row,
      payload: JSON.parse(row.payload),
    };
  },

  markResponseAsUsed: async (code) => {
    await db.run(
      `UPDATE response_codes SET used = 1 WHERE code = ?`,
      [code]
    );
  },
});
```

**依存関係**:
- `database/schema.ts`: SQLiteスキーマ
- `sqlite`: SQLiteドライバ

---

### 4. Routes Layer (`routes/`)

**責務**:
- HTTPリクエスト/レスポンス処理
- ルーティング
- バリデーション
- エラーハンドリング

**主要ファイル**:
- `oid4vp-routes.ts`: OID4VP API
- `presenters.ts`: プレゼンテーション変換関数
- `types.ts`: レスポンス型定義
- `error-handler.ts`: エラーハンドリング

#### OID4VP Routes

**ファイル**: `oid4vp-routes.ts`

**エンドポイント**:
- `POST /oid4vp/auth-request`: Authorization Request生成
- `GET /oid4vp/request`: Request Object取得（DCQL Query含む）
- ~~`GET /oid4vp/presentation-definition`~~: **廃止**（DCQL移行のため不要）
- `POST /oid4vp/responses`: VP Token受信 (VP Token検証成功後、自動的にcommitted状態へ遷移)
- `POST /oid4vp/response-code/exchange`: Response Code交換
- `GET /oid4vp/states`: 状態取得

#### Presenters

**ファイル**: `presenters.ts`

**責務**:
- ドメインモデルをHTTPレスポンス形式に変換

**主要関数**:

```typescript
export const authRequestPresenter = (
  authRequest: string,
  requestId: string,
  transactionId?: string
) => ({
  authRequest,
  requestId,
  transactionId,
});

export const authResponsePresenter = (
  redirectUri: string,
  responseCode: string
) => ({
  redirect_uri: `${redirectUri}#response_code=${responseCode}`,
});

export const exchangeResponseCodePresenter = (
  requestId: string,
  claimer: {
    sub: string;
    id_token: string;
    learningCredential?: string;
  }
) => ({
  requestId,
  claimer: {
    id_token: claimer.id_token,
    sub: claimer.sub,
    learningCredential: claimer.learningCredential,
  },
});

export const postStatePresenter = (state: PostState | null) =>
  state ? { value: state.value } : null;
```

#### ErrorHandler

**ファイル**: `error-handler.ts`

**責務**:
- エラータイプからHTTPステータスコードへの変換
- エラーレスポンス生成

**主要関数**:

```typescript
export const handleError = (
  error: NotSuccessResult
): { statusCode: number; body: any } => {
  switch (error.type) {
    case "INVALID_PARAMETER":
      return { statusCode: 400, body: toErrorBody("INVALID_PARAMETER", error.message) };
    case "NOT_FOUND":
      return { statusCode: 404, body: toErrorBody("NOT_FOUND", error.message) };
    case "EXPIRED":
      return { statusCode: 410, body: toErrorBody("EXPIRED", error.message) };
    case "INVALID_SUBMISSION":
      return { statusCode: 400, body: toErrorBody("INVALID_SUBMISSION", error.message) };
    default:
      return { statusCode: 500, body: toErrorBody("INTERNAL_ERROR") };
  }
};

export const toErrorBody = (
  type: string,
  message?: string,
  instance?: string
) => ({
  type,
  message,
  instance,
});
```

**依存関係**:
- `koa`: Webフレームワーク
- `koa-router`: ルーティング
- `koa-body`: リクエストボディパース
- `usecases/`: ビジネスロジック

---

### 5. Database Layer (`database/`)

**責務**:
- SQLiteスキーマ定義
- データベース初期化
- マイグレーション

**主要ファイル**:
- `schema.ts`: スキーマ定義
- `index.ts`: データベース初期化

#### Schema

**ファイル**: `schema.ts`

**テーブル定義**:
```sql
-- sessions: OID4VPセッション状態管理
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  request_id TEXT UNIQUE NOT NULL,
  state TEXT NOT NULL,
  vp_token TEXT,
  credential_data TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  committed_at INTEGER
);

-- requests: VP requestメタデータ
CREATE TABLE requests (
  id TEXT PRIMARY KEY,
  response_type TEXT NOT NULL,
  redirect_uri_returned_by_response_uri TEXT,
  transaction_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);

-- response_codes: Authorization response codes
CREATE TABLE response_codes (
  code TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  used INTEGER DEFAULT 0,
  FOREIGN KEY (request_id) REFERENCES requests(id)
);

-- presentation_definitions: 廃止（DCQL移行のため）
-- DCQL Queryはrequestsテーブルのdcql_queryカラムに保存

-- post_states: 認証フロー状態追跡
CREATE TABLE post_states (
  id TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  target_id TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
```

**インデックス**:
```sql
CREATE INDEX idx_sessions_request_id ON sessions(request_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_state ON sessions(state);

CREATE INDEX idx_requests_expires_at ON requests(expires_at);
CREATE INDEX idx_requests_transaction_id ON requests(transaction_id);

CREATE INDEX idx_response_codes_request_id ON response_codes(request_id);
CREATE INDEX idx_response_codes_expires_at ON response_codes(expires_at);
CREATE INDEX idx_response_codes_used ON response_codes(used);

-- presentation_definitions table/index: 廃止（DCQL移行のため）

CREATE INDEX idx_post_states_expires_at ON post_states(expires_at);
CREATE INDEX idx_post_states_value ON post_states(value);
```

**依存関係**:
- `sqlite3`: SQLite3ネイティブバインディング
- `better-sqlite3`: 同期型SQLiteドライバ

---

### 6. Tool-box Layer (`tool-box/`)

**責務**:
- 暗号化・署名検証
- X.509証明書処理
- 汎用ユーティリティ

**主要ファイル**:
- `verify.ts`: 署名検証
- `x509/x509.ts`: X.509証明書処理
- `x509/issue.ts`: 証明書発行
- `datetime.ts`: 日時処理
- `util.ts`: 汎用ユーティリティ

#### X.509証明書検証

**ファイル**: `tool-box/x509/x509.ts`

**主要関数**: `verifyCertificateChain()` - 証明書チェーンの検証

詳細な実装とセキュリティ考慮事項については、[security.md](security.md#1-x509証明書管理)を参照してください。

**依存関係**:
- `pkijs`: X.509証明書処理
- `asn1js`: ASN.1エンコーディング

---

## 依存関係図

```
┌─────────────────────────────────────────────────┐
│                  index.ts                       │
│                 (Entry Point)                   │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│                  api.ts                         │
│              (App Initialize)                   │
└────────────────┬────────────────────────────────┘
                 │
         ┌───────┴───────┐
         │               │
         ▼               ▼
┌──────────────┐  ┌──────────────┐
│   routes/    │  │  database/   │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│  usecases/   │  │ oid4vp-repo/ │
└──────┬───────┘  └──────┬───────┘
       │                 │
       └─────────┬───────┘
                 │
         ┌───────┴───────┬───────────┐
         │               │           │
         ▼               ▼           ▼
┌──────────────┐  ┌──────────┐  ┌────────┐
│   oid4vp/    │  │ helpers/ │  │tool-box│
└──────────────┘  └──────────┘  └────────┘
```

## 設計パターン

### 1. Repository Pattern

**実装箇所**: `usecases/oid4vp-repository.ts`

**目的**: データアクセスロジックをビジネスロジックから分離

**例**:
```typescript
// Repository Interface
interface SessionRepository {
  putRequestId(requestId: string): Promise<void>;
  getSession(requestId: string): Promise<Session | null>;
}

// SQLite Implementation
const initSessionRepository = (db: Database): SessionRepository => ({
  putRequestId: async (requestId) => {
    await db.run(`INSERT INTO sessions ...`, [requestId]);
  },
  getSession: async (requestId) => {
    return await db.get(`SELECT * FROM sessions WHERE request_id = ?`, [requestId]);
  },
});
```

### 2. Presenter Pattern

**実装箇所**: `routes/presenters.ts`

**目的**: ドメインモデルとHTTPレスポンス形式の変換を分離

**例**:
```typescript
// Use Case
const result = await interactor.generateAuthRequest(payload, authRequestPresenter);

// Presenter
const authRequestPresenter = (authRequest: string, requestId: string) => ({
  authRequest,
  requestId,
});
```

### 3. Strategy Pattern

**実装箇所**: `oid4vp/verify.ts`

**目的**: 検証アルゴリズムを動的に切り替え

**例**:
```typescript
// Verifier Function (Strategy)
type VerifierFunction<T, U> = (credential: T) => Promise<U>;

// Use
const credential = await verifier.getCredential(
  presentation,
  verifyFunction  // Strategy injection
);
```

### 4. Factory Pattern

**実装箇所**: `oid4vp/index.ts`

**目的**: 複雑なオブジェクト生成をカプセル化

**例**:
```typescript
// Verifier Factory
export const initVerifier = (datastore: VerifierDatastore): Verifier => {
  return {
    generatePresentationDefinition: async (...) => { /* ... */ },
    startRequest: async (...) => { /* ... */ },
    // ...
  };
};
```

## まとめ

OID4VP Verifierのコンポーネント設計は、以下の原則に基づいています：

1. **レイヤードアーキテクチャ**: 各層が明確な責務を持ち、下位層のみに依存
2. **疎結合**: インターフェースを介した依存関係、テストしやすい設計
3. **単一責任**: 各コンポーネントは1つの責務のみを持つ
4. **依存性注入**: ファクトリ関数で依存を注入
5. **型安全性**: TypeScriptの型システムを活用した堅牢な設計
6. **SQLiteベースの永続化**: シンプルで信頼性の高いデータ管理

この設計により、保守性が高く、拡張しやすいOID4VP Verifierシステムを実現しています。
