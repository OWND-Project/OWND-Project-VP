# コンポーネント設計ドキュメント

## 概要

boolcheckシステムは、レイヤードアーキテクチャに基づいて設計されており、各層が明確な責務を持っています。このドキュメントでは、主要なコンポーネントの設計、インターフェース、依存関係について説明します。

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
│  - ビジネスロジック                             │
│  - トランザクション制御                         │
│  - プレゼンテーション変換                       │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│             Repository Layer                    │
│  (orbit-db/, local-data/, oid4vp/)              │
│  - データ永続化                                 │
│  - データ同期                                   │
│  - キャッシュ管理                               │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────▼────────────────────────────────┐
│             Infrastructure Layer                │
│  (helpers/, services/, tool-box/)               │
│  - OrbitDB/IPFSアクセス                         │
│  - SQLiteアクセス                               │
│  - ロギング                                     │
│  - 暗号化・署名検証                             │
└─────────────────────────────────────────────────┘
```

## 主要コンポーネント

### 1. OrbitDB Service Layer (`orbit-db/`)

**責務**:
- OrbitDBとIPFSノードのセットアップ
- ドキュメントとKeyValueの管理
- ノード間の同期
- アクセス制御

**主要ファイル**:
- `orbitdb-service.ts`: OrbitDBサービスのコア実装
- `orbitdb-service.types.ts`: 型定義
- `index.ts`: エクスポート

#### setupNode()

**シグネチャ**:
```typescript
const setupNode = async (
  libP2POptions: Libp2pOptions,
  opt: SetUpOption,
): Promise<Node>
```

**責務**:
- libp2pノードの作成
- Heliaの初期化
- OrbitDB Identityの作成
- OrbitDBインスタンスの作成

**処理フロー**:
```typescript
// 1. libp2p作成
const libp2p = await createLibp2p(libP2POptions);

// 2. Helia (IPFS)作成
const blockstore = new LevelBlockstore(ipfsPath);
const ipfs = await createHelia({ libp2p, blockstore });

// 3. Identity作成
const identities = await Identities({ ipfs, keystore });
const identity = await identities.createIdentity({ id: identityKey });

// 4. OrbitDB作成
const orbitdb = await createOrbitDB({
  ipfs,
  directory: orbitdbPath,
  identity,
  identities,
});
```

#### openDocuments()

**シグネチャ**:
```typescript
const openDocuments = async (
  documentTypes: {
    name: string;
    indexBy: string;
    onUpdate?: (entry: any) => Promise<void>;
  }[],
): Promise<{ documents: Record<string, OpenedDocument>; closeDocuments: () => Promise<void> }>
```

**責務**:
- OrbitDBドキュメントタイプを開く
- アクセスコントローラを設定
- 更新イベントリスナーを登録

**使用例**:
```typescript
const docs = await node.openDocuments([
  { name: "urls", indexBy: "id", onUpdate: onUpdateUrls },
  { name: "claims", indexBy: "id", onUpdate: onUpdateClaims },
  { name: "affiliations", indexBy: "id", onUpdate: onUpdateAffiliations },
]);

// ドキュメントアクセス
await docs.documents["urls"].document.put({ id: "...", url: "..." });
const url = await docs.documents["urls"].document.get("url-id");
```

#### syncDocuments()

**シグネチャ**:
```typescript
const syncDocuments = async (
  args: SyncArgs,
  onUpdates: Record<string, (entry: any) => Promise<void>>,
): Promise<Result<SyncDocumentsOkResult, SyncDocumentsNgResult>>
```

**責務**:
- BOOL_NODEに接続（libp2p dial）
- OrbitDBアドレスを使用してドキュメントを開く
- 更新イベントリスナーを登録

**使用例（API_NODE）**:
```typescript
const docInfo = await fetch(`${mainPeerHost}/admin/db/info`).then(r => r.json());

const synced = await node.syncDocuments(docInfo, {
  urls: onUpdateUrls,
  claims: onUpdateClaims,
  affiliations: onUpdateAffiliations,
});

if (synced.ok) {
  const docs = synced.payload;
  // docsを使用してOrbitDBにアクセス
}
```

**依存関係**:
- `libp2p`: ピアツーピア通信
- `helia`: IPFS実装
- `@orbitdb/core`: OrbitDBコア
- `blockstore-level`: LevelDBベースのブロックストア

---

### 2. Use Case Layer (`usecases/`)

**責務**:
- ビジネスロジックの実装
- トランザクション制御
- データの整合性保証
- プレゼンテーション形式への変換

**主要ファイル**:
- `claim-interactor.ts`: Claim関連のビジネスロジック
- `oid4vp-interactor.ts`: OID4VP認証フロー
- `oid4vp-repository.ts`: OID4VP用データストア
- `types.ts`: 型定義

#### ClaimInteractor

**ファイル**: `claim-interactor.ts`

**責務**:
- URL登録
- Claim作成・削除
- Claimer管理
- Affiliation管理

**主要メソッド**:

##### putUrl()

**シグネチャ**:
```typescript
const putUrl = async <T>(
  url: string,
  presenter: UrlPresenter<T>,
): Promise<Result<T, NotSuccessResult>>
```

**処理フロー**:
```typescript
// 1. URL重複チェック
const existing = await selectUrl(url);
if (existing.ok && existing.payload.urlDoc) {
  return { ok: false, error: { type: "CONFLICT" } };
}

// 2. OGPメタデータ取得（Puppeteer）
const ogpResult = await getOgpFromUrl(url);

// 3. URLドキュメント作成
const urlDoc = {
  id: randomUniqueString(),
  url,
  domain: new URL(url).hostname,
  title: ogpResult.payload.title,
  description: ogpResult.payload.description,
  image: JSON.stringify(ogpResult.payload.image),
  created_at: new Date().toISOString(),
};

// 4. OrbitDB保存
await docs.documents["urls"].document.put(urlDoc);

// 5. プレゼンテーション変換
return { ok: true, payload: presenter(aggregatedUrl) };
```

##### putClaim()

**シグネチャ**:
```typescript
const putClaim = async <T>(
  payload: {
    url: string;
    claimer: { id_token: string; sub: string; organization?: string; icon?: string };
    comment: string;
  },
  presenter: NewClaimPresenter<T>,
): Promise<Result<T, NotSuccessResult>>
```

**処理フロー**:
```typescript
// 1. URL存在チェック
const urlDoc = await selectUrl(payload.url);
if (!urlDoc.ok || !urlDoc.payload.urlDoc) {
  return { ok: false, error: { type: "INVALID_PARAMETER" } };
}

// 2. Claimer作成または取得
const claimerDoc = await getOrCreateClaimer(payload.claimer);

// 3. Affiliation作成（組織情報がある場合）
let affiliationId;
if (payload.claimer.organization) {
  const affiliationDoc = await createAffiliation(claimerDoc.id, payload.claimer);
  affiliationId = affiliationDoc.id;
}

// 4. Claimドキュメント作成
const claimDoc = {
  id: randomUniqueString(),
  url: payload.url,
  claimer_id: claimerDoc.id,
  affiliation_id: affiliationId,
  comment: payload.comment,  // SD-JWT
  created_at: new Date().toISOString(),
};

// 5. OrbitDB保存
await docs.documents["claims"].document.put(claimDoc);

// 6. プレゼンテーション変換
return { ok: true, payload: presenter(claimDoc) };
```

##### deleteClaim()

**シグネチャ**:
```typescript
const deleteClaim = async (
  id: string,
  idToken: string,
): Promise<VoidResult<NotSuccessResult>>
```

**処理フロー**:
```typescript
// 1. Claim取得
const claim = await getClaim(id);
if (!claim) {
  return { ok: false, error: { type: "NOT_FOUND" } };
}

// 2. Claimer検証
const claimer = await getClaimer(claim.claimer_id);
if (claimer.id_token !== idToken) {
  return { ok: false, error: { type: "KEY_DOES_NOT_MATCH" } };
}

// 3. OrbitDB更新（deleted_atを設定）
const updatedClaim = {
  ...claim,
  deleted_at: new Date().toISOString(),
};
await docs.documents["claims"].document.put(updatedClaim);

return { ok: true };
```

**依存関係**:
- `orbit-db/`: OrbitDBアクセス
- `local-data/`: SQLiteアクセス
- `helpers/jwt-helper.ts`: JWT処理
- `services/ogp-service.ts`: OGP取得
- `utils/random-util.ts`: UUID生成

#### OID4VPInteractor

**ファイル**: `oid4vp-interactor.ts`

**責務**:
- OID4VP認証リクエスト生成
- VP Token検証
- クレデンシャル処理
- BOOL_NODEへのClaim送信

**主要メソッド**:

##### generateAuthRequest()

認証リクエストを生成し、Presentation Definitionを作成します。

##### receiveAuthResponse()

ウォレットからのVP Tokenを受信し、レスポンスコードを発行します。

##### exchangeAuthResponse()

レスポンスコードを交換して、VP Tokenを検証し、クレーム情報を抽出します。

##### confirmComment()

クレームをBOOL_NODEに送信して確定します。

**依存関係**:
- `oid4vp/verifier.ts`: Verifier機能
- `oid4vp/response-endpoint.ts`: レスポンスエンドポイント
- `usecases/oid4vp-repository.ts`: データストア
- `usecases/internal/credential1-processor.ts`: クレデンシャル処理
- `usecases/internal/api-node-caller.ts`: BOOL_NODE API呼び出し

---

### 3. Local Data Layer (`local-data/`)

**責務**:
- OrbitDBとSQLite間の同期
- SQLiteクエリ実行
- ローカルキャッシュ管理

**主要ファイル**:
- `sqlite-client.ts`: SQLiteクライアント
- `local-data-handler.ts`: データハンドラ
- `syncer.ts`: 同期関数
- `replication.ts`: レプリケーション（全履歴同期）
- `on-update.ts`: 更新イベントハンドラ

#### SQLiteClient

**ファイル**: `sqlite-client.ts`

**責務**:
- SQLiteデータベース初期化
- テーブル作成
- エラーハンドリング

**主要メソッド**:

##### initClient()

**シグネチャ**:
```typescript
const initClient = async (
  databaseFilePath: string,
): Promise<{
  init: () => Promise<void>;
  destroy: () => Promise<void>;
  db: Database;
}>
```

**処理フロー**:
```typescript
// 1. SQLiteデータベースオープン
const db = await open({
  filename: databaseFilePath,
  driver: sqlite3.cached.Database,
});

// 2. テーブル作成（存在しない場合）
await createDb({
  urls: DDL_URLS,
  claims: DDL_CLAIMS,
  affiliations: DDL_AFFILIATIONS,
  sync_histories: DDL_SYNC_HISTORIES,
});

return { init, destroy, db };
```

**DDL例（urls）**:
```sql
CREATE TABLE urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_id VARCHAR(32) UNIQUE,
  url VARCHAR(4096) UNIQUE,
  search VARCHAR(4096),
  domain VARCHAR(255),
  title VARCHAR(255),
  description VARCHAR(2048),
  content_type VARCHAR(80),
  image VARCHAR(4096),
  source_created_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

#### LocalDataHandler

**ファイル**: `local-data-handler.ts`

**責務**:
- SQLiteへのデータ挿入・更新
- 集計クエリ実行
- フィルタリング・ソート

**主要ハンドラ**:

##### urlHandler()

**主要メソッド**:
- `addUrl(urlDoc)`: URLを挿入
- `getUrlByUrl(url)`: URLで検索
- `getUrlMetadata(id)`: メタデータ取得

##### claimHandler()

**主要メソッド**:
- `addClaim(claimDoc)`: Claimを挿入
- `deleteClaim(claimDoc)`: Claimを削除
- `getClaimsByUrl(url)`: URL に紐づくClaim一覧
- `getAggregatedUrl(opt)`: URLごとの集計データ取得

**集計クエリ例**:
```sql
SELECT
  MIN(b.url_id) as id,
  a.url,
  MAX(title) AS title,
  SUM(CASE WHEN bool_value = 1 THEN 1 ELSE 0 END) AS true_count,
  SUM(CASE WHEN bool_value = 0 THEN 1 ELSE 0 END) AS false_count,
  SUM(CASE WHEN bool_value = 2 THEN 1 ELSE 0 END) AS else_count,
  SUM(CASE WHEN bool_value = 1 AND a.affiliation_id IS NOT NULL AND a.affiliation_id <> '' THEN 1 ELSE 0 END) AS verified_true_count,
  MIN(a.source_created_at) AS oldest_created_at
FROM claims a
INNER JOIN urls b ON a.url = b.url
GROUP BY a.url
ORDER BY oldest_created_at DESC
```

##### affiliationHandler()

**主要メソッド**:
- `addAffiliation(affiliationDoc)`: Affiliationを挿入
- `getAffiliationByClaimerId(claimerId)`: Claimer IDで検索

##### syncHistoryHandler()

**主要メソッド**:
- `addSyncHistory(docType, hash, key)`: 同期履歴を記録
- `getLatestSyncHistory(docType)`: 最新の同期履歴を取得

#### Syncer

**ファイル**: `syncer.ts`

**責務**:
- OrbitDBエントリをSQLiteに同期
- エラーハンドリング

**主要関数**:
```typescript
export const syncers = async (databaseFilePath: string) => {
  const db = await initClient(databaseFilePath);

  const syncUrl = async (value: UrlDocument, silent: boolean = false) => {
    const handler = await urlHandler(db.db);
    await handler.addUrl(value);
  };

  const syncClaim = async (value: ClaimDocument, silent: boolean = false) => {
    const handler = await claimHandler(db.db);
    if (value.deleted_at) {
      await handler.deleteClaim(value);
    } else {
      await handler.addClaim(value);
    }
  };

  const syncAffiliation = async (value: AffiliationDocument, silent: boolean = false) => {
    const handler = await affiliationHandler(db.db);
    await handler.addAffiliation(value);
  };

  return { syncUrl, syncClaim, syncAffiliation, latestHistory, saveLatestHistory };
};
```

#### Replication

**ファイル**: `replication.ts`

**責務**:
- 初回起動時の全履歴同期
- 差分同期のための履歴管理

**主要関数**:
```typescript
export const replication = (syncers: Syncers) => {
  const syncAllUrls = async () => {
    const latestHash = await latestHistory("urls");
    for await (const { hash, key, value } of docs.documents["urls"].document.iterator()) {
      if (hash === latestHash) break;  // 前回の同期ポイントまで
      await syncUrl(value, true);
      setLatestHash(hash, key);
    }
    await saveLatest();
  };

  // syncAllClaims, syncAllAffiliations も同様

  return { setDocs, syncAllUrls, syncAllClaims, syncAllAffiliations };
};
```

**依存関係**:
- `sqlite`: SQLiteドライバ
- `sqlite3`: SQLite3ネイティブバインディング

---

### 4. Routes Layer (`routes/`)

**責務**:
- HTTPリクエスト/レスポンス処理
- ルーティング
- バリデーション
- エラーハンドリング

**主要ファイル**:
- `main-routes.ts`: Database API（BOOL_NODE/API_NODE）
- `admin-routes.ts`: Admin API（BOOL_NODE/API_NODE）
- `oid4vp-routes.ts`: OID4VP API（VERIFIER_NODE）
- `presenters.ts`: プレゼンテーション変換関数
- `types.ts`: レスポンス型定義
- `error-handler.ts`: エラーハンドリング

#### Presenters

**ファイル**: `presenters.ts`

**責務**:
- ドメインモデルをHTTPレスポンス形式に変換

**主要関数**:

##### urlPresenter()

```typescript
export const urlPresenter = (url: AggregatedUrl): UrlResource => ({
  id: url.id,
  url: url.url,
  domain: url.domain,
  title: url.title,
  content_type: url.content_type,
  description: url.description,
  image: url.image ? JSON.parse(url.image) : undefined,
  created_at: url.oldest_created_at,
  true_count: url.true_count,
  false_count: url.false_count,
  else_count: url.else_count,
  verified_true_count: url.verified_true_count,
  verified_false_count: url.verified_false_count,
  verified_else_count: url.verified_else_count,
});
```

##### claimPresenter()

```typescript
export const claimPresenter = (
  claim: ClaimDocument,
  url: AggregatedUrl,
  claimer: ClaimerDocument,
  organization?: string,
): ClaimResource => ({
  id: claim.id,
  url: urlPresenter(url),
  claimer: {
    id: claimer.id,
    id_token: claimer.id_token,
    icon: claimer.icon,
    organization,
    created_at: claim.created_at,
  },
  comment: claim.comment,
  created_at: claim.created_at,
});
```

#### ErrorHandler

**ファイル**: `error-handler.ts`

**責務**:
- エラータイプからHTTPステータスコードへの変換
- エラーレスポンス生成

**主要関数**:

```typescript
export const handleError = (
  error: NotSuccessResult,
): { statusCode: number; body: any } => {
  switch (error.type) {
    case "INVALID_PARAMETER":
      return { statusCode: 400, body: toErrorBody("INVALID_PARAMETER", error.message) };
    case "NOT_FOUND":
      return { statusCode: 404, body: toErrorBody("NOT_FOUND", error.message) };
    case "CONFLICT":
      return { statusCode: 409, body: toErrorBody("CONFLICT", error.message, error.instance) };
    case "KEY_DOES_NOT_MATCH":
      return { statusCode: 403, body: toErrorBody("KEY_DOES_NOT_MATCH") };
    // ...
    default:
      return { statusCode: 500, body: toErrorBody("UNEXPECTED_ERROR") };
  }
};

export const toErrorBody = (
  type: string,
  message?: string,
  instance?: string,
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

### 5. Helpers Layer (`helpers/`)

**責務**:
- 低レベルのヘルパー関数
- IPFSアクセス
- Peer ID管理
- libp2p設定

**主要ファイル**:
- `ipfs-helper.ts`: IPFS関連ヘルパー
- `libp2p-helper.ts`: libp2p設定生成
- `get-peer-id.ts`: Peer ID管理
- `jwt-helper.ts`: JWT処理

#### libp2p-helper

**ファイル**: `libp2p-helper.ts`

**責務**:
- libp2pオプション生成
- トランスポート・プロトコル設定

**主要関数**:

```typescript
export const getLibp2pOptions = (opts: {
  listenAddresses?: string[];
  peerId?: PeerId;
} = {}): Libp2pOptions => ({
  peerId: opts.peerId,
  addresses: {
    listen: opts.listenAddresses || [],
  },
  transports: [tcp()],
  connectionEncrypters: [noise()],
  streamMuxers: [yamux()],
  services: {
    identify: identify(),
    pubsub: gossipsub({
      allowPublishToZeroTopicPeers: true,
    }),
  },
});
```

#### get-peer-id

**ファイル**: `get-peer-id.ts`

**責務**:
- Peer IDの永続化
- BOOL_NODEの固定Peer ID管理

**主要関数**:

```typescript
export const loadAndUsePeerId = async (peerIdPath: string): Promise<PeerId> => {
  try {
    const peerIdData = await fs.readFile(peerIdPath);
    const peerId = await unmarshalPrivateKey(peerIdData);
    return peerId;
  } catch (err) {
    // ファイルが存在しない場合は新規作成
    const peerId = await createEd25519PeerId();
    const privateKey = marshalPrivateKey(peerId);
    await fs.writeFile(peerIdPath, privateKey);
    return peerId;
  }
};
```

**依存関係**:
- `libp2p`: ピアツーピア通信
- `helia`: IPFS実装

---

### 6. Services Layer (`services/`)

**責務**:
- アプリケーション横断的な機能
- ロギング
- OGP取得

**主要ファイル**:
- `logging-service.ts`: ロギング
- `ogp-service.ts`: OGP取得

#### LoggingService

**ファイル**: `logging-service.ts`

**責務**:
- 構造化ロギング
- 環境別のログレベル設定

**主要関数**:

```typescript
import winston from "winston";

const getLogger = () => {
  const env = process.env.NODE_ENV || "local";
  const level = env === "prod" ? "info" : "debug";

  return winston.createLogger({
    level,
    format: winston.format.combine(
      winston.format.timestamp(),
      winston.format.json(),
    ),
    transports: [
      new winston.transports.Console({
        format: winston.format.combine(
          winston.format.colorize(),
          winston.format.simple(),
        ),
      }),
    ],
  });
};

export default getLogger;
```

#### OGPService

**ファイル**: `ogp-service.ts`

**責務**:
- Puppeteerを使用したOGPメタデータ取得
- タイムアウト処理
- エラーハンドリング

**主要関数**:

```typescript
import puppeteer from "puppeteer";
import ogs from "open-graph-scraper";

export const getOgpFromUrl = async (url: string) => {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();

  try {
    await page.goto(url, { waitUntil: "networkidle2", timeout: 10000 });
    const html = await page.content();
    const { result } = await ogs({ html });

    return {
      ok: true,
      payload: {
        title: result.ogTitle || result.dcTitle,
        description: result.ogDescription || result.dcDescription,
        image: result.ogImage,
        // ...
      },
    };
  } catch (err) {
    return { ok: false, error: { type: "ClientError", cause: err } };
  } finally {
    await browser.close();
  }
};
```

**依存関係**:
- `winston`: ロギングライブラリ
- `puppeteer`: ヘッドレスブラウザ
- `open-graph-scraper`: OGP解析

---

### 7. Tool-box Layer (`tool-box/`)

**責務**:
- 暗号化・署名検証
- X.509証明書処理
- 汎用ユーティリティ

**主要ファイル**:
- `verify.ts`: 署名検証
- `x509/x509.ts`: X.509証明書処理
- `x509/issue.ts`: 証明書発行
- `x509/revoke.ts`: 証明書失効
- `datetime.ts`: 日時処理
- `generic-result.ts`: Result型定義

#### Verify

**ファイル**: `verify.ts`

**責務**:
- VC/VP署名検証
- X.509証明書チェーン検証

**主要関数**:

```typescript
export const verifyVcForW3CVcDataV1 = async <T>(
  credential: string,
  opts: { skipVerifyChain?: boolean } = {},
): Promise<ExtractedCredential<string, VerifiableCredential<T>>> => {
  // 1. SD-JWTデコード
  const decoded = decodeSDJWT(credential);

  // 2. JWT署名検証
  const jwk = await importJWK(decoded.jwt.payload.cnf.jwk);
  const verifyResult = await jwtVerify(credential, jwk);

  // 3. X.509証明書チェーン検証
  if (!opts.skipVerifyChain) {
    const x5c = decoded.jwt.header.x5c;
    const chainVerifyResult = await verifyCertificateChain(x5c);
    if (!chainVerifyResult.ok) {
      throw new Error("Certificate chain verification failed");
    }
  }

  return {
    raw: credential,
    value: decoded.jwt.payload as VerifiableCredential<T>,
    verified: true,
  };
};
```

#### X.509処理

**ファイル**: `x509/x509.ts`

**責務**:
- X.509証明書の解析
- 証明書チェーン検証

**主要関数**:

```typescript
export const verifyCertificateChain = async (
  x5c: string[],
): Promise<Result<boolean, X509Error>> => {
  // 1. PEM変換
  const certs = x5c.map(cert => Certificate.fromPEM(cert));

  // 2. チェーン検証
  for (let i = 0; i < certs.length - 1; i++) {
    const cert = certs[i];
    const issuer = certs[i + 1];
    const verifyResult = await cert.verify({ publicKey: issuer.publicKey });
    if (!verifyResult) {
      return { ok: false, error: { type: "VERIFY_FAILURE" } };
    }
  }

  // 3. ルートCA検証（省略可）

  return { ok: true, payload: true };
};
```

**依存関係**:
- `jose`: JWT処理
- `@meeco/sd-jwt`: SD-JWT処理
- `pkijs`: X.509証明書処理

---

### 8. Middlewares Layer (`middlewares/`)

**責務**:
- リクエスト前処理
- ロギング

**主要ファイル**:
- `routes-logger.ts`: ルートロガー

#### RoutesLogger

**ファイル**: `routes-logger.ts`

**責務**:
- HTTPリクエスト/レスポンスのロギング

**実装**:

```typescript
import Koa from "koa";
import getLogger from "../services/logging-service.js";

const logger = getLogger();

export default () => {
  return async (ctx: Koa.Context, next: Koa.Next) => {
    const start = Date.now();
    await next();
    const ms = Date.now() - start;

    logger.info({
      method: ctx.method,
      url: ctx.url,
      status: ctx.status,
      duration: `${ms}ms`,
    });
  };
};
```

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
│   routes/    │  │  orbit-db/   │
└──────┬───────┘  └──────┬───────┘
       │                 │
       ▼                 ▼
┌──────────────┐  ┌──────────────┐
│  usecases/   │  │ local-data/  │
└──────┬───────┘  └──────┬───────┘
       │                 │
       └─────────┬───────┘
                 │
         ┌───────┴───────┬───────────┐
         │               │           │
         ▼               ▼           ▼
┌──────────────┐  ┌──────────┐  ┌────────┐
│   helpers/   │  │ services/│  │tool-box│
└──────────────┘  └──────────┘  └────────┘
```

## 設計パターン

### 1. Repository Pattern

**実装箇所**: `orbit-db/`, `local-data/`

**目的**: データアクセスロジックをビジネスロジックから分離

**例**:
```typescript
// Repository Interface
interface ClaimRepository {
  save(claim: ClaimDocument): Promise<void>;
  findById(id: string): Promise<ClaimDocument | null>;
  findByUrl(url: string): Promise<ClaimDocument[]>;
}

// OrbitDB Implementation
class OrbitDBClaimRepository implements ClaimRepository {
  async save(claim: ClaimDocument) {
    await this.docs.documents["claims"].document.put(claim);
  }
  // ...
}

// SQLite Implementation (Cache)
class SQLiteClaimRepository implements ClaimRepository {
  async save(claim: ClaimDocument) {
    await this.db.run(`INSERT INTO claims ...`, claim);
  }
  // ...
}
```

### 2. Presenter Pattern

**実装箇所**: `routes/presenters.ts`

**目的**: ドメインモデルとHTTPレスポンス形式の変換を分離

**例**:
```typescript
// Use Case
const result = await interactor.getUrl(id, urlPresenter);

// Presenter
const urlPresenter = (url: AggregatedUrl): UrlResource => ({
  id: url.id,
  url: url.url,
  // ... transformation logic
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
  verifyFunction,  // Strategy injection
);
```

### 4. Factory Pattern

**実装箇所**: `helpers/libp2p-helper.ts`, `orbit-db/orbitdb-service.ts`

**目的**: 複雑なオブジェクト生成をカプセル化

**例**:
```typescript
// libp2p Factory
export const getLibp2pOptions = (opts): Libp2pOptions => ({
  // ... complex configuration
});

// OrbitDB Factory
export const setupNode = async (libP2POptions, opt): Promise<Node> => {
  // ... complex setup process
};
```

## まとめ

boolcheckのコンポーネント設計は、以下の原則に基づいています：

1. **レイヤードアーキテクチャ**: 各層が明確な責務を持ち、下位層のみに依存
2. **疎結合**: インターフェースを介した依存関係、テストしやすい設計
3. **単一責任**: 各コンポーネントは1つの責務のみを持つ
4. **依存性注入**: コンストラクタやファクトリ関数で依存を注入
5. **型安全性**: TypeScriptの型システムを活用した堅牢な設計

この設計により、保守性が高く、拡張しやすいシステムを実現しています。
