# API仕様ドキュメント

## 概要

boolcheckシステムは、3つのノードタイプがそれぞれ異なるREST APIを公開しています。このドキュメントでは、各APIエンドポイントの仕様、リクエスト/レスポンス形式、エラーハンドリング、認証方法について詳述します。

## ノード別API構成

| ノードタイプ | ベースパス | 公開API | CORS設定 |
|-------------|-----------|---------|---------|
| BOOL_NODE | `http://localhost:3000` | Database API, Admin API | 特定オリジンからのPOSTのみ |
| API_NODE | `http://localhost:3001` | Database API (read-only) | 全オリジンからのGETのみ |
| VERIFIER_NODE | `http://localhost:3002` | OID4VP API | 特定オリジンからのGET/POST、credentials有効 |

## Database API

Database APIは、URL、Claim、Claimerの管理を担当します。BOOL_NODEは読み書き両方、API_NODEは読み取り専用です。

### Base URL

- BOOL_NODE: `http://localhost:3000/database`
- API_NODE: `http://localhost:3001/database`

---

### POST /database/urls

URLを登録し、OGPメタデータを取得します。

**アクセス**: BOOL_NODEのみ

**リクエスト**:

```http
POST /database/urls HTTP/1.1
Content-Type: application/json

{
  "url": "https://example.com/article/123"
}
```

**リクエストボディ**:

| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `url` | string | ✓ | 登録するURL（完全なURL形式） |

**レスポンス** (200 OK):

```json
{
  "id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "url": "https://example.com/article/123",
  "domain": "example.com",
  "title": "記事のタイトル",
  "content_type": "text/html",
  "description": "記事の説明文...",
  "image": [
    {
      "url": "https://example.com/og-image.jpg",
      "width": 1200,
      "height": 630,
      "type": "image/jpeg"
    }
  ],
  "created_at": "2025-01-15T10:30:00.000Z",
  "true_count": 0,
  "false_count": 0,
  "else_count": 0,
  "verified_true_count": 0,
  "verified_false_count": 0,
  "verified_else_count": 0
}
```

**レスポンスボディ**:

`UrlResource`型（詳細は[レスポンス型定義](#レスポンス型定義)を参照）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_PARAMETER` | リクエストボディが不正 |
| 404 | `NOT_FOUND` | URLが存在しない、またはアクセス不可 |
| 409 | `CONFLICT` | URLが既に登録済み（`instance`フィールドに既存URLのパスを含む） |
| 500 | `INTERNAL_ERROR` | サーバー内部エラー |

**例**: URLが既に登録済みの場合

```json
{
  "type": "CONFLICT",
  "message": "URL already exists",
  "instance": "/database/urls/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6"
}
```

---

### GET /database/urls

URL一覧を取得します。フィルタリング・ソート機能をサポート。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /database/urls?filter=example.com&sort=-verified_true_count&start_date=2025-01-01T00:00:00Z HTTP/1.1
```

**クエリパラメータ**:

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `filter` | string | - | URL部分一致検索 |
| `start_date` | string | - | ISO 8601形式の日時。この日時以降に作成されたクレームのみを持つURLを取得 |
| `sort` | string | - | ソートキー。`true_count`, `false_count`, `created_at`のいずれか。先頭に`-`を付けると降順 |

**レスポンス** (200 OK):

```json
[
  {
    "id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "url": "https://example.com/article/123",
    "domain": "example.com",
    "title": "記事のタイトル",
    "content_type": "text/html",
    "description": "記事の説明文...",
    "image": [...],
    "created_at": "2025-01-15T10:30:00.000Z",
    "true_count": 10,
    "false_count": 3,
    "else_count": 1,
    "verified_true_count": 8,
    "verified_false_count": 2,
    "verified_else_count": 0
  },
  ...
]
```

**レスポンスボディ**:

`UrlResource[]`型の配列

---

### GET /database/urls/:id

URL詳細を取得します。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /database/urls/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6 HTTP/1.1
```

**パスパラメータ**:

| パラメータ | 型 | 説明 |
|-----------|---|------|
| `id` | string | UrlDocumentのID（32文字のUUID） |

**レスポンス** (200 OK):

```json
{
  "id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "url": "https://example.com/article/123",
  "domain": "example.com",
  "title": "記事のタイトル",
  ...
}
```

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 404 | - | URLが見つからない |

---

### GET /database/urls/:id/metadata

URLのメタデータのみを取得します（クレーム集計情報を含まない）。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /database/urls/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6/metadata HTTP/1.1
```

**レスポンス** (200 OK):

```json
{
  "id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
  "url": "https://example.com/article/123",
  "domain": "example.com",
  "title": "記事のタイトル",
  "content_type": "text/html",
  "description": "記事の説明文...",
  "image": [...],
  "created_at": "2025-01-15T10:30:00.000Z"
}
```

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 404 | `NOT_FOUND` | URLが見つからない |

---

### GET /database/urls/:id/claims

指定URLに紐づくClaim一覧を取得します。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /database/urls/a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6/claims HTTP/1.1
```

**レスポンス** (200 OK):

```json
[
  {
    "id": "claim123...",
    "url": {
      "id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
      "url": "https://example.com/article/123",
      ...
    },
    "claimer": {
      "id": "claimer456...",
      "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
      "icon": "https://example.com/icon.png",
      "organization": "Example Org"
    },
    "comment": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
    "created_at": "2025-01-15T11:00:00.000Z"
  },
  ...
]
```

**レスポンスボディ**:

`ClaimResource[]`型の配列

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 404 | - | URLが見つからない |

---

### POST /database/claims

Claimを作成します。

**アクセス**: BOOL_NODEのみ

**リクエスト**:

```http
POST /database/claims HTTP/1.1
Content-Type: application/json

{
  "url": "https://example.com/article/123",
  "claimer": {
    "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
    "sub": "user@example.com",
    "organization": "Example Org",
    "icon": "https://example.com/icon.png"
  },
  "comment": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9..."
}
```

**リクエストボディ**:

| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `url` | string | ✓ | 対象URL（登録済みである必要がある） |
| `claimer.id_token` | string | ✓ | ClaimerのJWTトークン |
| `claimer.sub` | string | ✓ | ClaimerのOpenID subject識別子 |
| `claimer.organization` | string | - | 組織名（検証済みクレームの場合） |
| `claimer.icon` | string | - | ClaimerのアイコンURL |
| `comment` | string | ✓ | SD-JWT形式のクレーム本体 |

**レスポンス** (201 Created):

```json
{
  "id": "claim789...",
  "status": "Created"
}
```

**ヘッダー**:

```
Location: /database/claims/claim789...
```

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_PARAMETER` | リクエストボディが不正、またはURLが未登録 |

---

### GET /database/claims/:id

Claim詳細を取得します。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /database/claims/claim789... HTTP/1.1
```

**レスポンス** (200 OK):

```json
{
  "id": "claim789...",
  "url": {
    "id": "a1b2c3d4e5f6g7h8i9j0k1l2m3n4o5p6",
    "url": "https://example.com/article/123",
    ...
  },
  "claimer": {
    "id": "claimer456...",
    "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
    "icon": "https://example.com/icon.png",
    "organization": "Example Org"
  },
  "comment": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
  "created_at": "2025-01-15T11:00:00.000Z"
}
```

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 404 | - | Claimが見つからない |

---

### DELETE /database/claims/:id

Claimを削除します（論理削除）。

**アクセス**: BOOL_NODEのみ

**認証**: Bearerトークン必須（Claimを作成したClaimerのid_token）

**リクエスト**:

```http
DELETE /database/claims/claim789... HTTP/1.1
Authorization: Bearer eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...
```

**レスポンス** (204 No Content):

（ボディなし）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 401 | `Unauthorized` | Authorizationヘッダーが欠落、または形式が不正 |
| 403 | `KEY_DOES_NOT_MATCH` | トークンがClaim作成者と一致しない |
| 404 | - | Claimが見つからない |

---

### GET /database/claimers/:id

Claimer情報を取得します。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /database/claimers/claimer456... HTTP/1.1
```

**レスポンス** (200 OK):

```json
{
  "id": "claimer456...",
  "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
  "icon": "https://example.com/icon.png",
  "organization": "Example Org",
  "created_at": "2025-01-15T10:00:00.000Z"
}
```

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 404 | - | Claimerが見つからない |

---

### GET /database/claimers/:id/claims

指定Claimerが作成したClaim一覧を取得します。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /database/claimers/claimer456.../claims HTTP/1.1
```

**レスポンス** (200 OK):

```json
[
  {
    "id": "claim789...",
    "url": {...},
    "claimer": {...},
    "comment": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
    "created_at": "2025-01-15T11:00:00.000Z"
  },
  ...
]
```

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 404 | - | Claimerが見つからない |

---

### GET /database/backup

全データのバックアップを取得します。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /database/backup HTTP/1.1
```

**レスポンス** (200 OK):

```json
{
  "urls": [...],
  "claimers": [...],
  "affiliations": [...],
  "claims": [...]
}
```

---

### POST /database/restore

バックアップデータからリストアします。

**アクセス**: BOOL_NODEのみ

**リクエスト**:

```http
POST /database/restore HTTP/1.1
Content-Type: application/json

{
  "urls": [...],
  "claimers": [...],
  "affiliations": [...],
  "claims": [...]
}
```

**レスポンス** (200 OK):

（実装による）

---

## Admin API

Admin APIは、OrbitDBノードの管理機能を提供します。BOOL_NODE、API_NODEで利用可能。

### Base URL

- BOOL_NODE: `http://localhost:3000/admin`
- API_NODE: `http://localhost:3001/admin`

---

### GET /admin/peer/info

現在のノードのPeer情報を取得します。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
GET /admin/peer/info HTTP/1.1
```

**レスポンス** (200 OK):

```json
{
  "identity": {
    "hash": "zdpuAtRaxsrGj93bD6DmcruYvaNeuP7sgWDYsXCPTqCs8d1Lz"
  },
  "multiaddrs": [
    "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooWQecqt7GuK3NGvFaPPkGGu5UctugTjGTSe9BByAJve5m8",
    "/ip4/192.168.1.100/tcp/4000/p2p/12D3KooWQecqt7GuK3NGvFaPPkGGu5UctugTjGTSe9BByAJve5m8"
  ]
}
```

**レスポンスボディ**:

| フィールド | 型 | 説明 |
|-----------|---|------|
| `identity.hash` | string | OrbitDB IdentityのCIDハッシュ |
| `multiaddrs` | string[] | libp2pマルチアドレス配列 |

---

### POST /admin/access-right/grant

他のノードに書き込み権限を付与します。

**アクセス**: BOOL_NODEのみ

**リクエスト**:

```http
POST /admin/access-right/grant HTTP/1.1
Content-Type: application/json

{
  "identity": {
    "hash": "zdpuAtRaxsrGj93bD6DmcruYvaNeuP7sgWDYsXCPTqCs8d1Lz"
  },
  "multiaddrs": [
    "/ip4/192.168.1.101/tcp/4001/p2p/12D3KooWXYZ..."
  ]
}
```

**リクエストボディ**:

| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `identity.hash` | string | ✓ | 権限を付与するノードのIdentityハッシュ |
| `multiaddrs` | string[] | ✓ | 権限を付与するノードのマルチアドレス |

**レスポンス** (204 No Content):

（ボディなし）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | - | リクエストボディが不正、またはデータベースが未初期化 |

---

### GET /admin/db/info

OrbitDBドキュメント情報を取得します。

**アクセス**: BOOL_NODEのみ（API_NODEはこのエンドポイントにアクセスして同期を開始）

**リクエスト**:

```http
GET /admin/db/info HTTP/1.1
```

**レスポンス** (200 OK):

```json
{
  "documents": {
    "urls": {
      "address": "/orbitdb/zdpuAtRaxsrGj93bD6DmcruYvaNeuP7sgWDYsXCPTqCs8d1Lz/urls",
      "indexBy": "id"
    },
    "claimers": {
      "address": "/orbitdb/zdpuAtRaxsrGj93bD6DmcruYvaNeuP7sgWDYsXCPTqCs8d1Lz/claimers",
      "indexBy": "id"
    },
    "claims": {
      "address": "/orbitdb/zdpuAtRaxsrGj93bD6DmcruYvaNeuP7sgWDYsXCPTqCs8d1Lz/claims",
      "indexBy": "id"
    },
    "affiliations": {
      "address": "/orbitdb/zdpuAtRaxsrGj93bD6DmcruYvaNeuP7sgWDYsXCPTqCs8d1Lz/affiliations",
      "indexBy": "id"
    }
  },
  "peer": {
    "multiaddrs": [
      "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooWQecqt7GuK3NGvFaPPkGGu5UctugTjGTSe9BByAJve5m8"
    ]
  }
}
```

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | - | データベースが未初期化 |

---

### POST /admin/db/sync

OrbitDBドキュメントを同期します（通常はAPI_NODEが内部的に使用）。

**アクセス**: BOOL_NODE、API_NODE

**リクエスト**:

```http
POST /admin/db/sync HTTP/1.1
Content-Type: application/json

{
  "documents": {...},
  "peer": {...}
}
```

**レスポンス** (204 No Content):

（ボディなし）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | - | リクエストボディが不正 |
| 500 | - | 同期エラー |

---

## OID4VP API

OID4VP APIは、OpenID for Verifiable Presentationsプロトコルを実装し、アイデンティティウォレットとの連携を提供します。

### Base URL

- VERIFIER_NODE: `http://localhost:3002/oid4vp`

---

### POST /oid4vp/auth-request

認証リクエストを生成します。

**アクセス**: VERIFIER_NODEのみ

**リクエスト**:

```http
POST /oid4vp/auth-request HTTP/1.1
Content-Type: application/json

{
  "type": "post_comment",
  "url": "https://example.com/article/123"
}
```

**リクエストボディ**:

| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `type` | string | - | `"post_comment"` (デフォルト) または削除用の別タイプ |
| `url` | string | ✓ | 対象URL |

**レスポンス** (200 OK):

```json
{
  "value": "oid4vp://localhost/request?client_id=http://localhost&request_uri=http://localhost/oid4vp/request%3Fid%3Dreq123..."
}
```

**セッション**:

セッションCookieに`request_id`を設定

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_PARAMETER` | リクエストボディが不正 |

---

### GET /oid4vp/request

認証リクエストオブジェクトを取得します（ウォレットアプリが使用）。

**アクセス**: VERIFIER_NODEのみ

**リクエスト**:

```http
GET /oid4vp/request?type=post_comment&id=req123&presentationDefinitionId=pd456 HTTP/1.1
```

**クエリパラメータ**:

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `type` | string | - | `"post_comment"` (デフォルト) |
| `id` | string | ✓ | リクエストID |
| `presentationDefinitionId` | string | ✓ | Presentation Definition ID |

**レスポンス** (200 OK):

（OID4VPリクエストオブジェクト）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `BAD_REQUEST` | クエリパラメータが不正 |
| 404 | - | リクエストが見つからない |

---

### GET /oid4vp/presentation-definition

Presentation Definitionを取得します（ウォレットアプリが使用）。

**アクセス**: VERIFIER_NODEのみ

**リクエスト**:

```http
GET /oid4vp/presentation-definition?id=pd456 HTTP/1.1
```

**レスポンス** (200 OK):

（Presentation Definitionオブジェクト）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 404 | `NOT_FOUND` | Presentation Definitionが見つからない |

---

### POST /oid4vp/responses

ウォレットから認証レスポンス（VP Token）を受信します。

**アクセス**: VERIFIER_NODEのみ

**リクエスト**:

```http
POST /oid4vp/responses HTTP/1.1
Content-Type: application/x-www-form-urlencoded

vp_token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...&presentation_submission=...&state=state123
```

**リクエストボディ** (application/x-www-form-urlencoded):

| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `vp_token` | string | ✓ | VP Token (SD-JWT形式) |
| `presentation_submission` | string | ✓ | Presentation Submission |
| `state` | string | ✓ | State値 |

**レスポンス** (200 OK):

```json
{
  "redirect_uri": "https://client.example.org/cb#response_code=091535f699ea575c7937fa5f0f454aee"
}
```

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_PARAMETER` | リクエストボディが不正 |

---

### POST /oid4vp/response-code/exchange

レスポンスコードを交換してクレーム情報を取得します。

**アクセス**: VERIFIER_NODEのみ

**リクエスト**:

```http
POST /oid4vp/response-code/exchange?response_code=091535f699ea575c7937fa5f0f454aee&type=post_comment HTTP/1.1
```

**クエリパラメータ**:

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `response_code` | string | ✓ | レスポンスコード |
| `type` | string | - | `"post_comment"` (デフォルト) |

**レスポンス** (200 OK):

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

**セッション**:

セッションCookieに`request_id`を設定

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_PARAMETER` | レスポンスコードが不正 |

---

### POST /oid4vp/comment/confirm

クレームをBOOL_NODEに送信して確定します。

**アクセス**: VERIFIER_NODEのみ

**認証**: セッションCookieに`request_id`が必要

**リクエスト**:

```http
POST /oid4vp/comment/confirm HTTP/1.1
Cookie: koa.sess=...
```

**レスポンス** (200 OK):

```json
{
  "id": "claim789..."
}
```

**セッション**:

セッションを無効化（`ctx.session = null`）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | - | セッションが不正 |

---

### POST /oid4vp/comment/cancel

クレーム作成をキャンセルします。

**アクセス**: VERIFIER_NODEのみ

**認証**: セッションCookieに`request_id`が必要

**リクエスト**:

```http
POST /oid4vp/comment/cancel HTTP/1.1
Cookie: koa.sess=...
```

**レスポンス** (204 No Content):

（ボディなし）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | - | セッションが不正 |

---

### GET /oid4vp/comment/states

クレーム作成の状態を取得します。

**アクセス**: VERIFIER_NODEのみ

**認証**: セッションCookieに`request_id`が必要

**リクエスト**:

```http
GET /oid4vp/comment/states HTTP/1.1
Cookie: koa.sess=...
```

**レスポンス** (200 OK):

```json
{
  "value": "committed"
}
```

**ステート値**:

| 値 | 説明 |
|----|------|
| `"started"` | 認証リクエスト生成済み |
| `"consumed"` | レスポンスコード交換済み |
| `"committed"` | クレーム確定済み |
| `"expired"` | セッション期限切れ |
| `"canceled"` | キャンセル済み |
| `"invalid_submission"` | 無効な提出 |

**セッション**:

`value`が`"committed"`の場合、セッションを無効化

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_HEADER` | セッションが不正 |
| 404 | - | ステートが見つからない |

---

## レスポンス型定義

### UrlResource

```typescript
interface UrlResource {
  id: string;                       // UrlDocumentのID
  url: string;                      // 完全なURL
  domain?: string;                  // ドメイン名
  title?: string;                   // ページタイトル
  content_type?: string;            // MIMEタイプ
  description?: string;             // メタディスクリプション
  image?: ImageType[];              // 画像情報配列
  created_at: string;               // ISO 8601形式のタイムスタンプ
  true_count?: number;              // TRUEクレーム数
  false_count?: number;             // FALSEクレーム数
  else_count?: number;              // ELSEクレーム数
  verified_true_count?: number;     // 検証済みTRUEクレーム数
  verified_false_count?: number;    // 検証済みFALSEクレーム数
  verified_else_count?: number;     // 検証済みELSEクレーム数
}
```

### ImageType

```typescript
interface ImageType {
  height?: number;                  // 画像の高さ (px)
  width?: number;                   // 画像の幅 (px)
  type?: string;                    // MIMEタイプ
  url: string;                      // 画像URL
  alt?: string;                     // 代替テキスト
}
```

### ClaimResource

```typescript
interface ClaimResource {
  id: string;                       // ClaimDocumentのID
  url: UrlResource;                 // 対象URL情報
  claimer: ClaimerResource;         // Claimer情報
  comment: string;                  // SD-JWT形式のクレーム本体
  created_at: string;               // ISO 8601形式のタイムスタンプ
}
```

### ClaimerResource

```typescript
interface ClaimerResource {
  id: string;                       // ClaimerDocumentのID
  id_token: string;                 // JWTトークン
  icon?: string;                    // アイコンURL
  organization?: string;            // 組織名
  created_at: string;               // ISO 8601形式のタイムスタンプ
}
```

---

## エラーレスポンス

### エラー形式

すべてのエラーレスポンスは以下の形式で返却されます：

```json
{
  "type": "ERROR_TYPE",
  "message": "Error description",
  "instance": "/path/to/resource"
}
```

### エラータイプ一覧

| タイプ | HTTPステータス | 説明 |
|-------|---------------|------|
| `INVALID_PARAMETER` | 400 | リクエストパラメータが不正 |
| `INVALID_HEADER` | 400 | リクエストヘッダーが不正 |
| `NOT_FOUND` | 404 | リソースが見つからない |
| `EXPIRED` | 410 | リソースが期限切れ |
| `DUPLICATED_ERROR` | 409 | 重複エラー |
| `CONFLICT` | 409 | リソースの競合（`instance`フィールドに既存リソースのパスを含む） |
| `GONE` | 410 | リソースが削除済み |
| `INTERNAL_ERROR` | 500 | サーバー内部エラー |
| `UNSUPPORTED_CURVE` | 400 | サポートされていない楕円曲線 |
| `KEY_DOES_NOT_MATCH` | 403 | 認証キーが一致しない |
| `UNEXPECTED_ERROR` | 500 | 予期しないエラー |

---

## 認証・認可

### Bearerトークン認証

**対象エンドポイント**: `DELETE /database/claims/:id`

**ヘッダー**:

```
Authorization: Bearer <id_token>
```

**検証プロセス**:
1. Authorizationヘッダーから`Bearer`トークンを抽出
2. Claimの`claimer_id`を取得
3. Claimerの`id_token`と比較
4. 一致しない場合は`403 KEY_DOES_NOT_MATCH`エラー

### セッション認証

**対象エンドポイント**: OID4VP API（`/oid4vp/comment/*`, `/oid4vp/response-code/exchange`）

**セッション設定**:

```typescript
app.keys = [process.env.OID4VP_COOKIE_SECRET];
app.use(session({
  maxAge: 60 * 60 * 1000,  // 1時間
  signed: true,
  httpOnly: true,
  secure: NODE_ENV !== 'local',
  sameSite: 'none'
}, app));
```

**セッションフィールド**:
- `request_id`: リクエストID
- `transaction_id`: トランザクションID（削除用）

---

## CORS設定

### BOOL_NODE

```typescript
cors({
  origin: process.env.APP_HOST,        // 特定オリジンのみ
  allowMethods: ['POST', 'OPTIONS']    // POSTとOPTIONSのみ
})
```

### API_NODE

```typescript
cors({
  origin: '*',                         // 全オリジン許可
  allowMethods: ['GET']                // GETのみ
})
```

### VERIFIER_NODE

```typescript
cors({
  origin: process.env.APP_HOST,        // 特定オリジンのみ
  allowMethods: ['POST', 'GET'],       // POSTとGET
  credentials: true                    // Cookie送信を許可
})
```

---

## ヘルスチェック

### GET /health-check

すべてのノードで利用可能なヘルスチェックエンドポイント。

**リクエスト**:

```http
GET /health-check HTTP/1.1
```

**レスポンス** (204 No Content):

（ボディなし）

---

## まとめ

boolcheck APIは、3つのノードタイプが協調して動作する設計になっています：

1. **BOOL_NODE**: 更新系APIとAdmin APIを提供。書き込み権限を持ち、OrbitDBへのデータ永続化を担当。
2. **API_NODE**: 参照系APIを提供。BOOL_NODEから同期したデータをSQLiteでクエリし、高速な参照機能を提供。
3. **VERIFIER_NODE**: OID4VP APIを提供。アイデンティティウォレットとの連携により、検証可能なクレームを受け取りBOOL_NODEに送信。

各APIはREST原則に従い、適切なHTTPメソッド、ステータスコード、エラーハンドリングを実装しています。
