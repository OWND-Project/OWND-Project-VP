# データモデルドキュメント

## 概要

boolcheckシステムは、OrbitDB（分散データベース）とSQLite（ローカルキャッシュ）の2層構造でデータを管理しています。このドキュメントでは、各エンティティのスキーマ定義、データのライフサイクル、リレーションシップ、およびクエリ戦略について詳述します。

## データアーキテクチャ

```
┌─────────────────────────────────────────────────────┐
│              OrbitDB Documents Layer                │
│         (Distributed, Append-only Log)              │
├─────────────────────────────────────────────────────┤
│  - urls          (indexed by id)                    │
│  - claimers      (indexed by id)                    │
│  - claims        (indexed by id)                    │
│  - affiliations  (indexed by id)                    │
└────────────────┬────────────────────────────────────┘
                 │ sync
                 ▼
┌─────────────────────────────────────────────────────┐
│              SQLite Cache Layer                     │
│         (Local, Queryable, Indexed)                 │
├─────────────────────────────────────────────────────┤
│  - urls          (url_id UNIQUE, url UNIQUE)        │
│  - claims        (claim_id UNIQUE)                  │
│  - affiliations  (affiliation_id UNIQUE)            │
│  - sync_histories (hash UNIQUE, key UNIQUE)         │
└─────────────────────────────────────────────────────┘
```

## エンティティモデル

### 1. UrlDocument

URLとそのメタデータを管理するエンティティ。

**OrbitDB Schema** (`src/usecases/types.ts`):

```typescript
interface UrlDocument {
  id: string;                // UUID (32文字)
  url: string;               // 完全なURL (最大4096文字)
  domain?: string;           // ドメイン名 (例: "example.com")
  title?: string;            // ページタイトル (最大255文字)
  content_type?: string;     // MIMEタイプ (例: "text/html")
  description?: string;      // メタディスクリプション (最大2048文字)
  search?: string;           // 検索用テキスト (最大4096文字)
  image?: string;            // ImageDocument JSON文字列
  ogp?: any;                 // OGPメタデータ (JSON)
  created_at: string;        // ISO 8601形式のタイムスタンプ
}
```

**ImageDocument** (UrlDocumentに含まれる):

```typescript
interface ImageDocument {
  height?: number;           // 画像の高さ (px)
  width?: number;            // 画像の幅 (px)
  type?: string;             // 画像のMIMEタイプ
  url: string;               // 画像のURL
  alt?: string;              // 代替テキスト
}
```

**SQLite Schema** (`src/local-data/sqlite-client.ts`):

```sql
CREATE TABLE urls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url_id VARCHAR(32) UNIQUE,            -- OrbitDBのid
  url VARCHAR(4096) UNIQUE,             -- 完全なURL
  search VARCHAR(4096),                 -- 検索用テキスト
  domain VARCHAR(255),                  -- ドメイン名
  title VARCHAR(255),                   -- ページタイトル
  description VARCHAR(2048),            -- メタディスクリプション
  content_type VARCHAR(80),             -- MIMEタイプ
  image VARCHAR(4096),                  -- ImageDocument JSON
  source_created_at DATETIME,           -- OrbitDBでの作成日時
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- SQLite挿入日時
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP   -- SQLite更新日時
)
```

**データフロー**:
1. クライアントがPOST `/database/urls` でURL登録
2. PuppeteerでOGPメタデータを取得（タイトル、ディスクリプション、画像等）
3. `randomUniqueString()`で32文字のIDを生成
4. OrbitDB `urls`ドキュメントに保存
5. OrbitDBの`update`イベントでSQLiteに同期

**バリデーション**:
- `url`: 必須、有効なURL形式
- `url`の重複チェック（既存URLはConflictエラー）

### 2. ClaimerDocument

クレーム発行者（ウォレットユーザー）を管理するエンティティ。

**OrbitDB Schema**:

```typescript
interface ClaimerDocument {
  id: string;                // UUID (32文字)
  sub: string;               // OpenIDのsubject識別子
  id_token: string;          // JWTトークン
  icon: string;              // アイコンURL
  created_at: string;        // ISO 8601形式のタイムスタンプ
}
```

**特徴**:
- ClaimerDocumentはOrbitDBに保存されるが、SQLiteテーブルは存在しない
- クレーム取得時にOrbitDBから直接読み取る

**データフロー**:
1. OID4VP認証フロー完了時にVP Tokenから抽出
2. `id_token`（SD-JWT）をデコードして`sub`と`icon`を取得
3. OrbitDB `claimers`ドキュメントに保存

### 3. ClaimDocument

真偽情報（クレーム）を管理する中核エンティティ。

**OrbitDB Schema**:

```typescript
interface ClaimDocument {
  id: string;                // UUID (32文字)
  url: string;               // 対象URL
  claimer_id: string;        // ClaimerDocumentのid
  affiliation_id?: string;   // AffiliationDocumentのid (任意)
  comment: string;           // SD-JWT形式のクレーム本体
  created_at: string;        // ISO 8601形式のタイムスタンプ
  deleted_at?: string;       // 削除日時 (任意)
}
```

**comment フィールドの構造**:

`comment`は、SD-JWT（Selective Disclosure JWT）形式のトークンで、以下のCredentialSubjectを含みます：

```typescript
interface VerifiableCredential {
  vc: {
    credentialSubject: {
      url: string;           // 対象URL
      bool_value: number;    // 1: TRUE, 0: FALSE, 2: ELSE
      comment: string;       // コメントテキスト
    };
  };
}
```

**SQLite Schema**:

```sql
CREATE TABLE claims (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id VARCHAR(32) UNIQUE,          -- OrbitDBのid
  comment VARCHAR(4096),                -- SD-JWT文字列
  bool_value INTEGER,                   -- 1: TRUE, 0: FALSE, 2: ELSE
  url VARCHAR(4096),                    -- 対象URL
  claimer_id VARCHAR(32),               -- ClaimerDocumentのid
  affiliation_id VARCHAR(32),           -- AffiliationDocumentのid (任意)
  source_created_at DATETIME,           -- OrbitDBでの作成日時
  source_deleted_at DATETIME,           -- OrbitDBでの削除日時 (任意)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- SQLite挿入日時
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP   -- SQLite更新日時
)
```

**データフロー（作成）**:
1. VERIFIER_NODEでOID4VP認証完了
2. VP TokenからSD-JWTをデコードして`bool_value`と`comment`を抽出
3. BOOL_NODEのPOST `/database/claims`にリクエスト
4. OrbitDB `claims`ドキュメントに保存
5. SQLiteに同期（`comment`をデコードして`bool_value`をSQLiteに保存）

**データフロー（削除）**:
1. DELETE `/database/claims/:id` にBearerトークン付きでリクエスト
2. `id_token`を検証してClaimer本人確認
3. OrbitDB `claims`ドキュメントに`deleted_at`を設定して更新
4. SQLiteから該当レコードを削除（`DELETE FROM claims`）

**バリデーション**:
- `url`: 必須、URLドキュメントが存在すること
- `claimer_id`: 必須、Claimerドキュメントが存在すること
- `comment`: 必須、有効なSD-JWT形式
- 削除時: Bearerトークンが`claimer_id`と一致すること

### 4. AffiliationDocument

クレーム発行者と組織の所属関係を管理するエンティティ。

**OrbitDB Schema**:

```typescript
interface AffiliationDocument {
  id: string;                // UUID (32文字)
  claimer_id: string;        // ClaimerDocumentのid
  claimer_sub: string;       // ClaimerのOpenID subject
  organization: string;      // 組織名
  created_at: string;        // ISO 8601形式のタイムスタンプ
}
```

**SQLite Schema**:

```sql
CREATE TABLE affiliations (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  affiliation_id VARCHAR(32) UNIQUE,    -- OrbitDBのid
  claimer_id VARCHAR(32),               -- ClaimerDocumentのid
  claimer_sub VARCHAR(512),             -- ClaimerのOpenID subject
  organization VARCHAR(32),             -- 組織名
  source_created_at DATETIME,           -- OrbitDBでの作成日時
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- SQLite挿入日時
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP   -- SQLite更新日時
)
```

**データフロー**:
1. OID4VP認証時に組織情報を含むVP Tokenを受信
2. VP Tokenから組織情報（`organization`）を抽出
3. OrbitDB `affiliations`ドキュメントに保存
4. SQLiteに同期

**用途**:
- Verified Claims（検証済みクレーム）の判別
- 組織に所属するClaimerのクレームは信頼性が高いとみなされる
- `verified_true_count`, `verified_false_count`の集計に使用

### 5. SyncHistoryTable

API_NODEの同期履歴を管理する内部エンティティ（OrbitDBには存在せず、SQLiteのみ）。

**SQLite Schema**:

```sql
CREATE TABLE sync_histories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_type VARCHAR(32),                 -- "urls", "claims", "affiliations"
  hash VARCHAR(255) UNIQUE,             -- OrbitDBエントリハッシュ
  key VARCHAR(255) UNIQUE,              -- OrbitDBエントリキー
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,  -- 同期日時
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
```

**データフロー**:
1. API_NODE起動時に全履歴同期（`syncAllUrls`, `syncAllClaims`, `syncAllAffiliations`）
2. 各エントリの`hash`と`key`を記録
3. 次回起動時、最後の`hash`まで到達したら同期を停止（差分同期）

**用途**:
- 効率的な差分同期の実現
- 重複同期の防止

## 集約データモデル

### AggregatedUrl

URLごとにクレームを集計した読み取り専用のビュー。SQLiteのJOIN/GROUP BYで生成。

**Schema**:

```typescript
type AggregatedUrl = UrlDocument & AggregateResult & { oldest_created_at: string };

interface AggregateResult {
  true_count: number;              // TRUEクレーム数
  false_count: number;             // FALSEクレーム数
  else_count: number;              // ELSEクレーム数
  verified_true_count: number;     // 検証済みTRUEクレーム数
  verified_false_count: number;    // 検証済みFALSEクレーム数
  verified_else_count: number;     // 検証済みELSEクレーム数
  oldest_created_at: string;       // 最古のクレーム作成日時
}
```

**SQLクエリ** (`src/local-data/local-data-handler.ts`):

```sql
SELECT
  MIN(b.url_id) as id,
  a.url,
  MAX(domain) AS domain,
  MAX(title) AS title,
  MAX(description) AS description,
  MAX(search) AS search,
  MAX(content_type) AS content_type,
  MAX(image) AS image,
  SUM(CASE WHEN bool_value = 1 THEN 1 ELSE 0 END) AS true_count,
  SUM(CASE WHEN bool_value = 0 THEN 1 ELSE 0 END) AS false_count,
  SUM(CASE WHEN bool_value = 2 THEN 1 ELSE 0 END) AS else_count,
  SUM(CASE WHEN bool_value = 1 AND a.affiliation_id IS NOT NULL AND a.affiliation_id <> '' THEN 1 ELSE 0 END) AS verified_true_count,
  SUM(CASE WHEN bool_value = 0 AND a.affiliation_id IS NOT NULL AND a.affiliation_id <> '' THEN 1 ELSE 0 END) AS verified_false_count,
  SUM(CASE WHEN bool_value = 2 AND a.affiliation_id IS NOT NULL AND a.affiliation_id <> '' THEN 1 ELSE 0 END) AS verified_else_count,
  MIN(a.source_created_at) AS oldest_created_at
FROM
  claims a
INNER JOIN urls b ON a.url = b.url
GROUP BY
  a.url
```

**フィルタリング・ソート**:

| パラメータ | 説明 | 実装 |
|-----------|------|------|
| `filter` | URL部分一致検索 | `WHERE a.url LIKE ?` |
| `startDate` | 指定日時以降のクレーム | `HAVING oldest_created_at >= ?` |
| `sortKey` | ソートキー (`true_count`, `false_count`, `created_at`) | `ORDER BY verified_true_count DESC` |
| `desc` | 降順ソート | `DESC` |

**使用例**:
- `GET /database/urls?filter=example.com&sort=-true_count`
  - "example.com"を含むURLを、検証済みTRUEクレーム数の降順で取得

## エンティティリレーションシップ図（ER図）

```
┌─────────────────┐
│  UrlDocument    │
│─────────────────│
│ id (PK)         │
│ url (UNIQUE)    │
│ domain          │
│ title           │
│ description     │
│ image           │
│ created_at      │
└────────┬────────┘
         │
         │ 1:N
         │
┌────────▼────────────┐
│  ClaimDocument      │
│─────────────────────│
│ id (PK)             │
│ url (FK)            │◄──┐
│ claimer_id (FK)     │   │
│ affiliation_id (FK) │   │ N:1
│ comment (SD-JWT)    │   │
│ created_at          │   │
│ deleted_at          │   │
└─────────┬───────────┘   │
          │               │
          │ N:1           │
          │               │
┌─────────▼───────────┐   │
│  ClaimerDocument    │   │
│─────────────────────│   │
│ id (PK)             │   │
│ sub                 │───┘
│ id_token            │
│ icon                │
│ created_at          │
└─────────┬───────────┘
          │
          │ 1:N
          │
┌─────────▼──────────────┐
│  AffiliationDocument   │
│────────────────────────│
│ id (PK)                │
│ claimer_id (FK)        │
│ claimer_sub            │
│ organization           │
│ created_at             │
└────────────────────────┘
```

**リレーションシップ**:

1. **UrlDocument ↔ ClaimDocument** (1:N)
   - 1つのURLに対して複数のClaimが存在
   - Claimの`url`フィールドで関連付け

2. **ClaimerDocument ↔ ClaimDocument** (1:N)
   - 1人のClaimerが複数のClaimを発行
   - Claimの`claimer_id`フィールドで関連付け

3. **ClaimerDocument ↔ AffiliationDocument** (1:N)
   - 1人のClaimerが複数の組織に所属可能（時系列で変わる）
   - Affiliationの`claimer_id`フィールドで関連付け

4. **AffiliationDocument ↔ ClaimDocument** (1:N)
   - 1つのAffiliationに対して複数のClaimが存在
   - Claimの`affiliation_id`フィールドで関連付け（任意）

## データライフサイクル

### URLのライフサイクル

```
[作成] → [同期] → [参照] → [永続化]
   ↓        ↓        ↓         ↓
BOOL    BOOL→API   API     OrbitDB/SQLite
NODE     NODE     NODE     (削除なし)
```

1. **作成**: POST `/database/urls` でURL登録
2. **メタデータ取得**: Puppeteerでスクレイピング
3. **OrbitDB保存**: `urls.put(urlDoc)`
4. **SQLite同期**: `onUpdate` イベント → `syncUrl()`
5. **参照**: GET `/database/urls/:id`

**削除**: URLドキュメントは削除されない（永続化）

### Claimのライフサイクル

```
[認証] → [作成] → [同期] → [参照] → [削除]
   ↓        ↓        ↓        ↓        ↓
VERIFIER BOOL    BOOL→API  API     BOOL
  NODE   NODE     NODE    NODE     NODE
```

1. **認証**: VERIFIER_NODEでOID4VP認証
2. **作成**: BOOL_NODEのPOST `/database/claims`でClaim登録
3. **OrbitDB保存**: `claims.put(claimDoc)`
4. **SQLite同期**: `onUpdate` イベント → `syncClaim()`
5. **参照**: GET `/database/claims/:id`
6. **削除**: DELETE `/database/claims/:id`
   - OrbitDBに`deleted_at`を設定
   - SQLiteからレコード削除

### Claimerのライフサイクル

```
[認証] → [作成] → [永続化]
   ↓        ↓         ↓
VERIFIER BOOL    OrbitDB
  NODE   NODE    (削除なし)
```

1. **認証**: VERIFIER_NODEでOID4VP認証
2. **VP Token処理**: `id_token`から`sub`と`icon`を抽出
3. **OrbitDB保存**: `claimers.put(claimerDoc)`
4. **参照**: Claim取得時にOrbitDBから読み取り

**削除**: Claimerドキュメントは削除されない（永続化）

### Affiliationのライフサイクル

```
[認証] → [作成] → [同期] → [参照] → [永続化]
   ↓        ↓        ↓        ↓         ↓
VERIFIER BOOL    BOOL→API  API     OrbitDB/SQLite
  NODE   NODE     NODE    NODE    (削除なし)
```

1. **認証**: VERIFIER_NODEでOID4VP認証（組織情報含む）
2. **組織情報抽出**: VP Tokenから`organization`を取得
3. **OrbitDB保存**: `affiliations.put(affiliationDoc)`
4. **SQLite同期**: `onUpdate` イベント → `syncAffiliation()`
5. **参照**: Claim取得時にJOINで組織名を取得

**削除**: Affiliationドキュメントは削除されない（永続化）

## インデックス戦略

### OrbitDB インデックス

OrbitDBは各ドキュメントタイプで`id`フィールドをインデックスとして使用：

```typescript
const Database = Documents({ indexBy: "id" });
const doc = await orbitdb.open("urls", { Database });
```

**検索方法**:
- `doc.get(id)`: IDで直接取得
- `doc.query((doc) => doc.url === url)`: 関数フィルタで検索
- `doc.iterator()`: 全エントリを走査

### SQLite インデックス

**UNIQUE制約** (暗黙的にインデックス作成):
- `urls.url_id`: URLドキュメントID
- `urls.url`: URL文字列
- `claims.claim_id`: ClaimドキュメントID
- `affiliations.affiliation_id`: AffiliationドキュメントID
- `sync_histories.hash`: OrbitDBエントリハッシュ
- `sync_histories.key`: OrbitDBエントリキー

**追加インデックス推奨**（パフォーマンス向上）:
```sql
CREATE INDEX idx_claims_url ON claims(url);
CREATE INDEX idx_claims_claimer_id ON claims(claimer_id);
CREATE INDEX idx_claims_affiliation_id ON claims(affiliation_id);
CREATE INDEX idx_claims_source_created_at ON claims(source_created_at);
CREATE INDEX idx_affiliations_claimer_id ON affiliations(claimer_id);
```

## データ整合性

### OrbitDBレベルの整合性

- **追記型ログ**: すべての操作はログに追記され、削除されない
- **CRDTs**: 競合のないレプリケーション
- **アクセス制御**: OrbitDBAccessControllerによる書き込み制御

### SQLiteレベルの整合性

- **UNIQUE制約**: IDとURLの一意性を保証
- **外部キー**: 現在は未使用（将来的に追加可能）
- **トランザクション**: SQLiteの自動コミット

### 同期の整合性

- **イベント駆動**: OrbitDBの`update`イベントでSQLite同期
- **冪等性**: 同じエントリを複数回同期しても結果は同じ
- **エラーハンドリング**: 同期エラーはログに記録され、次回リトライ

## バリデーションルール

### URL登録

```typescript
// src/usecases/claim-interactor.ts
const putUrl = async (url: string) => {
  // 1. URL重複チェック
  const existing = await selectUrl(url);
  if (existing) {
    return { ok: false, error: { type: "CONFLICT" } };
  }

  // 2. OGPメタデータ取得（Puppeteer）
  const ogpResult = await getOgpFromUrl(url);
  if (!ogpResult.ok) {
    if (ogpResult.error.type === "NotFound") {
      return { ok: false, error: { type: "NOT_FOUND" } };
    }
    // その他のエラー処理
  }

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
};
```

### Claim登録

```typescript
const putClaim = async (payload: {
  url: string;
  claimer: { id_token: string; sub: string; organization?: string };
  comment: string; // SD-JWT
}) => {
  // 1. URL存在チェック
  const urlDoc = await selectUrl(payload.url);
  if (!urlDoc.ok || !urlDoc.payload.urlDoc) {
    return { ok: false, error: { type: "INVALID_PARAMETER", message: "URL not found" } };
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
    comment: payload.comment, // SD-JWT
    created_at: new Date().toISOString(),
  };

  // 5. OrbitDB保存
  await docs.documents["claims"].document.put(claimDoc);
};
```

### Claim削除

```typescript
const deleteClaim = async (id: string, idToken: string) => {
  // 1. Claim存在チェック
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
};
```

## パフォーマンス最適化

### 1. 集計クエリの最適化

**課題**: URLごとのクレーム集計はコストが高い

**解決策**: SQLiteでGROUP BYを使用した事前集計

```sql
-- 集計結果を一度に取得
SELECT
  a.url,
  SUM(CASE WHEN bool_value = 1 THEN 1 ELSE 0 END) AS true_count,
  SUM(CASE WHEN bool_value = 0 THEN 1 ELSE 0 END) AS false_count
FROM claims a
GROUP BY a.url
```

**効果**: OrbitDBで全Claimをフィルタするよりも高速

### 2. 同期の最適化

**課題**: 全履歴同期は時間がかかる

**解決策**: 同期履歴を記録して差分同期

```typescript
const syncAllUrls = async () => {
  const latestHash = await latestHistory("urls");
  for await (const { hash, key, value } of docs.documents["urls"].document.iterator()) {
    if (hash === latestHash) break; // 前回の同期ポイントまで
    await syncUrl(value, true);
    setLatestHash(hash, key);
  }
  await saveLatest();
};
```

**効果**: 2回目以降の起動が高速化

### 3. クエリキャッシュ

**課題**: 同じクエリを繰り返し実行するとコストが高い

**解決策**: SQLiteのクエリ結果をアプリケーション層でキャッシュ（将来的な改善）

## まとめ

boolcheckのデータモデルは、以下の設計原則に基づいています：

1. **分散性**: OrbitDBによる分散データベース、ノード間でのレプリケーション
2. **永続性**: 追記型ログによるデータの永続化（削除マーキングのみ）
3. **クエリ性能**: SQLiteキャッシュによる高速な集計・フィルタリング
4. **整合性**: イベント駆動同期とUNIQUE制約による整合性保証
5. **拡張性**: エンティティ間の疎結合な関係、新しいドキュメントタイプの追加が容易

この設計により、分散環境でありながら高速なクエリ性能と強い整合性を両立しています。
