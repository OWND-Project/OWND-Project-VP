# Nonce ライフサイクル問題の解決方針

## ✅ 実装完了 (2025-11-20)

**アプローチ1（Request作成時に全て生成）**の実装が完了しました。

### 実装された変更

#### Phase 1: データストアの統合
- `ResponseEndpointDatastore.saveRequest`: nonce, session, consumed_at カラムを追加
- `ResponseEndpointDatastore.getRequest`: nonce を戻り値に追加
- `VerifierDatastore.saveRequest`: response_type, redirect_uri_returned_by_response_uri, dcql_query カラムを追加

#### Phase 2: Nonce生成タイミングの修正
1. **VpRequest型の更新** (`src/oid4vp/response-endpoint.ts:13`)
   - `nonce?: string` プロパティを追加

2. **generateAuthRequest の修正** (`src/usecases/oid4vp-interactor.ts:107-167`)
   - リクエスト作成時に一度だけ uuidv4() でnonceを生成
   - verifier.startRequest に generateId オプションでnonceを渡す
   - responseEndpoint.saveRequest でnonceとdcql_queryを永続化

3. **getRequestObject の修正** (`src/usecases/oid4vp-interactor.ts:187-279`)
   - 保存済みのnonceとdcql_queryを取得して使用
   - verifier.startRequest を呼ばずに、generateRequestObjectJwt を直接呼び出し
   - これによりnonceの再生成を防止

### 動作フロー (修正後)

```
1. Verifier: POST /oid4vp/auth-requests (Request作成)
   └─> oid4vp-interactor.generateAuthRequest()
       - nonce_A = uuidv4() (一度だけ生成)
       - dcql_query を生成
       - verifier.startRequest({ generateId: () => nonce_A })
       - ResponseEndpointDatastore.saveRequest({ nonce: nonce_A, dcqlQuery })

2. Wallet: GET /oid4vp/request?id=xxx (Request_URI取得) ← 何回アクセスしても同じ
   └─> oid4vp-interactor.getRequestObject()
       - request = ResponseEndpointDatastore.getRequest(id)
       - nonce_A を取得 (保存済み)
       - dcql_query を取得 (保存済み)
       - generateRequestObjectJwt(clientId, issuerJwk, { nonce: nonce_A, dcqlQuery })
       - 同じnonce_Aを使ったRequest Object JWTを返す

3. Wallet: GET /oid4vp/request?id=xxx (2回目以降も同じ)
   └─> 常に同じ nonce_A を返す

4. Wallet: POST /oid4vp/responses (VP送信)
   └─> Verifierは nonce_A を期待
       Walletは nonce_A を保持 ✓ 一致する
```

### 重要な変更点

- **nonce生成は1回のみ**: `generateAuthRequest` で一度だけ生成され、データベースに保存
- **request_uri アクセス時**: `getRequestObject` は保存済みnonceを使用し、再生成しない
- **データの一貫性**: ResponseEndpointとVerifierの両方で同じrequestsテーブルに全フィールドを保存
- **セキュリティ**: リプレイアタック対策が正しく機能するようになった

## 問題の概要 (解決済み)

現在の実装では、`request_uri`を使用する場合、アクセスするたびに新しいnonceが生成される重大な問題があります。

### 問題点の詳細

1. **毎回nonceが再生成される**
   - `GET /oid4vp/request`エンドポイント（request_uri）にアクセスするたびに`verifier.startRequest()`が呼ばれる
   - `verifier.startRequest()`内で`uuidv4()`により新しいnonceが生成される（`src/oid4vp/verifier.ts:109`）
   - データベースに保存されるnonceも更新される

2. **ライフサイクルの不一致**
   - **直接authorization requestに埋め込む場合**: requestとnonceのライフサイクルが一致（1回だけ生成）
   - **request_uriを使用する場合**: アクセスのたびに新しいnonceが生成され、不一致が発生

3. **セキュリティ上の問題**
   - Walletが最初に取得したnonceと、Verifierが検証時に期待するnonceが異なる
   - リプレイアタック対策として機能しない

## 現在の実装フロー

### 1. Request_URI使用時のフロー

```
1. Verifier: POST /oid4vp/auth-requests (Request作成)
   └─> ResponseEndpointDatastore.saveRequest()
       - response_type, dcql_query保存
       - nonceは保存されない

2. Wallet: GET /oid4vp/request?id=xxx (Request_URI取得) ← 1回目
   └─> oid4vp-interactor.getRequestObject()
       └─> verifier.startRequest() ← ここで新しいnonce生成
           └─> VerifierDatastore.saveRequest()
               - nonce_A を保存 (INSERT OR REPLACE)
               - response_type, dcql_queryは保存されない

3. Wallet: GET /oid4vp/request?id=xxx (Request_URI取得) ← 2回目
   └─> oid4vp-interactor.getRequestObject()
       └─> verifier.startRequest() ← また新しいnonce生成
           └─> VerifierDatastore.saveRequest()
               - nonce_B を保存 (INSERT OR REPLACE)
               - nonce_Aは上書きされる

4. Wallet: POST /oid4vp/responses (VP送信)
   └─> Verifierは nonce_B を期待
       しかしWalletは nonce_A または nonce_B を持っている（アクセスタイミング次第）
```

### 2. 直接埋め込み時のフロー（問題なし）

```
1. Verifier: POST /oid4vp/auth-requests (Request作成＋startRequest)
   └─> verifier.startRequest()
       └─> nonce_A を1回だけ生成・保存

2. Wallet: Authorization Request受信（nonceが直接含まれる）
   └─> nonce_A を使用

3. Wallet: POST /oid4vp/responses (VP送信)
   └─> Verifierは nonce_A を期待
       Walletも nonce_A を持っている（一致）
```

## 根本原因の分析

### 1. データストアの分離による不整合

`src/usecases/oid4vp-repository.ts`に2つの異なるsaveRequestメソッドが存在：

**ResponseEndpointDatastore.saveRequest (37-52行目)**
```typescript
INSERT OR REPLACE INTO requests
(id, response_type, redirect_uri_returned_by_response_uri, transaction_id,
 created_at, expires_at, encryption_private_jwk, dcql_query)
```
- ✅ 保存: response_type, dcql_query, transaction_id
- ❌ 未保存: nonce, session, consumed_at

**VerifierDatastore.saveRequest (119-134行目)**
```typescript
INSERT OR REPLACE INTO requests
(id, nonce, session, transaction_id, created_at, expires_at,
 consumed_at, encryption_private_jwk)
```
- ✅ 保存: nonce, session, consumed_at
- ❌ 未保存: response_type, dcql_query

### 2. startRequestの誤った使用

`src/usecases/oid4vp-interactor.ts:244`で、`getRequestObject()`内で`verifier.startRequest()`が呼ばれている：

```typescript
const getRequestObject = async (
  requestId: string,
  presentationDefinitionId: string,
): Promise<Result<string, NotSuccessResult>> => {
  const request = await responseEndpoint.getRequest(requestId);

  // ... DCQL query の構築 ...

  // start vp request ← 毎回実行される！
  const vpRequest = await verifier.startRequest(
    request,
    clientId,
    startRequestOpts,
  );
  return {
    ok: true,
    payload: vpRequest.request!,
  };
};
```

`startRequest`は本来「リクエストの開始」を意味するが、実際には「Request Object JWTの生成」に使われており、命名と用途が不一致。

## 解決方針

### アプローチ1: Request作成時にすべて生成（推奨）

**概要**: Request作成時（`POST /oid4vp/auth-requests`）にnonce, dcql_queryを含むすべての情報を生成・保存し、`GET /oid4vp/request`では保存済みデータから取得のみ行う。

#### メリット
- ✅ nonceが1回だけ生成される
- ✅ ライフサイクルが明確
- ✅ request_uriの取得が冪等（同じ内容を返す）
- ✅ データモデルがシンプル

#### デメリット
- ⚠️ Request作成時にDCQL queryのUI選択結果が必要
- ⚠️ 既存のフローを大きく変更

#### 実装ステップ

**Step 1: データストアの統合**

`src/usecases/oid4vp-repository.ts`の2つのsaveRequestメソッドを統合：

```typescript
// ResponseEndpointDatastore.saveRequest を修正
saveRequest: async (request: VpRequest & Partial<VpRequestAtVerifier>) => {
  await db.run(
    `INSERT OR REPLACE INTO requests
     (id, nonce, session, response_type, redirect_uri_returned_by_response_uri,
      transaction_id, created_at, expires_at, consumed_at,
      encryption_private_jwk, dcql_query)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      request.id,
      request.nonce || null,
      request.session || null,
      request.responseType,
      request.redirectUriReturnedByResponseUri || null,
      request.transactionId || null,
      request.issuedAt,
      request.issuedAt + request.expiredIn,
      request.consumedAt || 0,
      request.encryptionPrivateJwk || null,
      request.dcqlQuery || null,
    ]
  );
},
```

**Step 2: Request作成時にnonceとdcqlを生成**

`src/usecases/oid4vp-interactor.ts`の`startAuthRequest`を修正：

```typescript
const startAuthRequest = async (
  responseMode: "direct_post.jwt",
  dcqlCredentialQueries: any[], // UIから渡される
): Promise<Result<StartAuthRequestResult, NotSuccessResult>> => {
  // ... 既存のコード ...

  // Generate nonce at request creation time
  const nonce = uuidv4();

  // Generate DCQL query at request creation time
  const dcqlQuery = verifier.generateDcqlQuery(dcqlCredentialQueries);

  const request: VpRequest = {
    id: requestId,
    nonce, // ← 追加
    responseType,
    redirectUriReturnedByResponseUri,
    transactionId,
    issuedAt,
    expiredIn: Env().expiredIn.request,
    encryptionPublicJwk: encryptionPublicJwk
      ? JSON.stringify(encryptionPublicJwk)
      : undefined,
    encryptionPrivateJwk: encryptionPrivateJwk
      ? JSON.stringify(encryptionPrivateJwk)
      : undefined,
    dcqlQuery: JSON.stringify(dcqlQuery), // ← 追加
  };

  await responseEndpoint.saveRequest(request);

  // ... 残りのコード ...
};
```

**Step 3: getRequestObjectでは保存済みデータを使用**

`src/usecases/oid4vp-interactor.ts`の`getRequestObject`を修正：

```typescript
const getRequestObject = async (
  requestId: string,
  presentationDefinitionId: string,
): Promise<Result<string, NotSuccessResult>> => {
  // 保存済みのrequestを取得
  const request = await responseEndpoint.getRequest(requestId);

  if (!request) {
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }

  // 保存済みのnonce, dcqlQueryを使用（再生成しない）
  if (!request.nonce || !request.dcqlQuery) {
    logger.error(`Request ${requestId} is missing nonce or dcqlQuery`);
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }

  const dcqlQuery = JSON.parse(request.dcqlQuery);

  const opts: GenerateRequestObjectOptions = {
    responseType: request.responseType,
    responseMode: "direct_post.jwt",
    responseUri: responseUri,
    clientMetadata: getClientMetadata(),
    dcqlQuery,
    nonce: request.nonce, // ← 保存済みのnonceを使用
    state: request.id,
  };

  // Request Object JWTを生成（nonceは再生成しない）
  const issuerJwk = JSON.parse(Env().verifier.jwk);
  const x5c = Env().verifier.x5c;

  const requestObjectJwt = await verifier.generateRequestObjectJwt(
    clientId,
    opts,
    issuerJwk,
    x5c,
  );

  return {
    ok: true,
    payload: requestObjectJwt,
  };
};
```

**Step 4: verifier.tsに新しいメソッド追加**

`src/oid4vp/verifier.ts`に、nonceを再生成しないメソッドを追加：

```typescript
/**
 * Generate Request Object JWT without creating/saving a new request
 * Used when retrieving request_uri with pre-existing nonce
 */
const generateRequestObjectJwt = async (
  clientId: string,
  opts: GenerateRequestObjectOptions,
  issuerJwk: PrivateJwk,
  x5c?: string[],
): Promise<string> => {
  const parsed = parseClientId(clientId);
  if (!parsed) {
    throw new UnsupportedClientIdSchemeError(
      `Client ID must include a valid prefix. Got: ${clientId}`,
    );
  }

  if (parsed.prefix === "redirect_uri") {
    throw new Error("redirect_uri prefix does not support request_uri");
  }

  // Generate signed request object
  const requestObject = generateRequestObjectPayload(clientId, opts);
  const requestJwt = await signRequestObject(
    requestObject,
    issuerJwk,
    x5c,
  );

  return requestJwt;
};
```

**Step 5: UIでdcql_queryを選択可能に**

**現状**: 既にUIでclaim選択機能が実装されている（`views/home.ejs` + `POST /submit-request`）

**修正内容**: `POST /submit-request`で選択されたclaimを`generateAuthRequest`に渡す

`src/routes/ui-routes.ts:47-93`の実装を確認：

```typescript
router.post("/submit-request", koaBody(), async (ctx) => {
  // Get selected claims from form data
  const formData = ctx.request.body || {};
  const selectedClaims: string[] = [];

  // Required claims (always included)
  const requiredClaims = [
    "issuing_authority",
    "issuing_country",
    "date_of_issuance",
    "achievement_title",
  ];
  selectedClaims.push(...requiredClaims);

  // Add selected optional claims
  const optionalClaimsFromForm = formData.optional_claims;
  if (optionalClaimsFromForm) {
    if (Array.isArray(optionalClaimsFromForm)) {
      selectedClaims.push(...optionalClaimsFromForm);
    } else {
      selectedClaims.push(optionalClaimsFromForm);
    }
  }

  // Build DCQL credential queries with selected claims
  const dcqlCredentialQueries = [
    {
      id: "learning_credential",
      format: "dc+sd-jwt",
      meta: {
        vct_values: ["urn:eu.europa.ec.eudi:learning:credential:1"],
      },
      claims: selectedClaims.map(claim => ({ path: [claim] })),
    },
  ];

  // Generate authorization request with selected claims
  const result = await interactor.generateAuthRequest(
    authRequestPresenter,
    dcqlCredentialQueries  // ← これをgenerateAuthRequestに渡す
  );
});
```

**この実装は既に正しい**: UIで選択されたclaimがdcqlCredentialQueriesとして構築され、`generateAuthRequest`に渡されています。

**ただし、現在の問題**: `generateAuthRequest`がdcqlCredentialQueriesを受け取っているが、それを`startAuthRequest`に渡していない可能性があります。

**確認が必要な箇所**:
1. `oid4vp-interactor.ts`の`generateAuthRequest`メソッド
2. `generateAuthRequest`が`startAuthRequest`を呼ぶ際に、dcqlCredentialQueriesを渡しているか
3. `startAuthRequest`がdcqlCredentialQueriesを保存しているか

**修正例**:

現在の`generateAuthRequest`が以下のようになっている場合：
```typescript
const generateAuthRequest = async (
  presenter: AuthRequestPresenter,
  dcqlCredentialQueries?: any[], // UIから渡される
) => {
  // ...
  const result = await startAuthRequest(
    responseMode,
    // dcqlCredentialQueriesを渡す必要がある
  );
  // ...
};
```

修正後：
```typescript
const generateAuthRequest = async (
  presenter: AuthRequestPresenter,
  dcqlCredentialQueries?: any[], // UIから渡される
) => {
  // ...
  const result = await startAuthRequest(
    responseMode,
    dcqlCredentialQueries || defaultDcqlQuery, // ← 明示的に渡す
  );
  // ...
};
```

**API側（`POST /oid4vp/auth-request`）の対応**:

API経由でリクエストを作成する場合も、リクエストボディでdcqlCredentialQueriesを受け取れるようにする：

```typescript
router.post(`/${apiDomain}/auth-request`, koaBody(), async (ctx) => {
  const requestBody = ctx.request.body || {};
  const dcqlCredentialQueries = requestBody.dcql_credential_queries;

  const result = await interactor.generateAuthRequest(
    authRequestPresenter,
    dcqlCredentialQueries, // ← リクエストボディから取得
  );
  // ...
});
```

**まとめ**:
- UIの実装は既に完了している
- `generateAuthRequest`と`startAuthRequest`の間でdcqlCredentialQueriesが正しく受け渡されるように修正が必要
- API経由の場合も同様に対応

### アプローチ2: Nonceテーブル分離（代替案）

**概要**: nonceを別テーブルで管理し、requestsテーブルとは独立したライフサイクルを持たせる。

#### メリット
- ✅ requestsテーブルの責務が明確
- ✅ 複数のnonceを管理できる（必要に応じて）

#### デメリット
- ❌ テーブルが増える（複雑性が増す）
- ❌ JOIN操作が必要
- ❌ 本質的な問題（毎回nonceが生成される）は解決しない

**非推奨**: この方法では「request_uriアクセス時にnonceが再生成される」問題は解決できないため、推奨しません。

## 推奨する実装計画

### Phase 1: データストアの統合（優先度: 高）

1. ✅ `ResponseEndpointDatastore.saveRequest`と`VerifierDatastore.saveRequest`を統合
2. ✅ すべてのフィールドを保存できるようにする
3. ✅ テストを追加して整合性を確認

### Phase 2: Nonce生成タイミングの修正（優先度: 高）

1. ✅ `startAuthRequest`でnonceを生成
2. ✅ `getRequestObject`では保存済みnonceを使用（再生成しない）
3. ✅ `verifier.generateRequestObjectJwt`メソッドを追加

### Phase 3: DCQL Query生成タイミングの修正（優先度: 中）

1. ⚠️ UIでdcql_queryを選択可能にする
2. ⚠️ `startAuthRequest`でdcql_queryを生成・保存
3. ⚠️ `getRequestObject`では保存済みdcql_queryを使用

### Phase 4: テストとドキュメント（優先度: 中）

1. ✅ End-to-Endテストの追加
2. ✅ request_uriの冪等性を確認するテスト
3. ✅ データモデルのドキュメント更新

## 移行戦略

### 後方互換性の維持

既存のデータベースには以下の状況が存在する可能性：

1. nonceがnullのレコード
2. dcql_queryがnullのレコード

**対応方法**:
- `getRequestObject`でnull値を検出した場合、適切なエラーメッセージを返す
- または、フォールバック処理で動的に生成する（非推奨）

### デプロイ手順

1. **Step 1: データベーススキーマ確認**
   - 既存のrequestsテーブルにnonce, dcql_queryカラムが存在することを確認
   - 存在しない場合はマイグレーション実行

2. **Step 2: コードデプロイ**
   - 統合されたsaveRequestメソッドをデプロイ
   - getRequestObjectの修正をデプロイ

3. **Step 3: 動作確認**
   - request_uriを使用したフローをテスト
   - 複数回アクセスしても同じnonceが返されることを確認

4. **Step 4: 既存データのクリーンアップ**
   - 不完全なレコード（nonceまたはdcql_queryがnull）を削除
   - または手動で補完

## セキュリティ上の注意点

### Nonce検証の強化

nonceが固定されることで、以下のセキュリティ対策が必要：

1. **Nonce使用済みフラグ**
   - requestsテーブルに`nonce_used`カラムを追加
   - VP検証時に使用済みフラグをチェック
   - 使用済みnonceの再利用を防止

2. **Nonce有効期限**
   - requestsの有効期限とnonceの有効期限を一致させる
   - 期限切れのnonceを受け付けない

3. **ログとモニタリング**
   - Nonce再利用の試みを検知
   - アラートを発行

## まとめ

**推奨する解決策**: アプローチ1（Request作成時にすべて生成）

**理由**:
- Nonceのライフサイクルが明確
- Request_URIの冪等性が保証される
- データモデルがシンプル
- セキュリティが向上

**次のアクション**:
1. Phase 1（データストア統合）から着手
2. Phase 2（Nonce生成タイミング修正）を実装
3. テストで動作を確認
4. Phase 3（DCQL Query修正）は必要に応じて実装

この修正により、work.mdに記載されている全ての問題が解決されます。
