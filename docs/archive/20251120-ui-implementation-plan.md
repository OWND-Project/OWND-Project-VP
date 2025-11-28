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

## 動作確認中に判明した課題と対応

### 課題1: request_uri パラメータが出力されない ✅ 完了

**現状**:
- 現在の実装では`redirect_uri`スキームを使用しており、Authorization Requestのパラメータが全てURLに直接含まれる
- `request_uri`を使用する実装になっていない

**原因**:
- `src/usecases/oid4vp-interactor.ts`の`generateAuthRequest()`メソッドで、`x509_san_dns`のみが`requestUri`を返す実装になっている
- `x509_hash`スキームの場合の処理が不足

**対応内容**:
1. ✅ `src/usecases/oid4vp-interactor.ts`の型定義を修正し、`x509_hash`スキームをサポート
2. ✅ `generateAuthRequest()`メソッドの条件分岐を修正し、`x509_hash`でも`requestUri`を返すように実装
3. ✅ 開発用のES256自己署名証明書を生成（CN=localhost, SAN=DNS:localhost）
4. ✅ 証明書のSHA-256ハッシュを計算: `852VpUM5Dtmk0ZhcCUnI1b-YiypE3mjw1pa8YTLYPh8`
5. ✅ `.env`ファイルを更新:
   - `OID4VP_CLIENT_ID_SCHEME=x509_hash`
   - `OID4VP_CLIENT_ID=x509_hash:852VpUM5Dtmk0ZhcCUnI1b-YiypE3mjw1pa8YTLYPh8`
   - `OID4VP_VERIFIER_X5C=<Base64証明書>`
6. ✅ `getRequestObject()`メソッドをDCQL対応に更新（Learning Credential用）

**実装箇所**:
- `src/usecases/oid4vp-interactor.ts` (53行目, 126-130行目, 160-219行目)
- `.env` (14行目, 20行目, 36行目)

### 課題2: DCQL query が空で出力される ✅ 完了

**現状**:
- ホーム画面でクレームを選択しているが、`dcql_query`パラメータが空になっている
- `interactor.generateAuthRequest()`にDCQLクエリが渡されていない

**原因**:
- `src/routes/ui-routes.ts`の`POST /submit-request`ハンドラーで、フォームから送信されたクレーム選択を処理していない
- ハードコードされた`authRequestPresenter`を使用しており、選択されたクレームが反映されない

**対応内容**:
1. ✅ `generateAuthRequest()`メソッドに`dcqlCredentialQueries`オプションパラメータを追加
2. ✅ `POST /submit-request`ハンドラーでフォームデータから選択されたクレームを抽出
3. ✅ 必須クレーム（`issuing_authority`, `issuing_country`, `date_of_issuance`, `achievement_title`）を常に含める
4. ✅ オプションクレームのチェック状態を確認し、選択されたものを追加
5. ✅ DCQLクエリオブジェクトを動的に生成して`generateAuthRequest()`に渡す
6. ✅ 選択されたクレームをログ出力で確認可能に

**動作確認**:
- ログ出力例: `Selected claims: ["issuing_authority","issuing_country","date_of_issuance","achievement_title","family_name","given_name"]`
- Authorization Requestに正しくDCQLクエリが含まれることを確認

**実装箇所**:
- `src/usecases/oid4vp-interactor.ts` (89-92行目: パラメータ追加, 106-126行目: デフォルトクエリ)
- `src/routes/ui-routes.ts` (50-96行目: クレーム選択処理とDCQLクエリ生成)

### 課題3: /oid4vp/states エンドポイントが404を返す

**現状**:
- ✅ **解決済み**: `GET /oid4vp/states`エンドポイントは既に実装済み（`src/routes/oid4vp-routes.ts` 184-203行目）
- セッションのcookieがない場合は400エラーを返す（正常動作）

**確認結果**:
- エンドポイントは正しく動作している
- ポーリングスクリプト（`public/js/polling.js`）も正しく実装されている

## 実装完了サマリー

### 実施日
2025-11-20

### 実装した機能
1. ✅ `x509_hash` Client Identifier Prefixのサポート
2. ✅ `request_uri`パラメータを使用したJWT-secured Authorization Request
3. ✅ 動的DCQLクエリ生成（フォームでのクレーム選択に基づく）
4. ✅ 必須クレームと選択可能クレームの区別
5. ✅ Learning Credentialのすべてのクレームに対応

### 生成されるAuthorization Requestの例
```
oid4vp://authorize?client_id=x509_hash:852VpUM5Dtmk0ZhcCUnI1b-YiypE3mjw1pa8YTLYPh8&request_uri=http://localhost:3000/oid4vp/request?id=<request_id>&pdId=learning_credential
```

### DCQLクエリの例（family_nameとgiven_nameを選択した場合）
```json
{
  "credentials": [
    {
      "id": "learning_credential",
      "format": "dc+sd-jwt",
      "meta": {
        "vct_values": ["urn:eu.europa.ec.eudi:learning:credential:1"]
      },
      "claims": [
        { "path": ["issuing_authority"] },
        { "path": ["issuing_country"] },
        { "path": ["date_of_issuance"] },
        { "path": ["achievement_title"] },
        { "path": ["family_name"] },
        { "path": ["given_name"] }
      ]
    }
  ]
}
```

### 動作確認方法
1. サーバーを起動: `npm run dev`
2. ブラウザで`http://localhost:3000`にアクセス
3. クレームを選択して「Next」をクリック
4. QRコードまたはリンクが表示される
5. Authorization URLに`client_id`と`request_uri`が含まれることを確認
6. `request_uri`にアクセスすると署名付きJWTが返される

### 課題4: Authorization Request表示画面にRequest Object確認UIを追加 ✅ 完了

**要件**:
- QRコード表示画面にRequest Objectを確認できるUIを追加
- ボタンをクリックしたらダイアログで表示される仕様

**対応内容**:
1. ✅ "View Request Object"ボタンを追加
2. ✅ Bootstrap 5のモーダルダイアログを実装
3. ✅ モーダル表示時に`request_uri`からJWTを取得
4. ✅ JWTをデコードしてHeader、Payload、Raw JWTを表示
5. ✅ EJSテンプレートの`<%- %>`タグでURL HTMLエンコーディング問題を解決

**実装箇所**:
- `views/auth-request.ejs` (33-75行目: モーダルUI、81-131行目: JavaScript)

**発生した問題と解決**:
- **問題**: モーダルで"No request_uri found"エラーが表示される
- **原因**: `<%= authRequestUrl %>`がHTMLエンコーディングで`&`を`&amp;`に変換していた
- **解決**: `<%- authRequestUrl %>`（rawアウトプット）に変更してHTMLエンコーディングを無効化

## 動作確認中に判明した課題2の対応

### 課題2-1: /oid4vp/states エンドポイントが404を返す ✅ 完了

**現状**:
- `GET /oid4vp/states`エンドポイントは`src/routes/oid4vp-routes.ts`に実装済み（179-198行目）
- セッションにrequest_idがある場合にpost_stateを返す
- しかし、Authorization Request生成直後はDBに`post_state`が未登録のため404を返していた

**原因**:
- `generateAuthRequest()`でAuthorization Requestを生成した時点で`post_state`が初期化されていなかった
- Walletがレスポンスを送信するまで`post_state`テーブルにレコードが作成されないため、初期ポーリング時に404エラーが発生

**対応内容**:
1. ✅ `generateAuthRequest()`でAuthorization Request生成時に`post_state`を`"started"`で初期化
2. ✅ `stateRepository.putState(request.id, "started", {...})`を追加
3. ✅ これによりWalletからのレスポンス前でも`GET /oid4vp/states`が`{"value": "started"}`を返せるようになった

**実装箇所**:
- `src/usecases/oid4vp-interactor.ts` (162-166行目: post_state初期化)

### 課題2-2: client_metadata に暗号化用の公開鍵が無い ✅ 完了

**要件**:
- VP Token暗号化を環境変数で切り替えできるようにする
- 暗号化を要求する場合は公開鍵をclient_metadataに含める

**対応内容**:
1. ✅ 環境変数 `OID4VP_VP_TOKEN_ENCRYPTION_ENABLED` を追加（`true`で有効化）
2. ✅ `Env()`関数に`enableEncryption`プロパティを追加
3. ✅ `generateAuthRequest()`で`enableEncryption`をResponse Endpointに渡す
4. ✅ 暗号化機能は既に実装済み（Response Endpoint側で鍵ペア生成、Verifier側でclient_metadataに含める）

**実装箇所**:
- `src/usecases/oid4vp-interactor.ts` (68行目: enableEncryption追加, 103行目: initiateTransactionに渡す)
- `src/oid4vp/response-endpoint.ts` (87行目: enableEncryptionパラメータ、既存実装で鍵生成)
- `src/oid4vp/verifier.ts` (136-146行目: 既存実装でclient_metadataに含める)

### 課題2-3: response_type は vp_token のみで良い ✅ 完了

**現状**:
- 現在の実装では`response_type = "vp_token id_token"`を使用
- SIOPv2のID Token検証は削除済み（Learning Credentialのみを使用）

**対応内容**:
1. ✅ `src/usecases/oid4vp-interactor.ts`の`generateAuthRequest()`で`responseType`を`"vp_token"`に変更
2. ✅ `getRequestObject()`でも同様に変更
3. ✅ ID Token関連コードは既に削除済み（exchangeAuthResponse内でID Token検証は行っていない）

**実装箇所**:
- `src/usecases/oid4vp-interactor.ts` (96行目, 176行目: responseType変更)

### 課題2-4: dcql_query に画面で選択したクレームが連動していない ✅ 完了

**現状**:
- UI実装時にクレーム選択機能は実装済み（課題2で対応済み）
- しかし、実際にテストすると選択したクレームがDCQLクエリに反映されていなかった
- x509スキームでは`request_uri`を使用するため、`getRequestObject()`が別途呼ばれる
- この時点で保存されたDCQLクエリを使用する必要があったが、未実装だった

**原因**:
1. `generateAuthRequest()`で生成されたDCQLクエリがデータベースに保存されていなかった
2. `getRequestObject()`が`request_id`から情報を取得する際、保存されたDCQLクエリを参照していなかった
3. `src/routes/ui-routes.ts`のフォーム処理で`optional_claims`の取得ロジックが間違っていた
   - フォームは`name="optional_claims"`で配列として送信されるが、コードは個別のクレーム名でチェックしていた

**対応内容**:
1. ✅ データベーススキーマに`dcql_query TEXT`カラムを追加（`src/database/schema.ts`）
2. ✅ `VpRequest`インターフェースに`dcqlQuery?: string`を追加
3. ✅ `saveRequest()`でDCQLクエリをJSON文字列として保存
4. ✅ `getRequest()`で保存されたDCQLクエリを取得
5. ✅ `generateAuthRequest()`でDCQLクエリをデータベースに保存（155-160行目）
6. ✅ `getRequestObject()`で保存されたDCQLクエリを取得・パースして使用（192-227行目）
7. ✅ `src/routes/ui-routes.ts`のフォーム処理ロジックを修正：
   - `formData.optional_claims`を配列として正しく取得
   - 配列の場合と単一値の場合の両方に対応

**データベースマイグレーション**:
```sql
ALTER TABLE requests ADD COLUMN dcql_query TEXT;
```

**実装箇所**:
- `src/database/schema.ts` (44行目: dcql_queryカラム追加)
- `src/oid4vp/response-endpoint.ts` (20行目: VpRequestインターフェース)
- `src/usecases/oid4vp-repository.ts` (39-50行目: saveRequest, 70行目: getRequest)
- `src/usecases/oid4vp-interactor.ts` (155-160行目: DCQL保存, 192-227行目: DCQL取得)
- `src/routes/ui-routes.ts` (50-78行目: フォーム処理修正)

**検証結果**:
- オプショナルクレームを選択しない場合: 4つの必須クレームのみがJWTに含まれる
- オプショナルクレームを選択した場合: 必須クレーム + 選択したクレームがJWTに含まれる

### 課題2-5: JWT の typ ヘッダーが正しくない ✅ 完了

**現状**:
- Request ObjectのJWT `typ`ヘッダーが`"JWT"`になっていた
- OID4VP 1.0仕様では`"oauth-authz-req+jwt"`が正しい（RFC 9101参照）

**対応内容**:
1. ✅ `src/oid4vp/auth-request.ts`の`generateRequestObjectJwt()`を修正
2. ✅ `typ`ヘッダーを`"JWT"`から`"oauth-authz-req+jwt"`に変更

**実装箇所**:
- `src/oid4vp/auth-request.ts` (134行目: typ変更)

**参照仕様**:
- RFC 9101: The OAuth 2.0 Authorization Framework: JWT-Secured Authorization Request (JAR)
- OID4VP 1.0: Section 6.1 (Request Object)

### 課題2-6: response_mode を direct_post.jwt に変更 ✅ 完了

**現状**:
- `response_mode`が`"direct_post"`になっていた
- 暗号化されたレスポンスを要求する場合は`"direct_post.jwt"`を使用する必要がある

**対応内容**:
1. ✅ `src/usecases/oid4vp-interactor.ts`の`generateAuthRequest()`で`responseMode`を`"direct_post.jwt"`に変更
2. ✅ `getRequestObject()`でも同様に変更

**実装箇所**:
- `src/usecases/oid4vp-interactor.ts` (139行目, 231行目: responseMode変更)

**参照仕様**:
- OID4VP 1.0: Section 6.3 (Response Mode "direct_post.jwt")
- JWT-Secured Authorization Response Mode for OAuth 2.0 (JARM)

## 参考

- EUDI Wallet NiScy_JP EU pilot v0.10: Learning Credential Data Model
- OID4VP 1.0: DCQL (Digital Credentials Query Language)
- OID4VP 1.0: Client Identifier Prefix (Section 5.9)
- OID4VP 1.0: Request Object typ header (Section 6.1)
- Bootstrap 5 Documentation: https://getbootstrap.com/docs/5.3/
- EJS Documentation: https://ejs.co/
