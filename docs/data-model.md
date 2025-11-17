# OID4VP Verifier - データモデル

## 概要

OID4VP Verifierシステムは、SQLiteデータベースを使用してOID4VPプロトコルのセッション管理とリクエスト情報を永続化します。このドキュメントでは、データベーススキーマ、エンティティのライフサイクル、リレーションシップについて詳述します。

## データアーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│              SQLite Database Layer                  │
│         (ACID Transactions, WAL Mode)               │
├─────────────────────────────────────────────────────┤
│  Tables:                                            │
│  - sessions          (OID4VP session management)    │
│  - requests          (VP request metadata)          │
│  - response_codes    (Authorization response codes) │
│  - presentation_definitions (PD storage)            │
│  - post_states       (Processing state tracking)    │
└─────────────────────────────────────────────────────┘
```

### 設計原則

1. **一時的なデータストレージ**: すべてのデータは有効期限付き
2. **自動クリーンアップ**: 期限切れデータは自動的に削除
3. **WALモード**: 並行アクセス性能の最適化
4. **ACID特性**: トランザクション完全性の保証

---

## テーブル定義

### 1. sessions テーブル

OID4VPセッションの状態管理を行います。

#### スキーマ

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,              -- セッションID (UUID)
  request_id TEXT UNIQUE NOT NULL,  -- リクエストID
  state TEXT NOT NULL,              -- 状態 (started/consumed/committed/expired/canceled)
  vp_token TEXT,                    -- 受信したVP Token (JSON)
  credential_data TEXT,             -- 抽出したクレデンシャルデータ (JSON)
  created_at INTEGER NOT NULL,      -- 作成日時 (Unix timestamp)
  expires_at INTEGER NOT NULL,      -- 有効期限 (Unix timestamp)
  consumed_at INTEGER,              -- VP Token受信日時
  committed_at INTEGER              -- データコミット日時
);

CREATE INDEX idx_sessions_request_id ON sessions(request_id);
CREATE INDEX idx_sessions_expires_at ON sessions(expires_at);
CREATE INDEX idx_sessions_state ON sessions(state);
```

#### フィールド説明

| フィールド | 型 | NULL許可 | 説明 |
|-----------|-----|---------|------|
| `id` | TEXT | NO | セッションの一意識別子 (UUID v4) |
| `request_id` | TEXT | NO | 関連するリクエストID |
| `state` | TEXT | NO | セッション状態 (enum) |
| `vp_token` | TEXT | YES | 受信したVP Token (JSON文字列) |
| `credential_data` | TEXT | YES | 抽出したクレデンシャルデータ (JSON文字列) |
| `created_at` | INTEGER | NO | セッション作成時刻 (秒単位) |
| `expires_at` | INTEGER | NO | セッション有効期限 (秒単位) |
| `consumed_at` | INTEGER | YES | VP Token受信時刻 |
| `committed_at` | INTEGER | YES | データコミット時刻 |

#### 状態遷移

```
started → consumed → committed
   ↓         ↓          ↓
expired  expired    expired
   ↓         ↓
canceled  canceled
```

- **started**: セッション開始、Authorization Request生成済み
- **consumed**: VP Token受信、検証完了
- **committed**: クレデンシャルデータ確定
- **expired**: 有効期限切れ
- **canceled**: ユーザーによるキャンセル

#### データ例

```json
{
  "id": "550e8400-e29b-41d4-a716-446655440000",
  "request_id": "req_abc123",
  "state": "consumed",
  "vp_token": "{\"vp\":{\"verifiableCredential\":[...]}}",
  "credential_data": "{\"idToken\":\"...\",\"claimJwt\":\"...\"}",
  "created_at": 1700000000,
  "expires_at": 1700000600,
  "consumed_at": 1700000123,
  "committed_at": null
}
```

---

### 2. requests テーブル

OID4VP Authorization Requestのメタデータを保存します。

#### スキーマ

```sql
CREATE TABLE requests (
  id TEXT PRIMARY KEY,                   -- リクエストID (UUID)
  response_type TEXT NOT NULL,           -- レスポンスタイプ ("vp_token id_token")
  redirect_uri_returned_by_response_uri TEXT,  -- Response URIから返却されるRedirect URI
  transaction_id TEXT,                   -- トランザクションID (オプション)
  created_at INTEGER NOT NULL,           -- 作成日時
  expires_at INTEGER NOT NULL            -- 有効期限
);

CREATE INDEX idx_requests_expires_at ON requests(expires_at);
CREATE INDEX idx_requests_transaction_id ON requests(transaction_id);
```

#### フィールド説明

| フィールド | 型 | NULL許可 | 説明 |
|-----------|-----|---------|------|
| `id` | TEXT | NO | リクエストの一意識別子 |
| `response_type` | TEXT | NO | OID4VPレスポンスタイプ |
| `redirect_uri_returned_by_response_uri` | TEXT | YES | Response URIエンドポイントから返却されるURI |
| `transaction_id` | TEXT | YES | トランザクション追跡用ID |
| `created_at` | INTEGER | NO | リクエスト作成時刻 |
| `expires_at` | INTEGER | NO | リクエスト有効期限 |

#### データ例

```json
{
  "id": "req_abc123",
  "response_type": "vp_token id_token",
  "redirect_uri_returned_by_response_uri": "https://verifier.example.com/callback",
  "transaction_id": "txn_xyz789",
  "created_at": 1700000000,
  "expires_at": 1700000600
}
```

---

### 3. response_codes テーブル

Authorization Response Codeを管理します（direct_postモード）。

#### スキーマ

```sql
CREATE TABLE response_codes (
  code TEXT PRIMARY KEY,             -- レスポンスコード (UUID)
  request_id TEXT NOT NULL,          -- 関連するリクエストID
  payload TEXT NOT NULL,             -- AuthResponsePayload (JSON)
  created_at INTEGER NOT NULL,       -- 作成日時
  expires_at INTEGER NOT NULL,       -- 有効期限
  used INTEGER DEFAULT 0,            -- 使用済みフラグ (0: 未使用, 1: 使用済み)
  FOREIGN KEY (request_id) REFERENCES requests(id)
);

CREATE INDEX idx_response_codes_request_id ON response_codes(request_id);
CREATE INDEX idx_response_codes_expires_at ON response_codes(expires_at);
CREATE INDEX idx_response_codes_used ON response_codes(used);
```

#### フィールド説明

| フィールド | 型 | NULL許可 | 説明 |
|-----------|-----|---------|------|
| `code` | TEXT | NO | レスポンスコードの一意識別子 |
| `request_id` | TEXT | NO | 関連するリクエストID (外部キー) |
| `payload` | TEXT | NO | AuthResponsePayload (JSON文字列) |
| `created_at` | INTEGER | NO | コード作成時刻 |
| `expires_at` | INTEGER | NO | コード有効期限 |
| `used` | INTEGER | NO | 使用済みフラグ (デフォルト: 0) |

#### AuthResponsePayload構造

```typescript
interface AuthResponsePayload {
  vpToken: string | string[];           // VP Token (単一またはArray)
  presentationSubmission: PresentationSubmission;  // Presentation Submission
  idToken?: string;                     // ID Token (オプション)
}
```

#### データ例

```json
{
  "code": "091535f699ea575c7937fa5f0f454aee",
  "request_id": "req_abc123",
  "payload": "{\"vpToken\":\"eyJ...\",\"presentationSubmission\":{...}}",
  "created_at": 1700000123,
  "expires_at": 1700000723,
  "used": 0
}
```

---

### 4. presentation_definitions テーブル

Presentation Definitionを保存します。

#### スキーマ

```sql
CREATE TABLE presentation_definitions (
  id TEXT PRIMARY KEY,               -- Presentation Definition ID
  definition TEXT NOT NULL,          -- Presentation Definition (JSON)
  created_at INTEGER NOT NULL        -- 作成日時
);

CREATE INDEX idx_presentation_definitions_created_at ON presentation_definitions(created_at);
```

#### フィールド説明

| フィールド | 型 | NULL許可 | 説明 |
|-----------|-----|---------|------|
| `id` | TEXT | NO | Presentation Definitionの一意識別子 |
| `definition` | TEXT | NO | Presentation Definition全体 (JSON文字列) |
| `created_at` | INTEGER | NO | 作成時刻 |

#### Presentation Definition構造

```typescript
interface PresentationDefinition {
  id: string;
  input_descriptors: InputDescriptor[];
  format?: FormatDesignation;
}

interface InputDescriptor {
  id: string;
  format?: FormatDesignation;
  constraints?: Constraints;
}
```

#### データ例

```json
{
  "id": "pd_vp_example",
  "definition": "{\"id\":\"pd_vp_example\",\"input_descriptors\":[...]}",
  "created_at": 1700000000
}
```

---

### 5. post_states テーブル

処理状態の追跡を行います。

#### スキーマ

```sql
CREATE TABLE post_states (
  id TEXT PRIMARY KEY,               -- リクエストID
  value TEXT NOT NULL,               -- 状態値
  target_id TEXT,                    -- ターゲットID (オプション)
  created_at INTEGER NOT NULL,       -- 作成日時
  expires_at INTEGER NOT NULL        -- 有効期限
);

CREATE INDEX idx_post_states_expires_at ON post_states(expires_at);
CREATE INDEX idx_post_states_value ON post_states(value);
```

#### フィールド説明

| フィールド | 型 | NULL許可 | 説明 |
|-----------|-----|---------|------|
| `id` | TEXT | NO | リクエストIDと同一 |
| `value` | TEXT | NO | 状態値 (enum) |
| `target_id` | TEXT | YES | ターゲットリソースID |
| `created_at` | INTEGER | NO | 作成時刻 |
| `expires_at` | INTEGER | NO | 有効期限 |

#### 状態値 (PostStateValue)

- `started`: 処理開始
- `consumed`: VP Token受信完了
- `committed`: データコミット完了
- `expired`: 有効期限切れ
- `canceled`: キャンセル
- `invalid_submission`: 不正な提出

#### データ例

```json
{
  "id": "req_abc123",
  "value": "consumed",
  "target_id": null,
  "created_at": 1700000000,
  "expires_at": 1700000600
}
```

---

## エンティティリレーションシップ

```
┌─────────────────┐
│    sessions     │
│─────────────────│
│ id (PK)         │
│ request_id (UK) │◄───────┐
│ state           │        │
│ vp_token        │        │
│ ...             │        │
└─────────────────┘        │
                           │
                           │
┌─────────────────┐        │
│    requests     │        │
│─────────────────│        │
│ id (PK)         │────────┘
│ response_type   │
│ ...             │
└────────┬────────┘
         │
         │ 1:N
         │
         ▼
┌─────────────────┐
│ response_codes  │
│─────────────────│
│ code (PK)       │
│ request_id (FK) │
│ payload         │
│ used            │
│ ...             │
└─────────────────┘

┌──────────────────────────┐
│ presentation_definitions │
│──────────────────────────│
│ id (PK)                  │
│ definition               │
│ ...                      │
└──────────────────────────┘

┌─────────────────┐
│   post_states   │
│─────────────────│
│ id (PK)         │
│ value           │
│ ...             │
└─────────────────┘
```

---

## データライフサイクル

### 1. Authorization Request生成時

```sql
-- 1. リクエスト作成
INSERT INTO requests (id, response_type, created_at, expires_at)
VALUES ('req_abc123', 'vp_token id_token', 1700000000, 1700000600);

-- 2. Presentation Definition保存
INSERT INTO presentation_definitions (id, definition, created_at)
VALUES ('pd_vp_example', '{"id":"pd_vp_example",...}', 1700000000);

-- 3. セッション作成
INSERT INTO sessions (id, request_id, state, created_at, expires_at)
VALUES ('session_xyz', 'req_abc123', 'started', 1700000000, 1700000600);

-- 4. 処理状態作成
INSERT INTO post_states (id, value, created_at, expires_at)
VALUES ('req_abc123', 'started', 1700000000, 1700000600);
```

### 2. VP Token受信時

```sql
-- 1. Response Code作成
INSERT INTO response_codes (code, request_id, payload, created_at, expires_at, used)
VALUES ('code_abc', 'req_abc123', '{"vpToken":"eyJ..."}', 1700000123, 1700000723, 0);

-- 2. セッション状態更新
UPDATE sessions
SET state = 'consumed',
    vp_token = '{"vp":{"verifiableCredential":[...]}}',
    consumed_at = 1700000123
WHERE request_id = 'req_abc123';

-- 3. 処理状態更新
UPDATE post_states
SET value = 'consumed'
WHERE id = 'req_abc123';
```

### 3. Response Code交換時

```sql
-- 1. Response Code取得・使用済みマーク
UPDATE response_codes
SET used = 1
WHERE code = 'code_abc' AND used = 0;

SELECT * FROM response_codes WHERE code = 'code_abc';

-- 2. クレデンシャルデータ保存
UPDATE sessions
SET credential_data = '{"idToken":"...","claimJwt":"..."}',
    state = 'committed',
    committed_at = 1700000456
WHERE request_id = 'req_abc123';

-- 3. 処理状態更新
UPDATE post_states
SET value = 'committed'
WHERE id = 'req_abc123';
```

### 4. 自動クリーンアップ

```sql
-- 期限切れセッション削除
DELETE FROM sessions
WHERE expires_at < strftime('%s', 'now');

-- 期限切れリクエスト削除
DELETE FROM requests
WHERE expires_at < strftime('%s', 'now');

-- 期限切れResponse Code削除
DELETE FROM response_codes
WHERE expires_at < strftime('%s', 'now');

-- 期限切れ処理状態削除
DELETE FROM post_states
WHERE expires_at < strftime('%s', 'now');
```

---

## インデックス戦略

### 主要クエリパターン

1. **セッション取得 (by request_id)**
```sql
SELECT * FROM sessions WHERE request_id = ? AND expires_at > ?;
-- Index: idx_sessions_request_id
```

2. **リクエスト取得 (by id)**
```sql
SELECT * FROM requests WHERE id = ? AND expires_at > ?;
-- Primary Key: id
```

3. **Response Code取得・検証**
```sql
SELECT * FROM response_codes WHERE code = ? AND used = 0 AND expires_at > ?;
-- Primary Key: code
-- Index: idx_response_codes_used
```

4. **期限切れデータ削除**
```sql
DELETE FROM sessions WHERE expires_at < ?;
-- Index: idx_sessions_expires_at
```

---

## パフォーマンス最適化

### WALモード

```sql
PRAGMA journal_mode = WAL;
PRAGMA busy_timeout = 5000;
```

- **並行アクセス性能**: 読み取りと書き込みの同時実行が可能
- **書き込み性能向上**: ディスクI/Oの削減

### トランザクション戦略

```typescript
// 複数操作をトランザクションでまとめる
await db.run('BEGIN TRANSACTION');
try {
  await db.run('INSERT INTO requests ...');
  await db.run('INSERT INTO sessions ...');
  await db.run('INSERT INTO presentation_definitions ...');
  await db.run('COMMIT');
} catch (error) {
  await db.run('ROLLBACK');
  throw error;
}
```

---

## データ保持ポリシー

### 自動削除タイミング

- **セッション**: 有効期限切れ後、自動削除
- **リクエスト**: 有効期限切れ後、自動削除
- **Response Code**: 有効期限切れ後、自動削除
- **Presentation Definition**: 参照されなくなった時点で削除可能
- **Post States**: 有効期限切れ後、自動削除

### デフォルト有効期限

- **セッション**: 10分 (600秒)
- **リクエスト**: 10分 (600秒)
- **Response Code**: 10分 (600秒)
- **Post States**: 10分 (600秒)

---

## バックアップとリカバリ

### バックアップ戦略

```bash
# SQLiteファイルのバックアップ
sqlite3 oid4vp.sqlite ".backup oid4vp_backup.sqlite"

# WALファイルも含めた完全バックアップ
cp oid4vp.sqlite oid4vp_backup.sqlite
cp oid4vp.sqlite-wal oid4vp_backup.sqlite-wal
cp oid4vp.sqlite-shm oid4vp_backup.sqlite-shm
```

### リカバリ

```bash
# バックアップからのリストア
cp oid4vp_backup.sqlite oid4vp.sqlite
```

### LiteStream対応 (オプション)

```yaml
# litestream.yml
dbs:
  - path: /var/lib/oid4vp/oid4vp.sqlite
    replicas:
      - url: s3://mybucket/oid4vp.sqlite
```

---

## セキュリティ考慮事項

### データ暗号化

- **転送時暗号化**: HTTPS/TLS
- **保存時暗号化**: OS/ファイルシステムレベルの暗号化を推奨

### 機密情報の取り扱い

- **VP Token**: 一時的に保存、処理後は削除推奨
- **クレデンシャルデータ**: 必要最小限の保存、早期削除推奨

### アクセス制御

- **ファイルパーミッション**: 600 (所有者のみ読み書き可能)
- **SQLiteユーザー**: アプリケーション専用ユーザーで実行
