# デプロイメントガイド

## 概要

このドキュメントでは、boolcheckシステムの各ノード（BOOL_NODE、API_NODE、VERIFIER_NODE）のデプロイメント手順、環境設定、ネットワーク構成、トラブルシューティングについて説明します。

## 前提条件

### システム要件

- **OS**: Linux (Ubuntu 20.04+推奨), macOS 10.15+
- **Node.js**: v20以上
- **メモリ**: 最小2GB、推奨4GB以上
- **ディスク**: 最小10GB、推奨50GB以上（OrbitDB/IPFSデータ蓄積のため）
- **ネットワーク**: インターネット接続、libp2p通信用のポート開放

### 依存ソフトウェア

```bash
# Node.js 20のインストール（nvmを使用）
nvm install stable --latest-npm
nvm use 20

# Yarnのインストール（必要に応じて）
npm install -g yarn
```

## プロジェクトセットアップ

### 1. リポジトリクローン

```bash
git clone https://github.com/your-org/boolcheck-backend.git
cd boolcheck-backend
```

### 2. 依存関係インストール

```bash
yarn install
```

## BOOL_NODE デプロイメント

### 1. ビルド

```bash
yarn run build:bool_node
```

**成果物**: `apps/bool_node/src/`

### 2. 環境設定

```bash
cp .env.template.bool_node ./apps/bool_node/.env
```

**環境変数設定** (`apps/bool_node/.env`):

```bash
# アプリケーション設定
APP_TYPE=BOOL_NODE
APP_PORT=3000
NODE_ENV=prod
APP_HOST=https://your-frontend-app.com  # フロントエンドアプリのオリジン

# OrbitDB/IPFS設定
PEER_ADDR=/ip4/0.0.0.0/tcp/4000
ORBITDB_ROOT_ID_KEY=main_peer
IPFS_PATH=./ipfs/blocks
ORBITDB_PATH=./orbitdb
KEYSTORE_PATH=./keystore
PEER_ID_PATH=./peer-id.bin  # 固定PeerIDを使用

# SQLite設定
DATABASE_FILEPATH=./database.sqlite

# MAIN_PEER_HOST（API_NODEが接続するため、外部からアクセス可能なURLを指定）
# ※BOOL_NODE自身は使用しないが、API_NODEの設定に必要
```

### 3. Peer ID生成

初回起動時に自動生成されます。`PEER_ID_PATH`で指定したファイルに保存されます。

**手動生成（必要に応じて）**:
```bash
node -e "
const { createEd25519PeerId } = require('@libp2p/peer-id-factory');
const { marshalPrivateKey } = require('@libp2p/peer-id');
const fs = require('fs');

(async () => {
  const peerId = await createEd25519PeerId();
  const privateKey = marshalPrivateKey(peerId);
  fs.writeFileSync('./apps/bool_node/peer-id.bin', privateKey);
  console.log('PeerID:', peerId.toString());
})();
"
```

### 4. 起動

```bash
cd apps/bool_node
nvm use 20
node --enable-source-maps src/index.js
```

**または**:
```bash
yarn run start:bool_node
```

### 5. 動作確認

```bash
# ヘルスチェック
curl http://localhost:3000/health-check

# Peer情報取得
curl http://localhost:3000/admin/peer/info
```

**期待されるレスポンス**:
```json
{
  "identity": {
    "hash": "zdpuAtRaxsrGj93bD6DmcruYvaNeuP7sgWDYsXCPTqCs8d1Lz"
  },
  "multiaddrs": [
    "/ip4/127.0.0.1/tcp/4000/p2p/12D3KooW...",
    "/ip4/192.168.1.100/tcp/4000/p2p/12D3KooW..."
  ]
}
```

### 6. ネットワーク設定

**ファイアウォール**:
```bash
# ポート開放（Ubuntu/ufw）
sudo ufw allow 3000/tcp   # API
sudo ufw allow 4000/tcp   # libp2p
```

**リバースプロキシ（Nginx）**:
```nginx
server {
    listen 443 ssl http2;
    server_name api.boolcheck.com;

    ssl_certificate /path/to/fullchain.pem;
    ssl_certificate_key /path/to/privkey.pem;

    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

---

## API_NODE デプロイメント

### 1. ビルド

```bash
yarn run build:api_node
```

### 2. 環境設定

```bash
cp .env.template.api_node ./apps/api_node/.env
```

**環境変数設定** (`apps/api_node/.env`):

```bash
# アプリケーション設定
APP_TYPE=API_NODE
APP_PORT=3001
NODE_ENV=prod

# OrbitDB/IPFS設定
PEER_ADDR=/ip4/0.0.0.0/tcp/4001
ORBITDB_ROOT_ID_KEY=peer2
IPFS_PATH=./ipfs/blocks
ORBITDB_PATH=./orbitdb
KEYSTORE_PATH=./keystore

# BOOL_NODE接続設定
MAIN_PEER_HOST=http://localhost:3000  # BOOL_NODEのURL（内部ネットワークの場合）
# MAIN_PEER_HOST=https://api.boolcheck.com  # BOOL_NODEのURL（外部ネットワークの場合）

# SQLite設定
DATABASE_FILEPATH=./database.sqlite
```

### 3. 起動

```bash
cd apps/api_node
nvm use 20
node --enable-source-maps src/index.js
```

**または**:
```bash
yarn run start:api_node
```

### 4. 動作確認

**同期状態確認**:
```bash
# BOOL_NODEからDB情報取得
curl http://localhost:3000/admin/db/info

# API_NODEのURL一覧取得（同期後）
curl http://localhost:3001/database/urls
```

### 5. 初回同期

初回起動時、API_NODEは以下のプロセスで同期：

1. BOOL_NODEの`/admin/db/info`にアクセス
2. OrbitDBアドレスとPeer情報を取得
3. BOOL_NODEにlibp2p dialで接続
4. OrbitDBドキュメントを開いて全履歴を同期
5. 同期完了後、リアルタイム更新を受信

**同期ログ例**:
```
info: connect to: http://localhost:3000
info: Dialing to /ip4/127.0.0.1/tcp/4000/p2p/12D3KooW...
info: Successfully connected to /ip4/127.0.0.1/tcp/4000/p2p/12D3KooW...
info: sync all urls
info: 1000 registered
info: 2000 registered
info: Execution Time(2345 count): 15000ms
info: sync all claims
...
```

### 6. スケールアウト

複数のAPI_NODEを起動して負荷分散：

```bash
# API_NODE 1
APP_PORT=3001 PEER_ADDR=/ip4/0.0.0.0/tcp/4001 node src/index.js

# API_NODE 2
APP_PORT=3011 PEER_ADDR=/ip4/0.0.0.0/tcp/4011 node src/index.js

# API_NODE 3
APP_PORT=3021 PEER_ADDR=/ip4/0.0.0.0/tcp/4021 node src/index.js
```

**ロードバランサ（Nginx）**:
```nginx
upstream api_nodes {
    server localhost:3001;
    server localhost:3011;
    server localhost:3021;
}

server {
    listen 443 ssl http2;
    server_name api-read.boolcheck.com;

    location / {
        proxy_pass http://api_nodes;
    }
}
```

---

## VERIFIER_NODE デプロイメント

### 1. ビルド

```bash
yarn run build:verifier_node
```

### 2. 環境設定

```bash
cp .env.template.verifier_node ./apps/verifier_node/.env
```

**環境変数設定** (`apps/verifier_node/.env`):

```bash
# アプリケーション設定
APP_TYPE=VERIFIER_NODE
APP_PORT=3002
APP_HOST=https://your-frontend-app.com  # フロントエンドアプリのオリジン

# OrbitDB/IPFS設定（OID4VP用）
ORBITDB_ROOT_ID_KEY=oid4vp
OID4VP_IPFS_PATH=./oid4vp/ipfs/blocks
OID4VP_ORBITDB_PATH=./oid4vp/orbitdb
OID4VP_KEYSTORE_PATH=./oid4vp/keystore

# OID4VP設定
OID4VP_CLIENT_ID_SCHEME=x509_san_dns
OID4VP_VERIFIER_JWK='{"kty":"EC","crv":"P-256","x":"...","d":"..."}'
OID4VP_VERIFIER_X5C='-----BEGIN CERTIFICATE-----
MIICx...
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIICy...
-----END CERTIFICATE-----'

# OID4VP URL設定
OID4VP_REQUEST_HOST=oid4vp://your-domain.com/request
OID4VP_REQUEST_URI=https://your-domain.com/oid4vp/request
OID4VP_RESPONSE_URI=https://your-domain.com/oid4vp/responses
OID4VP_REDIRECT_URI=https://your-domain.com/oid4vp/redirect
OID4VP_CLIENT_ID=https://your-domain.com
OID4VP_PRESENTATION_DEFINITION_URI=https://your-domain.com/oid4vp/presentation-definitions

# OID4VP タイムアウト設定
OID4VP_REQUEST_EXPIRED_IN_AT_RESPONSE_ENDPOINT=600
OID4VP_REQUEST_EXPIRED_IN_AT_VERIFIER=600
OID4VP_RESPONSE_EXPIRED_IN=600
POST_SESSION_EXPIRED_IN=600
POST_STATE_EXPIRED_IN=600

# セッション設定
COOKIE_SECRET=your-random-secret-key-here

# Client Metadata
OID4VP_CLIENT_METADATA_NAME=boolcheck.com
OID4VP_CLIENT_METADATA_LOGO_URI=https://your-domain.com/logo.png
OID4VP_CLIENT_METADATA_POLICY_URI=https://your-domain.com/policy.html
OID4VP_CLIENT_METADATA_TOS_URI=https://your-domain.com/tos.html

# BOOL_NODE接続設定
MAIN_NODE_HOST=http://localhost:3000  # BOOL_NODEのURL
```

### 3. X.509証明書とJWK生成

#### JWK生成

```bash
npm install -g elliptic-jwk

node -e "
const { genkey } = require('elliptic-jwk');

(async () => {
  const jwk = await genkey('P-256', true);
  console.log('JWK:', JSON.stringify(jwk));
})();
"
```

#### X.509証明書生成（自己署名証明書の例）

```bash
openssl req -x509 -newkey ec:<(openssl ecparam -name prime256v1) \
  -keyout key.pem -out cert.pem -days 365 -nodes \
  -subj "/CN=your-domain.com" \
  -addext "subjectAltName=DNS:your-domain.com"
```

**証明書チェーンをPEM形式に変換**:
```bash
cat cert.pem intermediate.pem root.pem > chain.pem
```

**環境変数に設定**:
```bash
OID4VP_VERIFIER_X5C=$(cat chain.pem)
```

### 4. 起動

```bash
cd apps/verifier_node
nvm use 20
node --enable-source-maps src/index.js
```

**または**:
```bash
yarn run start:verifier_node
```

### 5. 動作確認

```bash
# ヘルスチェック
curl http://localhost:3002/health-check

# 認証リクエスト生成（テスト）
curl -X POST http://localhost:3002/oid4vp/auth-request \
  -H "Content-Type: application/json" \
  -d '{"url":"https://example.com","comment":"test","boolValue":1}'
```

---

## 本番環境デプロイメント

### デプロイメント構成

```
┌──────────────────────────────────────────────┐
│          Production Environment              │
├──────────────────────────────────────────────┤
│                                              │
│  ┌─────────────┐          ┌──────────────┐  │
│  │ Load Balancer│         │ Load Balancer│  │
│  │  (Nginx)     │         │   (Nginx)    │  │
│  └──────┬───────┘         └──────┬───────┘  │
│         │                        │          │
│    ┌────▼────┐              ┌────▼────┐    │
│    │API_NODE │              │VERIFIER │    │
│    │   x3    │              │  NODE   │    │
│    └────┬────┘              └────┬────┘    │
│         │                        │          │
│         │ IPFS/OrbitDB           │ HTTP     │
│         ▼                        ▼          │
│    ┌─────────────────────────────────────┐  │
│    │          BOOL_NODE                  │  │
│    │         (Single Master)             │  │
│    └─────────────────────────────────────┘  │
│                                              │
└──────────────────────────────────────────────┘
```

### プロセス管理（PM2）

```bash
npm install -g pm2
```

**PM2設定ファイル** (`ecosystem.config.js`):

```javascript
module.exports = {
  apps: [
    {
      name: "bool_node",
      script: "./apps/bool_node/src/index.js",
      cwd: "/path/to/boolcheck-backend",
      env: {
        NODE_ENV: "prod",
        APP_TYPE: "BOOL_NODE",
        APP_PORT: 3000,
      },
      instances: 1,
      exec_mode: "fork",
      node_args: "--enable-source-maps",
    },
    {
      name: "api_node",
      script: "./apps/api_node/src/index.js",
      cwd: "/path/to/boolcheck-backend",
      env: {
        NODE_ENV: "prod",
        APP_TYPE: "API_NODE",
        APP_PORT: 3001,
      },
      instances: 3,  // スケールアウト
      exec_mode: "cluster",
      node_args: "--enable-source-maps",
    },
    {
      name: "verifier_node",
      script: "./apps/verifier_node/src/index.js",
      cwd: "/path/to/boolcheck-backend",
      env: {
        NODE_ENV: "prod",
        APP_TYPE: "VERIFIER_NODE",
        APP_PORT: 3002,
      },
      instances: 1,
      exec_mode: "fork",
      node_args: "--enable-source-maps",
    },
  ],
};
```

**PM2コマンド**:
```bash
# 起動
pm2 start ecosystem.config.js

# 停止
pm2 stop all

# 再起動
pm2 restart all

# ログ確認
pm2 logs

# プロセス監視
pm2 monit

# 自動起動設定
pm2 startup
pm2 save
```

### Docker化（将来的な改善）

**Dockerfile例**:

```dockerfile
FROM node:20-alpine

WORKDIR /app

COPY package.json yarn.lock ./
RUN yarn install --frozen-lockfile

COPY . .
RUN yarn run build:bool_node

WORKDIR /app/apps/bool_node

ENV NODE_ENV=prod
EXPOSE 3000 4000

CMD ["node", "--enable-source-maps", "src/index.js"]
```

**docker-compose.yml例**:

```yaml
version: '3.8'

services:
  bool_node:
    build:
      context: .
      dockerfile: Dockerfile.bool_node
    ports:
      - "3000:3000"
      - "4000:4000"
    volumes:
      - ./apps/bool_node/.env:/app/apps/bool_node/.env
      - bool_node_data:/app/apps/bool_node
    restart: unless-stopped

  api_node:
    build:
      context: .
      dockerfile: Dockerfile.api_node
    ports:
      - "3001:3001"
      - "4001:4001"
    volumes:
      - ./apps/api_node/.env:/app/apps/api_node/.env
      - api_node_data:/app/apps/api_node
    depends_on:
      - bool_node
    restart: unless-stopped

  verifier_node:
    build:
      context: .
      dockerfile: Dockerfile.verifier_node
    ports:
      - "3002:3002"
    volumes:
      - ./apps/verifier_node/.env:/app/apps/verifier_node/.env
      - verifier_node_data:/app/apps/verifier_node
    depends_on:
      - bool_node
    restart: unless-stopped

volumes:
  bool_node_data:
  api_node_data:
  verifier_node_data:
```

---

## トラブルシューティング

### 1. BOOL_NODEとAPI_NODEの接続失敗

**症状**:
```
error: wait main boot..
error: Failed to dial /ip4/...
```

**原因**:
- BOOL_NODEが起動していない
- ファイアウォールでlibp2pポートがブロックされている
- `MAIN_PEER_HOST`の設定が間違っている

**解決策**:
```bash
# 1. BOOL_NODEが起動しているか確認
curl http://localhost:3000/admin/peer/info

# 2. ファイアウォール確認
sudo ufw status
sudo ufw allow 4000/tcp

# 3. libp2pポートが開いているか確認
netstat -tuln | grep 4000

# 4. MAIN_PEER_HOSTの設定確認
cat apps/api_node/.env | grep MAIN_PEER_HOST
```

### 2. OrbitDB同期が遅い

**症状**:
- API_NODE起動時の同期に時間がかかる
- 大量のデータで同期が完了しない

**解決策**:

**同期履歴の確認**:
```bash
sqlite3 apps/api_node/database.sqlite "SELECT * FROM sync_histories;"
```

**同期履歴のリセット**（全履歴を再同期）:
```bash
sqlite3 apps/api_node/database.sqlite "DELETE FROM sync_histories;"
```

**OrbitDBとIPFSのデータ削除**（完全リセット）:
```bash
cd apps/api_node
rm -rf ./orbitdb ./ipfs
# 再起動すると全データを再同期
```

### 3. OID4VP認証エラー

**症状**:
```
error: Certificate chain verification failed
error: JWT signature verification failed
```

**原因**:
- X.509証明書が無効
- JWKが間違っている
- 証明書のSANが`client_id`と一致しない

**解決策**:
```bash
# 1. 証明書の確認
openssl x509 -in cert.pem -text -noout

# 2. SANの確認
openssl x509 -in cert.pem -text -noout | grep DNS

# 3. JWKの確認
node -e "console.log(JSON.parse(process.env.OID4VP_VERIFIER_JWK))"

# 4. 環境変数ENVIRONMENT=local でX.509検証をスキップ（開発時のみ）
ENVIRONMENT=local node src/index.js
```

### 4. セッション期限切れ

**症状**:
```
error: Session expired or invalid
```

**原因**:
- セッションの有効期限が短すぎる
- Cookieが保存されていない

**解決策**:
```bash
# セッション有効期限を延長
POST_SESSION_EXPIRED_IN=3600  # 1時間

# Cookieが保存されているか確認（ブラウザ開発者ツール）
# Application > Cookies > koa.sess
```

### 5. CORS エラー

**症状**:
```
error: Access to fetch at 'http://localhost:3000/database/urls' from origin 'http://localhost:3001' has been blocked by CORS policy
```

**原因**:
- `APP_HOST`の設定が間違っている
- CORSの`origin`が正しく設定されていない

**解決策**:
```bash
# APP_HOST設定確認
cat apps/bool_node/.env | grep APP_HOST

# APP_HOSTをフロントエンドのオリジンに設定
APP_HOST=https://your-frontend-app.com
```

---

## バックアップ・リストア

### バックアップ

**OrbitDB/IPFSデータ**:
```bash
cd apps/bool_node
tar -czf backup_$(date +%Y%m%d).tar.gz \
  ./orbitdb ./ipfs ./keystore ./database.sqlite ./peer-id.bin
```

**API経由のバックアップ**:
```bash
curl http://localhost:3000/database/backup > backup.json
```

### リストア

**OrbitDB/IPFSデータ**:
```bash
cd apps/bool_node
tar -xzf backup_20250115.tar.gz
```

**API経由のリストア**:
```bash
curl -X POST http://localhost:3000/database/restore \
  -H "Content-Type: application/json" \
  -d @backup.json
```

---

## 監視・ロギング

### ログ設定

**Winston設定** (`src/services/logging-service.ts`):

本番環境では、ログをファイルまたはクラウドロギングサービスに出力：

```typescript
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [
    new winston.transports.File({ filename: "error.log", level: "error" }),
    new winston.transports.File({ filename: "combined.log" }),
  ],
});
```

### 監視ツール

**PM2監視**:
```bash
pm2 monit
```

**ログ監視**:
```bash
tail -f apps/bool_node/combined.log
```

**メトリクス取得**（将来的な改善）:
- Prometheus + Grafana
- CloudWatch (AWS)
- Datadog

---

## まとめ

boolcheckのデプロイメントは、以下のステップで行います：

1. **環境準備**: Node.js 20、依存関係インストール
2. **ビルド**: 各ノードのビルド実行
3. **環境設定**: `.env`ファイルの作成と設定
4. **起動**: 各ノードの起動と動作確認
5. **監視**: PM2によるプロセス管理とログ監視

本番環境では、ロードバランサ、プロセスマネージャ、監視ツールを活用して、高可用性と安定運用を実現します。
