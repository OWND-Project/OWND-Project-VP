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

本番環境では、有効なX.509証明書が必要です。

#### 1. Let's Encryptで証明書を取得（推奨）

```bash
# Certbotのインストール
sudo apt-get update
sudo apt-get install certbot

# 証明書取得
sudo certbot certonly --standalone -d your-verifier.com
```

#### 2. 証明書をPEM形式で読み込み

```bash
# 証明書をBase64エンコード
cat /etc/letsencrypt/live/your-verifier.com/fullchain.pem | base64 -w 0

# 秘密鍵からJWKを生成（elliptic-jwkを使用）
node -e "
const fs = require('fs');
const ellipticJwk = require('elliptic-jwk');
const privateKey = fs.readFileSync('/etc/letsencrypt/live/your-verifier.com/privkey.pem', 'utf8');
const jwk = ellipticJwk.privateKeyToJWK(privateKey);
console.log(JSON.stringify(jwk));
"
```

#### 3. 環境変数に設定

`.env` ファイルに証明書とJWKを設定します。

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
