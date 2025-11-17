# セキュリティドキュメント

## 概要

このドキュメントでは、boolcheckシステムのセキュリティ実装について詳述します。システムは、X.509証明書、JWT/JWK、OrbitDBアクセス制御、CORS、セッション管理など、多層防御アプローチを採用しています。

## セキュリティアーキテクチャ

```
┌──────────────────────────────────────────────────┐
│           Security Layers                        │
├──────────────────────────────────────────────────┤
│                                                  │
│  ┌────────────────────────────────────────────┐ │
│  │  1. Transport Layer Security (HTTPS)      │ │
│  │     - TLS 1.2+                            │ │
│  │     - X.509証明書による認証               │ │
│  └────────────────────────────────────────────┘ │
│                     │                            │
│  ┌─────────────────▼──────────────────────────┐ │
│  │  2. Application Layer Security            │ │
│  │     - CORS                                │ │
│  │     - セッション管理                      │ │
│  │     - Bearerトークン認証                  │ │
│  └────────────────┬──────────────────────────┘ │
│                   │                              │
│  ┌────────────────▼──────────────────────────┐ │
│  │  3. Data Layer Security                   │ │
│  │     - OrbitDBアクセス制御                 │ │
│  │     - VC/VP署名検証                       │ │
│  │     - SD-JWT Selective Disclosure         │ │
│  └────────────────┬──────────────────────────┘ │
│                   │                              │
│  ┌────────────────▼──────────────────────────┐ │
│  │  4. Logging & Monitoring                  │ │
│  │     - 構造化ロギング                      │ │
│  │     - エラー追跡                          │ │
│  │     - アクセスログ                        │ │
│  └───────────────────────────────────────────┘ │
│                                                  │
└──────────────────────────────────────────────────┘
```

## 1. X.509証明書管理

### 証明書の用途

boolcheckでは、X.509証明書を以下の目的で使用：

1. **VERIFIER_NODE認証**: OID4VPのVerifierとしての身元証明
2. **VC/VP署名検証**: ウォレットから受信したクレデンシャルの署名検証

### 証明書スキーム

**client_id_scheme**: `x509_san_dns`

- Verifierの証明書にSAN（Subject Alternative Name）でDNS名を含める
- ウォレットはSANのDNS名と`client_id`を照合

**設定例**:
```bash
OID4VP_CLIENT_ID_SCHEME=x509_san_dns
OID4VP_CLIENT_ID=http://localhost
OID4VP_VERIFIER_X5C=<PEM形式の証明書チェーン>
```

### 証明書チェーン検証

**ファイル**: `src/tool-box/x509/x509.ts`

**検証プロセス**:
```typescript
export const verifyCertificateChain = async (
  x5c: string[],
): Promise<Result<boolean, X509Error>> => {
  const certs = x5c.map(cert => Certificate.fromPEM(cert));

  // 1. チェーン検証
  for (let i = 0; i < certs.length - 1; i++) {
    const cert = certs[i];
    const issuer = certs[i + 1];

    // 2. 署名検証
    const verifyResult = await cert.verify({
      publicKey: issuer.publicKey,
    });
    if (!verifyResult) {
      return { ok: false, error: { type: "VERIFY_FAILURE" } };
    }

    // 3. 有効期限検証
    const now = new Date();
    if (cert.notBefore > now || cert.notAfter < now) {
      return { ok: false, error: { type: "CERT_EXPIRED" } };
    }
  }

  // 4. ルートCA検証（オプション）
  // ...

  return { ok: true, payload: true };
};
```

### 証明書のライフサイクル

```
┌────────────┐
│  証明書発行│
│  (CA)      │
└─────┬──────┘
      │
      ▼
┌────────────┐
│  証明書配置│
│  (X5C)     │
└─────┬──────┘
      │
      ▼
┌────────────┐
│  署名生成  │
│  (JWT)     │
└─────┬──────┘
      │
      ▼
┌────────────┐
│  署名検証  │
│  (Wallet)  │
└─────┬──────┘
      │
      ▼
┌────────────┐
│  証明書失効│
│  (CRL/OCSP)│
└────────────┘
```

**証明書更新**:
- 証明書の有効期限前に新しい証明書を発行
- `OID4VP_VERIFIER_X5C`環境変数を更新
- VERIFIER_NODEを再起動

**証明書失効**:
- 現在の実装ではCRL/OCSP未対応
- 将来的な改善: CRLまたはOCSPによる失効確認

## 2. JWT/JWK処理

### JWK (JSON Web Key)

**Verifier JWK**:
```json
{
  "kty": "EC",
  "crv": "P-256",
  "x": "...",
  "d": "..."
}
```

**設定**:
```bash
OID4VP_VERIFIER_JWK='{"kty":"EC","crv":"P-256","x":"...","d":"..."}'
```

**生成方法** (elliptic-jwk):
```typescript
import { genkey } from "elliptic-jwk";

const jwk = await genkey("P-256", true);  // privateKey=true
// { kty: "EC", crv: "P-256", x: "...", d: "..." }
```

### JWT署名と検証

#### Request Object署名

**ファイル**: `src/oid4vp/auth-request.ts`

```typescript
export const generateRequestObjectJwt = async (
  clientId: string,
  options: GenerateRequestObjectOptions,
  issuerJwk: PrivateJwk,
  x5c?: string[],
): Promise<string> => {
  const payload = generateRequestObjectPayload(clientId, options);

  // 1. JWKをインポート
  const privateKey = await importJWK(issuerJwk);

  // 2. JWTヘッダー作成
  const header: JWTHeaderParameters = {
    alg: "ES256",
    typ: "JWT",
  };
  if (x5c) {
    header.x5c = x5c;  // X.509証明書チェーン
  }

  // 3. JWT署名
  const jwt = await new SignJWT(camelToSnake(payload))
    .setProtectedHeader(header)
    .setIssuedAt()
    .setExpirationTime("10m")
    .sign(privateKey);

  return jwt;
};
```

#### JWT検証

**ファイル**: `src/tool-box/verify.ts`

```typescript
export const verifyVcForW3CVcDataV1 = async <T>(
  credential: string,
  opts: { skipVerifyChain?: boolean } = {},
): Promise<ExtractedCredential<string, VerifiableCredential<T>>> => {
  // 1. SD-JWTデコード
  const decoded = decodeSDJWT(credential);

  // 2. JWK取得（`cnf.jwk`から）
  const jwk = decoded.jwt.payload.cnf.jwk;
  const publicKey = await importJWK(jwk);

  // 3. JWT署名検証
  try {
    await jwtVerify(credential, publicKey);
  } catch (err) {
    throw new Error("JWT signature verification failed");
  }

  // 4. X.509証明書チェーン検証
  if (!opts.skipVerifyChain && decoded.jwt.header.x5c) {
    const chainResult = await verifyCertificateChain(decoded.jwt.header.x5c);
    if (!chainResult.ok) {
      throw new Error("Certificate chain verification failed");
    }
  }

  return {
    raw: credential,
    value: decoded.jwt.payload as VerifiableCredential<T>,
    verified: true,
  };
};
```

### SD-JWT (Selective Disclosure JWT)

**特徴**:
- クレームを選択的に開示
- Holderが開示するクレームを制御
- Verifierは必要なクレームのみを要求

**構造**:
```
<Issuer-signed JWT>~<Disclosure 1>~<Disclosure 2>~...~<KB-JWT>
```

**デコード**:
```typescript
import { decodeSDJWT } from "@meeco/sd-jwt";

const decoded = decodeSDJWT(token);
// {
//   jwt: { header, payload, signature },
//   disclosures: [{ salt, key, value }, ...],
//   kbJwt: { header, payload, signature }
// }
```

**セキュリティ考慮事項**:
- Disclosureのsaltはランダム生成され、推測不可能
- KB-JWT (Key Binding JWT)でHolder署名を検証（実装により異なる）

## 3. セッション管理

### セッション設定

**ファイル**: `src/api.ts`

```typescript
import session from "koa-session";

app.keys = [process.env.OID4VP_COOKIE_SECRET || "some secret hurr"];

const CONFIG: Partial<opts> = {
  key: "koa.sess",
  maxAge: 60 * 60 * 1000,  // 1時間
  autoCommit: true,
  overwrite: true,
  httpOnly: true,
  signed: true,
  rolling: false,
  renew: false,
  secure: !(process.env.NODE_ENV === "local" || process.env.NODE_ENV === "test"),
  sameSite: "none",
};

app.use(session(CONFIG, app));
```

### セキュリティ設定

| 設定 | 値 | 説明 |
|-----|---|------|
| `httpOnly` | `true` | JavaScriptからのアクセスを防止（XSS対策） |
| `signed` | `true` | セッションCookieに署名（改ざん検知） |
| `secure` | `true` (本番) | HTTPS接続のみでCookie送信 |
| `sameSite` | `"none"` | クロスサイトリクエストでもCookie送信（CORS対応） |
| `maxAge` | `3600000` | 1時間でセッション期限切れ |

### セッション検証

**検証フロー**:
```typescript
// routes/oid4vp-routes.ts
router.post(`/${apiDomain}/comment/confirm`, async (ctx) => {
  const requestId = ctx.session?.request_id;
  if (!requestId) {
    ctx.status = 400;
    ctx.body = toErrorBody("INVALID_HEADER", "Session expired or invalid");
    return;
  }

  // セッションからデータ取得
  const session = await getSession(requestId);
  // ...
});
```

### セッションライフサイクル

```
┌────────────────┐
│ セッション生成 │
│ (auth-request) │
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ セッション更新 │
│ (response-code)│
└───────┬────────┘
        │
        ▼
┌────────────────┐
│ セッション削除 │
│ (confirm)      │
└────────────────┘
```

**セッション削除**:
```typescript
// セッション無効化
ctx.session = null;
```

### セッションハイジャック対策

1. **HTTPS必須**: 本番環境では`secure: true`
2. **署名検証**: `signed: true`でCookie改ざん検知
3. **短い有効期限**: 1時間で自動失効
4. **Nonce使用**: OID4VPリクエストごとに一意のnonce

## 4. CORS設定

### ノード別CORS設定

#### BOOL_NODE

**設定**:
```typescript
cors({
  origin: process.env.APP_HOST,        // 特定オリジンのみ
  allowMethods: ['POST', 'OPTIONS']    // POSTとOPTIONSのみ
})
```

**セキュリティ考慮**:
- 更新系APIは特定のフロントエンドアプリからのみアクセス可能
- GETメソッドは無効（情報漏洩防止）

#### API_NODE

**設定**:
```typescript
cors({
  origin: '*',                         // 全オリジン許可
  allowMethods: ['GET']                // GETのみ
})
```

**セキュリティ考慮**:
- 参照系APIのみ公開（更新は不可）
- 全オリジンからのアクセスを許可（公開API）

#### VERIFIER_NODE

**設定**:
```typescript
cors({
  origin: process.env.APP_HOST,        // 特定オリジンのみ
  allowMethods: ['POST', 'GET'],       // POSTとGET
  credentials: true                    // Cookie送信を許可
})
```

**セキュリティ考慮**:
- セッションCookieを使用するため`credentials: true`
- 特定のフロントエンドアプリからのみアクセス可能

### Preflight Request

**CORS Preflightの処理**:
```typescript
// main-routes.ts
router.options(`/database/urls`, async (ctx) => {
  ctx.status = 204;  // Preflight成功
});
```

### CORS攻撃対策

1. **Origin検証**: 許可されたオリジンのみアクセス可能
2. **Credential制限**: credentialsフラグで明示的に制御
3. **メソッド制限**: 必要最小限のHTTPメソッドのみ許可

## 5. OrbitDBアクセス制御

### アクセスコントローラ

**ファイル**: `src/orbit-db/orbitdb-service.ts`

```typescript
const openDocuments = async (documentTypes) => {
  // 1. OrbitDBAccessController作成
  const write = [identity.id];  // 書き込み許可するIdentity
  const AccessController = OrbitDBAccessController({ write });

  // 2. ドキュメント開く
  for (const docType of documentTypes) {
    const Database = Documents({ indexBy: docType.indexBy });
    const opt = { type: "documents", AccessController, Database };
    const doc = await orbitdb.open(docType.name, opt);
    // ...
  }
};
```

### Grant権限

**エンドポイント**: `POST /admin/access-right/grant`

**処理フロー**:
```typescript
const grant = async (documents, requester) => {
  // 1. リモートノードに接続（libp2p dial）
  await libp2p.dial(multiaddr(requester.multiaddrs[0]));

  // 2. リモートIdentity取得
  const identity = await identities.getIdentity(requester.identity.hash);

  // 3. 書き込み権限付与
  for (const doc of Object.values(documents)) {
    await doc.document.access.grant("write", identity.id);
  }
};
```

### アクセス制御の検証

**OrbitDBのエントリ検証**:
```typescript
// OrbitDB内部で自動的に検証
const entry = {
  identity: "<identity-hash>",
  payload: {...},
  sig: "<signature>",
};

// 1. Identityの書き込み権限チェック
if (!accessController.canWrite(entry.identity)) {
  throw new Error("Permission denied");
}

// 2. 署名検証
const verified = await verifySignature(entry);
if (!verified) {
  throw new Error("Invalid signature");
}
```

### セキュリティ考慮事項

1. **Identity管理**: Keystoreで秘密鍵を安全に保管
2. **Grant権限**: BOOL_NODEのみが権限付与可能
3. **署名検証**: すべてのエントリで署名を検証

## 6. 認証・認可

### Bearerトークン認証

**使用箇所**: `DELETE /database/claims/:id`

**実装**:
```typescript
// routes/main-routes.ts
router.delete(`/database/claims/:id`, async (ctx) => {
  // 1. Authorizationヘッダー取得
  const authHeader = ctx.headers.authorization;
  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    ctx.status = 401;
    ctx.body = toErrorBody("Unauthorized");
    return;
  }

  // 2. トークン抽出
  const idToken = authHeader.split(" ")[1];

  // 3. Claim削除（トークン検証含む）
  const result = await interactor.deleteClaim(id, idToken);
  if (!result.ok) {
    const { statusCode, body } = handleError(result.error);
    ctx.status = statusCode;
    ctx.body = body;
    return;
  }

  ctx.status = 204;
});
```

**トークン検証**:
```typescript
// usecases/claim-interactor.ts
const deleteClaim = async (id, idToken) => {
  // 1. Claim取得
  const claim = await getClaim(id);

  // 2. Claimer取得
  const claimer = await getClaimer(claim.claimer_id);

  // 3. トークン照合
  if (claimer.id_token !== idToken) {
    return { ok: false, error: { type: "KEY_DOES_NOT_MATCH" } };
  }

  // 4. 削除処理
  // ...
};
```

### OID4VP認証

**認証フロー**:
1. `POST /oid4vp/auth-request`: Presentation Definition生成
2. `POST /oid4vp/responses`: VP Token受信・検証
3. `POST /oid4vp/response-code/exchange`: クレーム情報取得
4. `POST /oid4vp/comment/confirm`: Claim登録

**多要素検証**:
- **Nonce検証**: Replay攻撃防止
- **署名検証**: VP/VC署名検証
- **証明書検証**: X.509証明書チェーン検証
- **有効期限検証**: トークン・セッション期限チェック

## 7. エラーハンドリング

### エラーログ

**ファイル**: `src/services/logging-service.ts`

```typescript
import winston from "winston";

const logger = winston.createLogger({
  level: env === "prod" ? "info" : "debug",
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json(),
  ),
  transports: [
    new winston.transports.Console(),
    // 本番環境ではファイルまたはクラウドロギングサービスに出力
  ],
});
```

### エラー情報の機密性

**エラーレスポンス**:
```typescript
// routes/error-handler.ts
export const toErrorBody = (
  type: string,
  message?: string,
  instance?: string,
) => ({
  type,            // エラータイプ（公開）
  message,         // エラーメッセージ（詳細は非公開）
  instance,        // リソースパス（公開）
});
```

**機密情報の除外**:
- スタックトレースは本番環境では非公開
- データベースエラーの詳細は非公開
- 内部エラーは `UNEXPECTED_ERROR` として一般化

### エラーロギング戦略

```typescript
// api.ts
app.use(async (ctx, next) => {
  try {
    await next();
  } catch (err) {
    // 1. エラーログ（詳細情報）
    errorLogger().log(err);

    // 2. クライアントレスポンス（一般化）
    ctx.status = 500;
    ctx.body = toErrorBody("UNEXPECTED_ERROR", "Unknown error");
  }
});
```

**ログレベル**:
- `error`: 例外・エラー
- `warn`: 警告（同期遅延など）
- `info`: 通常の操作（APIアクセス、DB更新）
- `debug`: デバッグ情報（本番では無効）

## 8. セキュリティベストプラクティス

### 環境変数の管理

**機密情報**:
- `OID4VP_COOKIE_SECRET`: セッションCookie暗号化キー
- `OID4VP_VERIFIER_JWK`: Verifier秘密鍵
- `OID4VP_VERIFIER_X5C`: X.509証明書

**保管方法**:
- `.env`ファイルは`.gitignore`に追加
- 本番環境では環境変数またはシークレット管理サービスを使用
- テンプレート（`.env.template.*`）には実際の値を含めない

### 依存関係の管理

**定期的な更新**:
```bash
yarn upgrade --latest
```

**脆弱性スキャン**:
```bash
yarn audit
yarn audit fix
```

### 入力検証

**バリデーション**:
- URLの形式検証（`new URL(url)`）
- `bool_value`の範囲チェック（0-2）
- UUIDの形式検証

**サニタイゼーション**:
- SQLクエリはプリペアドステートメント使用
- OrbitDBはJSON形式で保存（型安全）

### レート制限

**将来的な改善**:
- API呼び出しのレート制限（express-rate-limitなど）
- IP単位/ユーザー単位の制限
- DDoS対策

### セキュリティヘッダー

**将来的な改善**:
```typescript
app.use(async (ctx, next) => {
  ctx.set("X-Content-Type-Options", "nosniff");
  ctx.set("X-Frame-Options", "DENY");
  ctx.set("X-XSS-Protection", "1; mode=block");
  ctx.set("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
  await next();
});
```

## 9. セキュリティ監査

### 監査ログ

**記録する情報**:
- API呼び出し（エンドポイント、メソッド、IPアドレス）
- OrbitDB更新（ドキュメントタイプ、ID、タイムスタンプ）
- 認証イベント（成功/失敗、ユーザー）
- エラー・例外

**ログ形式**:
```json
{
  "timestamp": "2025-01-15T10:30:00.000Z",
  "level": "info",
  "method": "POST",
  "url": "/database/claims",
  "status": 201,
  "duration": "150ms",
  "ip": "192.168.1.100"
}
```

### 定期的なレビュー

**セキュリティチェックリスト**:
- [ ] 依存関係の脆弱性スキャン
- [ ] アクセスログのレビュー
- [ ] エラーログの分析
- [ ] X.509証明書の有効期限確認
- [ ] CORS設定の見直し
- [ ] セッションタイムアウトの妥当性確認

## まとめ

boolcheckのセキュリティ実装は、以下の原則に基づいています：

1. **多層防御**: 複数のセキュリティレイヤーで保護
2. **最小権限**: 必要最小限のアクセス権のみ付与
3. **暗号化**: 通信とデータの暗号化
4. **検証**: すべての入力とトークンを検証
5. **ログ記録**: セキュリティイベントの記録と監視
6. **定期的な更新**: 依存関係とセキュリティパッチの適用

この設計により、真偽情報の信頼性と整合性を保ちながら、安全なシステム運用を実現しています。
