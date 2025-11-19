# VP Token暗号化対応（HAIP準拠）

**作成日**: 2025-11-19
**最終更新**: 2025-11-19
**対応仕様**: OpenID4VP 1.0 + HAIP (High Assurance Interoperability Profile)
**ステータス**: ✅ 実装完了

## 実装進捗

| Phase | 項目 | ステータス | 実装内容 |
|-------|------|-----------|---------|
| Phase 0 | 設計ドキュメント作成 | ✅ 完了 | state パラメータの扱いを明確化、compactDecryptの動作説明追加 |
| Phase 1 | エフェメラル鍵ペア生成・保存 | ✅ 完了 | Response Endpoint側で鍵生成。jwt-helper.ts, response-endpoint.ts, oid4vp-repository.ts更新 |
| Phase 2 | client_metadata拡張 | ✅ 完了 | types.ts (jwks, encryptedResponseEncValuesSupported追加), auth-request.ts (direct_post.jwt対応), verifier.ts (公開鍵をclient_metadataに含める) |
| Phase 3 | Response Endpoint JWE復号化 | ✅ 完了 | response-endpoint.ts に JWE 復号化処理追加。stateパラメータ(平文)でrequest特定 |
| Phase 4 | テスト実装 | ✅ 完了 | tests/helpers/jwt-helper.test.ts 追加 (鍵生成、暗号化/復号化テスト)。全テスト合格 (30 passing) |
| Phase 5 | ドキュメント更新 | ✅ 完了 | 本ドキュメントに進捗状況反映 |

## 実装サマリー

### 設計の改善

当初はVerifier側で鍵生成する設計でしたが、**Response Endpoint側で鍵生成から復号化まで一貫して処理**する設計に変更：

**メリット**:
- 責任の明確化: Response Endpointが暗号化/復号化の全責任を持つ
- データストアの統一: ResponseEndpointDatastoreのみで完結
- フロー簡素化: Verifierは受け取った公開鍵をclient_metadataに含めるだけ

### 変更ファイル一覧

- `src/helpers/jwt-helper.ts` - generateEphemeralKeyPair(), decryptJWE() 追加
- `src/database/schema.ts` - encryption_private_jwk カラム追加
- `src/oid4vp/types.ts` - ClientMetadata に jwks, encryptedResponseEncValuesSupported 追加
- `src/oid4vp/auth-request.ts` - response_mode に "direct_post.jwt" 追加
- `src/oid4vp/verifier.ts` - encryptionPublicJwk を client_metadata に含める処理
- `src/oid4vp/response-endpoint.ts` - initiateTransaction で鍵生成、receiveAuthResponse で JWE 復号化
- `src/usecases/oid4vp-repository.ts` - ResponseEndpointDatastore, VerifierDatastore に暗号化カラム対応
- `tests/helpers/jwt-helper.test.ts` - JWE暗号化/復号化テスト追加

### テスト結果

```
JWT Helper - JWE Encryption
  #generateEphemeralKeyPair
    ✔ should generate ECDH-ES key pair with P-256 curve
  #decryptJWE
    ✔ should decrypt JWE encrypted with ECDH-ES + A128GCM

全テスト: 30 passing (105ms)
TypeScriptコンパイル: ✅ エラーなし
```

## 概要

OID4VP 1.0のHAIP要件に準拠するため、VP Tokenの暗号化機能を実装します。
Response Mode `direct_post.jwt` を使用し、Authorization ResponseをJWE（JSON Web Encryption）で暗号化します。

## 仕様参照

### HAIP要件
https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-04.html#section-5.1

```
Response encryption MUST be used by utilizing response mode direct_post.jwt,
as defined in Section 8.3 of [OIDF.OID4VP].
```

### OID4VP 1.0 暗号化仕様
https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#section-8.3

## 暗号化アルゴリズム

- **JWE Algorithm**: `ECDH-ES` (Elliptic Curve Diffie-Hellman Ephemeral Static)
- **JWE Encryption Method**: `A128GCM` (AES GCM using 128-bit key)
- **Elliptic Curve**: `P-256` (secp256r1)

## JWE構造

### Compact Serialization形式

```
BASE64URL(ProtectedHeader)
.
(空文字列 - EncryptedKeyはECDH-ESでは使用しない)
.
BASE64URL(IV)
.
BASE64URL(Ciphertext)
.
BASE64URL(Tag)
```

### Protected Header例

```json
{
  "alg": "ECDH-ES",
  "enc": "A128GCM",
  "kid": "ac",
  "epk": {
    "kty": "EC",
    "crv": "P-256",
    "x": "nnmVpm3V3jbhc...",
    "y": "r4fjDqwJys9qU..."
  }
}
```

- `kid`: Verifierの公開鍵のKey ID
- `epk`: Walletが生成したエフェメラル公開鍵（Ephemeral Public Key）

### 暗号化対象ペイロード例

```json
{
  "vp_token": {
    "affiliation_credential": ["eyJhbGci..."]
  }
}
```

**注**: `state`パラメータは暗号化対象に含まれず、フォームパラメータとして別途送信されます。

## 実装設計

### 1. エフェメラル鍵ペア管理

#### 鍵ペア生成（Verifier側）

Authorization Request生成時に、以下を実行：

1. **エフェメラル鍵ペア生成**
   - アルゴリズム: ECDH-ES
   - 曲線: P-256
   - ライブラリ: `jose.generateKeyPair('ECDH-ES', { extractable: true, crv: 'P-256' })`

2. **鍵ペアのJWK形式エクスポート**
   ```typescript
   const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', {
     extractable: true,
     crv: 'P-256'
   });
   const publicJwk = await exportJWK(publicKey);
   const privateJwk = await exportJWK(privateKey);
   ```

3. **Key ID付与**
   ```typescript
   const kid = crypto.randomUUID();
   publicJwk.kid = kid;
   publicJwk.use = 'enc';
   publicJwk.alg = 'ECDH-ES';
   ```

4. **秘密鍵の保存**
   - requestsテーブルに新規カラム `encryption_private_jwk` を追加
   - JSON文字列として保存: `JSON.stringify(privateJwk)`

#### データベーススキーマ拡張

```sql
ALTER TABLE requests
ADD COLUMN encryption_private_jwk TEXT;  -- エフェメラル秘密鍵（JWK形式、JSON文字列）
```

### 2. client_metadata拡張

#### 追加プロパティ

```typescript
interface ClientMetadata {
  // 既存プロパティ
  clientId: string;
  vpFormats?: { [format: string]: any };
  clientName?: string;
  logoUri?: string;
  policyUri?: string;
  tosUri?: string;

  // 新規追加
  jwks?: {
    keys: JWK[];  // エフェメラル公開鍵を含む
  };
  encryptedResponseEncValuesSupported?: string[];  // ["A128GCM"]
}
```

#### client_metadata生成例

```typescript
export function generateClientMetadata(
  clientId: string,
  opts?: {
    // 既存オプション
    clientName?: string;
    logoUri?: string;
    policyUri?: string;
    tosUri?: string;
    // 新規追加
    encryptionPublicJwk?: JWK;  // エフェメラル公開鍵
  }
): ClientMetadata {
  const metadata: ClientMetadata = {
    clientId,
    vpFormats: { jwt_vp: { alg: ["ES256"] } },
    // ... 既存フィールド
  };

  // 暗号化対応
  if (opts?.encryptionPublicJwk) {
    metadata.jwks = {
      keys: [opts.encryptionPublicJwk]
    };
    metadata.encryptedResponseEncValuesSupported = ["A128GCM"];
  }

  return metadata;
}
```

### 3. Response Mode対応

#### Response Mode値

- 既存: `direct_post`
- 新規: `direct_post.jwt`

#### Request Object拡張

```typescript
interface RequestObjectPayload {
  // 既存フィールド
  response_type: string;
  response_mode: string;  // "direct_post" | "direct_post.jwt"
  response_uri: string;
  client_id: string;
  nonce: string;
  state: string;
  dcql_query: DcqlQuery;

  // client_metadataに暗号化情報を含める
  client_metadata?: ClientMetadata;
}
```

### 4. Response Endpoint拡張

#### リクエストパラメータ

**非暗号化** (`direct_post`):
```
POST /oid4vp/responses
Content-Type: application/x-www-form-urlencoded

vp_token={"affiliation_credential":["eyJ..."]}
&id_token=eyJ...
&state=req_abc123
```

**暗号化** (`direct_post.jwt`):
```
POST /oid4vp/responses
Content-Type: application/x-www-form-urlencoded

response=eyJhbGci...  (JWE Compact形式)
&state=req_abc123
```

**注**: 暗号化時も`state`パラメータは平文でフォームパラメータとして送信されます。

#### 処理フロー

```typescript
async function receiveAuthResponse(body: any) {
  // 1. 暗号化レスポンス検出
  if (body.response) {
    // JWE形式
    const jweToken = body.response;
    const state = body.state;  // stateは平文で送信される

    // 2. kidからrequestを特定
    const { protectedHeader } = await jose.decodeProtectedHeader(jweToken);
    const kid = protectedHeader.kid;
    const request = await getRequestByEncryptionKid(kid);

    // 3. state検証（オプション）
    if (state && state !== request.id) {
      throw new Error('State mismatch');
    }

    // 4. 秘密鍵を取得
    const privateJwk = JSON.parse(request.encryption_private_jwk);
    const privateKey = await importJWK(privateJwk, 'ECDH-ES');

    // 5. JWE復号化
    const { plaintext } = await compactDecrypt(jweToken, privateKey);
    const payload = JSON.parse(new TextDecoder().decode(plaintext));

    // 6. 通常フロー継続
    const { vp_token } = payload;
    // ... 既存の検証処理（vp_token, state使用）
  } else {
    // 非暗号化（既存フロー）
    const { vp_token, id_token, state } = body;
    // ... 既存処理
  }
}
```

### 5. JWE暗号化/復号化ヘルパー関数

#### 追加する関数（jwt-helper.ts）

```typescript
/**
 * エフェメラル鍵ペア生成（ECDH-ES + P-256）
 */
export async function generateEphemeralKeyPair(): Promise<{
  publicJwk: JWK;
  privateJwk: JWK;
  kid: string;
}> {
  const { publicKey, privateKey } = await generateKeyPair('ECDH-ES', {
    extractable: true,
    crv: 'P-256',
  });

  const publicJwk = await exportJWK(publicKey);
  const privateJwk = await exportJWK(privateKey);

  const kid = crypto.randomUUID();

  publicJwk.kid = kid;
  publicJwk.use = 'enc';
  publicJwk.alg = 'ECDH-ES';

  privateJwk.kid = kid;

  return { publicJwk, privateJwk, kid };
}

/**
 * JWE復号化（ECDH-ES + A128GCM）
 */
export async function decryptJWE(
  jwe: string,
  privateJwk: JWK
): Promise<any> {
  const privateKey = await importJWK(privateJwk, 'ECDH-ES');
  const { plaintext } = await compactDecrypt(jwe, privateKey);
  return JSON.parse(new TextDecoder().decode(plaintext));
}
```

## 実装フロー

### Authorization Requestフロー（暗号化対応）

```
1. POST /oid4vp/auth-request
   ↓
2. エフェメラル鍵ペア生成
   - generateEphemeralKeyPair()
   ↓
3. requestsテーブル保存
   - encryption_private_jwk: JSON.stringify(privateJwk)
   ↓
4. client_metadata生成
   - jwks: { keys: [publicJwk] }
   - encryptedResponseEncValuesSupported: ["A128GCM"]
   ↓
5. Request Object生成
   - response_mode: "direct_post.jwt"
   - client_metadata: 上記
   ↓
6. Authorization Request返却
```

### Authorization Responseフロー（暗号化対応）

```
1. POST /oid4vp/responses
   body: { response: "eyJhbGci...", state: "req_abc123" }
   ↓
2. JWE Protected Header解析
   - kid取得
   ↓
3. requestsテーブルからencryption_private_jwk取得
   - kidでリクエストを特定
   ↓
4. state検証（オプション）
   - state === request.id
   ↓
5. JWE復号化
   - decryptJWE(jwe, privateJwk)
   ↓
6. ペイロード抽出
   - { vp_token }
   ↓
7. 通常の検証フロー
   - VP Token検証
   - SD-JWT検証
   - Response Code生成
```

## セキュリティ考慮事項

### エフェメラル鍵の管理

1. **一時性**
   - 各Authorization Requestごとに新しい鍵ペアを生成
   - リクエスト有効期限（デフォルト10分）後に削除推奨

2. **秘密鍵の保護**
   - データベース暗号化推奨
   - 使用後は速やかに削除

3. **鍵の再利用禁止**
   - エフェメラル鍵は1回限りの使用

### JWE検証

1. **Protected Headerの検証**
   - `alg`: "ECDH-ES" のみ許可
   - `enc`: "A128GCM" のみ許可
   - `kid`: requestsテーブルに存在することを確認

2. **タイミング攻撃対策**
   - 復号化失敗時も一定時間応答を遅延

## テスト計画

### 1. エフェメラル鍵生成テスト

- [ ] 鍵ペア生成成功
- [ ] JWK形式の妥当性確認
- [ ] kid付与確認

### 2. client_metadata生成テスト

- [ ] jwks含むclient_metadata生成
- [ ] encryptedResponseEncValuesSupported設定確認

### 3. JWE暗号化/復号化テスト

- [ ] Authorization Response暗号化（Wallet側シミュレーション）
- [ ] JWE復号化成功
- [ ] 復号化後のペイロード検証
- [ ] 不正なJWEの検出

### 4. エンドツーエンドテスト

- [ ] 暗号化対応Authorization Request生成
- [ ] 暗号化されたAuthorization Response受信
- [ ] VP Token抽出・検証成功

### 5. エラーハンドリングテスト

- [ ] 不正なkid
- [ ] 不正なアルゴリズム
- [ ] 破損したJWE

## 環境変数

新規環境変数は不要（既存のOID4VP設定で対応）

## 後方互換性

- 既存の非暗号化フロー（`direct_post`）は引き続きサポート
- `response_mode`の値で暗号化/非暗号化を判定
- クライアントアプリケーションは暗号化対応を選択可能

## 実装優先順位

1. **Phase 1**: エフェメラル鍵生成・保存機能
2. **Phase 2**: client_metadata拡張
3. **Phase 3**: Response Endpoint JWE復号化対応
4. **Phase 4**: テスト実装
5. **Phase 5**: ドキュメント更新

## 参考資料

- [OpenID4VP 1.0](https://openid.net/specs/openid-4-verifiable-presentations-1_0.html)
- [HAIP 1.0](https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-04.html)
- [RFC 7518 - JWE Algorithms](https://www.rfc-editor.org/rfc/rfc7518.html)
- [jose NPM Package](https://github.com/panva/jose)
