# 開発者ガイド (Developer Guide)

このドキュメントは、boolcheck バックエンドシステムの開発に参加する開発者向けのガイドです。

## 目次

1. [開発環境のセットアップ](#開発環境のセットアップ)
2. [プロジェクト構造](#プロジェクト構造)
3. [コーディング規約](#コーディング規約)
4. [新機能の追加方法](#新機能の追加方法)
5. [テスト戦略](#テスト戦略)
6. [デバッグ手法](#デバッグ手法)
7. [一般的な開発タスク](#一般的な開発タスク)
8. [トラブルシューティング](#トラブルシューティング)

---

## 開発環境のセットアップ

### 前提条件

- **Node.js**: v20 以上
- **yarn**: パッケージマネージャー
- **Git**: バージョン管理
- **エディタ**: VSCode 推奨 (TypeScript サポート)

### 初期セットアップ

```bash
# リポジトリのクローン
git clone <repository-url>
cd OWND-Project-VP

# 依存関係のインストール
yarn

# TypeScript のビルド (各ノード別)
yarn run build:bool_node
yarn run build:api_node
yarn run build:verifier_node

# 開発モードで起動 (ホットリロード対応)
yarn run dev
```

### 環境変数の設定

開発環境では、`.env` ファイルを作成します:

```bash
# ノードタイプの指定
APP_TYPE=BOOL_NODE  # または API_NODE, VERIFIER_NODE
APP_PORT=3000

# OrbitDB/IPFS 設定
PEER_ADDR=/ip4/0.0.0.0/tcp/4000
ORBITDB_ROOT_ID_KEY=main_peer
IPFS_PATH=./ipfs/blocks
ORBITDB_PATH=./orbitdb
KEYSTORE_PATH=./keystore

# SQLite設定
DATABASE_FILEPATH=./database.sqlite

# ログレベル
LOG_LEVEL=debug
```

### VSCode 推奨設定

`.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "typescript.tsdk": "node_modules/typescript/lib",
  "typescript.enablePromptUseWorkspaceTsdk": true,
  "[typescript]": {
    "editor.codeActionsOnSave": {
      "source.fixAll.eslint": true
    }
  }
}
```

---

## プロジェクト構造

### ディレクトリ構成

```
OWND-Project-VP/
├── src/
│   ├── api.ts                    # アプリケーションエントリポイント
│   ├── index.ts                  # メインエントリポイント
│   ├── types/                    # 型定義
│   │   └── app-types.ts          # アプリケーション共通型
│   ├── routes/                   # ルーティング層
│   │   ├── main-routes.ts        # データベース API
│   │   ├── admin-routes.ts       # 管理者 API
│   │   ├── oid4vp-routes.ts      # OID4VP API
│   │   ├── presenters.ts         # レスポンス整形
│   │   └── types.ts              # ルート用型定義
│   ├── usecases/                 # ビジネスロジック層
│   │   ├── claim-interactor.ts   # クレーム処理
│   │   ├── oid4vp-interactor.ts  # OID4VP 処理
│   │   ├── oid4vp-repository.ts  # OID4VP データアクセス
│   │   ├── types.ts              # ユースケース用型定義
│   │   └── internal/             # 内部処理
│   │       └── credential1-processor.ts  # 資格情報処理
│   ├── orbit-db/                 # OrbitDB 層
│   │   ├── orbitdb-service.ts    # OrbitDB サービス
│   │   └── orbitdb-service.types.ts
│   ├── local-data/               # ローカルデータ層
│   │   ├── local-data-handler.ts # データハンドラー
│   │   ├── sqlite-client.ts      # SQLite クライアント
│   │   ├── replication.ts        # レプリケーション
│   │   └── syncer.ts             # 同期処理
│   ├── oid4vp/                   # OID4VP 実装
│   │   ├── verifier.ts           # Verifier 実装
│   │   ├── verify.ts             # VP/VC 検証
│   │   ├── auth-request.ts       # 認証リクエスト生成
│   │   └── response-endpoint.ts  # レスポンスエンドポイント
│   ├── helpers/                  # ヘルパー関数
│   │   ├── libp2p-helper.ts      # libp2p ユーティリティ
│   │   └── get-peer-id.ts        # Peer ID 生成
│   ├── services/                 # サービス層
│   │   ├── logging-service.ts    # ログサービス
│   │   └── ogp-service.ts        # OGP 取得サービス
│   └── tool-box/                 # ツール群
│       ├── verify.ts             # 検証ツール
│       └── x509/                 # X.509 関連
│           └── x509.ts           # 証明書処理
├── docs/                         # ドキュメント
├── dist/                         # ビルド成果物
├── orbitdb/                      # OrbitDB データ (gitignore)
├── ipfs/                         # IPFS データ (gitignore)
└── package.json                  # プロジェクト設定
```

### レイヤーアーキテクチャ

システムは以下の層で構成されています:

1. **Presentation Layer** (`routes/`)
   - HTTP リクエスト/レスポンス処理
   - バリデーション
   - Presenter によるレスポンス整形

2. **Use Case Layer** (`usecases/`)
   - ビジネスロジック
   - トランザクション制御
   - エラーハンドリング

3. **Repository Layer** (`orbit-db/`, `local-data/`)
   - データアクセス
   - OrbitDB と SQLite の統合
   - データ同期

4. **Infrastructure Layer** (`oid4vp/`, `services/`, `helpers/`)
   - 外部サービス連携
   - ユーティリティ関数
   - 技術的な詳細実装

---

## コーディング規約

### TypeScript スタイルガイド

#### 型定義

```typescript
// ✅ Good: 明示的な型定義
interface UrlDocument {
  url: string;
  hash: string;
  timestamp: number;
}

// ❌ Bad: any の使用
const data: any = fetchData();

// ✅ Good: 具体的な型または unknown
const data: UrlDocument = fetchData();
```

#### Result パターン

エラーハンドリングには Result パターンを使用します:

```typescript
import { Result } from './types/app-types';

// Result<成功時の型, エラー型>
export const processUrl = async (
  url: string
): Promise<Result<UrlDocument, ValidationError>> => {
  if (!isValidUrl(url)) {
    return {
      ok: false,
      error: {
        type: 'INVALID_URL',
        message: 'Invalid URL format',
      },
    };
  }

  const doc = await createUrlDocument(url);
  return {
    ok: true,
    payload: doc,
  };
};

// 呼び出し側
const result = await processUrl(url);
if (!result.ok) {
  console.error(result.error);
  return;
}
const doc = result.payload; // 型安全にアクセス
```

#### 非同期処理

```typescript
// ✅ Good: async/await の使用
export const fetchData = async (): Promise<Data> => {
  const result = await orbitdbService.query({ indexValue: 'value' });
  return processResult(result);
};

// ❌ Bad: Promise チェーンの過度な使用
export const fetchData = (): Promise<Data> => {
  return orbitdbService
    .query({ indexValue: 'value' })
    .then(result => processResult(result));
};
```

#### ログ出力

```typescript
import { logger } from './services/logging-service';

// ログレベルの使い分け
logger.debug('Detailed information for debugging', { context });
logger.info('General information', { event: 'USER_REGISTERED' });
logger.warn('Warning conditions', { issue: 'SLOW_RESPONSE' });
logger.error('Error conditions', { error, stack: error.stack });
```

#### ファイル命名規則

- **ケバブケース**: ファイル名は小文字とハイフンを使用
  - 例: `claim-interactor.ts`, `oid4vp-routes.ts`

- **型定義ファイル**: `.types.ts` サフィックス
  - 例: `orbitdb-service.types.ts`, `app-types.ts`

- **テストファイル**: `.test.ts` または `.spec.ts` サフィックス
  - 例: `claim-interactor.test.ts`

---

## 新機能の追加方法

### 新しい API エンドポイントの追加

#### ステップ 1: 型定義の追加 (`src/routes/types.ts`)

```typescript
export type GetUrlsRequest = {
  limit?: number;
  offset?: number;
};

export type GetUrlsResponse = {
  urls: UrlDocument[];
  total: number;
};
```

#### ステップ 2: Presenter の追加 (`src/routes/presenters.ts`)

```typescript
export const presentUrls = (urls: UrlDocument[], total: number): GetUrlsResponse => {
  return {
    urls: urls.map(url => ({
      url: url.url,
      hash: url.hash,
      timestamp: url.timestamp,
    })),
    total,
  };
};
```

#### ステップ 3: Use Case の実装 (`src/usecases/url-interactor.ts`)

```typescript
import { Result } from '../types/app-types';

export class UrlInteractor {
  constructor(
    private localDataHandler: LocalDataHandler,
  ) {}

  async getUrls(
    limit: number = 10,
    offset: number = 0
  ): Promise<Result<{ urls: UrlDocument[]; total: number }, Error>> {
    try {
      const urls = await this.localDataHandler.getUrls(limit, offset);
      const total = await this.localDataHandler.countUrls();

      return {
        ok: true,
        payload: { urls, total },
      };
    } catch (error) {
      return {
        ok: false,
        error: error as Error,
      };
    }
  }
}
```

#### ステップ 4: ルートの追加 (`src/routes/main-routes.ts`)

```typescript
import Router from '@koa/router';
import { presentUrls } from './presenters';

export const setupMainRoutes = (
  router: Router,
  urlInteractor: UrlInteractor,
) => {
  router.get('/api/urls', async (ctx) => {
    const { limit, offset } = ctx.query;

    const result = await urlInteractor.getUrls(
      limit ? parseInt(limit as string) : 10,
      offset ? parseInt(offset as string) : 0,
    );

    if (!result.ok) {
      ctx.status = 500;
      ctx.body = { error: result.error.message };
      return;
    }

    ctx.body = presentUrls(result.payload.urls, result.payload.total);
  });
};
```

### 新しい OrbitDB ドキュメントタイプの追加

#### ステップ 1: 型定義 (`src/types/app-types.ts`)

```typescript
export interface CommentDocument {
  _id: string;
  urlHash: string;
  userId: string;
  comment: string;
  timestamp: number;
}
```

#### ステップ 2: インデックス設定 (`src/orbit-db/orbitdb-service.ts`)

```typescript
const commentIndexes = [
  { indexBy: 'urlHash', indexName: 'commentsByUrlHash' },
  { indexBy: 'userId', indexName: 'commentsByUserId' },
];

await createDocuments<CommentDocument>(
  ipfs,
  'comments',
  commentIndexes,
);
```

#### ステップ 3: データハンドラー追加 (`src/local-data/local-data-handler.ts`)

```typescript
export class LocalDataHandler {
  async saveComment(comment: CommentDocument): Promise<void> {
    const sql = `
      INSERT OR REPLACE INTO comments (_id, urlHash, userId, comment, timestamp)
      VALUES (?, ?, ?, ?, ?)
    `;
    await this.sqliteClient.run(sql, [
      comment._id,
      comment.urlHash,
      comment.userId,
      comment.comment,
      comment.timestamp,
    ]);
  }

  async getCommentsByUrl(urlHash: string): Promise<CommentDocument[]> {
    const sql = `
      SELECT * FROM comments
      WHERE urlHash = ?
      ORDER BY timestamp DESC
    `;
    return await this.sqliteClient.all<CommentDocument>(sql, [urlHash]);
  }
}
```

### OID4VP の新しい資格情報タイプの追加

#### ステップ 1: Presentation Definition の作成 (`src/oid4vp/auth-request.ts`)

```typescript
const employeePresentationDefinition: PresentationDefinition = {
  id: 'employee_verification',
  input_descriptors: [
    {
      id: 'employee_credential',
      name: 'Employee Credential',
      purpose: 'Verify employee status',
      constraints: {
        fields: [
          {
            path: ['$.vc.type'],
            filter: {
              type: 'array',
              contains: { const: 'EmployeeCredential' },
            },
          },
          {
            path: ['$.vc.credentialSubject.employeeId'],
            purpose: 'Employee ID is required',
          },
          {
            path: ['$.vc.credentialSubject.department'],
            purpose: 'Department information is required',
          },
        ],
      },
    },
  ],
};
```

#### ステップ 2: Processor の実装 (`src/usecases/internal/employee-processor.ts`)

```typescript
import { Result } from '../../types/app-types';

export interface EmployeeData {
  employeeId: string;
  department: string;
  name: string;
}

export const processEmployeeCredential = (
  vpToken: string
): Result<EmployeeData, ProcessorError> => {
  try {
    const decoded = decodeVpToken(vpToken);
    const credential = decoded.vp.verifiableCredential[0];

    const employeeId = credential.credentialSubject.employeeId;
    const department = credential.credentialSubject.department;
    const name = credential.credentialSubject.name;

    if (!employeeId || !department) {
      return {
        ok: false,
        error: {
          type: 'MISSING_FIELD',
          message: 'Required employee fields are missing',
        },
      };
    }

    return {
      ok: true,
      payload: { employeeId, department, name },
    };
  } catch (error) {
    return {
      ok: false,
      error: {
        type: 'PROCESSING_ERROR',
        message: error.message,
      },
    };
  }
};
```

---

## テスト戦略

### ユニットテストの作成

```typescript
// src/usecases/__tests__/claim-interactor.test.ts
import { ClaimInteractor } from '../claim-interactor';
import { LocalDataHandler } from '../../local-data/local-data-handler';

describe('ClaimInteractor', () => {
  let claimInteractor: ClaimInteractor;
  let mockLocalDataHandler: jest.Mocked<LocalDataHandler>;

  beforeEach(() => {
    mockLocalDataHandler = {
      getClaimsByUrl: jest.fn(),
      saveClaim: jest.fn(),
    } as any;

    claimInteractor = new ClaimInteractor(mockLocalDataHandler);
  });

  describe('getClaimsByUrl', () => {
    it('should return claims for a valid URL hash', async () => {
      const mockClaims = [
        { _id: '1', urlHash: 'hash123', claimerId: 'user1' },
      ];
      mockLocalDataHandler.getClaimsByUrl.mockResolvedValue(mockClaims);

      const result = await claimInteractor.getClaimsByUrl('hash123');

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.payload).toEqual(mockClaims);
      }
    });

    it('should handle errors gracefully', async () => {
      mockLocalDataHandler.getClaimsByUrl.mockRejectedValue(
        new Error('Database error')
      );

      const result = await claimInteractor.getClaimsByUrl('hash123');

      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.message).toBe('Database error');
      }
    });
  });
});
```

### 統合テストの作成

```typescript
// src/routes/__tests__/main-routes.integration.test.ts
import request from 'supertest';
import { createApp } from '../../api';

describe('Main Routes Integration', () => {
  let app: any;

  beforeAll(async () => {
    app = await createApp({
      nodeType: 'API_NODE',
      port: 3001,
      dbPath: ':memory:', // インメモリDBを使用
    });
  });

  afterAll(async () => {
    await app.close();
  });

  describe('GET /api/claims/:urlHash', () => {
    it('should return claims for a URL', async () => {
      const response = await request(app.callback())
        .get('/api/claims/test-hash')
        .expect(200);

      expect(response.body).toHaveProperty('claims');
      expect(Array.isArray(response.body.claims)).toBe(true);
    });

    it('should return 404 for non-existent URL', async () => {
      await request(app.callback())
        .get('/api/claims/non-existent')
        .expect(404);
    });
  });
});
```

### テストの実行

```bash
# すべてのテストを実行
yarn test

# カバレッジレポート付き
yarn test:coverage

# 特定のファイルのみテスト
yarn test claim-interactor

# ウォッチモード
yarn test:watch
```

---

## デバッグ手法

### ログレベルの調整

開発時は詳細なログを出力します:

```bash
LOG_LEVEL=debug yarn run dev
```

### VSCode デバッガーの設定

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug BOOL_NODE",
      "program": "${workspaceFolder}/src/index.ts",
      "preLaunchTask": "tsc: build",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "env": {
        "APP_TYPE": "BOOL_NODE",
        "APP_PORT": "3000",
        "LOG_LEVEL": "debug"
      },
      "sourceMaps": true,
      "smartStep": true,
      "skipFiles": ["<node_internals>/**"]
    }
  ]
}
```

### OrbitDB データの確認

```typescript
// デバッグ用のスクリプト
import { createOrbitDB } from './orbit-db/orbitdb-service';

const debugOrbitDB = async () => {
  const orbitdb = await createOrbitDB({
    directory: './orbitdb',
    id: 'debug',
  });

  // すべてのドキュメントを表示
  const result = await orbitdb.query<UrlDocument>('urls', {});
  console.log('Total documents:', result.length);
  console.log('Documents:', JSON.stringify(result, null, 2));
};

debugOrbitDB();
```

### SQLite データの確認

```bash
# SQLite CLI で直接確認
sqlite3 ./local-data/boolcheck.db

# クエリ例
SELECT * FROM urls LIMIT 10;
SELECT COUNT(*) FROM claims;
SELECT * FROM claimers WHERE _id = 'specific-id';
```

### ネットワークデバッグ

libp2p の接続状況を確認:

```typescript
import { logger } from './services/logging-service';

// libp2p イベントのログ出力
libp2p.addEventListener('peer:connect', (event) => {
  logger.debug('Peer connected', { peerId: event.detail.toString() });
});

libp2p.addEventListener('peer:disconnect', (event) => {
  logger.debug('Peer disconnected', { peerId: event.detail.toString() });
});

// 接続中のピアの確認
const peers = await libp2p.peerStore.all();
console.log('Connected peers:', peers.map(p => p.id.toString()));
```

---

## 一般的な開発タスク

### 新しいマイグレーションの作成

```typescript
// src/local-data/migrations/003_add_comments_table.ts
export const migration003 = async (db: Database) => {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS comments (
      _id TEXT PRIMARY KEY,
      urlHash TEXT NOT NULL,
      userId TEXT NOT NULL,
      comment TEXT NOT NULL,
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (urlHash) REFERENCES urls(hash)
    );

    CREATE INDEX idx_comments_urlHash ON comments(urlHash);
    CREATE INDEX idx_comments_userId ON comments(userId);
  `);
};
```

### 環境変数の追加

1. `src/types/app-types.ts` に型定義を追加:

```typescript
export interface AppConfig {
  nodeType: NodeType;
  port: number;
  // 新しい設定を追加
  maxConnections: number;
}
```

2. `src/api.ts` で環境変数を読み込む:

```typescript
const config: AppConfig = {
  nodeType: process.env.APP_TYPE as NodeType,
  port: parseInt(process.env.APP_PORT || '3000'),
  maxConnections: parseInt(process.env.MAX_CONNECTIONS || '50'),
};
```

### CORS 設定の変更

```typescript
// src/api.ts
import cors from '@koa/cors';

// ノードタイプごとに異なる CORS 設定
const corsOptions = config.nodeType === 'API_NODE'
  ? {
      origin: '*', // API_NODE は全てのオリジンを許可
      credentials: false,
    }
  : {
      origin: (ctx) => {
        const origin = ctx.get('Origin');
        const allowedOrigins = ['https://example.com', 'https://app.example.com'];
        return allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
      },
      credentials: true,
    };

app.use(cors(corsOptions));
```

### カスタムミドルウェアの追加

```typescript
// src/middleware/request-logger.ts
import { Context, Next } from 'koa';
import { logger } from '../services/logging-service';

export const requestLogger = async (ctx: Context, next: Next) => {
  const start = Date.now();

  await next();

  const duration = Date.now() - start;
  logger.info('Request completed', {
    method: ctx.method,
    url: ctx.url,
    status: ctx.status,
    duration: `${duration}ms`,
  });
};

// src/api.ts で使用
import { requestLogger } from './middleware/request-logger';
app.use(requestLogger);
```

### バッチ処理の追加

```typescript
// src/jobs/claim-aggregator.ts
import { CronJob } from 'cron';
import { logger } from '../services/logging-service';

export const startClaimAggregator = (localDataHandler: LocalDataHandler) => {
  // 毎時実行
  const job = new CronJob('0 * * * *', async () => {
    logger.info('Starting claim aggregation job');

    try {
      const urls = await localDataHandler.getAllUrls();

      for (const url of urls) {
        const aggregated = await localDataHandler.getAggregatedClaims(url.hash);
        logger.debug('Aggregated claims', { url: url.url, count: aggregated.length });
      }

      logger.info('Claim aggregation job completed');
    } catch (error) {
      logger.error('Claim aggregation job failed', { error });
    }
  });

  job.start();
  logger.info('Claim aggregator scheduled');
};
```

---

## トラブルシューティング

### よくある問題と解決方法

#### 問題 1: OrbitDB が起動しない

**症状**: `Error: Could not create OrbitDB instance`

**原因**: IPFS ディレクトリが破損している

**解決方法**:
```bash
# IPFS と OrbitDB のデータを削除して再起動
rm -rf ./ipfs ./orbitdb
yarn run dev
```

#### 問題 2: Peer に接続できない

**症状**: `No peers connected`

**原因**: libp2p の設定または NAT の問題

**解決方法**:
```typescript
// ANNOUNCE_ADDRESSES を確認
// .env
ANNOUNCE_ADDRESSES=/ip4/YOUR_PUBLIC_IP/tcp/4001

// または、ローカルネットワークの場合
ANNOUNCE_ADDRESSES=/ip4/192.168.1.100/tcp/4001
```

#### 問題 3: SQLite の同期エラー

**症状**: `SQLITE_BUSY: database is locked`

**原因**: 複数のプロセスが同じデータベースにアクセスしている

**解決方法**:
```typescript
// WAL モードを有効にする
await db.exec('PRAGMA journal_mode=WAL');
await db.exec('PRAGMA busy_timeout=5000');
```

#### 問題 4: OID4VP 認証が失敗する

**症状**: `VP Token verification failed`

**デバッグ手順**:
```typescript
// 1. VP Token をデコードして内容を確認
const decoded = jwt.decode(vpToken, { complete: true });
console.log('VP Token:', JSON.stringify(decoded, null, 2));

// 2. 証明書チェーンを確認
const x5c = decoded.header.x5c;
const verifyResult = await verifyCertificateChain(x5c);
console.log('Certificate verification:', verifyResult);

// 3. Presentation Definition とのマッチングを確認
const matchResult = await matchInputDescriptors(
  presentationDefinition,
  decoded.payload
);
console.log('Input descriptor match:', matchResult);
```

#### 問題 5: メモリリーク

**症状**: Node.js プロセスのメモリ使用量が増加し続ける

**デバッグ方法**:
```bash
# ヒープスナップショットを取得
node --expose-gc --inspect dist/index.js

# Chrome DevTools で接続してメモリプロファイルを取得
```

**一般的な原因**:
- イベントリスナーの未削除
- グローバル変数への大きなオブジェクトの保持
- クロージャによる参照の保持

**解決方法**:
```typescript
// イベントリスナーを適切に削除
const handler = (event) => { /* ... */ };
emitter.on('event', handler);
// ...
emitter.off('event', handler); // 必ず削除

// WeakMap/WeakSet を使用してガベージコレクションを許可
const cache = new WeakMap();
```

---

## パフォーマンス最適化

### データベースクエリの最適化

```typescript
// ❌ Bad: N+1 クエリ
const urls = await localDataHandler.getAllUrls();
for (const url of urls) {
  const claims = await localDataHandler.getClaimsByUrl(url.hash);
  // ...
}

// ✅ Good: 一括取得
const urlsWithClaims = await localDataHandler.getUrlsWithClaims();
```

### OrbitDB クエリの最適化

```typescript
// ❌ Bad: すべてのドキュメントを取得してフィルタリング
const allDocs = await orbitdb.query<ClaimDocument>('claims', {});
const filtered = allDocs.filter(doc => doc.urlHash === targetHash);

// ✅ Good: インデックスを使用
const filtered = await orbitdb.query<ClaimDocument>('claims', {
  indexValue: targetHash,
});
```

### キャッシュの実装

```typescript
// src/cache/claim-cache.ts
import NodeCache from 'node-cache';

export class ClaimCache {
  private cache: NodeCache;

  constructor(ttlSeconds: number = 300) {
    this.cache = new NodeCache({ stdTTL: ttlSeconds });
  }

  get(key: string): ClaimDocument[] | undefined {
    return this.cache.get(key);
  }

  set(key: string, value: ClaimDocument[]): void {
    this.cache.set(key, value);
  }

  del(key: string): void {
    this.cache.del(key);
  }
}

// 使用例
export class ClaimInteractor {
  private cache: ClaimCache;

  async getClaimsByUrl(urlHash: string): Promise<Result<ClaimDocument[], Error>> {
    // キャッシュを確認
    const cached = this.cache.get(urlHash);
    if (cached) {
      return { ok: true, payload: cached };
    }

    // データベースから取得
    const claims = await this.localDataHandler.getClaimsByUrl(urlHash);

    // キャッシュに保存
    this.cache.set(urlHash, claims);

    return { ok: true, payload: claims };
  }
}
```

---

## セキュリティベストプラクティス

### 入力検証

```typescript
import validator from 'validator';

export const validateUrl = (url: string): Result<string, ValidationError> => {
  // URL 形式の検証
  if (!validator.isURL(url, { protocols: ['http', 'https'] })) {
    return {
      ok: false,
      error: { type: 'INVALID_FORMAT', message: 'Invalid URL format' },
    };
  }

  // 許可されたドメインの検証 (オプション)
  const allowedDomains = ['example.com', 'trusted-domain.com'];
  const hostname = new URL(url).hostname;
  if (!allowedDomains.some(domain => hostname.endsWith(domain))) {
    return {
      ok: false,
      error: { type: 'FORBIDDEN_DOMAIN', message: 'Domain not allowed' },
    };
  }

  return { ok: true, payload: url };
};
```

### SQL インジェクション対策

```typescript
// ✅ Good: プリペアドステートメントを使用
const sql = 'SELECT * FROM urls WHERE hash = ?';
const result = await db.all(sql, [userInput]);

// ❌ Bad: 文字列連結
const sql = `SELECT * FROM urls WHERE hash = '${userInput}'`;
```

### XSS 対策

```typescript
import xss from 'xss';

export const sanitizeComment = (comment: string): string => {
  // HTML タグを除去
  return xss(comment, {
    whiteList: {}, // タグを一切許可しない
    stripIgnoreTag: true,
  });
};
```

### レート制限

```typescript
import ratelimit from 'koa-ratelimit';
import Redis from 'ioredis';

const redis = new Redis();

app.use(ratelimit({
  driver: 'redis',
  db: redis,
  duration: 60000, // 1分
  errorMessage: 'Too many requests',
  id: (ctx) => ctx.ip,
  headers: {
    remaining: 'Rate-Limit-Remaining',
    reset: 'Rate-Limit-Reset',
    total: 'Rate-Limit-Total',
  },
  max: 100, // 1分あたり100リクエスト
}));
```

---

## まとめ

このガイドでは、boolcheck バックエンドシステムの開発に必要な情報を網羅しました:

- **開発環境のセットアップ**: Node.js, pnpm, 環境変数の設定
- **プロジェクト構造**: レイヤーアーキテクチャと各ディレクトリの役割
- **コーディング規約**: TypeScript のベストプラクティスと Result パターン
- **新機能の追加**: API エンドポイント、OrbitDB ドキュメント、OID4VP 資格情報
- **テスト戦略**: ユニットテストと統合テストの作成方法
- **デバッグ手法**: ログ、VSCode デバッガー、データベース確認
- **一般的な開発タスク**: マイグレーション、ミドルウェア、バッチ処理
- **トラブルシューティング**: よくある問題と解決方法
- **パフォーマンス最適化**: クエリ最適化とキャッシング
- **セキュリティ**: 入力検証、SQL インジェクション対策、XSS 対策

さらに詳しい情報は、各ドキュメントを参照してください:

- [システムアーキテクチャ](./architecture-detail.md)
- [データモデル](./data-model.md)
- [API 仕様](./api-specification.md)
- [OID4VP 実装](./oid4vp-implementation.md)
- [コンポーネント設計](./components.md)
- [セキュリティ](./security.md)
- [デプロイメント](./deployment.md)
