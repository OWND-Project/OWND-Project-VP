# 依存関係分析結果

## 分析日時
Phase 1実施中

## 主要ファイルの依存関係

### src/api.ts
**削除必要な依存:**
- ❌ `./helpers/libp2p-helper.js` - libp2p関連
- ❌ `./helpers/get-peer-id.js` - Peer ID管理
- ❌ `./orbit-db/index.js` - OrbitDB
- ❌ `./routes/admin-routes.js` - OrbitDB管理API
- ❌ `./routes/main-routes.js` - Boolcheck固有API
- ❌ `./local-data/on-update.js` - OrbitDB更新ハンドラ
- ❌ `./local-data/replication.js` - レプリケーション
- ❌ `./local-data/syncer.js` - 同期処理

**保持する依存:**
- ✅ `koa` - Webフレームワーク
- ✅ `koa-session` - セッション管理
- ✅ `koa-router` - ルーティング
- ✅ `@koa/cors` - CORS
- ✅ `./routes/oid4vp-routes.js` - OID4VP API
- ✅ `./middlewares/routes-logger.js` - ロガー
- ✅ `./services/logging-service.js` - ログサービス
- ✅ `./routes/error-handler.js` - エラーハンドラ

### src/routes/oid4vp-routes.ts
**削除必要な依存:**
- ❌ `../usecases/claim-interactor.js` - Boolcheck固有

**保持する依存:**
- ✅ `koa-router` - ルーティング
- ✅ `koa-body` - ボディパーサー
- ✅ `../usecases/oid4vp-interactor.js` - OID4VP処理
- ✅ `../oid4vp/index.js` - OID4VP機能
- ✅ `../tool-box/index.js` - Result型
- ✅ `../services/logging-service.js` - ログ
- ✅ `./presenters.js` - プレゼンター
- ✅ `./error-handler.js` - エラーハンドラ

**修正必要:**
- 🔧 claim-interactorへの参照削除
- 🔧 Boolcheck関連の処理削除

### src/usecases/oid4vp-interactor.ts
**削除必要な依存:**
- ❌ `../oid4vp/siop-v2.js` - SIOPv2

**保持する依存:**
- ✅ `undici` - fetch
- ✅ `../tool-box/index.js` - Result型
- ✅ `../services/logging-service.js` - ログ
- ✅ `./internal/credential1-processor.js` - クレデンシャル処理
- ✅ `./internal/credential2-processor.js` - クレデンシャル処理
- ✅ `../tool-box/x509/x509.js` - X.509処理

**修正必要:**
- 🔧 siopv2への参照削除

### src/usecases/oid4vp-repository.ts
**完全書き換え必要:**
- ❌ `../orbit-db/index.js` - OrbitDB依存を完全削除
- 🔧 SQLiteベースの実装に全面書き換え

**保持する依存:**
- ✅ `uuid` - UUID生成
- ✅ `./types.js` - 型定義
- ✅ `../utils/data-util.js` - ユーティリティ
- ✅ `../tool-box/index.js` - Result型
- ✅ `../oid4vp/index.js` - OID4VP型

## OrbitDB依存の詳細

### KeyValues型の使用箇所
1. `oid4vp-repository.ts`
   - `initResponseEndpointDatastore(openedKeyValues: KeyValues)`
   - `initVerifierDatastore(openedKeyValues: KeyValues)`
   - `initSessionRepository(keyValue: OpenedKeyValue)`
   - `initPostStateRepository(keyValue: OpenedKeyValue)`

### データストア操作
- `requestsAtResponseEndpoint` - リクエスト保存
- `responsesAtResponseEndpoint` - レスポンス保存
- `requestsAtVerifier` - Verifierリクエスト
- `presentationDefinitions` - Presentation Definition
- `sessions` - セッション管理
- `states` - 状態管理

→ これら全てをSQLiteテーブルに置き換え

## 削除対象ファイルの最終リスト

### OrbitDB関連 (完全削除)
1. `src/orbit-db/orbitdb-service.ts`
2. `src/orbit-db/orbitdb-service.types.ts`
3. `src/orbit-db/index.ts`

### libp2p/IPFS関連 (完全削除)
4. `src/helpers/libp2p-helper.ts`
5. `src/helpers/ipfs-helper.ts`
6. `src/helpers/get-peer-id.ts`

### ローカルデータ同期関連 (完全削除)
7. `src/local-data/replication.ts`
8. `src/local-data/syncer.ts`
9. `src/local-data/on-update.ts`
10. `src/local-data/local-data-handler.ts`
11. `src/local-data/sqlite-client.ts` (旧版削除、新版作成)

### Boolcheck固有機能 (完全削除)
12. `src/usecases/claim-interactor.ts`
13. `src/usecases/claim-repository.ts`
14. `src/usecases/internal/select-url.ts`
15. `src/usecases/internal/api-node-caller.ts`
16. `src/routes/main-routes.ts`
17. `src/routes/admin-routes.ts`
18. `src/services/ogp-service.ts`

### SIOPv2関連 (完全削除)
19. `src/oid4vp/siop-v2.ts`

## 合計削除ファイル数: 19

## 新規作成ファイル

1. `src/database/sqlite-client.ts` - 新SQLiteクライアント
2. `src/database/schema.ts` - スキーマ定義
3. `src/database/migrations.ts` - マイグレーション(オプション)

## 修正が必要なファイル

### 大規模修正
1. `src/api.ts` - 3ノード分岐削除、OrbitDB初期化削除
2. `src/usecases/oid4vp-repository.ts` - 全面書き換え(OrbitDB→SQLite)

### 中規模修正
3. `src/usecases/oid4vp-interactor.ts` - siopv2削除、API簡素化
4. `src/routes/oid4vp-routes.ts` - claim-interactor削除

### 小規模修正
5. `src/types/app-types.ts` - 不要な型削除
6. `src/usecases/types.ts` - Boolcheck型削除
7. `src/routes/types.ts` - OID4VP型のみ残す
8. `src/routes/presenters.ts` - OID4VP関連のみ残す
9. `src/index.ts` - エントリポイント簡素化

## package.json 依存関係の整理

### 削除候補
- `@orbitdb/core` - OrbitDB削除により不要
- `blockstore-level` - OrbitDB依存
- `helia` - IPFS削除により不要
- `@chainsafe/libp2p-gossipsub` - libp2p削除により不要
- `puppeteer` - OGP取得削除により不要
- `open-graph-scraper` - OGP取得削除により不要

### 保持
- `koa`, `koa-router`, `koa-body`, `koa-session` - Webフレームワーク
- `@koa/cors` - CORS
- `sqlite`, `sqlite3` - データベース
- `jose` - JWT/JWK
- `@meeco/sd-jwt` - SD-JWT
- `pkijs` - X.509証明書
- `uuid` - UUID生成
- `winston` - ロギング
- `dotenv` - 環境変数
- `typescript` - TypeScript

## 次のステップ

Phase 2に進み、削除作業を実施します。
削除順序:
1. OrbitDB関連ファイル
2. libp2p/IPFS関連ファイル
3. ローカルデータ同期関連ファイル
4. Boolcheck固有機能ファイル
5. SIOPv2ファイル

各削除後にビルドして影響範囲を確認します。
