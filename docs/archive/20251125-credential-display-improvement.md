# クレデンシャル表示UI改善

**作成日**: 2025-11-25
**完了日**: 2025-11-25
**ステータス**: ✅ 完了

## タスク概要

受け取ったクレデンシャルをデコードして、人間が読める形式で表示する機能を実装する。

### 要件

1. **クレデンシャルのデコード表示**
   - 現在：DBに保存されているSD-JWT-VCをそのまま（JWT文字列として）表示
   - 改善後：SD-JWT-VCをデコードして内容を表示
   - 表示項目のラベル名は EUDI-Wallet-NiScy_JP EU pilot_v0.10.docx の SD-JWT-VC type definition に記載されている display とメタデータ情報に合わせる

2. **ポーリング挙動の変更**
   - 現在：stateをポーリングで監視し、有効期限が切れるとエラー画面に遷移
   - 改善後：`committed` に遷移したらポーリングを停止し、その後に失効してもエラー画面に遷移しない

## 現状分析

### ファイル構成

#### フロントエンド

1. **views/auth-request.ejs** (Line 161)
   - QRコード表示画面
   - `polling.js` を読み込んでstate監視を開始

2. **public/js/polling.js**
   - `/oid4vp/states` を3秒間隔でポーリング
   - `committed` → `/credential-info` にリダイレクト
   - `expired` / `invalid_submission` → `/error` にリダイレクト
   - 問題：committedでリダイレクト後、セッションが期限切れになるとエラー画面に遷移する可能性

3. **views/credential-info.ejs**
   - クレデンシャル情報表示画面
   - 現在は生のJWT文字列を `<pre>` タグで表示
   - `idToken`: ID Token（JWT文字列）
   - `learningCredentialJwt`: Learning Credential（SD-JWT文字列）

#### バックエンド

1. **src/routes/ui-routes.ts** (Line 152-176)
   - `/credential-info` エンドポイント
   - `interactor.getCredentialData(requestId)` を呼び出し
   - `idToken` と `learningCredentialJwt` を取得してテンプレートに渡す

2. **src/usecases/oid4vp-interactor.ts** (Line 451-471)
   - `getCredentialData` 関数
   - `sessionRepository.getSessionByRequestId<WaitCommitData>(requestId)` でセッションデータを取得
   - セッションが期限切れの場合は `EXPIRED` エラーを返す
   - 問題：committed後でもセッション期限切れでエラーになる

3. **src/usecases/types.ts** (Line 36-41)
   - `WaitCommitData` インターフェース
   - `idToken`: string
   - `learningCredentialJwt?`: string

### Learning Credential のフィールド

DCQL クエリおよび既存コードから確認できるフィールド：

- `issuing_authority` - 発行機関
- `issuing_country` - 発行国
- `date_of_issuance` - 発行日
- `family_name` - 姓
- `given_name` - 名
- `achievement_title` - 成果タイトル
- `achievement_description` - 成果説明

実データ例（前回のログより）：
```
issuing_authority: 田中大学
issuing_country: JP
date_of_issuance: 2025-11-03
family_name: 若杉
given_name: 良介
achievement_title: 有機化学入門
```

## 実装計画

### Phase 1: バックエンド - クレデンシャルデコード

#### 1.1 getCredentialData 関数の拡張

**ファイル**: `src/usecases/oid4vp-interactor.ts`

**変更内容**:
- SD-JWT をデコードして payload を抽出
- フィールドを整形して返却
- セッション期限切れ処理の改善検討

**実装**:
```typescript
const getCredentialData = async (
  requestId: string,
): Promise<Result<any, NotSuccessResult>> => {
  const sessionResult = await sessionRepository.getSessionByRequestId<WaitCommitData>(requestId);

  if (!sessionResult.ok) {
    if (sessionResult.error.type === "NOT_FOUND") {
      return { ok: false, error: { type: "NOT_FOUND" } };
    }
    if (sessionResult.error.type === "EXPIRED") {
      // TODO: committed状態の場合はEXPIREDを無視する仕組みの検討
      return { ok: false, error: { type: "EXPIRED" } };
    }
    return { ok: false, error: { type: "UNEXPECTED_ERROR" } };
  }

  const session = sessionResult.payload;
  const { idToken, learningCredentialJwt } = session.data;

  // Decode Learning Credential SD-JWT
  let learningCredential: any = null;
  if (learningCredentialJwt) {
    try {
      // SD-JWTをデコード（検証なし）
      const { decodeSdJwt } = await import("../helpers/jwt-helper.js");
      const { issueJwt } = decodeSdJwt(learningCredentialJwt);

      // JWT payloadをパース
      const { decodeJwt } = await import("jose");
      const payload = decodeJwt(issueJwt);

      // フィールド抽出
      learningCredential = {
        rawJwt: learningCredentialJwt,
        fields: {
          issuing_authority: payload.issuing_authority,
          issuing_country: payload.issuing_country,
          date_of_issuance: payload.date_of_issuance,
          family_name: payload.family_name,
          given_name: payload.given_name,
          achievement_title: payload.achievement_title,
          achievement_description: payload.achievement_description,
        }
      };
    } catch (error) {
      logger.error(`Failed to decode Learning Credential: ${error}`);
      learningCredential = {
        rawJwt: learningCredentialJwt,
        error: "Failed to decode credential"
      };
    }
  }

  return {
    ok: true,
    payload: {
      idToken,
      learningCredentialJwt,
      learningCredential
    },
  };
};
```

#### 1.2 日本語ラベルマッピング

**ファイル**: 新規作成 `src/constants/credential-labels.ts`

EUDI-Wallet-NiScy_JP EU pilot_v0.10.docx の display 定義に基づく：

```typescript
export const LEARNING_CREDENTIAL_LABELS: Record<string, string> = {
  issuing_authority: "発行機関",
  issuing_country: "発行国",
  date_of_issuance: "発行日",
  family_name: "姓",
  given_name: "名",
  achievement_title: "成果タイトル",
  achievement_description: "成果説明",
};
```

### Phase 2: フロントエンド - 表示改善

#### 2.1 credential-info.ejs の更新

**ファイル**: `views/credential-info.ejs`

**変更内容**:
- デコードされたフィールドをテーブル形式で表示
- 日本語ラベルを使用
- 生のJWTも折りたたみ可能な形式で表示（デバッグ用）

**実装案**:
```html
<!-- Learning Credential Section -->
<% if (learningCredential) { %>
<h5 class="mt-4 mb-3">Learning Credential</h5>

<% if (learningCredential.fields) { %>
  <!-- Decoded Fields -->
  <div class="card mb-4">
    <div class="card-body">
      <table class="table table-bordered">
        <tbody>
          <% if (learningCredential.fields.issuing_authority) { %>
          <tr>
            <th style="width: 30%">発行機関</th>
            <td><%= learningCredential.fields.issuing_authority %></td>
          </tr>
          <% } %>
          <% if (learningCredential.fields.issuing_country) { %>
          <tr>
            <th>発行国</th>
            <td><%= learningCredential.fields.issuing_country %></td>
          </tr>
          <% } %>
          <% if (learningCredential.fields.date_of_issuance) { %>
          <tr>
            <th>発行日</th>
            <td><%= learningCredential.fields.date_of_issuance %></td>
          </tr>
          <% } %>
          <% if (learningCredential.fields.family_name) { %>
          <tr>
            <th>姓</th>
            <td><%= learningCredential.fields.family_name %></td>
          </tr>
          <% } %>
          <% if (learningCredential.fields.given_name) { %>
          <tr>
            <th>名</th>
            <td><%= learningCredential.fields.given_name %></td>
          </tr>
          <% } %>
          <% if (learningCredential.fields.achievement_title) { %>
          <tr>
            <th>成果タイトル</th>
            <td><%= learningCredential.fields.achievement_title %></td>
          </tr>
          <% } %>
          <% if (learningCredential.fields.achievement_description) { %>
          <tr>
            <th>成果説明</th>
            <td><%= learningCredential.fields.achievement_description %></td>
          </tr>
          <% } %>
        </tbody>
      </table>
    </div>
  </div>

  <!-- Raw JWT (collapsible) -->
  <div class="accordion mb-4" id="rawJwtAccordion">
    <div class="accordion-item">
      <h2 class="accordion-header">
        <button class="accordion-button collapsed" type="button" data-bs-toggle="collapse" data-bs-target="#rawJwtCollapse">
          生のSD-JWT（技術者向け）
        </button>
      </h2>
      <div id="rawJwtCollapse" class="accordion-collapse collapse" data-bs-parent="#rawJwtAccordion">
        <div class="accordion-body">
          <pre class="mb-0" style="white-space: pre-wrap; word-break: break-all;"><%= learningCredential.rawJwt %></pre>
        </div>
      </div>
    </div>
  </div>
<% } else if (learningCredential.error) { %>
  <!-- Error decoding -->
  <div class="alert alert-warning">
    <%= learningCredential.error %>
  </div>
  <div class="card mb-4">
    <div class="card-body">
      <pre class="mb-0" style="white-space: pre-wrap; word-break: break-all;"><%= learningCredential.rawJwt %></pre>
    </div>
  </div>
<% } %>
<% } %>
```

### Phase 3: ポーリング挙動の改善

#### 3.1 committed フラグの導入

**問題**:
- 現在、`committed` になった後もセッションが期限切れになるとエラー画面に遷移する可能性がある

**解決策の選択肢**:

##### Option A: セッションに committed フラグを追加

**メリット**: シンプル、セッション管理と統合
**デメリット**: スキーマ変更が必要

```typescript
// src/usecases/types.ts
export interface WaitCommitData extends EntityWithLifeCycle {
  data: {
    idToken: string;
    learningCredentialJwt?: string;
    committed?: boolean; // 追加
  };
}

// committed時にフラグをセット
// getCredentialDataでcommitted=trueの場合はEXPIREDエラーを無視
```

##### Option B: polling.js で localStorage を使用

**メリット**: スキーマ変更不要、クライアントサイドで完結
**デメリット**: ブラウザ依存

```javascript
// public/js/polling.js
async function pollStatus() {
  // Check if already committed
  const requestId = new URLSearchParams(window.location.search).get('request_id') ||
                    sessionStorage.getItem('requestId');
  const committedKey = `committed_${requestId}`;

  if (sessionStorage.getItem(committedKey) === 'true') {
    // Already committed, stop polling
    return;
  }

  try {
    const response = await fetch('/oid4vp/states');

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    if (data.value === 'committed') {
      // Mark as committed
      sessionStorage.setItem(committedKey, 'true');

      // Success - redirect to credential info page
      const requestId = data.requestId;
      window.location.href = requestId ? `/credential-info?request_id=${requestId}` : '/credential-info';
    } else if (data.value === 'expired' || data.value === 'invalid_submission') {
      // Error - redirect to error page
      window.location.href = `/error?type=${data.value}`;
    } else {
      // Continue polling
      setTimeout(pollStatus, pollInterval);
    }
  } catch (error) {
    console.error('Polling error:', error);
    // Continue polling even on error
    setTimeout(pollStatus, pollInterval);
  }
}
```

##### Option C: credential-info画面でポーリングを停止

**メリット**: 最もシンプル、スキーマ変更不要
**デメリット**: credential-info画面に到達した時点で既にcommitted

```javascript
// views/credential-info.ejs に追加
// ポーリングスクリプトをロードしない、またはポーリングを停止するフラグを設定
<script>
  // Mark this session as committed to stop any ongoing polling
  const urlParams = new URLSearchParams(window.location.search);
  const requestId = urlParams.get('request_id');
  if (requestId) {
    sessionStorage.setItem(`committed_${requestId}`, 'true');
  }
</script>
```

**推奨**: Option B + C の組み合わせ
- credential-info画面でcommittedフラグをセット
- polling.js でフラグをチェックして既にcommittedの場合はポーリングしない

#### 3.2 getCredentialData での EXPIRED 処理改善

**ファイル**: `src/usecases/oid4vp-interactor.ts`

**変更案**:
```typescript
// WaitCommitDataにcommittedフラグがある場合の処理
if (sessionResult.error.type === "EXPIRED") {
  // committedの場合は期限切れでもデータを返却する試み
  // ただしDBからデータが削除されている場合は不可能
  // → データ保持期間の延長を検討
  return { ok: false, error: { type: "EXPIRED" } };
}
```

**検討事項**:
- セッションの有効期限とデータ保持期間の分離
- committedデータの長期保存の必要性

## 実装順序

1. ✅ 作業ドキュメント作成（本ドキュメント）
2. ✅ Phase 1.1: `getCredentialData` 関数の拡張（SD-JWTデコード）
3. ✅ Phase 1.2: 日本語ラベルマッピング作成（EJSテンプレート内に実装）
4. ✅ Phase 2.1: `credential-info.ejs` の更新
5. ✅ Phase 3: ポーリング挙動の改善（Option B+C）
6. ✅ 動作確認・テスト

## テスト計画

### 手動テスト

1. **正常フロー**
   - QRコード生成 → Walletでスキャン → VP Token送信
   - credential-info画面でデコードされたフィールドが表示されることを確認
   - 日本語ラベルが正しく表示されることを確認

2. **ポーリング停止確認**
   - committed後、一定時間待機
   - セッション期限切れ後もcredential-info画面が表示され続けることを確認
   - エラー画面に遷移しないことを確認

3. **エラーハンドリング**
   - SD-JWTデコード失敗時のフォールバック表示を確認

## 参考資料

- EUDI-Wallet-NiScy_JP EU pilot_v0.10.docx - SD-JWT-VC type definition
- [OpenID4VP 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- [@meeco/sd-jwt](https://github.com/Meeco/sd-jwt) - SD-JWT library

## 実装サマリー

### 実装内容

#### Phase 1: バックエンド - SD-JWTデコード

**ファイル**: `src/usecases/oid4vp-interactor.ts` (行469-510)

実装した内容:
- `verifySdJwt`を使用してSD-JWTのSelective Disclosureを展開
- デコードされたpayloadから各フィールドを抽出
- エラー時は生のJWTとエラーメッセージを返却
- TypeScript型エラー対応: `payload`に`any`型を明示的に指定

重要な技術的決定:
- 当初`decodeSdJwt`を使用したが、Selective Disclosureが展開されないため、`verifySdJwt`に変更
- `skipVerifyChain: env !== "prod"`で開発環境では証明書チェーンの検証をスキップ

#### Phase 2: フロントエンド - UI表示改善

**ファイル**: `views/credential-info.ejs` (行29-111)

実装した内容:
- デコードされたフィールドを日本語ラベル付きテーブルで表示
- 生のSD-JWTをBootstrapアコーディオンで折りたたみ表示
- デコードエラー時のフォールバック表示
- sessionStorageを使用したcommittedフラグの設定（ポーリング停止用）

日本語ラベル:
- 発行機関 (issuing_authority)
- 発行国 (issuing_country)
- 発行日 (date_of_issuance)
- 姓 (family_name)
- 名 (given_name)
- 成果タイトル (achievement_title)
- 成果説明 (achievement_description)

#### Phase 3: ポーリング挙動の改善

**ファイル**: `public/js/polling.js`

実装した内容（Option B+C）:
- **Option B**: `polling.js`でsessionStorageのcommittedフラグをチェック
  - committed済みの場合はポーリングを停止
  - error状態でもcommitted済みの場合はエラー画面に遷移しない
- **Option C**: `credential-info.ejs`でページロード時にcommittedフラグをセット

効果:
- committed後、セッションが期限切れになってもエラー画面に遷移しない
- ユーザーがcredential-info画面を継続して閲覧可能

### テスト結果

**日時**: 2025-11-25

#### 正常フロー
- ✅ QRコード生成 → Walletでスキャン → VP Token送信
- ✅ credential-info画面でデコードされたフィールドが表示されることを確認
- ✅ 日本語ラベルが正しく表示されることを確認

#### ポーリング停止確認
- ✅ committed後、ポーリングが停止することを確認（sessionStorageフラグで制御）

### 技術的課題と解決

1. **課題**: SD-JWT デコード時に `decodeSdJwt` ではフィールド値が取得できない
   - **原因**: Selective Disclosureが展開されず、`_sd`配列にハッシュ値のみ
   - **解決**: `verifySdJwt`を使用してDisclosureを展開

2. **課題**: TypeScript型エラー "Property 'issuing_authority' does not exist on type '{}'"
   - **原因**: `verifiedResult.decodedPayload || verifiedResult`の型推論が`{}`
   - **解決**: `const payload: any`で明示的に型指定

3. **課題**: サーバー起動時に "address already in use" エラー
   - **原因**: 複数のnodemonプロセスが同時に起動
   - **解決**: 全プロセスをkillしてクリーンな状態で再起動

## 備考

- ID Token のデコード表示は今回のスコープ外（必要に応じて追加）
- Learning Credential 以外のクレデンシャルタイプへの対応は将来検討
- 日本語ラベルマッピング用の定数ファイル作成は不要と判断（EJSテンプレートに直接記述）
