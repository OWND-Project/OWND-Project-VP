# OID4VP Verifier - デプロイメントガイド

## 概要

このドキュメントでは、OID4VP Verifierシステムのデプロイメント手順、環境設定、トラブルシューティングについて説明します。

## 前提条件

### システム要件

- **OS**: Linux (Ubuntu 20.04+推奨), macOS 10.15+
- **Node.js**: v20以上
- **メモリ**: 最小2GB、推奨4GB以上
- **ディスク**: 最小10GB、推奨20GB以上
- **ネットワーク**: HTTPS通信用のポート開放（443または任意のポート）

### 依存ソフトウェア

```bash
# Node.js 20のインストール（nvmを使用）
nvm install 20
nvm use 20

# npmのアップデート
npm install -g npm@latest
```

## プロジェクトセットアップ

### 1. リポジトリクローン

```bash
git clone https://github.com/your-org/OWND-Project-VP.git
cd OWND-Project-VP
```

### 2. 依存関係インストール

```bash
npm install
```

### 3. ビルド

```bash
npm run build
```

**成果物**: `dist/src/`

## 環境設定

### 環境変数設定

`.env` ファイルを作成します:

```bash
# アプリケーション設定
APP_PORT=3000
NODE_ENV=production              # 本番環境ではproductionを設定（Secure Cookieを有効化）
APP_HOST=https://your-verifier.com  # アプリケーションのホストURL（セッションCookie設定用）

# OID4VP設定
OID4VP_CLIENT_ID=x509_san_dns:your-verifier.com  # Client Identifier Prefix形式
OID4VP_CLIENT_ID_SCHEME=x509_san_dns             # redirect_uri, x509_san_dns, x509_hash
OID4VP_REQUEST_HOST=haip-vp://authorize          # Authorization Request URLスキーム
OID4VP_REQUEST_URI=https://your-verifier.com/oid4vp/request
OID4VP_RESPONSE_URI=https://your-verifier.com/oid4vp/responses
OID4VP_REDIRECT_URI_RETURNED_BY_RESPONSE_URI=https://your-verifier.com/result  # Wallet応答後のリダイレクト先

# クライアントメタデータ
OID4VP_CLIENT_METADATA_NAME=Your Verifier Name
OID4VP_CLIENT_METADATA_LOGO_URI=https://your-verifier.com/logo.png
OID4VP_CLIENT_METADATA_POLICY_URI=https://your-verifier.com/policy.html
OID4VP_CLIENT_METADATA_TOS_URI=https://your-verifier.com/tos.html

# VP Token暗号化（オプション）
OID4VP_VP_TOKEN_ENCRYPTION_ENABLED=true  # VP Tokenの暗号化を有効化

# Verifier証明書（本番環境）
# 有効なX.509証明書とJWKを設定
OID4VP_VERIFIER_JWK='{"kty":"EC","crv":"P-256","x":"...","d":"..."}'
OID4VP_VERIFIER_X5C='-----BEGIN CERTIFICATE-----
MIICx...
-----END CERTIFICATE-----'

# SQLite設定
DATABASE_FILEPATH=./data/database.sqlite

# Cookie Secret（ランダムな文字列を生成）
COOKIE_SECRET=<generate-random-secret-here>

# ログレベル
LOG_LEVEL=info

# オプション: タイムアウト設定（秒）
OID4VP_REQUEST_EXPIRED_IN_AT_VERIFIER=600
OID4VP_REQUEST_EXPIRED_IN_AT_RESPONSE_ENDPOINT=600
OID4VP_RESPONSE_EXPIRED_IN=600
POST_SESSION_EXPIRED_IN=600
POST_STATE_EXPIRED_IN=600
```

### 環境変数一覧

| 環境変数名 | 必須 | 説明 | 例 |
|-----------|------|------|-----|
| APP_PORT | ○ | アプリケーションのポート番号 | 3000 |
| NODE_ENV | ○ | 環境（production時はSecure Cookie有効） | production |
| APP_HOST | ○ | アプリケーションのホストURL | https://your-verifier.com |
| OID4VP_CLIENT_ID | ○ | Client ID（Prefix形式） | x509_san_dns:your-verifier.com |
| OID4VP_CLIENT_ID_SCHEME | ○ | Client IDスキーム | x509_san_dns |
| OID4VP_REQUEST_HOST | ○ | Authorization RequestのURLスキーム | haip-vp://authorize |
| OID4VP_REQUEST_URI | ○ | Request Object取得エンドポイント | https://your-verifier.com/oid4vp/request |
| OID4VP_RESPONSE_URI | ○ | VP Token送信エンドポイント | https://your-verifier.com/oid4vp/responses |
| OID4VP_REDIRECT_URI_RETURNED_BY_RESPONSE_URI | - | Wallet応答後のリダイレクト先 | https://your-verifier.com/result |
| OID4VP_VP_TOKEN_ENCRYPTION_ENABLED | - | VP Token暗号化の有効化 | true |
| OID4VP_VERIFIER_JWK | ○ | 検証者のJWK（秘密鍵含む） | {"kty":"EC",...} |
| OID4VP_VERIFIER_X5C | ○ | X.509証明書チェーン（PEM形式） | -----BEGIN CERTIFICATE----- |
| COOKIE_SECRET | ○ | セッションCookieの暗号化キー | ランダム文字列 |
| DATABASE_FILEPATH | - | SQLiteデータベースのパス | ./data/database.sqlite |

### セッション設定に関する注意

- **NODE_ENV=production**: HTTPS環境で動作する場合は必ず`production`に設定してください。これにより`Secure`属性がCookieに付与されます。
- **APP_HOST**: セッションCookieの設定に使用されます。zrokなどのトンネリングサービスを使用する場合は、トンネルのURLを設定してください。
- Cookieが正しく設定されない場合、VP Token検証後のクレデンシャル情報表示でセッションが失われる可能性があります。

### VP Token暗号化に関する注意

`OID4VP_VP_TOKEN_ENCRYPTION_ENABLED=true`を設定すると、VP Tokenの暗号化（JWE形式）が有効になります。

#### 暗号化フロー

1. **エフェメラル鍵ペア生成**（Verifier側）
   - Authorization Request生成時にエフェメラル鍵ペア（公開鍵/秘密鍵）を生成
   - 秘密鍵はデータベースに保存（復号化用）

2. **Authorization Requestへの公開鍵追加**
   - Request Objectの`client_metadata.jwks`に公開鍵を含める
   - `response_mode`を`direct_post.jwt`に設定
   - `encryptedResponseEncValuesSupported`を`["A128GCM"]`に設定

3. **VP Token暗号化**（Wallet側）
   - Walletは`client_metadata.jwks`から公開鍵を取得
   - VP TokenをJWE形式で暗号化

4. **VP Token復号化**（Verifier側）
   - 暗号化されたVP Token（JWE）を受信
   - データベースから保存されていた秘密鍵を取得
   - JWEを復号化してVP Tokenを取得

#### 注意事項

- **Walletの対応**: Walletが`client_metadata.jwks`をサポートしている必要があります
- **セキュリティ**: 秘密鍵はデータベースに保存されるため、データベースのセキュリティを確保してください
- **トラブルシューティング**: Walletから暗号化されたVP Tokenが送信されない場合、Wallet側のログを確認してください

### Cookie Secretの生成

```bash
# ランダムな文字列を生成
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### X.509証明書の準備

本番環境では、有効なX.509証明書が必要です。Request Objectの署名に使用されます。

#### Client ID Schemeについて

OID4VP 1.0では、Client IDにスキームプレフィックスを付与します：

| スキーム | 形式 | 用途 |
|---------|------|------|
| `x509_san_dns` | `x509_san_dns:example.com` | 証明書のSAN DNS名を使用 |
| `x509_hash` | `x509_hash:<base64url-sha256>` | 証明書のSHA-256ハッシュを使用 |
| `redirect_uri` | `https://example.com/callback` | リダイレクトURIをそのまま使用 |

#### 方法1: ファイルパス指定（推奨）

秘密鍵と証明書のファイルパスを指定すると、起動時に自動的にJWK、X5C、Client IDが生成されます。

**1. 必要なファイル**

- EC秘密鍵（PEM形式）: `ec_private.key`
- X.509証明書（PEM形式）: `certificate.cer`

**2. .envファイルに設定**

```bash
# Client ID Scheme
OID4VP_CLIENT_ID_SCHEME=x509_hash

# 秘密鍵と証明書のファイルパス
OID4VP_VERIFIER_PRIVATE_KEY_PATH=../Certificates/ec_private.key
OID4VP_VERIFIER_CERTIFICATE_PATH=../Certificates/AATL20251110015175.cer
```

**3. サーバー起動**

サーバー起動時に以下が自動生成されます：
- `OID4VP_VERIFIER_JWK`: 秘密鍵からJWK形式に変換
- `OID4VP_VERIFIER_X5C`: 証明書からBase64 DER形式に変換
- `OID4VP_CLIENT_ID`: 証明書のSHA-256ハッシュから`x509_hash:xxx`形式で生成

起動ログで確認できます：
```
Loading certificate config from:
  Private key: ../Certificates/ec_private.key
  Certificate: ../Certificates/AATL20251110015175.cer
Generated certificate config:
  Client ID: x509_hash:3N0T7GUjp76p-bK_tzbRbAP5nW_nRQVu66ywYvb7tcM
```

#### 方法2: Let's Encrypt証明書

Let's Encryptで取得した証明書を使用する場合の設定手順です。

**1. 証明書の取得**

```bash
# Certbotのインストール
sudo apt-get update
sudo apt-get install certbot

# 証明書取得
sudo certbot certonly --standalone -d your-verifier.com
```

**2. 証明書をBase64エンコード**

```bash
cat /etc/letsencrypt/live/your-verifier.com/fullchain.pem | base64 -w 0
```

**3. 秘密鍵からJWKを生成**

```bash
node -e "
const fs = require('fs');
const ellipticJwk = require('elliptic-jwk');
const privateKey = fs.readFileSync('/etc/letsencrypt/live/your-verifier.com/privkey.pem', 'utf8');
const jwk = ellipticJwk.privateKeyToJWK(privateKey);
console.log(JSON.stringify(jwk));
"
```

**4. 環境変数に設定**

`.env` ファイルに証明書とJWKを設定します。

#### 方法3: 開発用自己署名証明書

開発環境で自己署名証明書を使用する場合：

```bash
# EC秘密鍵の生成
openssl ecparam -name prime256v1 -genkey -noout -out dev_private.key

# 自己署名証明書の生成
openssl req -new -x509 -key dev_private.key -out dev_cert.pem -days 365 -subj "/CN=localhost"

# JWK形式に変換（上記の手順を参照）
# Base64 DER形式に変換（上記の手順を参照）
```

**注意**: 自己署名証明書は開発環境専用です。本番環境では使用しないでください。

#### 証明書更新時の注意

証明書を更新した場合：

1. 新しい秘密鍵と証明書ファイルを配置
2. `.env`のファイルパスを更新（必要な場合）
3. サーバーを再起動（JWK、X5C、Client IDは自動的に再生成されます）

**注意**: `x509_hash`スキームを使用している場合、証明書が変わるとClient IDも変わります。

## デプロイ方法

デプロイ方法は環境により異なります。以下のオプションから選択してください：

- **直接実行**: `NODE_ENV=prod npm start`
- **PM2**: Node.jsプロセス管理ツールを使用
- **Docker**: コンテナ化してデプロイ
- **その他**: Kubernetes、AWS ECS等のコンテナオーケストレーション

詳細な設定方法は、使用する環境のベストプラクティスに従ってください。

## 運用上の考慮事項

### データベース管理

- SQLiteデータベースの定期バックアップを推奨
- 期限切れレコード（sessions, response_codes, post_states）の定期クリーンアップを実装
- WALモードの有効化を推奨（`PRAGMA journal_mode=WAL`）

### セキュリティ

- 本番環境では必ずHTTPSを使用
- Cookie Secretはランダムで十分に長い文字列を使用
- X.509証明書の有効期限管理（Let's Encrypt等）
- 必要なポートのみ開放
- 依存パッケージの定期的なセキュリティアップデート

### 監視

- ヘルスチェックエンドポイントの実装
- アプリケーションログの監視
- メモリ使用量の監視

## まとめ

OID4VP Verifierは単一ノード構成のため、デプロイが簡単です：

- **シンプルな構成**: 1つのNode.jsプロセスとSQLite
- **スケーラビリティ**: 必要に応じて水平スケール可能
- **柔軟性**: 様々なデプロイ環境に対応可能

本番環境では、HTTPS、適切な証明書管理、定期的なバックアップを必ず実施してください。
