# OID4VP Verifier - 開発者ガイド

このドキュメントは、OID4VP Verifierシステムの開発に参加する開発者向けのガイドです。

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
- **npm/yarn**: パッケージマネージャー
- **Git**: バージョン管理
- **エディタ**: VSCode 推奨 (TypeScript サポート)

### 初期セットアップ

```bash
# リポジトリのクローン
git clone <repository-url>
cd OWND-Project-VP

# 依存関係のインストール
npm install
# または
yarn install

# TypeScript のビルド
npm run build

# 開発モードで起動 (ホットリロード対応)
npm run dev
```

### 環境変数の設定

開発環境では、`.env` ファイルを作成します:

```bash
# アプリケーション設定
APP_PORT=3000
NODE_ENV=local
APP_HOST=http://localhost:3001  # フロントエンドアプリのオリジン

# OID4VP設定
OID4VP_CLIENT_ID=http://localhost:3000
OID4VP_CLIENT_ID_SCHEME=x509_san_dns
OID4VP_REQUEST_HOST=oid4vp://localhost
OID4VP_REQUEST_URI=http://localhost:3000/oid4vp/request
OID4VP_RESPONSE_URI=http://localhost:3000/oid4vp/responses
OID4VP_REDIRECT_URI=http://localhost:3001/callback

# VP Token暗号化（HAIP準拠、オプション）
OID4VP_VP_TOKEN_ENCRYPTION_ENABLED=false

# Verifier証明書（開発環境）
OID4VP_VERIFIER_JWK={"kty":"EC","crv":"P-256",...}
OID4VP_VERIFIER_X5C=<PEM形式の証明書>

# カスタムトラストアンカー（オプション）
# OID4VP_TRUST_ANCHOR_CERTIFICATES=/path/to/root.cer,/path/to/intermediate.cer

# SQLite設定
DATABASE_FILEPATH=./database.sqlite

# Cookie Secret
OID4VP_COOKIE_SECRET=your-secret-key-here

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
      "source.fixAll.eslint": "explicit"
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
│   │   ├── oid4vp-routes.ts      # OID4VP API
│   │   ├── presenters.ts         # レスポンス変換
│   │   ├── error-handler.ts      # エラーハンドリング
│   │   └── types.ts              # レスポンス型定義
│   ├── usecases/                 # ユースケース層
│   │   ├── oid4vp-interactor.ts  # OID4VP認証フロー
│   │   ├── oid4vp-repository.ts  # SQLiteリポジトリ
│   │   ├── internal/             # 内部処理
│   │   │   ├── credential1-processor.ts
│   │   │   └── credential2-processor.ts
│   │   └── types.ts              # ユースケース型定義
│   ├── oid4vp/                   # OID4VP Core
│   │   ├── verifier.ts           # Verifier実装
│   │   ├── response-endpoint.ts  # Response Endpoint
│   │   ├── verify.ts             # VP Token検証
│   │   ├── auth-request.ts       # Authorization Request生成
│   │   └── types.ts              # OID4VP型定義
│   ├── database/                 # データベース層
│   │   ├── schema.ts             # SQLiteスキーマ
│   │   └── index.ts              # DB初期化
│   ├── helpers/                  # ヘルパー関数
│   │   └── jwt-helper.ts         # JWT処理
│   ├── tool-box/                 # ツール群
│   │   ├── verify.ts             # 署名検証
│   │   ├── x509/                 # X.509証明書処理
│   │   │   ├── x509.ts           # 証明書検証
│   │   │   └── issue.ts          # 証明書発行
│   │   ├── datetime.ts           # 日時処理
│   │   └── util.ts               # 汎用ユーティリティ
│   └── services/                 # サービス層
│       └── logging-service.ts    # ロギング
├── tests/                        # テスト
│   ├── oid4vp/                   # OID4VPテスト
│   │   ├── verifier.test.ts
│   │   └── test-utils.ts
│   └── ...
├── docs/                         # ドキュメント
├── dist/                         # ビルド成果物
├── .env                          # 環境変数
├── package.json                  # プロジェクト設定
├── tsconfig.json                 # TypeScript設定
└── nodemon.json                  # Nodemon設定
```

### レイヤー別責務

#### 1. Presentation Layer (`routes/`)
- HTTPリクエスト/レスポンス処理
- ルーティング
- バリデーション
- エラーハンドリング

#### 2. Use Case Layer (`usecases/`)
- OID4VP認証フローの実装
- ビジネスロジック
- トランザクション制御
- プレゼンテーション変換

#### 3. Repository Layer (`usecases/oid4vp-repository.ts`)
- SQLiteセッション管理
- リクエスト・レスポンス永続化
- 状態管理

#### 4. Infrastructure Layer (`oid4vp/`, `database/`, `tool-box/`)
- OID4VP Core
- SQLiteアクセス
- 署名検証
- X.509証明書処理

---

## コーディング規約

### TypeScript スタイル

```typescript
// 良い例
export const generateAuthRequest = async <T>(
  payload: AuthRequestPayload,
  presenter: AuthRequestPresenter<T>
): Promise<Result<T, NotSuccessResult>> => {
  // 実装
};

// 型エイリアス
type Result<T, E> =
  | { ok: true; payload: T }
  | { ok: false; error: E };

// インターフェース
interface SessionRepository {
  putRequestId(requestId: string): Promise<void>;
  getSession(requestId: string): Promise<Session | null>;
}
```

### ネーミング規則

- **ファイル**: kebab-case (`oid4vp-interactor.ts`)
- **クラス/インターフェース**: PascalCase (`SessionRepository`)
- **関数/変数**: camelCase (`generateAuthRequest`)
- **定数**: UPPER_SNAKE_CASE (`CREDENTIAL_QUERY_ID`)
- **プライベート関数**: `_`プレフィックス (`_validateRequest`)

### コメント

```typescript
/**
 * Authorization Requestを生成します
 * @param payload リクエストペイロード
 * @param presenter レスポンス変換関数
 * @returns 生成されたAuthorization Request
 */
export const generateAuthRequest = async <T>(
  payload: AuthRequestPayload,
  presenter: AuthRequestPresenter<T>
): Promise<Result<T, NotSuccessResult>> => {
  // 1. トランザクション開始
  const request = await responseEndpoint.initiateTransaction({
    // ...
  });

  // 2. DCQL Query生成
  const dcqlQuery = verifier.generateDcqlQuery([
    // ...
  ]);

  return { ok: true, payload: presenter(authRequest, request.id) };
};
```

### エラーハンドリング

```typescript
// Result型を使用
const result = await someOperation();
if (!result.ok) {
  return { ok: false, error: result.error };
}

// エラータイプ
type NotSuccessResult =
  | { type: "INVALID_PARAMETER"; message?: string }
  | { type: "NOT_FOUND"; message?: string }
  | { type: "EXPIRED"; message?: string };
```

---

## 新機能の追加方法

### 1. 新しいOID4VPエンドポイントの追加

#### Step 1: ルート定義 (`routes/oid4vp-routes.ts`)

```typescript
router.post(`/${apiDomain}/new-endpoint`, koaBody(), async (ctx) => {
  const payload = ctx.request.body;

  const result = await interactor.newOperation(payload, newPresenter);

  if (result.ok) {
    ctx.status = 200;
    ctx.body = result.payload;
  } else {
    const { statusCode, body } = handleError(result.error);
    ctx.status = statusCode;
    ctx.body = body;
  }
});
```

#### Step 2: Interactor実装 (`usecases/oid4vp-interactor.ts`)

```typescript
const newOperation = async <T>(
  payload: any,
  presenter: (result: any) => T
): Promise<Result<T, NotSuccessResult>> => {
  // 1. バリデーション
  if (!payload.requiredField) {
    return { ok: false, error: { type: "INVALID_PARAMETER" } };
  }

  // 2. ビジネスロジック
  const result = await someProcessing(payload);

  // 3. Presenter変換
  return { ok: true, payload: presenter(result) };
};
```

#### Step 3: Presenter追加 (`routes/presenters.ts`)

```typescript
export const newPresenter = (result: any) => ({
  id: result.id,
  data: result.data,
});
```

#### Step 4: テスト作成 (`tests/oid4vp/new-endpoint.test.ts`)

```typescript
import { describe, it } from "mocha";
import { expect } from "chai";
import request from "supertest";

describe("POST /oid4vp/new-endpoint", () => {
  it("should return success", async () => {
    const response = await request(app.callback())
      .post("/oid4vp/new-endpoint")
      .send({ requiredField: "value" });

    expect(response.status).to.equal(200);
    expect(response.body).to.have.property("id");
  });
});
```

### 2. 新しいSQLiteテーブルの追加

#### Step 1: スキーマ定義 (`database/schema.ts`)

```sql
CREATE TABLE new_table (
  id TEXT PRIMARY KEY,
  field1 TEXT NOT NULL,
  field2 INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX idx_new_table_field1 ON new_table(field1);
```

#### Step 2: リポジトリ実装 (`usecases/oid4vp-repository.ts`)

```typescript
export const initNewTableRepository = (db: Database): NewTableRepository => ({
  save: async (data) => {
    await db.run(
      `INSERT INTO new_table (id, field1, field2, created_at)
       VALUES (?, ?, ?, ?)`,
      [data.id, data.field1, data.field2, Date.now()]
    );
  },

  get: async (id) => {
    return await db.get(
      `SELECT * FROM new_table WHERE id = ?`,
      [id]
    );
  },
});
```

---

## テスト戦略

### テスト構成

```bash
tests/
├── oid4vp/
│   ├── verifier.test.ts         # Verifier機能テスト
│   ├── response-endpoint.test.ts # Response Endpointテスト
│   └── test-utils.ts            # テストユーティリティ
└── tool-box/
    └── x509.test.ts             # X.509証明書処理テスト
```

### テスト実行

```bash
# 全テスト実行
npm test

# 特定のテスト実行
npm test -- --grep "verifier"

# カバレッジ計測
npm test -- --coverage
```

### テストの書き方

```typescript
import { describe, it, before, after } from "mocha";
import { expect } from "chai";
import { initVerifier } from "../../src/oid4vp/verifier.js";

describe("Verifier", () => {
  let verifier: Verifier;
  let datastore: VerifierDatastore;

  before(async () => {
    // セットアップ
    datastore = await setupTestDatastore();
    verifier = initVerifier(datastore);
  });

  after(async () => {
    // クリーンアップ
    await cleanupTestDatastore(datastore);
  });

  describe("generateDcqlQuery", () => {
    it("should generate valid DCQL query", () => {
      const dcqlQuery = verifier.generateDcqlQuery([
        {
          id: "learning_credential",
          format: "dc+sd-jwt",
          meta: { vct_values: ["urn:eu.europa.ec.eudi:learning:credential:1"] },
          claims: [{ path: ["family_name"] }, { path: ["given_name"] }],
        },
      ]);

      expect(dcqlQuery).to.have.property("credentials");
      expect(dcqlQuery.credentials).to.be.an("array");
      expect(dcqlQuery.credentials[0]).to.have.property("id", "learning_credential");
    });
  });
});
```

---

## デバッグ手法

### ロギング

```typescript
import getLogger from "../services/logging-service.js";

const logger = getLogger();

logger.debug("Debug information", { requestId: "req-123" });
logger.info("Info message", { userId: "user-456" });
logger.warn("Warning message", { reason: "Invalid parameter" });
logger.error("Error occurred", { error: err.message, stack: err.stack });
```

### VSCode デバッグ設定

`.vscode/launch.json`:

```json
{
  "version": "0.2.0",
  "configurations": [
    {
      "type": "node",
      "request": "launch",
      "name": "Debug OID4VP Verifier",
      "skipFiles": ["<node_internals>/**"],
      "program": "${workspaceFolder}/src/index.ts",
      "preLaunchTask": "tsc: build - tsconfig.json",
      "outFiles": ["${workspaceFolder}/dist/**/*.js"],
      "env": {
        "NODE_ENV": "local"
      }
    },
    {
      "type": "node",
      "request": "launch",
      "name": "Debug Mocha Tests",
      "program": "${workspaceFolder}/node_modules/mocha/bin/_mocha",
      "args": [
        "--require", "ts-node/register",
        "--timeout", "999999",
        "--colors",
        "${workspaceFolder}/tests/**/*.test.ts"
      ],
      "console": "integratedTerminal",
      "internalConsoleOptions": "neverOpen"
    }
  ]
}
```

---

## 一般的な開発タスク

### データベースリセット

```bash
# SQLiteデータベースを削除
rm database.sqlite

# アプリケーション再起動で自動的に再作成される
npm run dev
```

### テストデータ生成

```typescript
import ellipticJwk from "elliptic-jwk";
import { issueJwtUsingX5C } from "../tests/oid4vp/test-utils.js";

// テスト用のJWT生成
const privateJwk = ellipticJwk.newPrivateJwk("P-256");
const subject = "/C=JP/ST=Tokyo/L=Chiyoda-ku/O=Test Company/CN=test.example.com";
const payload = {
  vc: {
    type: ["VerifiableCredential", "TestCredential"],
    credentialSubject: {
      field1: "value1",
      field2: "value2",
    },
  },
};

const jwt = await issueJwtUsingX5C(payload, subject, privateJwk);
```

---

## トラブルシューティング

### 問題: ビルドエラー

```bash
# node_modulesを削除して再インストール
rm -rf node_modules
npm install

# TypeScriptのクリーンビルド
rm -rf dist
npm run build
```

### 問題: データベース接続エラー

```bash
# SQLiteファイルのパーミッション確認
ls -la database.sqlite

# 必要に応じてパーミッション変更
chmod 644 database.sqlite
```

### 問題: VP Token検証失敗

```typescript
// デバッグログを有効にして詳細を確認
LOG_LEVEL=debug npm run dev

// X.509証明書チェーン検証をスキップ（開発環境のみ）
ENVIRONMENT=local npm run dev
```

### 問題: ポート競合

```bash
# 使用中のポートを確認
lsof -i :3000

# プロセスを終了
kill -9 <PID>
```

---

## 参考資料

- [OID4VP 1.0 Specification](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- [DCQL (Digital Credentials Query Language)](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#name-digital-credentials-query-l)
- [SD-JWT Specification](https://datatracker.ietf.org/doc/html/draft-ietf-oauth-selective-disclosure-jwt)
- [Koa Documentation](https://koajs.com/)
- [TypeScript Handbook](https://www.typescriptlang.org/docs/)

### プロジェクトドキュメント

- [OID4VP実装ドキュメント](./oid4vp-implementation.md) - メインドキュメント
- [VP Token検証プロセス](./oid4vp-verification.md) - SD-JWT検証、DCQL Query定義
- [VP Token暗号化](./oid4vp-encryption.md) - HAIP準拠の暗号化フロー
- [リファレンス](./oid4vp-reference.md) - セッション管理、環境変数、DB

---

## 開発フロー

### 1. 機能開発

```bash
# 1. ブランチ作成
git checkout -b feature/new-feature

# 2. 実装
# コード作成 + テスト作成

# 3. ビルド確認
npm run build

# 4. テスト実行
npm test

# 5. コミット
git add .
git commit -m "feat: add new feature"

# 6. プッシュ
git push origin feature/new-feature
```

### 2. バグ修正

```bash
# 1. ブランチ作成
git checkout -b fix/bug-description

# 2. 問題の再現テスト作成

# 3. 修正実装

# 4. テスト確認
npm test

# 5. コミット
git commit -m "fix: resolve bug description"
```

---

このガイドは、OID4VP Verifierシステムの開発をスムーズに進めるための基本的な情報を提供しています。質問や不明点がある場合は、チームメンバーに相談してください。
