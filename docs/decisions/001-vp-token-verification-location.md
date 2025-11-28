# ADR-001: VP Token検証の実行場所

## ステータス
**完了** - 2024年11月実装済み

## コンテキスト

OID4VPフローには2つの主要エンドポイントがあります：

| エンドポイント | 処理 |
|---------------|------|
| `POST /oid4vp/responses` | WalletからVP Tokenを受信 |
| `POST /oid4vp/response-code/exchange` | レスポンスコードとクレデンシャルを交換 |

### 現在の実装

```
Wallet → POST /responses → 保存のみ → redirect_uri + response_code返却
                                           ↓
Frontend → POST /exchange → VP Token検証 → クレデンシャル抽出 → セッション保存
```

**`/oid4vp/responses`（response-endpoint.ts）の処理:**
1. JWE復号化（暗号化時）
2. ペイロード構造検証（state, vp_token存在確認）
3. レスポンス保存
4. redirect_uri + response_code返却

**`/oid4vp/response-code/exchange`（oid4vp-interactor.ts）の処理:**
1. レスポンスコード交換
2. nonce取得
3. **VP Token検証**（署名、証明書チェーン）
4. **クレデンシャル抽出**
5. リクエスト消費（consumed）
6. セッション保存
7. 状態更新（committed）

### 検討事項

1. プレゼンテーション検証をどちらのエンドポイントで実施すべきか？
2. クレデンシャル抽出をどちらのエンドポイントで実施すべきか？
3. `response-endpoint.ts`にどこまで処理を移動できるか？

## 選択肢

### Option A: 現状維持（exchangeで検証）

```
/responses → 保存のみ → response_code返却
/exchange  → VP Token検証 → クレデンシャル抽出
```

**メリット:**
- Response Endpointがシンプル
- Walletへの応答が高速
- OID4VP仕様に準拠（response_uriは受信確認のみ）

**デメリット:**
- 無効なVP Tokenも一時的に保存される
- 検証失敗時、redirect後にエラーが判明する

### Option B: responsesで検証（推奨）

```
/responses → VP Token検証 → クレデンシャル抽出 → 保存 → response_code返却
/exchange  → セッション取得のみ
```

**メリット:**
- Fail Fast: 無効なVP Tokenを即座に拒否
- Walletに即座にエラーを返せる
- 不正なデータが保存されない
- exchangeエンドポイントがシンプルになる

**デメリット:**
- Response Endpointが複雑化
- Walletへの応答時間が増加
- response-endpoint.tsの責務が増大

### Option C: ハイブリッド（検証のみresponsesで）

```
/responses → VP Token検証 → 検証済みとしてマーク → response_code返却
/exchange  → クレデンシャル抽出 → セッション保存
```

**メリット:**
- 検証は早期に実行
- クレデンシャル処理は分離

**デメリット:**
- 2つのエンドポイントに処理が分散
- 複雑さが増す

## OID4VP仕様との関係

OID4VP仕様では、`response_uri`でVP Tokenを受信した後のredirect_uri返却は**任意**です。

> The Verifier MAY return a redirect_uri to the Wallet after receiving the VP Token.

**重要な制約:**
- Response Endpointのエラーステータスやエラー形式は**定義されていない**
- エラーの場合も受け入れる必要がある
- Verifier側で結果を判断できる設計にする必要がある

つまり：
- Response Endpointは常にVP Tokenを受け入れる
- 検証結果（成功/失敗）はVerifierが後から確認する
- Walletへのエラー返却は仕様外

## 選択肢の再評価

### Option A: 現状維持（exchangeで検証）

```
/responses → 保存のみ → response_code返却（常に成功）
/exchange  → VP Token検証 → 結果返却
```

**評価:**
- 仕様準拠: ○
- シンプルさ: ○
- 課題: 無効なデータが一時的に保存される

### Option B: responsesで検証してエラー返却 ← **仕様違反**

~~検証失敗時にエラーを返す~~ → Response Endpointにエラー形式の定義がないため不適切

### Option D: responsesで検証して結果を保存（新規追加）

```
/responses → VP Token検証 → 結果（成功/失敗）を保存 → response_code返却（常に成功）
/exchange  → 保存済み結果を返却
```

**メリット:**
- 仕様準拠: Response Endpointは常に受け入れる
- 早期検証: 検証は即座に実行される
- exchangeの簡素化: 保存済み結果を返すだけ
- 状態の一貫性: 検証結果がすぐに状態に反映される

**デメリット:**
- Response Endpointが複雑化
- Walletへの応答時間が増加

## 推奨案: Option D（responsesで検証、結果を保存）

### 理由

1. **仕様準拠**: Response Endpointは常にVP Tokenを受け入れる
2. **早期検証**: 検証を先に実行し、結果を保存
3. **状態管理の改善**: 検証結果が即座にpost_stateに反映
4. **exchangeの簡素化**: 検証済み結果を返すだけ

### 実装方針

#### Option D のフロー詳細

```
Wallet → POST /responses
           ↓
    JWE復号化（暗号化時）
           ↓
    VP Token検証（署名、証明書チェーン、nonce）
           ↓
    ┌─────────────────┬─────────────────┐
    │   検証成功       │   検証失敗       │
    ├─────────────────┼─────────────────┤
    │ クレデンシャル抽出 │ エラー情報保存   │
    │ セッション保存    │                 │
    │ state=committed  │ state=invalid   │
    └─────────────────┴─────────────────┘
           ↓
    response_code返却（常に成功）
           ↓
Frontend → POST /exchange
           ↓
    保存済み結果を返却（成功 or エラー）
```

#### 状態遷移

```
started → committed        (検証成功)
       → invalid_submission (検証失敗)
       → expired           (タイムアウト)
```

#### 実装場所の選択肢

**案1: oid4vp-interactor.tsで検証（推奨）**

`response-endpoint.ts`の変更を最小限にし、`oid4vp-interactor.ts`で検証を行う：

```typescript
// oid4vp-interactor.ts
receiveAuthResponse = async (payload, presenter) => {
  // 1. response-endpointに委譲（JWE復号、基本検証、保存）
  const result = await responseEndpoint.receiveAuthResponse(payload);
  if (!result.ok) return result;

  const { responseCode, requestId } = result.payload;

  // 2. VP Token検証
  const request = await responseEndpoint.getRequest(requestId);
  const verifyResult = await extractCredentialFromVpToken(
    payload.vp_token, "learning_credential", request.nonce
  );

  if (!verifyResult.ok) {
    // 検証失敗: 状態を更新、エラー情報を保存
    await stateRepository.putState(requestId, "invalid_submission");
    await sessionRepository.putErrorData(requestId, verifyResult.error);
    // response_codeは返却（仕様準拠）
    return { ok: true, payload: presenter(redirectUri, responseCode) };
  }

  // 3. 検証成功: クレデンシャル保存、状態更新
  await sessionRepository.putWaitCommitData(requestId, ...);
  await stateRepository.putState(requestId, "committed");

  return { ok: true, payload: presenter(redirectUri, responseCode) };
};
```

**案2: response-endpoint.tsに検証ロジックを追加**

```typescript
// response-endpoint.ts
receiveAuthResponse = async (payload, verificationCallback?) => {
  // 既存の処理...

  // オプショナルな検証コールバック
  if (verificationCallback) {
    const verifyResult = await verificationCallback(vp_token, request.nonce);
    // 結果を保存
  }

  return { ok: true, payload: { redirectUri, responseCode } };
};
```

#### 推奨: 案1（oid4vp-interactor.tsで検証）

**理由:**
- `response-endpoint.ts`の責務を維持（OID4VPプロトコル層）
- ビジネスロジック（検証、クレデンシャル処理）はinteractor層に集約
- 依存関係の追加が不要
- テストが容易

## 決定

**Option D 案2を採用**

- `response-endpoint.ts`に検証ロジックを追加
- 将来のライブラリ化を見据え、汎用的な設計にする
- `extractCredentialFromVpToken`の処理を可能な範囲で移植

### 設計方針

`response-endpoint.ts`をライブラリ化可能にするため、以下の方針で設計：

1. **検証ロジックはコールバックで注入**
   - SD-JWT検証、nonce検証などの具体的な検証ロジックは外部から注入
   - ライブラリ利用者が独自の検証ロジックを実装可能

2. **汎用的なVP Token処理をresponse-endpoint.tsに実装**
   - DCQL形式のVP Token解析
   - Key Binding JWT nonce検証
   - 検証結果の保存

3. **アプリケーション固有ロジックはinteractor層に残す**
   - Learning Credential固有の処理
   - セッション/状態管理

### 実装計画

#### Phase 1: response-endpoint.tsの拡張

```typescript
// response-endpoint.ts

// 検証コールバックの型定義
export interface VpTokenVerificationCallback {
  /**
   * VP Token内のクレデンシャルを検証
   * @param credential - SD-JWT形式のクレデンシャル
   * @param nonce - 期待されるnonce値
   * @returns 検証結果
   */
  verifyCredential: (
    credential: string,
    nonce: string,
  ) => Promise<Result<{ verified: true; payload?: any }, { verified: false; error: string }>>;
}

export interface ReceiveAuthResponseOptions {
  expiredIn?: number;
  generateId?: () => string;
  /** VP Token検証コールバック（オプション） */
  verificationCallback?: VpTokenVerificationCallback;
}

// receiveAuthResponseの拡張
const receiveAuthResponse = async (
  payload: any,
  opts?: ReceiveAuthResponseOptions,
): Promise<Result<ReceiveAuthResponseResult, ReceiveAuthResponseError>> => {
  // 1. JWE復号化（既存）
  // 2. ペイロード構造検証（既存）
  // 3. レスポンス保存（既存）

  // 4. VP Token検証（新規・オプショナル）
  let verificationResult: VerificationResult | undefined;
  if (opts?.verificationCallback && vp_token) {
    verificationResult = await verifyVpTokenWithCallback(
      vp_token,
      request.nonce,
      opts.verificationCallback,
    );
  }

  // 5. 検証結果を含めてレスポンス保存
  await datastore.saveResponse({
    ...response,
    verificationResult,
  });

  return {
    ok: true,
    payload: { redirectUri, responseCode, verificationResult },
  };
};

// VP Token検証の汎用処理
const verifyVpTokenWithCallback = async (
  vpToken: Record<string, string[]>,
  nonce: string,
  callback: VpTokenVerificationCallback,
): Promise<VerificationResult> => {
  const results: Record<string, CredentialVerificationResult[]> = {};

  for (const [queryId, credentials] of Object.entries(vpToken)) {
    if (!credentials || credentials.length === 0) {
      results[queryId] = [{ status: "not_found" }];
      continue;
    }

    // 全クレデンシャルを検証
    const queryResults: CredentialVerificationResult[] = [];
    for (const credential of credentials) {
      // Key Binding JWT nonce検証
      const nonceValid = verifyKeyBindingNonce(credential, nonce);
      if (!nonceValid) {
        queryResults.push({ status: "invalid", error: "nonce_mismatch" });
        continue;
      }

      // コールバックで検証
      const verifyResult = await callback.verifyCredential(credential, nonce);
      if (verifyResult.ok && verifyResult.payload.verified) {
        queryResults.push({
          status: "verified",
          credential,
          payload: verifyResult.payload.payload,
        });
      } else {
        queryResults.push({
          status: "invalid",
          error: verifyResult.ok ? "unknown" : verifyResult.payload.error,
        });
      }
    }
    results[queryId] = queryResults;
  }

  return { credentials: results };
};

// Key Binding JWT nonce検証（ライブラリに含める汎用処理）
const verifyKeyBindingNonce = (sdJwt: string, expectedNonce: string): boolean => {
  try {
    const decoded = decodeSDJWT(sdJwt);
    if (!decoded.keyBindingJWT) return false;
    const kbPayload = decodeJwt(decoded.keyBindingJWT);
    return kbPayload.nonce === expectedNonce;
  } catch {
    return false;
  }
};
```

#### Phase 2: oid4vp-interactor.tsの更新

```typescript
// oid4vp-interactor.ts

const receiveAuthResponse = async <T>(
  payload: any,
  presenter: AuthResponsePresenter<T>,
): Promise<Result<T, NotSuccessResult>> => {
  // 検証コールバックを定義
  const verificationCallback: VpTokenVerificationCallback = {
    verifyCredential: async (credential, nonce) => {
      try {
        await verifySdJwt(credential, {});
        return { ok: true, payload: { verified: true } };
      } catch (err) {
        return { ok: true, payload: { verified: false, error: String(err) } };
      }
    },
  };

  // response-endpointに委譲（検証コールバック付き）
  const result = await responseEndpoint.receiveAuthResponse(payload, {
    expiredIn: Env().expiredIn.response,
    verificationCallback,
  });

  if (!result.ok) {
    return { ok: false, error: handleEndpointError(result.error) };
  }

  const { redirectUri, responseCode, verificationResult, requestId } = result.payload;

  // 検証結果に基づいて状態更新
  const learningCredentials = verificationResult?.credentials?.learning_credential || [];
  const verifiedCredentials = learningCredentials.filter(c => c.status === "verified");

  if (verifiedCredentials.length > 0) {
    // 検証成功したクレデンシャルを保存
    const credentials = verifiedCredentials.map(c => c.credential);
    await sessionRepository.putWaitCommitData(requestId, "", credentials[0], {
      expiredIn: Env().expiredIn.postSession,
    });
    await stateRepository.putState(requestId, "committed");
  } else {
    await stateRepository.putState(requestId, "invalid_submission");
  }

  return { ok: true, payload: presenter(redirectUri!, responseCode!) };
};
```

#### Phase 3: exchangeAuthResponseの簡素化

```typescript
// oid4vp-interactor.ts

const exchangeAuthResponse = async <T>(
  responseCode: string,
  transactionId: string | undefined,
  presenter: ExchangeResponseCodePresenter<T>,
): Promise<Result<T, NotSuccessResult>> => {
  // 1. レスポンス取得
  const exchange = await responseEndpoint.exchangeResponseCodeForAuthResponse(
    responseCode,
    transactionId,
  );
  if (!exchange.ok) {
    return { ok: false, error: handleEndpointError(exchange.error) };
  }

  // 2. セッションから検証済みデータを取得
  const session = await sessionRepository.getWaitCommitData(exchange.payload.requestId);
  if (!session.ok) {
    return { ok: false, error: { type: "NOT_FOUND" } };
  }

  // 3. 検証済みデータを返却（再検証不要）
  return {
    ok: true,
    payload: presenter(exchange.payload.requestId, session.payload),
  };
};
```

### 移植対象の処理

| 処理 | 移植先 | 備考 |
|------|-------|------|
| DCQL形式VP Token解析 | response-endpoint.ts | 汎用処理 |
| Key Binding JWT nonce検証 | response-endpoint.ts | 汎用処理 |
| SD-JWT署名検証 | コールバック経由 | アプリ固有（トラストアンカー等） |
| 検証結果保存 | response-endpoint.ts | 汎用処理 |
| セッション保存 | interactor | アプリ固有 |
| 状態更新 | interactor | アプリ固有 |

## 影響

### Option D（推奨案）を採用した場合

**変更が必要なファイル:**
- `oid4vp-interactor.ts`: `receiveAuthResponse`に検証ロジック追加
- `oid4vp-repository.ts`: エラー情報保存メソッド追加（オプション）

**簡素化されるファイル:**
- `exchangeAuthResponse`: 検証ロジック削除、保存済み結果返却のみ

**テスト:**
- `receiveAuthResponse`のテスト追加（検証成功/失敗ケース）
- `exchangeAuthResponse`のテスト簡素化

### Option A（現状維持）を採用した場合

**変更なし** - 現在の設計を維持

## 比較表

| 観点 | Option A（現状） | Option D（推奨） |
|------|-----------------|-----------------|
| 仕様準拠 | ○ | ○ |
| 検証タイミング | exchange時 | responses時 |
| 状態反映 | exchange後 | responses後 |
| response-endpoint.ts変更 | なし | なし（案1の場合） |
| exchangeの複雑さ | 高 | 低 |
| Walletへの応答時間 | 短 | やや長 |
| redirect_uri返却 | 常に返却 | 常に返却 |

### redirect_uriについて

OID4VP仕様では`redirect_uri`の返却は**任意**です。

**Option A/D共通（現在の設計）:**
- redirect_uriを常に返却する設計
- Walletはredirect_uriでVerifierのFrontendに遷移
- Frontendがexchangeエンドポイントで結果を取得

**redirect_uriを返却しない設計（将来の選択肢）:**

| 観点 | redirect_uri返却あり | redirect_uri返却なし |
|------|---------------------|---------------------|
| Wallet遷移 | Verifier Frontendへ | なし（Wallet内で完結） |
| 結果確認方法 | exchange API | ポーリング（/states） |
| ユースケース | Web連携 | Wallet単体利用 |

現在の実装はredirect_uriを返却する設計ですが、Option Dを採用すると、将来的にredirect_uriなしの設計にも対応しやすくなります（検証結果がresponses時点で確定するため、/statesでポーリング可能）。

---

## 実装結果

### 実装完了日
2024年11月

### 変更されたファイル

| ファイル | 変更内容 |
|---------|---------|
| `src/oid4vp/response-endpoint.ts` | VP Token検証ロジック追加、検証コールバック対応、リクエストIDログ追加、検証メタデータ対応 |
| `src/usecases/oid4vp-interactor.ts` | 検証コールバック実装、リクエストIDログ追加 |
| `src/tool-box/verify.ts` | JWT検証メタデータ（keySource, algorithm, certificateChainVerified）の追加 |
| `src/helpers/jwt-helper.ts` | SD-JWT検証メタデータの追加 |
| `tests/oid4vp/response-endpoint-verification.test.ts` | 検証コールバックのテスト追加 |
| `tests/tool-box/verify.test.ts` | 検証メタデータのテスト追加 |
| `tests/oid4vp/x5c-request-object.test.ts` | X.509検証メタデータのテスト追加 |

### 実装された機能

1. **VP Token検証コールバック**
   - `VpTokenVerificationCallback`インターフェースの実装
   - SD-JWT署名検証
   - Key Binding JWT nonce検証
   - 検証結果の保存と返却

2. **リクエストIDによるログトレース**
   - すべてのログに`[requestId=${requestId}]`プレフィックスを追加
   - 処理の開始から終了まで一貫したトレースが可能

3. **検証メタデータ**
   - `VerificationMetadata`インターフェースの実装
   - 鍵のソース（x5c/jwk/secret）の追跡
   - 使用アルゴリズムの記録
   - X.509証明書チェーン検証結果の追跡
   - 検証ログに検証タイプ情報を含める（例: `keySource=x5c, alg=ES256, certChainVerified=true`）

### テスト結果

9件のテストがすべてパス：

- 正常系
  - nonce検証とコールバック検証が成功した場合にverifiedステータスを返す
  - 複数のクレデンシャルをすべて検証する

- 異常系
  - Key Binding JWTがない場合にinvalidステータスを返す
  - nonceが一致しない場合にinvalidステータスを返す
  - コールバック検証が失敗した場合にinvalidステータスを返す
  - クレデンシャル配列が空の場合にnot_foundステータスを返す

- エッジケース
  - verificationCallbackが提供されない場合は検証を行わない
  - nonceがリクエストに設定されていない場合は検証を行わない
  - 混合した検証結果を正しく処理する（一部verified、一部invalid）

### 検証メタデータ

検証結果には、クレデンシャルがどのように検証されたかを示すメタデータが含まれます：

```typescript
export interface VerificationMetadata {
  /** 鍵のソース: x5c（証明書チェーン）, jwk（埋め込みJWK）, secret */
  keySource: "x5c" | "jwk" | "secret";
  /** 使用されたアルゴリズム */
  algorithm?: string;
  /** 証明書チェーン検証の結果（x5cの場合のみ） */
  certificateChainVerified?: boolean;
}
```

### 検証ログの例（成功：JWK）

埋め込みJWKで署名されたクレデンシャルの検証成功例：

```
[JWT Verification] Header: alg=ES256K, kid=none, jwk=present, x5c=none
[JWT Verification] Key source: jwk (embedded key), no certificate chain verification needed, kty=EC, crv=secp256k1, alg=ES256K
[JWT Verification] Signature verification successful
[requestId=9270365d-f787-4c01-a418-5c9bf92d2bce] Credential 1 verified for queryId: learning_credential (keySource=jwk, alg=ES256K, certChainVerified=N/A)
```

### 検証ログの例（成功：X.509証明書チェーン）

X.509証明書チェーンで署名されたクレデンシャルの検証成功例（リクエストID: `0e63dd0f-12dd-4375-87b4-ed4303e93349`）：

```
[JWT Verification] Header: alg=ES256, kid=none, jwk=none, x5c=present (1 certs)
[JWT Verification] Key source: x5c (certificate chain), verifying certificate chain...
[Certificate Chain] Starting verification: 1 certificate(s) in chain
[Certificate Chain] Trust anchors: system=150, custom=3, total=153
[Certificate Chain] Leaf certificate: subject.CN=Cyber Security Cloud, Inc., subject.O=Cyber Security Cloud, Inc., issuer.CN=GlobalSign GCC R45 AATL CA 2020 - Staging, issuer.O=GlobalSign nv-sa
[Certificate Chain] Executing certificate chain verification...
[Certificate Chain] Verification SUCCESS
[JWT Verification] Certificate chain verified, extracting public key from leaf certificate, alg=ES256
[JWT Verification] Signature verification successful
[requestId=0e63dd0f-12dd-4375-87b4-ed4303e93349] Credential 1 verified for queryId: learning_credential (keySource=x5c, alg=ES256, certChainVerified=true)
[requestId=0e63dd0f-12dd-4375-87b4-ed4303e93349] VP Token verification completed: [{"queryId":"learning_credential","results":["verified"]}]
[requestId=0e63dd0f-12dd-4375-87b4-ed4303e93349] VP Token verification succeeded
```

### 検証ログの例（失敗：証明書チェーン検証エラー）

トラストアンカーに登録されていない自己署名証明書での検証失敗例（リクエストID: `3d3de1e3-a142-4263-903a-6afac4822308`）：

```
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] Generated nonce: d144de68-fe31-4ff3-a521-1508e0a4efe3
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] generateAuthRequest end
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] Generated Request Object JWT with saved nonce
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] Attempting JWE decryption
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] JWE decryption successful
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] Starting VP Token verification
[JWT Verification] Header: alg=ES256K, kid=none, jwk=none, x5c=present (1 certs)
[JWT Verification] Key source: x5c (certificate chain), verifying certificate chain...
[Certificate Chain] Starting verification: 1 certificate(s) in chain
[Certificate Chain] Trust anchors: system=150, custom=3, total=153
[Certificate Chain] Leaf certificate: subject.CN=Learning Credential Issuer, subject.O=Educational Institution, issuer.CN=Learning Credential Issuer, issuer.O=Educational Institution
[Certificate Chain] Executing certificate chain verification...
[Certificate Chain] Verification FAILED: No valid certificate paths found
[JWT Verification] Certificate chain verification failed: Error: Certificate chain verification failed: No valid certificate paths found
SD-JWT verification failed: Error: Failed to verify SD-JWT
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] Credential 1 invalid for queryId: learning_credential: Error: Failed to verify SD-JWT
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] VP Token verification completed: [{"queryId":"learning_credential","results":["invalid"]}]
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] VP Token verification failed: no verified credentials
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] receiveAuthResponse end
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] exchangeAuthResponse code exchange success
[requestId=3d3de1e3-a142-4263-903a-6afac4822308] Session not found: NOT_FOUND
```

**失敗原因の分析**:
- 証明書が自己署名（Subject と Issuer が同一）
- トラストアンカー（system=150, custom=3）に発行者証明書が含まれていない
- 「No valid certificate paths found」で証明書チェーン検証失敗

**解決方法**:
- 発行者の証明書を `OID4VP_TRUST_ANCHOR_CERTIFICATES` 環境変数でトラストアンカーに追加
- または、信頼された CA が発行した証明書を使用

### 処理フロー（実装後）

```
Wallet → POST /responses
           ↓
    JWE復号化
           ↓
    VP Token検証（Key Binding JWT nonce検証 + SD-JWT署名検証）
           ↓
    検証結果を保存
           ↓
    response_code返却
           ↓
Frontend → POST /exchange
           ↓
    保存済み検証結果を返却
```

### 今後の改善点

- [ ] 検証エラー時の詳細なエラーコード標準化
- [ ] 検証結果のキャッシュ戦略の検討
- [ ] redirect_uriなしのフローへの対応（ポーリング方式）
