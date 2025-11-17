# システムアーキテクチャドキュメント

## 概要

boolcheckは、真偽情報（Claims）を分散データベース上で管理するためのシステムです。このドキュメントでは、システム全体のアーキテクチャ、各コンポーネントの役割、データフロー、および技術的な実装詳細について説明します。

## システム構成

boolcheckシステムは、以下の3つのノードタイプで構成されています：

```
┌─────────────────────────────────────────────────────────────────┐
│                        boolcheck System                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                   │
│  ┌──────────────┐      ┌──────────────┐      ┌───────────────┐ │
│  │  BOOL_NODE   │      │  API_NODE    │      │ VERIFIER_NODE │ │
│  │              │      │              │      │               │ │
│  │ [Write Node] │◄────►│ [Read Node]  │      │ [Auth Node]   │ │
│  │              │      │              │      │               │ │
│  │ Port: 3000   │      │ Port: 3001   │      │ Port: 3002    │ │
│  └──────┬───────┘      └──────┬───────┘      └───────┬───────┘ │
│         │                     │                      │         │
│         │                     │                      │         │
│    ┌────▼─────────────────────▼───────┐         ┌───▼──────┐  │
│    │      OrbitDB + IPFS Network      │         │ OrbitDB  │  │
│    │  (Distributed Database Layer)    │         │ (OID4VP) │  │
│    └─────────────┬────────────────────┘         └──────────┘  │
│                  │                                             │
│         ┌────────▼─────────┐                                   │
│         │  SQLite (Local)  │                                   │
│         │  Cache & Query   │                                   │
│         └──────────────────┘                                   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

### 1. BOOL_NODE（更新用ノード）

**役割**: 真偽情報の書き込み・更新を担当する中核ノード

**主な責務**:
- URLの登録とメタデータ取得（OGP情報など）
- Claimの作成と削除
- ClaimerとAffiliation（所属情報）の管理
- OrbitDBへのデータ永続化
- 他ノードへのアクセス制御（Grant権限管理）

**公開API**:
- `POST /database/urls` - URL登録
- `POST /database/claims` - Claim作成
- `DELETE /database/claims/:id` - Claim削除
- `GET /database/*` - 各種参照API
- `POST /admin/access-right/grant` - アクセス権付与（管理用）
- `GET /admin/db/info` - データベース情報取得（管理用）

**CORS設定**:
- 特定のAPP_HOSTからのPOSTリクエストのみ許可

**環境変数**:
```
APP_TYPE=BOOL_NODE
APP_PORT=3000
PEER_ADDR=/ip4/0.0.0.0/tcp/4000
ORBITDB_ROOT_ID_KEY=main_peer
IPFS_PATH=./ipfs/blocks
ORBITDB_PATH=./orbitdb
KEYSTORE_PATH=./keystore
DATABASE_FILEPATH=./database.sqlite
PEER_ID_PATH=./peer-id.bin  # 固定PeerIDを使用
```

### 2. API_NODE（参照用ノード）

**役割**: データの読み取り専用ノードとして、高速な参照機能を提供

**主な責務**:
- BOOL_NODEからのデータ同期
- 参照系APIの提供
- SQLiteキャッシュによる高速クエリ
- フィルタリング・ソート機能

**起動フロー**:
1. OrbitDBとIPFSノードを初期化
2. BOOL_NODEの`/admin/db/info`エンドポイントにアクセス
3. データベースアドレスとPeer情報を取得
4. BOOL_NODEにLibp2pで接続（dial）
5. OrbitDBドキュメントを開いて同期開始
6. 差分データをSQLiteに書き込み

**同期メカニズム**:
- 初回起動時: 全履歴を走査して同期（`syncAllUrls`, `syncAllClaims`, `syncAllAffiliations`）
- 同期履歴をSQLiteに保存（最後に同期したハッシュとキーを記録）
- 次回以降: 前回の同期ポイントから差分のみ同期
- OrbitDBの`update`イベントでリアルタイム更新を受信

**公開API**:
- `GET /database/urls` - URL一覧取得（フィルタ・ソート対応）
- `GET /database/urls/:id` - URL詳細取得
- `GET /database/urls/:id/metadata` - URLメタデータ取得
- `GET /database/urls/:id/claims` - URL に紐づくClaim一覧
- `GET /database/claims/:id` - Claim詳細取得
- `GET /database/claimers/:id` - Claimer情報取得
- `GET /database/backup` - バックアップデータ取得

**CORS設定**:
- 全てのオリジンからのGETリクエストを許可

**環境変数**:
```
APP_TYPE=API_NODE
APP_PORT=3001
PEER_ADDR=/ip4/0.0.0.0/tcp/4001
ORBITDB_ROOT_ID_KEY=peer2
MAIN_PEER_HOST=http://localhost:3000  # BOOL_NODEのアドレス
IPFS_PATH=./ipfs/blocks
ORBITDB_PATH=./orbitdb
KEYSTORE_PATH=./keystore
DATABASE_FILEPATH=./database.sqlite
```

### 3. VERIFIER_NODE（検証用ノード）

**役割**: OpenID for Verifiable Presentations (OID4VP) プロトコルを使用して、アイデンティティウォレットから検証可能なクレデンシャルを受け取る

**主な責務**:
- OID4VP認証リクエストの生成
- Presentation Definitionの管理
- Verifiable Credentialの検証
- SD-JWT（Selective Disclosure JWT）のデコードと検証
- 検証後のクレーム情報をBOOL_NODEに送信

**OID4VPフロー**:
1. クライアントが認証を開始（`POST /oid4vp/auth-request`）
2. VERIFIER_NODEがPresentation Definitionを生成
3. アイデンティティウォレットがVPトークンを送信
4. VERIFIER_NODEがVPトークンを検証
5. クレデンシャルからクレーム情報を抽出
6. BOOL_NODEにクレーム情報を登録

**使用する分散DB**:
- `requestsAtResponseEndpoint` - レスポンスエンドポイントでのリクエスト
- `requestsAtVerifier` - Verifierでのリクエスト
- `presentationDefinitions` - Presentation定義
- `responsesAtResponseEndpoint` - レスポンスエンドポイントでのレスポンス
- `sessions` - セッション情報
- `states` - 状態情報

**公開API**:
- `POST /oid4vp/auth-request` - 認証リクエスト作成
- `GET /oid4vp/presentation-definitions/:id` - Presentation定義取得
- `GET /oid4vp/request` - リクエスト取得
- `POST /oid4vp/responses` - レスポンス受信
- `POST /oid4vp/response-code/exchange` - レスポンスコード交換
- `POST /oid4vp/comment/confirm` - クレームコミット
- `POST /oid4vp/comment/cancel` - クレームキャンセル
- `GET /oid4vp/comment/states` - 状態取得

**CORS設定**:
- 特定のAPP_HOSTからのGET・POSTリクエストを許可（credentials有効）

**環境変数**:
```
APP_TYPE=VERIFIER_NODE
APP_PORT=3002
OID4VP_ORBITDB_ROOT_ID_KEY=oid4vp
OID4VP_IPFS_PATH=./oid4vp/ipfs/blocks
OID4VP_ORBITDB_PATH=./oid4vp/orbitdb
OID4VP_KEYSTORE_PATH=./oid4vp/keystore
OID4VP_CLIENT_ID_SCHEME=x509_san_dns
OID4VP_VERIFIER_JWK={"kty":"EC","crv":"P-256",...}
OID4VP_VERIFIER_X5C=<PEM形式のサーバー証明書>
OID4VP_REQUEST_HOST=oid4vp://localhost/request
OID4VP_CLIENT_ID=http://localhost
...
```

## データフロー

### URLとClaimの登録フロー（BOOL_NODE）

```
┌─────────┐
│ Client  │
└────┬────┘
     │ POST /database/urls
     ▼
┌────────────────────────────────┐
│ BOOL_NODE (main-routes)        │
│  ├─ ClaimInteractor            │
│  │   └─ UrlHandler             │
│  │       ├─ OGP取得（Puppeteer）│
│  │       └─ URLドキュメント作成  │
│  └─ OrbitDB                    │
│      └─ urls.put(urlDoc)       │
└────┬───────────────────────────┘
     │ OrbitDB update event
     ▼
┌─────────────────────────────┐
│ onUpdate handler            │
│  └─ SQLite syncUrl()        │
│      └─ INSERT OR REPLACE   │
└─────────────────────────────┘
     │ IPFS pubsub
     ▼
┌─────────────────────────────┐
│ API_NODE (同期済み)          │
│  ├─ OrbitDB update event    │
│  └─ SQLite syncUrl()        │
└─────────────────────────────┘
```

### OID4VPによるクレーム登録フロー（VERIFIER_NODE）

```
┌──────────────┐
│ Wallet App   │
└──────┬───────┘
       │ 1. POST /oid4vp/auth-request
       ▼
┌──────────────────────────────────────┐
│ VERIFIER_NODE                        │
│  ├─ Oid4vpInteractor                 │
│  │   ├─ Presentation Definition作成 │
│  │   └─ Auth Request作成             │
│  └─ OrbitDB (OID4VP用)               │
│      ├─ presentationDefinitions      │
│      └─ requestsAtResponseEndpoint   │
└──────┬───────────────────────────────┘
       │ 2. Presentation Definition返却
       ▼
┌──────────────┐
│ Wallet App   │ 3. VP Token生成
└──────┬───────┘
       │ 4. POST /oid4vp/responses
       ▼
┌──────────────────────────────────────┐
│ VERIFIER_NODE                        │
│  ├─ VP Token検証                     │
│  │   ├─ 署名検証（X.509証明書）      │
│  │   └─ SD-JWTデコード               │
│  ├─ Credential1Processor             │
│  │   └─ クレーム情報抽出              │
│  └─ sessions DBに保存                │
└──────┬───────────────────────────────┘
       │ 5. POST /oid4vp/comment/confirm
       ▼
┌──────────────────────────────────────┐
│ ApiNodeCaller (BOOL_NODEに送信)      │
│  └─ POST {BOOL_NODE}/database/claims │
└──────┬───────────────────────────────┘
       ▼
┌──────────────────────────────────────┐
│ BOOL_NODE                            │
│  └─ Claim登録                        │
└──────────────────────────────────────┘
```

## 分散データベースアーキテクチャ

### OrbitDB + IPFS構造

**OrbitDB**は、IPFSをベースとした分散データベースで、以下の特徴を持ちます：

- **CRDTs（Conflict-free Replicated Data Types）**: 競合のないデータレプリケーション
- **イベントログ**: すべての操作は追記型のログとして記録
- **アドレス指定**: `/orbitdb/<hash>/<name>` 形式でデータベースを特定
- **アクセス制御**: OrbitDBAccessControllerによる書き込み権限管理

**IPFS (Helia)**は、分散ファイルシステムとして使用され、以下を担当：

- **ブロックストレージ**: LevelDBベースのブロックストア（`blockstore-level`）
- **libp2p**: ピアツーピア通信プロトコル（TCP/IP上で動作）
- **Gossipsub**: Pub/Subメッセージング（OrbitDB更新の通知）
- **コンテンツアドレッシング**: CID（Content Identifier）によるデータ参照

### ドキュメントタイプ

BOOL_NODEとAPI_NODEは、以下の4つのドキュメントタイプを管理：

| ドキュメント名 | indexBy | 説明 |
|---------------|---------|------|
| `urls` | `id` | URL情報（メタデータ、OGP情報含む） |
| `claimers` | `id` | クレーム発行者情報（ウォレットユーザー） |
| `claims` | `id` | クレーム本体（真偽情報） |
| `affiliations` | `id` | 所属情報（組織との紐付け） |

各ドキュメントは、OrbitDBの`Documents`タイプとして実装され、指定された`indexBy`フィールドでインデックス化されています。

### 同期プロセス

**初期同期（API_NODE起動時）**:

1. **接続確立**:
   ```typescript
   // BOOL_NODEに接続
   const response = await fetch(`${mainPeerHost}/admin/db/info`);
   const docInfo = await response.json();

   // libp2p dialでピア接続
   await libp2p.dial(multiaddr(docInfo.peer.multiaddrs[0]));
   ```

2. **データベース同期**:
   ```typescript
   // OrbitDBアドレスを使用してドキュメントを開く
   const doc = await orbitdb.open(docInfo.documents.urls.address);
   ```

3. **全履歴同期**:
   ```typescript
   // イテレータで全エントリを走査
   for await (const { hash, key, value } of doc.iterator()) {
     if (hash === latestSyncedHash) break; // 前回の同期ポイントまで
     await syncUrl(value, true);
   }
   ```

**リアルタイム同期**:

```typescript
// OrbitDBの更新イベントをリスン
doc.events.on('update', async (entry) => {
  await onUpdateUrls(entry);
});
```

### SQLiteキャッシュ層

OrbitDBの分散データは、SQLiteにキャッシュされてクエリ性能を向上：

**テーブル構造**:
- `urls` - URL情報（OGP、作成日時、カウント等）
- `claims` - クレーム情報（URL、Claimer、真偽、タイムスタンプ）
- `claimers` - クレーム発行者情報
- `affiliations` - 所属情報
- `sync_history` - 同期履歴（最後に同期したハッシュとキー）

**同期ハンドラ** (`local-data/syncer.ts`):
- `syncUrl(value)` - URLをSQLiteに挿入/更新
- `syncClaim(value)` - Claimを挿入/削除
- `syncAffiliation(value)` - 所属情報を挿入/更新

**メリット**:
- 複雑なクエリ（フィルタ、ソート、集計）が高速
- OrbitDBへの負荷軽減
- オフラインでも参照可能

## アクセス制御とセキュリティ

### OrbitDBアクセス制御

**OrbitDBAccessController**を使用した書き込み制御：

```typescript
const write = [identity.id]; // 書き込み許可するIdentity
const AccessController = OrbitDBAccessController({ write });
const doc = await orbitdb.open(docType.name, { AccessController });
```

**Grant権限** (`/admin/access-right/grant`):
- BOOL_NODEが他のノードに書き込み権限を付与
- リモートのIdentityを取得して`doc.access.grant("write", identity.id)`を実行

### CORS設定

各ノードで異なるCORS設定を適用：

```typescript
// BOOL_NODE: 特定オリジンからのPOSTのみ
cors({ origin: appHost, allowMethods: ['POST', 'OPTIONS'] })

// API_NODE: 全オリジンからのGET
cors({ origin: '*', allowMethods: ['GET'] })

// VERIFIER_NODE: 特定オリジンからのGET/POST（credentials有効）
cors({ origin: appHost, allowMethods: ['POST', 'GET'], credentials: true })
```

### セッション管理

VERIFIER_NODEはKoaセッションを使用：

```typescript
app.keys = [process.env.OID4VP_COOKIE_SECRET];
app.use(session({
  maxAge: 60 * 60 * 1000, // 1時間
  signed: true,
  httpOnly: true,
  secure: NODE_ENV !== 'local',
  sameSite: 'none'
}, app));
```

### 認証トークン検証

Claim削除時にBearerトークンで認証：

```typescript
// DELETE /database/claims/:id
const authHeader = ctx.headers.authorization;
const idToken = authHeader.split(' ')[1];
const result = await interactor.deleteClaim(id, idToken);
```

## 技術スタック

### フレームワーク・ライブラリ

| カテゴリ | 技術 | 用途 |
|---------|------|------|
| Webフレームワーク | Koa | REST APIサーバー |
| 分散データベース | OrbitDB v2.2.0 | CRDTベースの分散DB |
| 分散ファイルシステム | Helia (IPFS) | ブロックストレージとP2P通信 |
| P2P通信 | libp2p | ピア接続とGossipsub |
| ローカルDB | SQLite3 | クエリ用キャッシュ |
| 暗号・署名 | jose, jsrsasign | JWT/JWK/X.509処理 |
| SD-JWT | @meeco/sd-jwt | Selective Disclosure JWT |
| スクレイピング | Puppeteer | OGPメタデータ取得 |
| ロギング | winston | 構造化ログ |

### 言語・ランタイム

- **TypeScript 5.5.4**: 型安全な開発
- **Node.js 20+**: ESModules使用
- **ビルド**: TypeScriptコンパイラ (`tsc`)

### ストレージ

- **LevelDB**: IPFSブロックストア（`blockstore-level`）
- **SQLite**: クエリキャッシュとローカルデータ
- **ファイルシステム**: OrbitDB、IPFS、Keystoreの永続化

## デプロイメント構成

### 推奨デプロイメント

```
┌───────────────────────────────────────────────────────────┐
│                    Production Environment                  │
├───────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────────┐         ┌─────────────────┐          │
│  │  Load Balancer  │         │  Load Balancer  │          │
│  │   (API_NODE)    │         │ (VERIFIER_NODE) │          │
│  └────────┬────────┘         └────────┬────────┘          │
│           │                           │                    │
│     ┌─────▼─────┐               ┌────▼─────┐              │
│     │ API_NODE  │               │ VERIFIER │              │
│     │ Instance1 │               │   NODE   │              │
│     ├───────────┤               │ Instance1│              │
│     │ API_NODE  │               └──────────┘              │
│     │ Instance2 │                                          │
│     ├───────────┤                                          │
│     │ API_NODE  │                                          │
│     │ Instance3 │                                          │
│     └─────┬─────┘                                          │
│           │                                                │
│           │ IPFS/OrbitDB Sync                              │
│           ▼                                                │
│     ┌───────────┐                                          │
│     │ BOOL_NODE │ (Single Master)                          │
│     │  Primary  │                                          │
│     └───────────┘                                          │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### ネットワーク要件

- **BOOL_NODE**:
  - ポート3000（API）、4000（libp2p TCP）を開放
  - 固定PeerIDを使用（`PEER_ID_PATH`で管理）

- **API_NODE**:
  - ポート3001（API）、4001（libp2p TCP）を開放
  - BOOL_NODEへのHTTP/libp2pアクセスが必要

- **VERIFIER_NODE**:
  - ポート3002（API）を開放
  - BOOL_NODEへのHTTPアクセスが必要

### 永続化ボリューム

各ノードで以下のディレクトリを永続化：

- `./ipfs/blocks` - IPFSブロックストア
- `./orbitdb` - OrbitDBデータ
- `./keystore` - 暗号鍵ストア
- `./database.sqlite` - SQLiteキャッシュ
- `./peer-id.bin` - PeerID（BOOL_NODEのみ）

## パフォーマンス最適化

### 同期の最適化

1. **バッチ処理**: 1000件ごとにログ出力
2. **履歴管理**: 最後に同期したハッシュを記録して差分同期
3. **並列処理**: 各ドキュメントタイプを独立して同期

### クエリの最適化

1. **SQLiteインデックス**: 頻繁に検索されるフィールドにインデックス
2. **集計クエリ**: URLごとのtrue/false countをSQLiteで事前計算
3. **ページネーション**: フィルタとソートに対応

### エラーハンドリング

1. **OrbitDB更新エラー**: イベントリスナーでエラーキャッチ
2. **同期リトライ**: BOOL_NODE起動待ちで5秒間隔でリトライ
3. **Graceful Shutdown**: SIGINTでOrbitDBとIPFSを正常終了

## まとめ

boolcheckは、OrbitDBとIPFSを活用した分散アーキテクチャにより、以下を実現しています：

- **スケーラビリティ**: 参照ノード（API_NODE）を水平スケール
- **可用性**: 分散データベースによる単一障害点の排除
- **一貫性**: CRDTsによる競合のないデータレプリケーション
- **パフォーマンス**: SQLiteキャッシュによる高速クエリ
- **信頼性**: OID4VPとVerifiable Credentialsによる検証可能なクレーム

各ノードが明確な役割分担を持ち、BOOL_NODEが更新の中核、API_NODEが参照の最適化、VERIFIER_NODEが認証・検証を担当することで、効率的かつ安全な真偽情報管理システムを構築しています。
