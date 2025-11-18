# OID4VP 1.0 (DCQL) 移行作業ドキュメント

## 概要

OpenID for Verifiable Presentations 1.0 では、Presentation Exchange (PEX) が廃止され、Digital Credentials Query Language (DCQL) に置き換えられました。

### 主な変更点

1. **Presentation Definition の廃止**
   - Presentation Definition エンドポイントが不要に
   - Input Descriptor が不要に
   - Submission Requirements が不要に

2. **DCQL の導入**
   - Request Object に `dcql_query` プロパティを追加
   - クレデンシャル要求条件を DCQL で記述

3. **Presentation Submission の廃止**
   - Response Endpoint のペイロードが `vp_token` のみに
   - descriptor_map を使った処理が不要に
   - VP Token から直接クレデンシャルを取り出す

## 移行手順

### Phase 1: DCQL 型定義の追加 ✅

**対象ファイル**: `src/oid4vp/types.ts`

**作業内容**:
- [ ] `DcqlQuery` インターフェースを追加
- [ ] `DcqlCredentialQuery` インターフェースを追加
- [ ] `DcqlClaimQuery` インターフェースを追加

**DCQL 型定義**:
```typescript
export interface DcqlClaimQuery {
  path: string[];
  values?: any[];
}

export interface DcqlCredentialQuery {
  id: string;
  format: string;
  meta?: {
    vct_values?: string[];
    [key: string]: any;
  };
  claims?: DcqlClaimQuery[];
}

export interface DcqlQuery {
  credentials: DcqlCredentialQuery[];
}
```

---

### Phase 2: Request Object への DCQL Query 追加

**対象ファイル**: `src/oid4vp/auth-request.ts`

**作業内容**:
- [ ] `GenerateRequestObjectOptions` に `dcqlQuery?: DcqlQuery` を追加
- [ ] `generateRequestObjectPayload()` で `dcqlQuery` を `payload` に含める
- [ ] `presentationDefinition` と `presentationDefinitionUri` の削除

**変更箇所**:
```typescript
// auth-request.ts Line 7-23
export interface GenerateRequestObjectOptions {
  // ... 既存のプロパティ ...
  dcqlQuery?: DcqlQuery;           // 追加
  // presentationDefinition?: any;    // 削除
  // presentationDefinitionUri?: string; // 削除
}

// auth-request.ts Line 49-115
export const generateRequestObjectPayload = (
  clientId: string,
  options: GenerateRequestObjectOptions = {},
): RequestObject => {
  // ... 既存のコード ...

  // 削除
  // if (options.presentationDefinition) {
  //   payload.presentationDefinition = options.presentationDefinition;
  // }
  // if (options.presentationDefinitionUri) {
  //   payload.presentationDefinitionUri = options.presentationDefinitionUri;
  // }

  // 追加
  if (options.dcqlQuery) {
    payload.dcqlQuery = options.dcqlQuery;
  }

  return payload;
};
```

---

### Phase 3: Verifier に DCQL Query 生成機能を追加

**対象ファイル**: `src/oid4vp/verifier.ts`

**作業内容**:
- [ ] `generateDcqlQuery()` メソッドを追加
- [ ] Affiliation Credential 用の DCQL Query を生成

**追加コード**:
```typescript
// verifier.ts - 新規メソッド
const generateDcqlQuery = (
  credentialQueries: DcqlCredentialQuery[]
): DcqlQuery => {
  return {
    credentials: credentialQueries
  };
};

// Export に追加
return {
  // ... 既存のメソッド ...
  generateDcqlQuery,
};
```

---

### Phase 4: Presentation Definition 関連の削除

#### 4.1 Verifier から削除

**対象ファイル**: `src/oid4vp/verifier.ts`

**作業内容**:
- [ ] `generatePresentationDefinition()` メソッドを削除 (229-245行)
- [ ] `getPresentationDefinition()` メソッドを削除 (251-255行)
- [ ] `getPresentationDefinitionMap()` メソッドを削除 (261-270行)
- [ ] `VerifierDatastore` インターフェースから削除:
  - `savePresentationDefinition`
  - `getPresentationDefinition`

#### 4.2 Types から削除

**対象ファイル**: `src/oid4vp/types.ts`

**作業内容**:
- [ ] `InputDescriptor` インターフェースを削除 (18-27行)
- [ ] `SubmissionRequirement` インターフェースを削除 (36-41行)
- [ ] `PresentationDefinition` インターフェースを削除 (43-47行)
- [ ] `VCFormats` インターフェースを削除（不要なら）

#### 4.3 Repository から削除

**対象ファイル**: `src/usecases/oid4vp-repository.ts`

**作業内容**:
- [ ] `savePresentationDefinition()` メソッドを削除
- [ ] `getPresentationDefinition()` メソッドを削除

#### 4.4 Database Schema から削除

**対象ファイル**: `src/database/schema.ts`

**作業内容**:
- [ ] `presentation_definitions` テーブル定義を削除
- [ ] マイグレーションスクリプトの作成（必要に応じて）

#### 4.5 Routes から削除

**対象ファイル**: `src/routes/oid4vp-routes.ts`

**作業内容**:
- [ ] `GET /oid4vp/presentation-definition` エンドポイントを削除

#### 4.6 Input Descriptor ファイルの削除

**対象ファイル**: `src/usecases/internal/input-descriptor.ts`

**作業内容**:
- [ ] ファイル全体を削除
- [ ] このファイルをインポートしている箇所を修正

---

### Phase 5: Presentation Submission 処理の削除

#### 5.1 Types から削除

**対象ファイル**: `src/oid4vp/types.ts`

**作業内容**:
- [ ] `PresentationSubmission` インターフェースを削除 (49-53行)
- [ ] `DescriptorMap` インターフェースを削除 (29-34行)

#### 5.2 Response Endpoint から削除

**対象ファイル**: `src/oid4vp/response-endpoint.ts`

**作業内容**:
- [ ] `AuthResponsePayload` から `presentationSubmission` フィールドを削除
- [ ] `/responses` エンドポイントの処理を更新

#### 5.3 Verifier から descriptor 処理を削除

**対象ファイル**: `src/oid4vp/verifier.ts`

**作業内容**:
- [ ] `getDescriptor()` メソッドを削除 (288-331行)
- [ ] `getOptionalDescriptor()` メソッドを削除 (272-286行)
- [ ] `getPresentation()` メソッドを更新（descriptor_map 不要に）
- [ ] `getCredential()` メソッドを更新（pathNested 処理削除）

#### 5.4 Verify から descriptor_map 処理を削除

**対象ファイル**: `src/oid4vp/verify.ts`

**作業内容**:
- [ ] `getDescriptorMap()` 関数を削除
- [ ] `extractPresentation()` を更新

---

### Phase 6: VP Token 直接処理の実装

#### 6.1 VP Token から直接クレデンシャルを抽出

**対象ファイル**: `src/oid4vp/verifier.ts`

**作業内容**:
- [ ] VP Token から直接 Verifiable Credential を抽出する新しいメソッドを実装
- [ ] Format 判定ロジックの実装（SD-JWT など）

**新規メソッド案**:
```typescript
const extractCredentialFromVpToken = async <T, U>(
  vpToken: string,
  credentialId: string,
  verifier?: VerifierFunction<T, U>
): Promise<Result<{ raw: T; decoded: U }, CredentialError>> => {
  // VP Token をデコード
  // credentialId に該当するクレデンシャルを抽出
  // 検証関数を実行
  // 結果を返却
};
```

#### 6.2 Interactor の更新

**対象ファイル**: `src/usecases/oid4vp-interactor.ts`

**作業内容**:
- [ ] `generateAuthRequest()` を更新
  - Presentation Definition 生成を DCQL Query 生成に変更
- [ ] `exchangeAuthResponse()` を更新
  - Presentation Submission を使わない処理に変更
  - VP Token から直接クレデンシャルを抽出

#### 6.3 Credential Processor の更新

**対象ファイル**: `src/usecases/internal/credential2-processor.ts`

**作業内容**:
- [ ] `processCredential2()` を更新
  - `getDescriptor()` を使わない処理に変更
  - VP Token から直接抽出する方式に変更

---

### Phase 7: テストの修正

**対象ファイル**: `tests/` 配下の全テストファイル

**作業内容**:
- [ ] Presentation Definition 生成のテストを DCQL Query に変更
- [ ] Presentation Submission のモックデータを削除
- [ ] VP Token 処理のテストを更新
- [ ] すべてのテストが通ることを確認

---

### Phase 8: ドキュメントの更新

**対象ファイル**:
- `docs/api-specification.md`
- `docs/oid4vp-implementation.md`
- `docs/components.md`
- `docs/data-model.md`

**作業内容**:
- [ ] Presentation Definition エンドポイントの記述を削除
- [ ] DCQL Query の説明を追加
- [ ] Presentation Submission の記述を削除
- [ ] シーケンス図を更新
- [ ] データモデル図を更新

---

## 進捗管理

| Phase | タスク | ステータス | 完了日 |
|-------|--------|-----------|--------|
| 1 | DCQL 型定義の追加 | ✅ 完了 | 2025-11-18 |
| 2 | Request Object への DCQL 追加 | ✅ 完了 | 2025-11-18 |
| 3 | Verifier に DCQL Query 生成追加 | ✅ 完了 | 2025-11-18 |
| 4.1 | Verifier から PD 削除 | ⬜ 未着手 | - |
| 4.2 | Types から PD 削除 | ⬜ 未着手 | - |
| 4.3 | Repository から PD 削除 | ⬜ 未着手 | - |
| 4.4 | Database Schema から PD 削除 | ⬜ 未着手 | - |
| 4.5 | Routes から PD エンドポイント削除 | ⬜ 未着手 | - |
| 4.6 | Input Descriptor ファイル削除 | ⬜ 未着手 | - |
| 5.1 | Types から PS 削除 | ⬜ 未着手 | - |
| 5.2 | Response Endpoint から PS 削除 | ⬜ 未着手 | - |
| 5.3 | Verifier から descriptor 処理削除 | ⬜ 未着手 | - |
| 5.4 | Verify から descriptor_map 削除 | ⬜ 未着手 | - |
| 6.1 | VP Token 直接抽出実装 | ⬜ 未着手 | - |
| 6.2 | Interactor 更新 | ⬜ 未着手 | - |
| 6.3 | Credential Processor 更新 | ⬜ 未着手 | - |
| 7 | テスト修正 | ⬜ 未着手 | - |
| 8 | ドキュメント更新 | ⬜ 未着手 | - |

## 注意事項

- 各 Phase は依存関係があるため、順番に実施すること
- Phase 4 と Phase 5 は並行して進められる部分もある
- テストは各 Phase 完了後にこまめに実行すること
- コミットは Phase 単位で行うこと

## 参考資料

- [OpenID for Verifiable Presentations 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- DCQL Specification（リンク追加予定）
