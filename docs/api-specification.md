# OID4VP Verifier - API仕様ドキュメント

## 概要

OID4VP VerifierシステムはOpenID for Verifiable Presentations (OID4VP) プロトコルに準拠した純粋なVerifierとして実装されています。このドキュメントでは、各APIエンドポイントの仕様、リクエスト/レスポンス形式、エラーハンドリング、認証方法について詳述します。

## システム構成

| 構成要素 | ベースパス | 公開API | CORS設定 |
|---------|-----------|---------|---------|
| OID4VP Verifier | `http://localhost:3000` | OID4VP API | 特定オリジンからのGET/POST、credentials有効 |

## OID4VP API

OID4VP APIは、OpenID for Verifiable Presentationsプロトコルを実装し、Identity Walletとの連携を提供します。

### Base URL

- `http://localhost:3000/oid4vp`

---

## エンドポイント一覧

### 1. Authorization Request生成

#### POST /oid4vp/auth-request

Verifiable Presentationをリクエストするための認証リクエストを生成します。

**リクエスト**:

```http
POST /oid4vp/auth-request HTTP/1.1
Content-Type: application/json
```

**リクエストボディ**:

リクエストボディは不要です。

**レスポンス** (200 OK):

```json
{
  "value": "oid4vp://example.com/request?client_id=http://localhost:3000&request_uri=http://localhost:3000/oid4vp/request%3Fid%3Dreq_abc123"
}
```

**レスポンスボディ**:

| フィールド | 型 | 説明 |
|-----------|---|------|
| `value` | string | OID4VP URIスキームのAuthorization Request URL |

**セッション**:

- セッションCookieに`request_id`を設定
- `transaction_id`が存在する場合は設定

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_PARAMETER` | リクエストボディが不正 |

**処理フロー**:
1. 所属証明クレデンシャル用のDCQL Queryを生成
2. post_statesテーブルに状態を保存（状態: `started`）
3. Authorization Requestを生成
4. セッションに`request_id`を設定
5. OID4VP URIを返却

---

### 2. Request Object取得

#### GET /oid4vp/request

Identity Walletが使用するRequest Objectを取得します。

**リクエスト**:

```http
GET /oid4vp/request?id=req_abc123 HTTP/1.1
```

**クエリパラメータ**:

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `id` | string | ✓ | リクエストID（UUIDv4） |

**レスポンス** (200 OK):

```json
{
  "response_type": "vp_token id_token",
  "response_mode": "direct_post",
  "response_uri": "http://localhost:3000/oid4vp/responses",
  "client_id": "http://localhost:3000",
  "client_id_scheme": "x509_san_dns",
  "nonce": "n-0S6_WzA2Mj",
  "state": "req_abc123",
  "dcql_query": {
    "credentials": [
      {
        "id": "affiliation_credential",
        "format": "vc+sd-jwt",
        "meta": {
          "vct_values": ["https://example.com/AffiliationCredential"]
        },
        "claims": [
          {
            "path": ["organization"]
          },
          {
            "path": ["portrait"]
          }
        ]
      }
    ]
  }
}
```

**レスポンスボディ**:

OID4VP 1.0 Request Object with DCQL Query（詳細は[OID4VP 1.0仕様](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)を参照）

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `BAD_REQUEST` | クエリパラメータが不正 |
| 404 | - | リクエストが見つからない |

---

### 3. Authorization Response受信

#### POST /oid4vp/responses

Identity WalletからVerifiable Presentationを受信します（Response Endpoint）。

**リクエスト**:

```http
POST /oid4vp/responses HTTP/1.1
Content-Type: application/x-www-form-urlencoded

vp_token=%7B%22affiliation_credential%22%3A%5B%22eyJ0eXAiOi...%22%5D%7D&id_token=eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...&state=req_abc123
```

**リクエストボディ** (application/x-www-form-urlencoded):

| フィールド | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `vp_token` | string | ✓ | VP Token（DCQL形式: `{"credential_id": ["SD-JWT1", "SD-JWT2", ...]}`のJSON文字列） |
| `id_token` | string | ✓ | ID Token（JWT形式） |
| `state` | string | ✓ | リクエスト時のState値（`request_id`） |

**レスポンス** (200 OK):

```json
{
  "redirect_uri": "https://client.example.org/cb#response_code=091535f699ea575c7937fa5f0f454aee"
}
```

**レスポンスボディ**:

| フィールド | 型 | 説明 |
|-----------|---|------|
| `redirect_uri` | string | クライアントへのリダイレクトURI（レスポンスコード含む） |

**検証処理**:
1. ID Tokenの署名検証（JWS/JWT）
2. X.509証明書チェーン検証（x5cヘッダーがある場合）
3. VP Token（DCQL形式）のパース
4. 所属証明クレデンシャル(SD-JWT)の抽出
5. SD-JWTの署名検証およびKey Binding JWT検証
6. Nonceの検証
7. **VP Token検証成功後、自動的にcommitted状態に遷移**
8. レスポンスコードを生成してresponse_codesテーブルに保存

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_PARAMETER` | リクエストボディが不正 |
| 400 | `INVALID_VP_TOKEN` | VP Tokenの形式が不正 |

**環境変数**:

- `OID4VP_VERIFIER_AUTH_RESPONSE_LIMIT`: リクエストボディサイズ制限（デフォルト: 1mb）

---

### 4. Response Code交換

#### POST /oid4vp/response-code/exchange

レスポンスコードを交換してクレデンシャルデータを取得します。

**リクエスト**:

```http
POST /oid4vp/response-code/exchange?response_code=091535f699ea575c7937fa5f0f454aee HTTP/1.1
Cookie: koa.sess=...
```

**クエリパラメータ**:

| パラメータ | 型 | 必須 | 説明 |
|-----------|---|------|------|
| `response_code` | string | ✓ | レスポンスコード（UUID） |

**レスポンス** (200 OK):

```json
{
  "id_token": "eyJhbGciOiJFUzI1NiIsInR5cCI6IkpXVCJ9...",
  "sub": "",
  "icon": "data:image/svg+xml;base64,...",
  "organization": "eyJ0eXAiOiJzZCtqd3QiLCJhbGc..."
}
```

**レスポンスボディ**:

| フィールド | 型 | 説明 |
|-----------|---|------|
| `id_token` | string | ID Token (JWT) |
| `sub` | string | Subject識別子 (未使用) |
| `icon` | string | アイコン画像 (Data URI) |
| `organization` | string | 所属証明クレデンシャル (SD-JWT) |

**セッション**:

- セッションCookieに`request_id`を設定
- セッション状態を`consumed`に更新

**処理フロー**:
1. レスポンスコードの有効性確認（response_codesテーブル）
2. レスポンスコードを使用済みに設定（used=1）
3. 所属証明クレデンシャル(SD-JWT)を検証・抽出
4. データをsessions.credential_dataに保存
5. **VP Token検証成功後、自動的にcommitted状態に遷移**
6. クレデンシャルデータを返却

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_PARAMETER` | レスポンスコードが不正 |
| 404 | - | レスポンスコードが見つからない |
| 410 | `EXPIRED` | レスポンスコードが期限切れ |

---

### 5. 状態取得

#### GET /oid4vp/states

現在のセッション状態を取得します。

**認証**: セッションCookieに`request_id`が必要

**リクエスト**:

```http
GET /oid4vp/states HTTP/1.1
Cookie: koa.sess=...
```

**レスポンス** (200 OK):

```json
{
  "value": "consumed"
}
```

**レスポンスボディ**:

| フィールド | 型 | 説明 |
|-----------|---|------|
| `value` | string | 現在の状態値 |

**状態値一覧**:

| 値 | 説明 | データフロー |
|----|------|------------|
| `started` | 認証リクエスト生成済み | POST /auth-request完了 |
| `committed` | VP Token検証成功・確定済み | POST /response-code/exchange完了時に自動遷移 |
| `expired` | セッション期限切れ | 有効期限超過 |
| `invalid_submission` | 無効な提出 | Presentation Submission検証失敗 |

**セッション**:

`value`が`"committed"`の場合、セッションを無効化

**エラーレスポンス**:

| ステータス | エラータイプ | 説明 |
|-----------|-------------|------|
| 400 | `INVALID_HEADER` | セッションが不正 |
| 404 | - | 状態が見つからない |

---

## 認証・認可

### セッション認証

OID4VP APIはCookie-basedセッション認証を使用します。

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

| フィールド | 型 | 説明 |
|-----------|---|------|
| `request_id` | string | リクエストID（UUIDv4） |
| `transaction_id` | string | トランザクションID（オプション） |

**対象エンドポイント**:
- `POST /oid4vp/response-code/exchange`
- `GET /oid4vp/states`

---

## CORS設定

```typescript
cors({
  origin: process.env.APP_HOST,        // 特定オリジンのみ
  allowMethods: ['POST', 'GET'],       // POSTとGET
  credentials: true                    // Cookie送信を許可
})
```

**環境変数**:
- `APP_HOST`: 許可するオリジン（例: `https://example.com`）

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
| `BAD_REQUEST` | 400 | リクエストが不正 |
| `INVALID_SUBMISSION` | 400 | Presentation Submissionが不正 |
| `NOT_FOUND` | 404 | リソースが見つからない |
| `EXPIRED` | 410 | リソースが期限切れ |
| `INTERNAL_ERROR` | 500 | サーバー内部エラー |

---

## データフロー図

### OID4VP完全フロー

```mermaid
sequenceDiagram
    participant Client as Web Client
    participant Verifier as OID4VP Verifier
    participant Wallet as Identity Wallet
    participant DB as SQLite

    Note over Client,DB: 1. Authorization Request生成
    Client->>Verifier: POST /oid4vp/auth-request
    Verifier->>DB: INSERT sessions (state=started)
    Verifier->>DB: INSERT requests (with DCQL query)
    Verifier-->>Client: OID4VP URI + Set-Cookie

    Note over Client,DB: 2. Wallet側のRequest Object取得
    Wallet->>Verifier: GET /oid4vp/request?id=xxx
    Verifier->>DB: SELECT requests WHERE id=xxx
    Verifier-->>Wallet: Request Object (with dcql_query)

    Note over Client,DB: 3. VP Token提出
    Wallet->>Verifier: POST /oid4vp/responses (vp_token)
    Verifier->>Verifier: VP Token検証
    Verifier->>DB: UPDATE sessions (state=consumed, vp_token=...)
    Verifier->>DB: INSERT response_codes
    Verifier-->>Wallet: redirect_uri + response_code

    Note over Client,DB: 4. Response Code交換とデータ確定
    Client->>Verifier: POST /response-code/exchange?response_code=zzz
    Verifier->>DB: SELECT response_codes WHERE code=zzz
    Verifier->>DB: UPDATE response_codes SET used=1
    Verifier->>DB: UPDATE sessions (credential_data=...)
    Verifier->>DB: UPDATE post_states (value=committed)
    Note right of Verifier: VP Token検証成功後、<br/>自動的にcommitted状態へ
    Verifier-->>Client: Credential Data + Set-Cookie
```

---

## 環境変数

| 変数名 | 説明 | デフォルト |
|-------|------|-----------|
| `OID4VP_REQUEST_HOST` | OID4VP URIスキームのホスト | `oid4vp://localhost` |
| `OID4VP_RESPONSE_URI` | Response EndpointのURI | `http://localhost:3000/oid4vp/responses` |
| `OID4VP_COOKIE_SECRET` | Cookieの署名キー | （必須） |
| `OID4VP_VERIFIER_AUTH_RESPONSE_LIMIT` | VP Tokenのサイズ制限 | `1mb` |
| `APP_HOST` | CORSで許可するオリジン | （必須） |
| `NODE_ENV` | 実行環境（`local`/`production`） | `local` |

---

## ヘルスチェック

### GET /health-check

アプリケーションの稼働状態を確認します。

**リクエスト**:

```http
GET /health-check HTTP/1.1
```

**レスポンス** (204 No Content):

（ボディなし）

---

## まとめ

OID4VP Verifier APIは、OpenID for Verifiable Presentationsプロトコルに準拠した純粋なVerifierとして実装されています：

- **純粋なOID4VP Verifier実装**: 所属証明クレデンシャル(SD-JWT)の検証に特化
- **簡素化されたフロー**: VP Token検証成功後、自動的にcommitted状態へ遷移
- **SQLiteベースの状態管理**: post_statesテーブルで検証フローの状態を追跡
- **セキュアな設計**: SD-JWT検証、X.509証明書チェーン検証、Cookie-basedセッション
- **RESTful API**: 適切なHTTPメソッド、ステータスコード、エラーハンドリング

本APIは、OpenID4VP 1.0 (DCQL)、SD-JWT等の標準仕様に準拠しています。
