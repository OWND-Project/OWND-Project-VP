# OID4VP Verifierへのリファクタリング計画

## 概要

Bool Checkシステムから純粋なOID4VP Verifierシステムへのリファクタリング。
分散データベース(OrbitDB)と3ノード構成を削除し、シンプルなSQLiteベースの単一ノード構成に変更する。

## 目標

**残す機能:**
- OID4VP Verifier機能
  - Presentation Definition作成
  - VP Token受信・検証
  - SD-JWT処理
  - X.509証明書チェーン検証

**削除する機能:**
- OrbitDB関連の分散データベース機能
- Boolcheck固有機能(URL登録、Claim管理)
- SIOPv2関連機能
- 3ノード構成(BOOL_NODE, API_NODE, VERIFIER_NODE)

**新しいアーキテクチャ:**
- 単一ノード構成
- SQLiteによるセッション管理
- OID4VPプロトコルのみに特化

---

## 現状分析

### 保持するコード

#### OID4VP関連 (src/oid4vp/)
- ✅ `auth-request.ts` - Presentation Definition生成、Authorization Request生成
- ✅ `response-endpoint.ts` - VP Token受信エンドポイント
- ✅ `verifier.ts` - Verifier機能のコア実装
- ✅ `verify.ts` - VP/VC検証ロジック
- ✅ `types.ts` - OID4VP型定義
- ✅ `jwk-util.ts` - JWK関連ユーティリティ
- ❌ `siop-v2.ts` - SIOPv2は削除対象
- ✅ `index.ts` - エクスポート(修正必要)

#### ツール関連 (src/tool-box/)
- ✅ `verify.ts` - VP/VC署名検証
- ✅ `x509/x509.ts` - X.509証明書処理
- ✅ `x509/issue.ts` - 証明書発行
- ✅ `x509/revoke.ts` - 証明書失効
- ✅ `x509/constant.ts` - 定数定義
- ✅ `datetime.ts` - 日時処理
- ✅ `generic-result.ts` - Result型定義
- ✅ `util.ts` - ユーティリティ
- ✅ `index.ts` - エクスポート

#### ヘルパー関連 (src/helpers/)
- ✅ `jwt-helper.ts` - JWT処理
- ❌ `libp2p-helper.ts` - libp2pは不要(OrbitDB依存)
- ❌ `ipfs-helper.ts` - IPFSは不要(OrbitDB依存)
- ❌ `get-peer-id.ts` - Peer IDは不要(OrbitDB依存)

#### サービス関連 (src/services/)
- ✅ `logging-service.ts` - ロギング
- ❌ `ogp-service.ts` - OGP取得はBoolcheck固有

#### ミドルウェア (src/middlewares/)
- ✅ `routes-logger.ts` - ルートロガー

### 削除するコード

#### OrbitDB関連
- ❌ `src/orbit-db/` - 全体削除
  - `orbitdb-service.ts`
  - `orbitdb-service.types.ts`
  - `index.ts`

#### ローカルデータ関連
- ❌ `src/local-data/` - 大部分削除、一部はSQLiteセッション管理に置き換え
  - `replication.ts` - 削除
  - `syncer.ts` - 削除
  - `on-update.ts` - 削除
  - `local-data-handler.ts` - 削除(Boolcheck固有のデータハンドラ)
  - `sqlite-client.ts` - 削除後、新規にセッション管理用を作成

#### Boolcheck固有機能
- ❌ `src/usecases/claim-interactor.ts` - 削除
- ❌ `src/usecases/claim-repository.ts` - 削除
- ❌ `src/usecases/internal/select-url.ts` - 削除
- ❌ `src/usecases/internal/api-node-caller.ts` - 削除
- ❌ `src/routes/main-routes.ts` - 削除(Boolcheck固有API)
- ❌ `src/routes/admin-routes.ts` - 削除(OrbitDB管理API)

#### その他
- ❌ `src/oid4vp/siop-v2.ts` - SIOPv2削除
- ❌ `src/helpers/libp2p-helper.ts` - libp2p不要
- ❌ `src/helpers/ipfs-helper.ts` - IPFS不要
- ❌ `src/helpers/get-peer-id.ts` - Peer ID不要
- ❌ `src/services/ogp-service.ts` - OGP不要

### 修正が必要なコード

#### コア部分
- 🔧 `src/api.ts` - 3ノード分岐削除、単一ノード構成に簡素化
- 🔧 `src/index.ts` - エントリポイント簡素化
- 🔧 `src/types/app-types.ts` - 不要な型削除、OID4VP特化型のみ残す

#### ユースケース
- 🔧 `src/usecases/oid4vp-interactor.ts` - Boolcheck依存削除
- 🔧 `src/usecases/oid4vp-repository.ts` - OrbitDB依存削除、SQLiteに変更
- 🔧 `src/usecases/internal/credential1-processor.ts` - 保持(要確認)
- 🔧 `src/usecases/internal/credential2-processor.ts` - 保持(要確認)
- 🔧 `src/usecases/internal/input-descriptor.ts` - 保持
- 🔧 `src/usecases/internal/error-handlers.ts` - 保持
- 🔧 `src/usecases/internal/internal-helpers.ts` - 保持(要確認)
- 🔧 `src/usecases/types.ts` - Boolcheck固有型削除

#### ルーティング
- 🔧 `src/routes/oid4vp-routes.ts` - OID4VP APIのみ残す、Boolcheck依存削除
- 🔧 `src/routes/presenters.ts` - OID4VP関連のみ残す
- 🔧 `src/routes/types.ts` - OID4VP関連のみ残す
- 🔧 `src/routes/error-handler.ts` - 保持

#### ユーティリティ
- ✅ `src/utils/random-util.ts` - 保持
- ❓ `src/utils/url-util.ts` - 確認必要
- ❓ `src/utils/data-util.ts` - 確認必要

---

## 新アーキテクチャ

### システム構成

```
┌─────────────────────────────────────────┐
│        OID4VP Verifier Application      │
├─────────────────────────────────────────┤
│                                         │
│  ┌──────────────────────────────────┐  │
│  │   Presentation Layer (Koa)      │  │
│  │   - OID4VP API Routes           │  │
│  │   - Session Management          │  │
│  │   - Error Handling              │  │
│  └──────────┬───────────────────────┘  │
│             │                           │
│  ┌──────────▼───────────────────────┐  │
│  │   Use Case Layer                │  │
│  │   - OID4VP Interactor           │  │
│  │   - Credential Processors       │  │
│  │   - Input Descriptor Matching   │  │
│  └──────────┬───────────────────────┘  │
│             │                           │
│  ┌──────────▼───────────────────────┐  │
│  │   Repository Layer              │  │
│  │   - Session Repository (SQLite) │  │
│  │   - Request Repository (SQLite) │  │
│  └──────────┬───────────────────────┘  │
│             │                           │
│  ┌──────────▼───────────────────────┐  │
│  │   Infrastructure Layer          │  │
│  │   - OID4VP Verifier             │  │
│  │   - VP/VC Verification          │  │
│  │   - X.509 Certificate Handling  │  │
│  │   - SD-JWT Processing           │  │
│  └──────────────────────────────────┘  │
│                                         │
└─────────────────────────────────────────┘
```

### SQLiteスキーマ設計

#### sessions テーブル
```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- セッションID
  request_id TEXT UNIQUE NOT NULL,  -- リクエストID
  state TEXT,                        -- 状態 (started/consumed/committed/expired/canceled)
  vp_token TEXT,                     -- 受信したVP Token
  credential_data TEXT,              -- 抽出したクレデンシャルデータ(JSON)
  created_at INTEGER NOT NULL,       -- 作成日時(Unix timestamp)
  expires_at INTEGER NOT NULL,       -- 有効期限(Unix timestamp)
  consumed_at INTEGER,               -- 消費日時
  committed_at INTEGER               -- コミット日時
);

CREATE INDEX idx_sessions_request_id ON sessions(request_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
```

#### requests テーブル
```sql
CREATE TABLE requests (
  id TEXT PRIMARY KEY,                        -- リクエストID
  presentation_definition TEXT NOT NULL,      -- Presentation Definition(JSON)
  nonce TEXT NOT NULL,                        -- Nonce
  client_id TEXT NOT NULL,                    -- Client ID
  response_uri TEXT NOT NULL,                 -- Response URI
  created_at INTEGER NOT NULL,                -- 作成日時
  expires_at INTEGER NOT NULL                 -- 有効期限
);

CREATE INDEX idx_requests_expires_at ON requests(expires_at);
```

#### response_codes テーブル
```sql
CREATE TABLE response_codes (
  code TEXT PRIMARY KEY,             -- レスポンスコード
  request_id TEXT NOT NULL,          -- リクエストID
  vp_token TEXT NOT NULL,            -- VP Token
  created_at INTEGER NOT NULL,       -- 作成日時
  expires_at INTEGER NOT NULL,       -- 有効期限
  used INTEGER DEFAULT 0,            -- 使用済みフラグ
  FOREIGN KEY (request_id) REFERENCES requests(id)
);

CREATE INDEX idx_response_codes_expires_at ON response_codes(expires_at);
```

### ディレクトリ構造(リファクタリング後)

```
src/
├── api.ts                           # アプリケーション初期化(簡素化)
├── index.ts                         # エントリポイント
├── types/
│   └── app-types.ts                 # アプリケーション型定義(簡素化)
├── routes/
│   ├── oid4vp-routes.ts             # OID4VP API
│   ├── presenters.ts                # レスポンス整形(OID4VPのみ)
│   ├── types.ts                     # ルート型定義(OID4VPのみ)
│   └── error-handler.ts             # エラーハンドリング
├── usecases/
│   ├── oid4vp-interactor.ts         # OID4VPビジネスロジック(修正)
│   ├── oid4vp-repository.ts         # OID4VPリポジトリ(SQLiteに変更)
│   ├── types.ts                     # ユースケース型定義(簡素化)
│   └── internal/
│       ├── credential1-processor.ts # クレデンシャル処理
│       ├── credential2-processor.ts # クレデンシャル処理
│       ├── input-descriptor.ts      # Input Descriptor処理
│       ├── error-handlers.ts        # エラーハンドラ
│       └── internal-helpers.ts      # ヘルパー関数
├── database/
│   ├── sqlite-client.ts             # SQLiteクライアント(新規)
│   └── schema.ts                    # スキーマ定義(新規)
├── oid4vp/
│   ├── auth-request.ts              # 認証リクエスト生成
│   ├── response-endpoint.ts         # レスポンスエンドポイント
│   ├── verifier.ts                  # Verifier実装
│   ├── verify.ts                    # VP/VC検証
│   ├── types.ts                     # OID4VP型定義
│   ├── jwk-util.ts                  # JWKユーティリティ
│   └── index.ts                     # エクスポート
├── helpers/
│   └── jwt-helper.ts                # JWT処理
├── services/
│   └── logging-service.ts           # ロギング
├── middlewares/
│   └── routes-logger.ts             # ルートロガー
├── tool-box/
│   ├── verify.ts                    # 署名検証
│   ├── x509/
│   │   ├── x509.ts                  # X.509証明書処理
│   │   ├── issue.ts                 # 証明書発行
│   │   ├── revoke.ts                # 証明書失効
│   │   └── constant.ts              # 定数
│   ├── datetime.ts                  # 日時処理
│   ├── generic-result.ts            # Result型
│   ├── util.ts                      # ユーティリティ
│   └── index.ts                     # エクスポート
└── utils/
    └── random-util.ts               # ランダム生成
```

---

## 実装手順

### Phase 1: 準備と分析 (1-2時間)

1. ✅ リファクタリング計画書作成
2. ⬜ 依存関係の詳細分析
3. ⬜ 削除対象ファイルの最終確認

### Phase 2: 削除作業 (2-3時間)

1. ⬜ OrbitDB関連の削除
   - `src/orbit-db/` 全体
   - `src/local-data/replication.ts`
   - `src/local-data/syncer.ts`
   - `src/local-data/on-update.ts`
   - `src/helpers/libp2p-helper.ts`
   - `src/helpers/ipfs-helper.ts`
   - `src/helpers/get-peer-id.ts`

2. ⬜ Boolcheck固有機能の削除
   - `src/usecases/claim-interactor.ts`
   - `src/usecases/claim-repository.ts`
   - `src/usecases/internal/select-url.ts`
   - `src/usecases/internal/api-node-caller.ts`
   - `src/routes/main-routes.ts`
   - `src/routes/admin-routes.ts`
   - `src/local-data/local-data-handler.ts`
   - `src/services/ogp-service.ts`

3. ⬜ SIOPv2関連の削除
   - `src/oid4vp/siop-v2.ts`

### Phase 3: 新機能実装 (3-4時間)

1. ⬜ SQLiteセッション管理実装
   - `src/database/sqlite-client.ts` 作成
   - `src/database/schema.ts` 作成
   - マイグレーション機能実装

2. ⬜ OID4VPリポジトリの書き換え
   - `src/usecases/oid4vp-repository.ts` をSQLiteベースに変更
   - OrbitDB依存を完全削除

3. ⬜ api.ts の簡素化
   - 3ノード分岐削除
   - 単一ノード構成に変更
   - OrbitDB初期化削除

### Phase 4: 統合と修正 (2-3時間)

1. ⬜ `src/usecases/oid4vp-interactor.ts` 修正
   - Boolcheck依存削除
   - 新しいリポジトリ層に適合

2. ⬜ `src/routes/oid4vp-routes.ts` 修正
   - 不要な処理削除
   - エラーハンドリング調整

3. ⬜ 型定義の整理
   - `src/types/app-types.ts` 簡素化
   - `src/usecases/types.ts` 簡素化
   - `src/routes/types.ts` 簡素化

### Phase 5: クリーンアップとテスト (1-2時間)

1. ⬜ 未使用コードの削除
2. ⬜ import文の整理
3. ⬜ package.json の依存関係整理
4. ⬜ 動作確認
5. ⬜ ドキュメント更新

---

## マイルストーン

### Milestone 1: 削除完了
- OrbitDB関連コード完全削除
- Boolcheck固有機能完全削除
- SIOPv2削除

### Milestone 2: 新アーキテクチャ実装完了
- SQLiteセッション管理実装
- OID4VPリポジトリ層SQLite化
- 単一ノード構成への移行

### Milestone 3: 統合完了
- すべてのOID4VP機能が動作
- エラーハンドリング正常
- ビルド成功

### Milestone 4: 最終クリーンアップ完了
- 未使用コード完全削除
- 依存関係整理
- ドキュメント更新

---

## リスクと対策

### リスク1: 予期せぬ依存関係
**対策**: 段階的に削除し、各段階でビルド確認

### リスク2: OID4VP機能の破損
**対策**: 各Phase完了時に動作確認

### リスク3: データマイグレーション
**対策**: 新システムはクリーンスタート(既存データ不要)

---

## 完了基準

- ✅ OrbitDB関連コード完全削除
- ✅ Boolcheck固有機能完全削除
- ✅ 3ノード構成削除、単一ノード化
- ✅ SQLiteセッション管理実装
- ✅ OID4VP機能すべて動作
- ✅ ビルドエラーなし
- ✅ 未使用依存関係削除
- ✅ ドキュメント更新

---

## 次のステップ

1. この計画のレビューと承認
2. Phase 1開始: 依存関係分析
3. 段階的な実装実行
