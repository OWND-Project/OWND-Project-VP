# クレデンシャル証明書検証

## 概要

クレデンシャル（SD-JWT）の検証時に、X.509証明書チェーンを検証する機能について説明します。

## 変更内容

### 背景

従来、開発環境では証明書チェーン検証をスキップする設定（`skipVerifyChain`）がありましたが、カスタムトラストアンカー（信頼証明書）を追加できる機能を実装したため、環境に関係なく常に証明書チェーン検証を行うように変更します。

### 変更箇所

1. **`src/usecases/internal/credential2-processor.ts`**
   - `skipVerifyChain`オプションを削除
   - 常に証明書チェーン検証を実行

2. **`src/usecases/oid4vp-interactor.ts`**
   - `getCredentialData()`内の`skipVerifyChain`オプションを削除
   - 常に証明書チェーン検証を実行

3. **`src/helpers/jwt-helper.ts`**
   - `verifySdJwt()`の`skipVerifyChain`パラメータを削除

4. **`src/tool-box/verify.ts`**
   - `verifyJwt()`の`skipVerifyChain`オプションを削除
   - 常に`verifyCertificateChain()`を呼び出す

5. **`src/oid4vp/types.ts`**
   - `PublicKeySetting`インターフェースから`skipVerifyChain`を削除

## 信頼証明書の設定

### 環境変数

```bash
# 信頼証明書ディレクトリ（トラストアンカー用）
OID4VP_TRUSTED_CERTIFICATES_DIR=../TrustAnchors
```

### 設定方法

1. 中間証明書とルート証明書を`TrustAnchors`ディレクトリに配置
2. `.cer`, `.crt`, `.pem`形式の証明書が自動的に読み込まれる
3. サーバー起動時にログで読み込み結果を確認

```
Loading trusted certificates from: ../TrustAnchors
  Loaded: intermediate1.cer
  Loaded: intermediate2.cer
  Loaded: root.cer
Loaded 3 trusted certificate(s)
```

## 検証フロー

```
┌─────────────────────────────────────────────────┐
│  1. SD-JWT受信                                  │
│     - VP Tokenからクレデンシャルを抽出           │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  2. JWT署名検証                                 │
│     - JWTヘッダーからx5c（証明書チェーン）を取得 │
│     - 証明書チェーン検証を実行                   │
│     - 署名検証を実行                            │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  3. 証明書チェーン検証                          │
│     - システムルート証明書をロード               │
│     - カスタム信頼証明書を追加                   │
│     - pkijsで証明書チェーンを検証                │
└────────────────┬────────────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────────────┐
│  4. 検証結果                                    │
│     - 成功: クレデンシャルデータを返却           │
│     - 失敗: エラーを返却                        │
└─────────────────────────────────────────────────┘
```

## 証明書ディレクトリ構成例

```
Certificate/
├── ec_private.key          # Verifier秘密鍵（署名用）
└── AATL20251110015175.cer  # Verifierリーフ証明書

TrustAnchors/
├── intermediate1.cer       # 中間証明書1
├── intermediate2.cer       # 中間証明書2
└── root.cer                # ルート証明書
```

## 注意事項

- 信頼証明書が正しく設定されていない場合、クレデンシャル検証が失敗します
- 自己署名証明書で署名されたクレデンシャルは、その証明書が信頼リストにない限り検証に失敗します
- 開発環境でも本番環境と同様に証明書検証が行われます
