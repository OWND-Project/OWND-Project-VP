# Learning Credential移行ガイド

## 概要

本ドキュメントは、`affiliation_credential`（組織所属証明書）から`learning_credential`（学習証明書）への移行を記録します。

**参考ドキュメント**: `EUDI-Wallet-NiScy_JP EU pilot_v0.10.docx` Section 3: Learning Credential Data Model

## 変更内容

### 1. Credential Type

| 項目 | 旧 (Affiliation Credential) | 新 (Learning Credential) |
|------|---------------------------|------------------------|
| Query ID | `affiliation_credential` | `learning_credential` |
| vct | `OrganizationalAffiliationCertificate` | `urn:eu.europa.ec.eudi:learning:credential:1` |
| Format | `vc+sd-jwt` | `vc+sd-jwt` (変更なし) |

### 2. データフィールド

#### 必須フィールド (Mandatory)

| フィールド名 | 型 | Selective Disclosure | 説明 |
|------------|---|---------------------|------|
| `issuing_authority` | string | Never | 発行機関名 |
| `issuing_country` | string | Never | 発行国 (ISO 3166-1 Alpha-2) |
| `date_of_issuance` | string | Never | 発行日 (YYYY-MM-DD) |
| `family_name` | string | Always | 姓 |
| `given_name` | string | Always | 名 |
| `achievement_title` | string | Never | コース/マイクロクレデンシャルの公式タイトル |

#### オプションフィールド (Optional)

| フィールド名 | 型 | Selective Disclosure | 説明 |
|------------|---|---------------------|------|
| `issuer` (iss) | URI | Never | 発行機関のURI |
| `date_of_expiry` | string | Never | 有効期限 (YYYY-MM-DD) |
| `achievement_description` | string | Never | 実績の説明 |
| `learning_outcomes` | array of string | Always (配列はAlways、要素はNever) | 学習成果リスト |
| `assessment_grade` | string | Always | 評価/成績 |

#### 削除されるフィールド

- `organization_name` / `organization` - 組織名（Affiliation Credentialのフィールド）
- `portrait` - 肖像写真（Affiliation Credentialのフィールド）

### 3. 実装変更箇所

#### 3.1 コアロジック

**ファイル**: `src/usecases/oid4vp-interactor.ts`

変更点:
- Line 104: credential query ID変更
- Line 107: vct変更
- Line 110-113: claimsフィールド更新
- Line 293: credentialQueryId定数更新

**変更前**:
```typescript
const dcqlQuery = verifier.generateDcqlQuery([
  {
    id: "affiliation_credential",
    format: "dc+sd-jwt",
    meta: {
      vct_values: ["OrganizationalAffiliationCertificate"],
    },
    claims: [
      { path: ["organization_name"] },
      { path: ["family_name"] },
      { path: ["given_name"] },
      { path: ["portrait"] },
    ],
  },
]);

const credentialQueryId = "affiliation_credential";
```

**変更後**:
```typescript
const dcqlQuery = verifier.generateDcqlQuery([
  {
    id: "learning_credential",
    format: "dc+sd-jwt",
    meta: {
      vct_values: ["urn:eu.europa.ec.eudi:learning:credential:1"],
    },
    claims: [
      { path: ["issuing_authority"] },
      { path: ["issuing_country"] },
      { path: ["date_of_issuance"] },
      { path: ["family_name"] },
      { path: ["given_name"] },
      { path: ["achievement_title"] },
      { path: ["achievement_description"] },
      { path: ["learning_outcomes"] },
      { path: ["assessment_grade"] },
    ],
  },
]);

const credentialQueryId = "learning_credential";
```

#### 3.2 クレデンシャルプロセッサ

**ファイル**: `src/usecases/internal/credential2-processor.ts`

変更点:
- 関数コメント更新
- `portrait`フィールドの抽出ロジック削除
- 戻り値の型を更新

**変更前**:
```typescript
export const extractCredentialFromVpToken = async (
  vpToken: Record<string, string[]>,
  credentialQueryId: string,
  nonce: string,
): Promise<Result<{ affiliation?: string; icon?: string }, NotSuccessResult>> => {
  // ... (処理)

  // Extract icon from disclosures
  let icon: string | undefined = undefined;
  if (decoded.disclosures) {
    decoded.disclosures.forEach((disclosure: any) => {
      if (disclosure.key === "portrait") {
        icon = disclosure.value;
      }
    });
  }

  return {
    ok: true,
    payload: {
      affiliation: token,
      icon
    }
  };
}
```

**変更後**:
```typescript
export const extractCredentialFromVpToken = async (
  vpToken: Record<string, string[]>,
  credentialQueryId: string,
  nonce: string,
): Promise<Result<{ learningCredential?: string }, NotSuccessResult>> => {
  // ... (処理)

  // Learning Credential doesn't include portrait field
  // Extract other fields as needed in the future

  return {
    ok: true,
    payload: {
      learningCredential: token
    }
  };
}
```

#### 3.3 型定義

**ファイル**: `src/usecases/types.ts`

変更点:
- ExchangeResponseCodePresenterの型更新
- WaitCommitDataの型更新

**変更前**:
```typescript
export type ExchangeResponseCodePresenter<T> = (
  requestId: string,
  claimer: {
    sub: string;
    id_token: string;
    organization?: string;
    icon?: string;
  },
) => T;

export interface WaitCommitData extends EntityWithLifeCycle {
  data: {
    idToken: string;
    affiliationJwt?: string;
  };
}
```

**変更後**:
```typescript
export type ExchangeResponseCodePresenter<T> = (
  requestId: string,
  claimer: {
    sub: string;
    id_token: string;
    learningCredential?: string;
  },
) => T;

export interface WaitCommitData extends EntityWithLifeCycle {
  data: {
    idToken: string;
    learningCredentialJwt?: string;
  };
}
```

### 4. テスト更新

#### 4.1 credential2-processor.test.ts

- テストデータのvct更新
- フィールド名更新
- `portrait`関連テスト削除

#### 4.2 response-endpoint.test.ts

- モックVP Tokenの更新
- credential query ID更新

### 5. ドキュメント更新

#### 5.1 docs/api-specification.md

- サンプルJSONのcredential query ID更新
- vct_values更新
- claimsフィールド更新

#### 5.2 docs/oid4vp-implementation.md

- コード例の更新
- データモデル説明更新

#### 5.3 docs/components.md

- コンポーネント説明更新

#### 5.4 docs/security.md

- セキュリティ関連の説明更新（該当する場合）

### 6. 実装スケジュール

1. **Phase 1**: 型定義更新
   - src/usecases/types.ts

2. **Phase 2**: コアロジック更新
   - src/usecases/internal/credential2-processor.ts
   - src/usecases/oid4vp-interactor.ts

3. **Phase 3**: テスト更新
   - tests/usecases/credential2-processor.test.ts
   - tests/oid4vp/response-endpoint.test.ts

4. **Phase 4**: ドキュメント更新
   - docs/api-specification.md
   - docs/oid4vp-implementation.md
   - docs/components.md

5. **Phase 5**: 統合テスト
   - 全テスト実行
   - 動作確認

## 参考資料

- [OpenID for Verifiable Presentations 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- [SD-JWT-based Verifiable Credentials (SD-JWT VC)](https://www.ietf.org/archive/id/draft-ietf-oauth-sd-jwt-vc-11.html)
- EUDI-Wallet-NiScy_JP EU pilot_v0.10.docx

---

## 実施結果

### 実装完了日
2025-11-19

### 実装内容

#### Phase 1: 型定義更新 ✅

**ファイル**: `src/usecases/types.ts`

変更内容:
- `ExchangeResponseCodePresenter`の型更新
  - `organization?: string` → 削除
  - `icon?: string` → 削除
  - `learningCredential?: string` → 追加
- `WaitCommitData`の型更新
  - `affiliationJwt?: string` → `learningCredentialJwt?: string`

#### Phase 2: コアロジック更新 ✅

**ファイル1**: `src/usecases/internal/credential2-processor.ts`

変更内容:
- 関数コメント更新: "Affiliation JWT" → "Learning Credential JWT"
- 戻り値の型更新: `{ affiliation?: string; icon?: string }` → `{ learningCredential?: string }`
- `portrait`フィールド抽出ロジック削除（Learning Credentialには存在しない）
- エラーハンドリング維持

**ファイル2**: `src/usecases/oid4vp-interactor.ts`

変更内容:
- Line 101-121: DCQL Query生成部分を完全更新
  - credential query ID: `affiliation_credential` → `learning_credential`
  - vct: `OrganizationalAffiliationCertificate` → `urn:eu.europa.ec.eudi:learning:credential:1`
  - claims: Learning Credentialの9フィールドに更新
    - `issuing_authority`
    - `issuing_country`
    - `date_of_issuance`
    - `family_name`
    - `given_name`
    - `achievement_title`
    - `achievement_description`
    - `learning_outcomes`
    - `assessment_grade`
- Line 298: credentialQueryId定数を`learning_credential`に更新
- Line 323-343: 抽出したクレデンシャルの処理を更新
  - 変数名: `affiliation`, `icon` → `learningCredential`
  - presenterに渡すデータを更新

**ファイル3**: `src/usecases/oid4vp-repository.ts`

変更内容:
- `putWaitCommitData`関数のパラメータ名更新
  - `affiliationJwt` → `learningCredentialJwt`
- credentialDataオブジェクトのプロパティ名更新
- WaitCommitDataオブジェクトの構築部分を更新

#### Phase 3: テスト更新 ✅

**ファイル**: `tests/usecases/credential2-processor.test.ts`

変更内容:
- credential query ID: `affiliation_credential` → `learning_credential`
- テストデータのvct更新
- テストデータのclaimsをLearning Credentialフィールドに更新
  - `vct`: `urn:eu.europa.ec.eudi:learning:credential:1`
  - `issuing_authority`: "Technical University of Munich"
  - `issuing_country`: "DE"
  - `date_of_issuance`: "2025-09-15"
  - `family_name`: "Smith"
  - `given_name`: "John"
  - `achievement_title`: "Foundations of Applied AI in Business"
- `portrait`関連テストを削除
- アサーション更新: `affiliation`, `icon` → `learningCredential`
- 全10個のテストケースを更新

テスト結果: **73 passing (248ms), 1 pending** ✅

#### Phase 4: ドキュメント更新 ✅

**ファイル1**: `docs/api-specification.md`

変更内容:
- レスポンス例（2箇所）のdcql_queryを更新
  - credential query ID: `affiliation_credential` → `learning_credential`
  - vct_values: `https://example.com/AffiliationCredential` → `urn:eu.europa.ec.eudi:learning:credential:1`
  - claimsフィールド: Learning Credentialの9フィールドに更新
- 通常レスポンス例と暗号化対応時レスポンス例の両方を更新

**ファイル2**: `docs/oid4vp-implementation.md`

変更内容:
- コード例（2箇所）のDCQL Query生成部分を更新
  - credential query ID: `affiliation_credential` → `learning_credential`
  - vct_values: `OrganizationalAffiliationCertificate` → `urn:eu.europa.ec.eudi:learning:credential:1`
  - claimsフィールド: Learning Credentialの9フィールドに更新
- 実装ガイドのJSON例を更新

**ファイル3**: `docs/components.md`

変更内容:
- DCQL Query生成のコード例を更新
  - credential query ID更新
  - vct_values更新
  - claimsフィールド: 9フィールドに更新
- ExchangeResponseCodePresenterの型定義を更新
  - `organization?: string` → 削除
  - `icon?: string` → 削除
  - `learningCredential?: string` → 追加
- presenterの実装例を更新

**ファイル4**: `docs/security.md`

変更内容:
- VP Token暗号化のコード例を更新
  - `vp_token: { affiliation_credential: [...] }` → `vp_token: { learning_credential: [...] }`

#### Phase 5: 統合テスト ✅

**テスト実行結果**:
```
73 passing (248ms)
0 pending
```

全テスト合格。Learning Credentialへの移行が正常に完了。

**クリーンアップ**:
- `tests/oid4vp/verify.test.ts` 削除
  - PEX (Presentation Exchange) 関連の廃止されたテストファイル
  - 全テストが`describe.skip()`でスキップされていた
  - DCQLベースの`extractCredentialFromVpToken`に置き換え済み
  - pending状態だったテストを完全に削除

### 変更ファイル一覧

**コアファイル**:
- `src/usecases/types.ts`
- `src/usecases/internal/credential2-processor.ts`
- `src/usecases/oid4vp-interactor.ts`
- `src/usecases/oid4vp-repository.ts`

**テストファイル**:
- `tests/usecases/credential2-processor.test.ts` (更新)
- `tests/oid4vp/verify.test.ts` (削除 - 廃止されたPEXテスト)

**ドキュメント**:
- `docs/learning-credential-migration.md` (本ファイル)
- `docs/api-specification.md`
- `docs/oid4vp-implementation.md`
- `docs/components.md`
- `docs/security.md`

### 主な変更点まとめ

1. **Credential Type変更**
   - Query ID: `affiliation_credential` → `learning_credential`
   - vct: `OrganizationalAffiliationCertificate` → `urn:eu.europa.ec.eudi:learning:credential:1`

2. **データフィールド変更**
   - 削除: `organization_name`, `portrait`
   - 追加: `issuing_authority`, `issuing_country`, `date_of_issuance`, `achievement_title`, `achievement_description`, `learning_outcomes`, `assessment_grade`

3. **型定義更新**
   - `organization` → `learningCredential`
   - `icon` → 削除
   - `affiliationJwt` → `learningCredentialJwt`

4. **テスト完全対応**
   - 全テストケースをLearning Credentialに更新
   - SD-JWTのvctとclaimsを新仕様に準拠
   - 全73テスト合格

### 完了状況

**全Phase完了** ✅:
- [x] Phase 1: 型定義更新
- [x] Phase 2: コアロジック更新
- [x] Phase 3: テスト更新
- [x] Phase 4: ドキュメント更新
- [x] Phase 5: 統合テスト
- [x] クリーンアップ: 廃止されたPEXテストファイル削除

**最終テスト結果**: 73 passing (248ms), 0 pending ✅

**コミット履歴**:
- `ccc4b4d`: コアロジック + テスト更新
- `932a34b`: 全ドキュメント更新
- `2bce1db`: 廃止されたPEXテストファイル削除

### 備考

- 後方互換性は提供していません（Affiliation Credentialは完全に削除）
- Learning CredentialはEUDI Wallet仕様（EUDI-Wallet-NiScy_JP EU pilot_v0.10.docx）に準拠
- OID4VP 1.0 + DCQL + SD-JWT VCの組み合わせで実装
- 全テスト合格により、実装の正確性を確認済み
