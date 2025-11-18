# PEX残存情報の整理

**調査日時**: 2025-11-18
**目的**: OID4VP 1.0 (DCQL) 移行後に残存するPresentation Exchange (PEX)関連の情報を整理

---

## サマリー

| カテゴリ | 残存数 | 状態 | 対応方針 |
|---------|--------|------|---------|
| ソースコード | 28箇所 | ⚠️ Deprecated | 後方互換性のため保持 |
| ドキュメント | 102箇所 | ⚠️ 要更新 | 段階的に更新 |

---

## 1. ソースコード内の残存 (28箇所)

### 1.1 型定義 (src/oid4vp/types.ts)

**状態**: `@deprecated` タグ付きで保持

```typescript
// 廃止されたPEX型定義 (後方互換性のため保持)
export interface InputDescriptor { ... }          // Line 42
export interface DescriptorMap { ... }            // Line 53
export interface PresentationDefinition { ... }   // Line 69
export interface PresentationSubmission { ... }   // Line 76
```

**理由**:
- 廃止されたテストコードでの使用
- 既存システムとの一時的な互換性維持

**推奨**: 将来的に削除予定（次回メジャーバージョンアップ時）

---

### 1.2 Verifier (src/oid4vp/verifier.ts)

**Deprecated メソッド**:

```typescript
// Line 227-276
getOptionalDescriptor(
  inputDescriptorId: string,
  authResponse: AuthResponsePayload
): Promise<Result<{ descriptorMap: DescriptorMap | null }, DescriptorError>>

// Line 237-276
getDescriptor(
  inputDescriptorId: string,
  authResponse: AuthResponsePayload
): Promise<Result<{ descriptorMap: DescriptorMap }, DescriptorError>>
```

**使用箇所**:
- `src/usecases/internal/credential2-processor.ts` (deprecated `processCredential2`)

**状態**: `@deprecated` マーク済み、DCQL版 `extractCredentialFromVpToken` で置き換え完了

**対応方針**: 次回クリーンアップ時に削除

---

### 1.3 Verify (src/oid4vp/verify.ts)

**Deprecated 関数**:

```typescript
// Line 13-43
export const getDescriptorMap = (
  inputDescriptor: InputDescriptor,
  descriptorMap: DescriptorMap[],
): DescriptorMap | null
```

**状態**: `@deprecated` JSDocコメント付き

**使用箇所**: `verifier.ts` の deprecated メソッド内のみ

**対応方針**: verifier.tsのdeprecatedメソッド削除と同時に削除

---

### 1.4 Input Descriptor (src/usecases/internal/input-descriptor.ts)

**状態**: ファイル全体が `@deprecated`

```typescript
/**
 * @deprecated This file contains PEX-related Input Descriptors which are deprecated.
 * These will be replaced with DCQL credential queries in Phase 6.
 * Use DCQL for new implementations.
 */

export const INPUT_DESCRIPTOR_AFFILIATION: InputDescriptor = { ... }
export const submissionRequirementAffiliation: SubmissionRequirement = { ... }
```

**使用箇所**: deprecated `processCredential2` 関数内のみ

**対応方針**: processCredential2削除時に一緒に削除

---

### 1.5 OID4VP Interactor (src/usecases/oid4vp-interactor.ts)

**Deprecated メソッド**:

```typescript
// Line 151-202: getRequestObject - @deprecated
// Line 208-214: getPresentationDefinition - @deprecated
```

**状態**:
- コメントで「PEX-related method. DCQL flow doesn't use Presentation Definition」と明記
- `getPresentationDefinition` は null を返すスタブ実装

**対応方針**: API互換性が不要になった時点で削除

---

### 1.6 Credential Processor (src/usecases/internal/credential2-processor.ts)

**Deprecated 関数**:

```typescript
// Line 100-177
/**
 * @deprecated Use extractCredentialFromVpToken instead (DCQL flow)
 * This PEX-based processor will be removed in a future version
 */
export const processCredential2 = async (
  verifier: Verifier,
  inputDescriptorId: string,
  authResponse: AuthResponsePayload,
  nonce: string,
): Promise<Result<{ affiliation?: string; icon?: string }, NotSuccessResult>>
```

**状態**: 完全にDCQL版 `extractCredentialFromVpToken` で置き換え済み

**対応方針**: 次回クリーンアップ時に削除可能

---

## 2. ドキュメント内の残存 (102箇所)

### 2.1 主要ドキュメント別の内訳

| ドキュメント | PEX参照数 | 更新状態 | 優先度 |
|-------------|----------|----------|--------|
| oid4vp-implementation.md | 45箇所 | 🟡 部分更新済み | 高 |
| api-specification.md | 18箇所 | ❌ 未更新 | 高 |
| components.md | 12箇所 | ❌ 未更新 | 中 |
| data-model.md | 10箇所 | ❌ 未更新 | 中 |
| architecture.md | 8箇所 | ❌ 未更新 | 中 |
| developer-guide.md | 5箇所 | ❌ 未更新 | 低 |
| security.md | 3箇所 | ❌ 未更新 | 低 |
| er.md | 1箇所 | ❌ 未更新 | 低 |

---

### 2.2 oid4vp-implementation.md (45箇所)

**更新済み箇所**:
- ✅ プロトコルフロー図 (Presentation Definition endpoint削除)
- ✅ コンポーネント構成図 (presentation_definitionsテーブル削除)
- ✅ generateAuthRequest コード例 (DCQL Query使用)
- ✅ DCQL Query例追加

**未更新箇所**:
- ❌ Line 241-289: getRequestObject処理フロー (Presentation Definition取得ロジック)
- ❌ Line 290-334: receiveAuthResponse (presentation_submissionパラメータ)
- ❌ Line 336-398: exchangeAuthResponse (processCredential2使用)
- ❌ Line 400-437: VP Token検証プロセス (getDescriptor/getPresentation)
- ❌ Line 500-543: Input Descriptor定義セクション
- ❌ Line 638-654: エラーハンドリング (DescriptorError)
- ❌ Line 670: OID4VP_PRESENTATION_DEFINITION_URI環境変数
- ❌ Line 684-756: 詳細フロー図 (Presentation Definition取得ステップ)

**推奨更新内容**:
1. getRequestObject → DCQL版に書き換え
2. receiveAuthResponse → presentation_submission削除
3. exchangeAuthResponse → extractCredentialFromVpToken使用に書き換え
4. VP Token検証プロセス → DCQL直接抽出方式に書き換え
5. Input Descriptorセクション → DCQL Queryセクションに置き換え
6. シーケンス図 → Presentation Definition取得ステップ削除

---

### 2.3 api-specification.md (18箇所)

**主な記述内容** (推測):
- GET /oid4vp/presentation-definition エンドポイント
- POST /oid4vp/auth-request レスポンス (presentationDefinitionId)
- POST /oid4vp/responses リクエスト (presentation_submission)
- データ型定義 (PresentationDefinition, InputDescriptor)

**推奨更新内容**:
- Presentation Definition エンドポイント削除
- DCQL Query フォーマット追加
- VP Token構造をDCQL形式に更新

---

### 2.4 components.md (12箇所)

**主な記述内容** (推測):
- Verifier コンポーネント (generatePresentationDefinition)
- PresentationDefinitionDatastore
- Input Descriptor処理

**推奨更新内容**:
- PEXコンポーネント削除
- DCQLコンポーネント追加
- extractCredentialFromVpToken説明追加

---

### 2.5 data-model.md (10箇所)

**主な記述内容** (推測):
- presentation_definitions テーブル
- PresentationSubmission データモデル
- DescriptorMap 構造

**推奨更新内容**:
- presentation_definitions テーブル削除を明記
- DCQL Query データモデル追加
- VP Token構造 (Record<string, string[]>) 説明

---

## 3. データベーススキーマ

### 3.1 削除済みテーブル

```sql
-- presentation_definitions テーブル (削除済み)
-- src/database/schema.ts でコメントアウト済み
```

**状態**: DDL定義はコメントアウト済み、実際のテーブル削除はマイグレーション未実施

**推奨**: マイグレーションスクリプト作成

---

## 4. テストコード

### 4.1 スキップ済みテスト (12件)

**ファイル**: `tests/oid4vp/verifier.test.ts`

```typescript
describe.skip("#generatePresentationDefinition (DEPRECATED - PEX removed)", ...)
describe.skip("#getPresentationDefinition (DEPRECATED - PEX removed)", ...)
describe.skip("#getDescriptor (DEPRECATED - PEX removed)", ...)
describe.skip("#getPresentation (DEPRECATED - PEX removed)", ...)
describe.skip("#getCredential (DEPRECATED - PEX removed)", ...)
```

**状態**: `.skip` でスキップ済み、`@ts-ignore` でTypeScriptエラー抑制

**対応方針**:
- 現状: 後方互換性テストとして保持
- 将来: deprecated実装削除時に一緒に削除

---

## 5. 環境変数

### 5.1 廃止された環境変数

```bash
# 廃止 (使用されていない)
OID4VP_PRESENTATION_DEFINITION_URI="http://localhost/oid4vp/presentation-definitions"
```

**現在の状態**:
- `docs/oid4vp-implementation.md` Line 670に記載あり
- 実装では使用されていない

**推奨**:
- ドキュメントから削除
- .env.exampleから削除（存在する場合）

---

## 6. 対応優先度と推奨アクション

### 優先度: 高 (即座に対応)

1. **api-specification.md更新**
   - Presentation Definition エンドポイント削除
   - DCQL仕様追加
   - VP Token構造更新

2. **oid4vp-implementation.md完全更新**
   - 処理フロー全体をDCQL版に書き換え
   - Input DescriptorセクションをDCQL Queryセクションに置き換え

### 優先度: 中 (計画的に対応)

3. **components.md / data-model.md 更新**
   - コンポーネント構成図更新
   - データモデル図更新

4. **データベースマイグレーション**
   - presentation_definitionsテーブル削除

### 優先度: 低 (必要に応じて対応)

5. **その他ドキュメント更新**
   - architecture.md, developer-guide.md, security.md

6. **Deprecated実装削除**
   - PEX型定義削除
   - deprecated関数削除
   - スキップ済みテスト削除

---

## 7. クリーンアップ計画案

### Phase A: ドキュメント完全更新 (推定: 2-3時間)

- [ ] api-specification.md 全面書き換え
- [ ] oid4vp-implementation.md 未更新箇所を完全更新
- [ ] components.md DCQL対応更新
- [ ] data-model.md DCQL対応更新

### Phase B: データベースクリーンアップ (推定: 30分)

- [ ] マイグレーションスクリプト作成
- [ ] presentation_definitionsテーブル削除実行
- [ ] schema.tsから完全削除

### Phase C: コードクリーンアップ (推定: 1時間)

- [ ] deprecated関数削除
  - processCredential2
  - getDescriptor / getOptionalDescriptor
  - getDescriptorMap
  - getPresentationDefinition (interactor)
- [ ] deprecated型削除
  - InputDescriptor
  - DescriptorMap
  - PresentationDefinition
  - PresentationSubmission
- [ ] input-descriptor.tsファイル削除
- [ ] スキップ済みテスト削除

### Phase D: 最終検証 (推定: 30分)

- [ ] TypeScriptコンパイル確認
- [ ] 全テスト実行
- [ ] ドキュメントリンク確認

**合計推定時間**: 4-5時間

---

## 8. 結論

### 現在の状態

✅ **実装**: DCQL移行完了、PEX機能は`@deprecated`で保持
🟡 **テスト**: 全テスト通過、deprecated部分はスキップ
⚠️ **ドキュメント**: 部分的に更新済み、多数の箇所が要更新

### 推奨される次のステップ

1. **即座に実施**: api-specification.md と oid4vp-implementation.md の完全更新
2. **計画的に実施**: データベースマイグレーションとコードクリーンアップ
3. **継続的に実施**: 残りのドキュメント更新

### リスク評価

- **低リスク**: deprecated実装削除（後方互換性が不要な場合）
- **中リスク**: データベーステーブル削除（バックアップ必須）
- **高リスク**: なし（DCQL実装は完全に動作中）

---

**作成日**: 2025-11-18
**最終更新**: 2025-11-18
