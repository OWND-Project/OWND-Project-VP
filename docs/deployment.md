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
NODE_ENV=prod
APP_HOST=https://your-frontend-app.com  # フロントエンドアプリのオリジン（CORS用）

# OID4VP設定
OID4VP_CLIENT_ID=https://your-verifier.com
OID4VP_CLIENT_ID_SCHEME=x509_san_dns
OID4VP_REQUEST_HOST=oid4vp://your-verifier.com
OID4VP_REQUEST_URI=https://your-verifier.com/oid4vp/request
OID4VP_RESPONSE_URI=https://your-verifier.com/oid4vp/responses
OID4VP_REDIRECT_URI=https://your-frontend-app.com/callback
OID4VP_PRESENTATION_DEFINITION_URI=https://your-verifier.com/oid4vp/presentation-definition

# Verifier証明書（本番環境）
# 有効なX.509証明書とJWKを設定
OID4VP_VERIFIER_JWK='{"kty":"EC","crv":"P-256","x":"...","d":"..."}'
OID4VP_VERIFIER_X5C='-----BEGIN CERTIFICATE-----
MIICx...
-----END CERTIFICATE-----'

# SQLite設定
DATABASE_FILEPATH=./data/database.sqlite

# Cookie Secret（ランダムな文字列を生成）
OID4VP_COOKIE_SECRET=<generate-random-secret-here>

# ログレベル
LOG_LEVEL=info

# オプション: タイムアウト設定
OID4VP_REQUEST_EXPIRED_IN=600  # 秒（デフォルト: 600秒 = 10分）
OID4VP_RESPONSE_EXPIRED_IN=600
POST_SESSION_EXPIRED_IN=600
POST_STATE_EXPIRED_IN=600

# オプション: VP Tokenサイズ制限
OID4VP_VERIFIER_AUTH_RESPONSE_LIMIT=1mb
```

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

### Option 1: 直接実行

```bash
# 本番モードで起動
NODE_ENV=prod npm start
```

### Option 2: PM2を使用（推奨）

PM2は、Node.jsアプリケーションのプロセス管理ツールです。

#### PM2のインストール

```bash
npm install -g pm2
```

#### PM2設定ファイル

`ecosystem.config.js` を作成:

```javascript
module.exports = {
  apps: [{
    name: 'oid4vp-verifier',
    script: './dist/src/index.js',
    instances: 1,
    autorestart: true,
    watch: false,
    max_memory_restart: '1G',
    env: {
      NODE_ENV: 'prod',
      APP_PORT: 3000,
    },
    error_file: './logs/err.log',
    out_file: './logs/out.log',
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }]
};
```

#### PM2で起動

```bash
# アプリケーション起動
pm2 start ecosystem.config.js

# ステータス確認
pm2 status

# ログ確認
pm2 logs oid4vp-verifier

# アプリケーション再起動
pm2 restart oid4vp-verifier

# 自動起動設定
pm2 startup
pm2 save
```

### Option 3: Dockerを使用

#### Dockerfile

```dockerfile
FROM node:20-alpine

WORKDIR /app

# 依存関係のコピーとインストール
COPY package*.json ./
RUN npm ci --only=production

# ソースコードのコピー
COPY dist ./dist

# ポート公開
EXPOSE 3000

# ヘルスチェック
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "require('http').get('http://localhost:3000/health-check', (r) => {process.exit(r.statusCode === 204 ? 0 : 1)})"

# 起動
CMD ["node", "dist/src/index.js"]
```

#### docker-compose.yml

```yaml
version: '3.8'

services:
  oid4vp-verifier:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=prod
      - APP_PORT=3000
    env_file:
      - .env
    volumes:
      - ./data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "node", "-e", "require('http').get('http://localhost:3000/health-check', (r) => {process.exit(r.statusCode === 204 ? 0 : 1)})"]
      interval: 30s
      timeout: 3s
      retries: 3
```

#### Dockerビルドと起動

```bash
# イメージビルド
docker-compose build

# コンテナ起動
docker-compose up -d

# ログ確認
docker-compose logs -f

# ステータス確認
docker-compose ps
```

## リバースプロキシ設定

### Nginx設定例

`/etc/nginx/sites-available/oid4vp-verifier`:

```nginx
server {
    listen 443 ssl http2;
    server_name your-verifier.com;

    # SSL証明書
    ssl_certificate /etc/letsencrypt/live/your-verifier.com/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/your-verifier.com/privkey.pem;

    # SSL設定
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers 'ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384';
    ssl_prefer_server_ciphers on;

    # プロキシ設定
    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_cache_bypass $http_upgrade;

        # タイムアウト設定
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }

    # ヘルスチェック
    location /health-check {
        proxy_pass http://localhost:3000/health-check;
        access_log off;
    }
}

# HTTPからHTTPSへリダイレクト
server {
    listen 80;
    server_name your-verifier.com;
    return 301 https://$server_name$request_uri;
}
```

Nginxを有効化して再起動:

```bash
# シンボリックリンク作成
sudo ln -s /etc/nginx/sites-available/oid4vp-verifier /etc/nginx/sites-enabled/

# 設定テスト
sudo nginx -t

# Nginx再起動
sudo systemctl restart nginx
```

## データベース管理

### SQLiteバックアップ

```bash
# バックアップスクリプト
#!/bin/bash
BACKUP_DIR="./backups"
DATE=$(date +%Y%m%d_%H%M%S)
DB_FILE="./data/database.sqlite"
BACKUP_FILE="$BACKUP_DIR/database_$DATE.sqlite"

mkdir -p $BACKUP_DIR
sqlite3 $DB_FILE ".backup $BACKUP_FILE"
echo "Backup created: $BACKUP_FILE"

# 古いバックアップを削除（30日以上前）
find $BACKUP_DIR -name "database_*.sqlite" -mtime +30 -delete
```

### cronで自動バックアップ

```bash
# crontabに追加
crontab -e

# 毎日午前2時にバックアップ
0 2 * * * /path/to/backup.sh >> /path/to/backup.log 2>&1
```

### 期限切れデータのクリーンアップ

SQLiteには自動クリーンアップ機能はないため、定期的にクリーンアップスクリプトを実行します。

```javascript
// cleanup.js
const sqlite3 = require('sqlite3');
const db = new sqlite3.Database('./data/database.sqlite');

const now = Date.now();

// 期限切れセッションを削除
db.run('DELETE FROM sessions WHERE expires_at < ?', [now], (err) => {
  if (err) console.error('Failed to clean up sessions:', err);
  else console.log('Sessions cleaned up');
});

// 期限切れレスポンスコードを削除
db.run('DELETE FROM response_codes WHERE expires_at < ?', [now], (err) => {
  if (err) console.error('Failed to clean up response_codes:', err);
  else console.log('Response codes cleaned up');
});

// 期限切れ状態を削除
db.run('DELETE FROM post_states WHERE expires_at < ?', [now], (err) => {
  if (err) console.error('Failed to clean up post_states:', err);
  else console.log('Post states cleaned up');
});

db.close();
```

```bash
# cronで毎時実行
crontab -e

# 毎時0分にクリーンアップ
0 * * * * node /path/to/cleanup.js >> /path/to/cleanup.log 2>&1
```

## 監視とログ

### ログ管理

```bash
# PM2のログローテーション
pm2 install pm2-logrotate

# ログローテーション設定
pm2 set pm2-logrotate:max_size 10M
pm2 set pm2-logrotate:retain 30
```

### ヘルスチェック

```bash
# シンプルなヘルスチェックスクリプト
#!/bin/bash
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/health-check)

if [ $HTTP_CODE -eq 204 ]; then
    echo "OK: OID4VP Verifier is healthy"
    exit 0
else
    echo "ERROR: OID4VP Verifier returned $HTTP_CODE"
    exit 1
fi
```

### メトリクス収集（オプション）

Prometheusなどのモニタリングツールと連携する場合は、専用のメトリクスエンドポイントを実装します。

## トラブルシューティング

### 問題: アプリケーションが起動しない

```bash
# ログ確認
pm2 logs oid4vp-verifier

# 環境変数確認
printenv | grep OID4VP

# ポート競合確認
lsof -i :3000
```

### 問題: VP Token検証失敗

```bash
# 証明書の有効性確認
openssl x509 -in /etc/letsencrypt/live/your-verifier.com/fullchain.pem -text -noout

# ログレベルをdebugに設定して詳細確認
LOG_LEVEL=debug pm2 restart oid4vp-verifier
```

### 問題: データベースロック

```bash
# SQLiteのWALモードを確認
sqlite3 ./data/database.sqlite "PRAGMA journal_mode;"

# WALモードに変更（推奨）
sqlite3 ./data/database.sqlite "PRAGMA journal_mode=WAL;"
```

### 問題: メモリ不足

```bash
# メモリ使用量確認
pm2 monit

# メモリ制限を増やす（ecosystem.config.jsで設定）
max_memory_restart: '2G'
```

## セキュリティベストプラクティス

1. **HTTPS必須**: 本番環境では必ずHTTPSを使用
2. **Cookie Secret**: ランダムで長い文字列を使用
3. **証明書管理**: Let's Encryptで自動更新
4. **ファイアウォール**: 必要なポートのみ開放
5. **定期アップデート**: Node.jsと依存パッケージを定期的に更新
6. **バックアップ**: SQLiteデータベースの定期バックアップ
7. **ログ監視**: エラーログの定期確認

## 更新とメンテナンス

### アプリケーション更新

```bash
# コード取得
git pull origin main

# 依存関係更新
npm install

# ビルド
npm run build

# PM2で再起動
pm2 restart oid4vp-verifier
```

### 依存パッケージ更新

```bash
# セキュリティ脆弱性確認
npm audit

# 脆弱性修正
npm audit fix

# パッケージ更新
npm update

# メジャーバージョン更新（慎重に）
npm outdated
npm install <package>@latest
```

## まとめ

OID4VP Verifierは単一ノード構成のため、デプロイが簡単です：

- **シンプルな構成**: 1つのNode.jsプロセスとSQLite
- **スケーラビリティ**: 必要に応じて水平スケール可能
- **メンテナンス**: PM2による自動再起動とログ管理
- **監視**: ヘルスチェックエンドポイントによる稼働監視

本番環境では、HTTPS、適切な証明書管理、定期的なバックアップを必ず実施してください。
