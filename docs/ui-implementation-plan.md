# UI実装計画書

## 概要

VerifierシステムにUIを実装して、Learning Credentialを要求できる機能を追加します。

## 技術スタック

- **テンプレートエンジン**: EJS (Embedded JavaScript)
- **CSSフレームワーク**: Bootstrap 5 (CDN経由)
- **QRコード生成**: qrcode パッケージ
- **レンダリング方式**: サーバーサイドレンダリング (SSR)

## アーキテクチャ

```
src/
├── routes/
│   ├── ui-routes.ts          # 新規: UI用ルーティング
│   └── oid4vp-routes.ts       # 既存: API用ルーティング
├── views/                     # 新規: EJSテンプレート
│   ├── home.ejs              # ホーム画面（クレーム選択）
│   ├── auth-request.ejs      # Authorization Request表示画面
│   ├── credential-info.ejs   # クレデンシャル情報表示
│   └── error.ejs             # エラー画面
└── public/                    # 新規: 静的ファイル（必要に応じて）
    └── js/
        └── polling.js         # post_statesポーリングスクリプト
```

## 画面仕様

### 1. ホーム画面 (`/`)

**目的**: Learning Credentialのクレーム選択

**UI要素**:
- タイトル: "Learning Credential Request"
- クレーム選択セクション:
  - **必須クレーム** (読み取り専用、チェック済み):
    - `issuing_authority` (発行機関)
    - `issuing_country` (発行国)
    - `date_of_issuance` (発行日)
    - `achievement_title` (達成タイトル)
  - **選択可能クレーム** (チェックボックス):
    - `family_name` (姓)
    - `given_name` (名)
    - `achievement_description` (達成説明)
    - `learning_outcomes` (学習成果)
    - `assessment_grade` (評価/成績)
- 「Next」ボタン: Authorization Request表示画面へ遷移

**動作**:
1. 選択されたクレームを収集
2. `POST /oid4vp/auth-request` (既存API) を呼び出し、`dcql_query`を生成
3. Authorization Request表示画面へリダイレクト

### 2. Authorization Request表示画面 (`/auth-request`)

**目的**: 生成されたAuthorization RequestをQRコード/リンクで表示

**UI要素**:
- タイトル: "Scan QR Code or Click Link"
- QRコード表示エリア
- リンク表示 (クリッカブル)
- ステータス表示: "Waiting for response..."
- ローディングインジケーター

**動作**:
1. `GET /oid4vp/states` (既存API) を定期的にポーリング (3秒間隔)
2. ステータスに応じて遷移:
   - `committed` → クレデンシャル情報表示画面へ
   - `expired` または `invalid_submission` → エラー画面へ
   - `pending` → ポーリング継続

**ポーリング実装**:
```javascript
// polling.js
const pollInterval = 3000; // 3秒

async function pollStatus() {
  try {
    const response = await fetch('/oid4vp/states');
    if (!response.ok) {
      throw new Error('Failed to fetch status');
    }
    const data = await response.json();

    if (data.value === 'committed') {
      window.location.href = '/credential-info';
    } else if (data.value === 'expired' || data.value === 'invalid_submission') {
      window.location.href = `/error?type=${data.value}`;
    } else {
      // Continue polling
      setTimeout(pollStatus, pollInterval);
    }
  } catch (error) {
    console.error('Polling error:', error);
    setTimeout(pollStatus, pollInterval);
  }
}

// Start polling on page load
window.addEventListener('DOMContentLoaded', () => {
  pollStatus();
});
```

### 3. クレデンシャル情報表示画面 (`/credential-info`)

**目的**: Walletから提供されたクレデンシャル情報を表示

**UI要素**:
- タイトル: "Received Credential Information"
- クレデンシャル情報テーブル:
  - 各フィールド名と値を表形式で表示
  - 提供されたクレームのみ表示
- 「New Request」ボタン: ホーム画面へ戻る

**動作**:
1. セッションに保存された`request_id`を使用
2. 新規API `GET /oid4vp/credential-data` でクレデンシャル情報を取得
   - `request_id`を元に`sessions`テーブルから`credential_data`を取得
   - `credential_data`には以下が含まれる:
     - `idToken`: ID Token (JWT)
     - `learningCredentialJwt`: Learning Credential (SD-JWT)
3. 取得したクレデンシャル情報をパース・表示

### 4. エラー画面 (`/error`)

**目的**: エラー発生時の情報表示

**UI要素**:
- タイトル: "Error"
- エラータイプに応じたメッセージ:
  - `expired`: "The request has expired. Please try again."
  - `invalid_submission`: "Invalid credential submission."
  - `unknown`: "An unexpected error occurred."
- 「Back to Home」ボタン: ホーム画面へ戻る

**動作**:
1. クエリパラメータ `type` からエラータイプを取得
2. エラーメッセージを表示

## データフロー

```
[ホーム画面]
    ↓ クレーム選択 → POST /oid4vp/auth-request
    ↓ Authorization Request生成、session.request_idに保存
[Authorization Request表示画面]
    ↓ QR表示 + ポーリング開始
    ↓ (Wallet側) VP Token送信 → POST /oid4vp/responses
    ↓ (バックエンド) credential_dataをsessionsテーブルに保存
    ↓ GET /oid4vp/states (ポーリング、3秒間隔)
    ↓ status = committed
[クレデンシャル情報表示画面]
    ↓ GET /oid4vp/credential-data (session.request_idを使用)
    ↓ sessionsテーブルからcredential_data取得
    ↓ SD-JWTをパースしてLearning Credential情報抽出
    表示完了
```

## 既存APIとの連携

既存のAPIエンドポイントを使用し、新規エンドポイントを1つ追加します:

1. **POST /oid4vp/auth-request**: Authorization Request生成（既存）
2. **GET /oid4vp/states**: ステータス取得（既存、ポーリング用）
3. **GET /oid4vp/credential-data**: クレデンシャル情報取得（新規）
   - `request_id`（セッションから取得）を使用
   - `sessions`テーブルの`credential_data`カラムから取得
   - レスポンス例:
     ```json
     {
       "idToken": "eyJhbGci...",
       "learningCredential": {
         "issuing_authority": "Tokyo University",
         "issuing_country": "JP",
         "date_of_issuance": "2025-01-15",
         "family_name": "山田",
         "given_name": "太郎",
         "achievement_title": "Introduction to Computer Science",
         "achievement_description": "Basic CS course",
         "learning_outcomes": "Understanding of algorithms",
         "assessment_grade": "A"
       }
     }
     ```

## セッション管理

Koa-sessionを使用して以下を管理:
- `request_id`: Authorization Requestの識別子
- `transaction_id`: トランザクション識別子（オプション）

## 必要なパッケージ

```json
{
  "dependencies": {
    "koa-ejs": "^4.3.0",
    "qrcode": "^1.5.3"
  },
  "devDependencies": {
    "@types/qrcode": "^1.5.5"
  }
}
```

## 実装順序

1. **Phase 1**: 環境セットアップ
   - パッケージインストール
   - EJS設定
   - 静的ファイルサービング設定

2. **Phase 2**: バックエンド拡張
   - `SessionRepository`に`getSessionByRequestId`メソッド追加
   - `OID4VPInteractor`に`getCredentialData`メソッド追加
   - 新規APIエンドポイント `GET /oid4vp/credential-data` 追加

3. **Phase 3**: ホーム画面実装
   - `views/home.ejs` 作成
   - `src/routes/ui-routes.ts` 作成
   - クレーム選択フォーム実装

4. **Phase 4**: Authorization Request表示画面実装
   - `views/auth-request.ejs` 作成
   - QRコード生成機能実装
   - ポーリングスクリプト実装

5. **Phase 5**: クレデンシャル情報表示画面実装
   - `views/credential-info.ejs` 作成
   - クレデンシャル情報取得・表示機能実装

6. **Phase 6**: エラー画面実装
   - `views/error.ejs` 作成
   - エラーハンドリング実装

7. **Phase 7**: 統合テスト
   - フルフロー動作確認
   - エラーケーステスト

## セキュリティ考慮事項

- **CSRF対策**: フォーム送信時にCSRFトークンを使用（Koa-sessionで管理）
- **セッション管理**: セキュアなセッションCookie設定
- **XSS対策**: EJSの自動エスケープ機能を使用
- **入力検証**: クレーム選択の妥当性チェック

## Bootstrap 5 使用方法

CDN経由で読み込み、追加のビルドプロセスを不要にします:

```html
<!-- Bootstrap CSS -->
<link href="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/css/bootstrap.min.css" rel="stylesheet">

<!-- Bootstrap JavaScript Bundle -->
<script src="https://cdn.jsdelivr.net/npm/bootstrap@5.3.0/dist/js/bootstrap.bundle.min.js"></script>
```

## Learning Credential クレーム一覧

### 必須クレーム (Always Requested)
| クレーム名 | 説明 | Selective Disclosure |
|-----------|------|---------------------|
| `issuing_authority` | 発行機関名 | Never |
| `issuing_country` | 発行国 (ISO 3166-1 Alpha-2) | Never |
| `date_of_issuance` | 発行日 (YYYY-MM-DD) | Never |
| `achievement_title` | コース/マイクロクレデンシャルの公式タイトル | Never |

### 選択可能クレーム (Optional)
| クレーム名 | 説明 | Selective Disclosure |
|-----------|------|---------------------|
| `family_name` | 姓 | Always |
| `given_name` | 名 | Always |
| `achievement_description` | 達成の説明 | Never |
| `learning_outcomes` | 学習成果の説明 | Never |
| `assessment_grade` | 評価/成績 | Never |

## 参考

- EUDI Wallet NiScy_JP EU pilot v0.10: Learning Credential Data Model
- OID4VP 1.0: DCQL (Digital Credentials Query Language)
- Bootstrap 5 Documentation: https://getbootstrap.com/docs/5.3/
- EJS Documentation: https://ejs.co/
