# 管理画面（デバッグインターフェース）仕様書

## 概要

開発・デバッグ用の管理画面を提供し、データベースの内容を確認・操作できる機能を実装します。

## セキュリティ考慮事項

**重要**: この機能は開発・デバッグ専用です。本番環境では無効化する必要があります。

### アクセス制御

1. **環境変数による有効化/無効化**
   - `ADMIN_DEBUG_ENABLED=true` で有効化
   - デフォルトは無効（本番環境での誤使用を防止）

2. **Basic認証によるアクセス制限**
   - 環境変数で認証情報を設定
   - `ADMIN_DEBUG_USERNAME=admin`
   - `ADMIN_DEBUG_PASSWORD=<strong-password>`

3. **IPアドレス制限（オプション）**
   - localhostからのみアクセス可能
   - 開発環境では`127.0.0.1`と`::1`のみ許可

## 機能仕様

### 1. ダッシュボード (`/admin`)

**目的**: データベースの概要とクイックアクセス

**表示内容**:
- データベースファイル情報（パス、サイズ）
- 各テーブルのレコード数
  - `requests`: Authorization Request一覧
  - `response_codes`: Response Code一覧
  - `post_states`: Post State一覧
  - `sessions`: セッション一覧
- 最終更新時刻

**UI要素**:
- 各テーブルへのリンク
- データベースクリアボタン（確認ダイアログ付き）

### 2. Requestsテーブル (`/admin/requests`)

**目的**: Authorization Requestの詳細確認

**表示カラム**:
| カラム名 | 説明 | 表示形式 |
|---------|------|---------|
| id | Request ID | UUID（短縮表示） |
| response_type | Response Type | `vp_token` |
| created_at | 作成日時 | 日本語フォーマット |
| expires_at | 有効期限 | 日本語フォーマット + 残り時間 |
| transaction_id | Transaction ID | UUID（短縮表示） |
| dcql_query | DCQLクエリ | JSON整形表示（展開可能） |

**機能**:
- ページネーション（20件/ページ）
- Request IDでの検索
- 有効期限でのフィルタリング（有効/期限切れ）
- 詳細表示（モーダルまたは別ページ）
- 削除機能（個別・一括）

### 3. Post Statesテーブル (`/admin/states`)

**目的**: Authorization Requestの状態追跡

**表示カラム**:
| カラム名 | 説明 | 表示形式 |
|---------|------|---------|
| request_id | Request ID | UUID（短縮表示） |
| value | 状態 | バッジ表示（色分け） |
| created_at | 作成日時 | 日本語フォーマット |
| expires_at | 有効期限 | 日本語フォーマット |

**状態の色分け**:
- `started`: 青（info）
- `committed`: 緑（success）
- `expired`: 赤（danger）
- `invalid_submission`: オレンジ（warning）

**機能**:
- 状態でのフィルタリング
- Request IDでの検索
- タイムライン表示（同一Request IDの状態遷移）

### 4. Sessionsテーブル (`/admin/sessions`)

**目的**: ユーザーセッションの確認

**表示カラム**:
| カラム名 | 説明 | 表示形式 |
|---------|------|---------|
| session_id | Session ID | ハッシュ値（短縮表示） |
| request_id | Request ID | UUID（短縮表示） |
| credential_data | Credential Data | JSON整形表示（展開可能） |
| created_at | 作成日時 | 日本語フォーマット |
| expires_at | 有効期限 | 日本語フォーマット |

**機能**:
- Session IDでの検索
- Request IDでの関連検索
- Credential Dataの詳細表示

### 5. Response Codesテーブル (`/admin/response-codes`)

**目的**: Response Codeの管理

**表示カラム**:
| カラム名 | 説明 | 表示形式 |
|---------|------|---------|
| code | Response Code | UUID（短縮表示） |
| request_id | Request ID | UUID（短縮表示） |
| payload | ペイロード | JSON整形表示（展開可能） |
| created_at | 作成日時 | 日本語フォーマット |
| expires_at | 有効期限 | 日本語フォーマット |
| used | 使用済みフラグ | チェックマーク表示 |

**機能**:
- 使用済み/未使用でのフィルタリング
- Request IDでの関連検索

### 6. データベース操作 (`/admin/actions`)

**目的**: データベースのメンテナンス

**機能**:
1. **期限切れレコードの削除**
   - `expires_at < 現在時刻` のレコードを全テーブルから削除
   - 削除件数を表示

2. **全データクリア**
   - 全テーブルのレコードを削除（テーブル構造は維持）
   - 確認ダイアログ + パスワード再入力

3. **データベースバックアップ**
   - SQLiteファイルのコピー作成
   - タイムスタンプ付きファイル名

4. **SQL実行（上級者向け）**
   - 任意のSQLクエリを実行
   - SELECT文のみ許可（データ破壊防止）

## 実装方針

### アーキテクチャ

```
src/
├── routes/
│   └── admin-routes.ts        # 管理画面ルーティング
├── middleware/
│   └── admin-auth.ts          # 認証ミドルウェア
└── usecases/
    └── admin-interactor.ts    # 管理画面ビジネスロジック

views/
└── admin/
    ├── dashboard.ejs          # ダッシュボード
    ├── requests.ejs           # Requestsテーブル
    ├── states.ejs             # Post Statesテーブル
    ├── sessions.ejs           # Sessionsテーブル
    ├── response-codes.ejs     # Response Codesテーブル
    └── actions.ejs            # データベース操作
```

### 技術スタック

- **認証**: koa-basic-auth
- **UI**: Bootstrap 5 + DataTables.js（テーブル表示・検索・ソート）
- **アイコン**: Bootstrap Icons
- **日時フォーマット**: Day.js（軽量な日時ライブラリ）

### 環境変数

```bash
# .env
ADMIN_DEBUG_ENABLED=true
ADMIN_DEBUG_USERNAME=admin
ADMIN_DEBUG_PASSWORD=your-strong-password-here
ADMIN_DEBUG_ALLOWED_IPS=127.0.0.1,::1  # カンマ区切り
```

## 実装手順

### Phase 1: 基本構造
1. 環境変数設定
2. 認証ミドルウェア実装
3. 管理画面ルーティング設定
4. ダッシュボードUI実装

### Phase 2: テーブル表示
1. Requestsテーブル表示
2. Post Statesテーブル表示
3. Sessionsテーブル表示
4. Response Codesテーブル表示

### Phase 3: 検索・フィルタリング
1. DataTables.js統合
2. 検索機能実装
3. フィルタリング機能実装

### Phase 4: データ操作
1. 期限切れレコード削除
2. 全データクリア
3. バックアップ機能

### Phase 5: 高度な機能
1. JSON整形表示
2. タイムライン表示
3. SQL実行機能

## UI設計

### ダッシュボード画面例

```
┌────────────────────────────────────────────────────┐
│  OID4VP Verifier - Admin Dashboard                │
├────────────────────────────────────────────────────┤
│                                                    │
│  📊 Database Overview                             │
│                                                    │
│  Path: ./oid4vp.sqlite                            │
│  Size: 245 KB                                     │
│  Last Modified: 2025-11-20 16:15:30               │
│                                                    │
│  ┌──────────────────────┬────────────────────┐   │
│  │ Table                │ Record Count       │   │
│  ├──────────────────────┼────────────────────┤   │
│  │ 📝 Requests         │ 15 records         │   │
│  │ 📊 Post States      │ 18 records         │   │
│  │ 👤 Sessions         │ 8 records          │   │
│  │ 🎫 Response Codes   │ 12 records         │   │
│  └──────────────────────┴────────────────────┘   │
│                                                    │
│  [View Requests] [View States] [View Sessions]   │
│  [Database Actions] [Clear Expired Records]      │
│                                                    │
└────────────────────────────────────────────────────┘
```

### テーブル表示画面例

```
┌────────────────────────────────────────────────────┐
│  Requests Table                        [Back]      │
├────────────────────────────────────────────────────┤
│                                                    │
│  Search: [____________]  Filter: [All ▼]         │
│                                                    │
│  ┌─────────┬──────────┬───────────┬──────────┐  │
│  │ ID      │ Type     │ Created   │ Expires  │  │
│  ├─────────┼──────────┼───────────┼──────────┤  │
│  │ 0fff... │ vp_token │ 16:10:30  │ 17:10:30 │  │
│  │ c6c9... │ vp_token │ 15:55:12  │ 16:55:12 │  │
│  │ ...     │ ...      │ ...       │ ...      │  │
│  └─────────┴──────────┴───────────┴──────────┘  │
│                                                    │
│  Showing 1-20 of 45 records                       │
│  [Previous] [1] [2] [3] [Next]                   │
│                                                    │
└────────────────────────────────────────────────────┘
```

## セキュリティチェックリスト

- [ ] 環境変数でデフォルト無効化
- [ ] Basic認証の実装
- [ ] IPアドレス制限
- [ ] SQL Injection対策（プリペアドステートメント使用）
- [ ] CSRF対策（koa-csrf使用）
- [ ] データ操作前の確認ダイアログ
- [ ] 本番環境での無効化確認
- [ ] アクセスログの記録

## パフォーマンス考慮事項

- ページネーション実装（大量データ対策）
- インデックスの活用
- JSON展開の遅延ロード
- キャッシュ機能（読み取り専用データ）

## 代替案

### 簡易版（最小実装）

環境変数とBasic認証のみで、全テーブルを1ページに表示する簡易版：

**実装内容**:
- `/admin` 1ページのみ
- 各テーブルの直近10件を表示
- 検索・フィルタリングなし
- JSON整形表示のみ

**メリット**:
- 実装工数が少ない（1-2時間）
- デバッグには十分な情報量

**デメリット**:
- 大量データには不向き
- 高度な検索ができない

### 外部ツール利用

SQLiteブラウザツールを使用する選択肢：

**推奨ツール**:
- DB Browser for SQLite（GUI）
- sqlite3 CLI（コマンドライン）
- VS Code拡張機能（SQLite Viewer）

**メリット**:
- 実装不要
- 高機能

**デメリット**:
- 開発環境へのアクセスが必要
- チーム間での共有が困難

## 実装状況 (2025-11-20)

### ✅ 完了した実装

#### 1. 基本構造
- ✅ 環境変数設定 (`ADMIN_DEBUG_ENABLED`, `ADMIN_DEBUG_USERNAME`, `ADMIN_DEBUG_PASSWORD`)
- ✅ カスタムBasic認証ミドルウェア実装 (`src/middleware/admin-auth.ts`)
  - koa-basic-authの代わりにカスタム実装を使用（ESM互換性問題のため）
- ✅ 管理画面ルーティング設定 (`src/routes/admin-routes.ts`)
- ✅ ビジネスロジック実装 (`src/usecases/admin-interactor.ts`)

#### 2. ダッシュボードUI
- ✅ 統合ダッシュボード (`/admin`)
- ✅ Bootstrap 5 + DataTables.jsによるUI実装
- ✅ データベース統計表示（各テーブルのレコード数）
- ✅ 全テーブルを1ページに統合表示

#### 3. テーブル表示

**Requestsテーブル**:
- ✅ ID, Nonce, Response Type, Transaction ID, Created At, Expires At, DCQL Query
- ✅ 水平スクロール対応
- ✅ DataTablesによるソート・ページネーション

**Post Statesテーブル**:
- ✅ ID, State, Target ID, Created At, Expires At
- ✅ 状態のバッジ表示（色分け）

**Sessionsテーブル**:
- ✅ ID, Request ID, State, Credential Data, Created At, Expires At
- ✅ 状態のバッジ表示

**Response Codesテーブル**:
- ✅ Code, Request ID, Payload, Created At, Expires At, Used
- ✅ 使用済みフラグのチェックマーク表示

#### 4. データ操作機能
- ✅ 期限切れレコードの削除 (`/admin/delete-expired`)
- ✅ 全データクリア (`/admin/clear-all`)
- ✅ 確認ダイアログ（クライアントサイド）

### ⚠️ 発見された問題

#### 重大な設計問題: リポジトリ層のデータ保存不整合

`src/usecases/oid4vp-repository.ts`に2つの異なる`saveRequest`メソッドが存在し、保存されるフィールドが異なることが判明：

**1. ResponseEndpointDatastore.saveRequest (37-52行目)**
```typescript
INSERT OR REPLACE INTO requests
(id, response_type, redirect_uri_returned_by_response_uri, transaction_id,
 created_at, expires_at, encryption_private_jwk, dcql_query)
```
- ✅ 保存: response_type, dcql_query, transaction_id
- ❌ **未保存: nonce**

**2. VerifierDatastore.saveRequest (119-134行目)**
```typescript
INSERT OR REPLACE INTO requests
(id, nonce, session, transaction_id, created_at, expires_at,
 consumed_at, encryption_private_jwk)
```
- ✅ 保存: nonce, session, consumed_at
- ❌ **未保存: response_type, dcql_query**

**影響**:
- リクエストの種類によって保存されるフィールドが異なる
- 管理画面で一部のフィールドがN/Aと表示される
- データベーススキーマは正しいが、アプリケーション層でデータが不完全

**根本原因**:
- 2つのデータストア（ResponseEndpoint用とVerifier用）が同じテーブルに書き込んでいる
- それぞれが異なるフィールドセットを想定している
- `INSERT OR REPLACE`により後から書き込まれた方が一部フィールドをNULLで上書きする可能性

### 🔄 保留中の作業

#### データ保存の統一化が必要

以下の修正が必要だが、設計全体の見直しが必要と判断し一旦保留：

1. **両方のsaveRequestメソッドを統合または調整**
   - すべてのフィールドを保存するように修正
   - または、用途に応じてテーブルを分離

2. **データモデルの整合性確認**
   - VpRequest型とVpRequestAtVerifier型の関係を明確化
   - 必要に応じてスキーマ変更

3. **トランザクション管理の見直し**
   - INSERT OR REPLACEの使用が適切か検証
   - 更新と挿入のロジック分離

### 📋 技術的な詳細

#### 実装したファイル
- `src/middleware/admin-auth.ts` - Basic認証ミドルウェア（カスタム実装）
- `src/usecases/admin-interactor.ts` - 管理機能のビジネスロジック
- `src/routes/admin-routes.ts` - 管理画面のルーティング
- `views/admin/dashboard.ejs` - 統合ダッシュボードUI
- `src/api.ts` - adminルートの登録

#### 修正したファイル
- `src/database/schema.ts` - スキーマ確認
- `package.json` - koa-basic-authを削除

#### 使用している技術
- **認証**: カスタムBasic認証（Buffer.from base64デコード）
- **UI**: Bootstrap 5 + DataTables.js
- **データベースAPI**: sqlite（Promise-based async/await）

### 次のステップ（保留）

データ保存の問題を解決するには、以下のアプローチを検討する必要がある：

1. **アーキテクチャレビュー**
   - ResponseEndpointとVerifierの責務を明確化
   - データモデルの統一または分離を決定

2. **リファクタリング**
   - 2つのsaveRequestメソッドの統合
   - または、テーブル分離（requests_endpoint, requests_verifier）

3. **テストの追加**
   - データ保存の整合性を確認するテスト
   - エンドツーエンドのテスト

## まとめ

管理画面の基本機能は完成したが、根本的なデータ保存の問題が発見された。
この問題は設計全体に関わるため、一旦管理画面の開発を中断し、
データモデルとリポジトリ層の設計を見直す必要がある。

**完了した機能**:
- ✅ 管理画面のUI（全テーブル表示、統計、データ操作）
- ✅ Basic認証によるアクセス制御
- ✅ DataTablesによる高度なテーブル表示

**未解決の問題**:
- ⚠️ リポジトリ層のデータ保存不整合
- ⚠️ 2つのsaveRequestメソッドの役割の明確化が必要
