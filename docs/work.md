# 依頼事項
## アプリ固有の機能の不要な機能の削除
Boolcheckに固有で本アプリで不要な機能がいくつか残っているので削除してください。
- URL投稿
- URL参照
- 投稿者参照
- コメント投稿
- コメント確定
- コメントキャンセル

## OID4VPプロトコル改訂への対応
https://openid.net/specs/openid-4-verifiable-presentations-1_0.html

プロトコルのバージョンが最新の1.0に更新されています。
これに合わせて実装も大きく変更が必要になっているので、以下を確認して対応してください。

### PEXの廃止とDigital Credentials Query Language (DCQL)の導入
Presentation Exchange(PEX)の仕様が実装観点から複雑すぎるということで、DCQLへの置き換えが決定されています。主な変更内容は以下です。

- Presentation Definitionの廃止
- Presentation Definitionエンドポイントの廃止
- 要求するクレデンシャルの条件はRequest Objectの`dcql_query`プロパティで指定する

    dcql_queryの例
    ```
    {
    "dcql_query": {
        "credentials": [
        {
            "id": "query_0",
            "format": "dc+sd-jwt",
            "meta": {
            "vct_values": [
                "urn:eudi:pid:1"
            ]
            },
            "claims": [
            {
                "path": [
                "family_name"
                ]
            },
            {
                "path": [
                "given_name"
                ]
            }
            ]
        }
        ]
    }
    }
    ```
- Presentation Submissionの廃止
    - PEX廃止に伴い、response endpointのペイロードがvp_tokenのみに変更
    - descriptor_mapを用いてクレデンシャルを取り出す処理は無くなりました

- vp_tokenからクレデンシャルを抽出する方法は以下のルール

    ```
    vp_token:
    REQUIRED. This is a JSON-encoded object containing entries where the key is the id value used for a Credential Query in the DCQL query and the value is an array of one or more Presentations that match the respective Credential Query. When multiple is omitted, or set to false, the array MUST contain only one Presentation. There MUST NOT be any entry in the JSON-encoded object for optional Credential Queries when there are no matching Credentials for the respective Credential Query. Each Presentation is represented as a string or object, depending on the format as defined in Appendix B. The same rules as above apply for encoding the Presentations.
    ```


## vp_tokenの暗号化対応
OID4VPのプロファイルであるHAIPの要件に準拠するため、JWEによる暗号化をサポートします。

###  リファレンスからの抜粋
https://openid.net/specs/openid4vc-high-assurance-interoperability-profile-1_0-04.html#name-openid-for-verifiable-presen

```
5.1. OpenID for Verifiable Presentations via Redirects
The following requirements apply to OpenID4VP via redirects, unless specified otherwise:

- Response encryption MUST be used by utilizing response mode direct_post.jwt, as defined in Section 8.3 of [OIDF.OID4VP]. Security Considerations in Section 14.3 of [OIDF.OID4VP] MUST be applied.
```

https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#section-8.3

概要
```
This section defines how an Authorization Response containing a VP Token (such as when the Response Type value is vp_token or vp_token id_token) can be encrypted at the application level using [RFC7518] where the payload of the JWE is a JSON object containing the Authorization Response parameters. 
```

暗号化に使用する公開鍵に関する仕様
```
To obtain the Verifier's public key to which to encrypt the Authorization Response, the Wallet uses JWKs from client metadata (such as the jwks member within the client_metadata request parameter or other mechanisms as allowed by the given Client Identifier Prefix). Using what it supports and its preferences, the Wallet selects the public key to encrypt the Authorization Response based on information about each key, such as the kty (Key Type), use (Public Key Use), alg (Algorithm), and other JWK parameters. The alg parameter MUST be present in the JWKs. The JWE alg algorithm used MUST be equal to the alg value of the chosen jwk. If the selected public key contains a kid parameter, the JWE MUST include the same value in the kid JWE Header Parameter (as defined in Section 4.1.6) of the encrypted response. This enables the Verifier to easily identify the specific public key that was used to encrypt the response. The JWE enc content encryption algorithm used is obtained from the encrypted_response_enc_values_supported parameter of client metadata, such as the client_metadata request parameter, allowing for the default value of A128GCM when not explicitly set.

The payload of the encrypted JWT response MUST include the contents of the response as defined in Section 8.1 as top-level JSON members.
```

client_metadataの例
```
{
 "response_type": "vp_token",
 "response_mode": "dc_api.jwt",
 "nonce": "xyz123ltcaccescbwc777",
 "dcql_query": {
  "credentials": [
   {
    "id": "my_credential",
    "format": "dc+sd-jwt",
    "meta": {
      "vct_values": ["https://credentials.example.com/identity_credential"]
    },
    "claims": [
      {"path": ["last_name"]},
      {"path": ["first_name"]},
      {"path": ["address", "postal_code"]}
     ]
    }
   ]
 },
 "client_metadata": {
   "jwks": {
    "keys": [
    {
     "kty":"EC", "kid":"ac", "use":"enc", "crv":"P-256","alg":"ECDH-ES",
     "x":"YO4epjifD-KWeq1sL2tNmm36BhXnkJ0He-WqMYrp9Fk",
     "y":"Hekpm0zfK7C-YccH5iBjcIXgf6YdUvNUac_0At55Okk"
    },
    {
     "kty":"OKP","kid":"jc","use":"enc","crv":"X25519","alg":"ECDH-ES",
     "x":"WPX7wnwq10hFNK9aDSyG1QlLswE_CJY14LdhcFUIVVc"
    },
    {
     "kty":"EC","kid":"lc","use":"enc","crv":"P-384","alg":"ECDH-ES",
     "x":"iHytgLNtXjEyYMAIGwfgjINZRmLfObYbmjPhkaPD8OiTkJtRHjegTNdH31Mxg4nV",
     "y":"MizXWSqNB7sSt_SNjg3spvaJnmjB-LpxsPpLUaea33rvINL3Mq-gEaANErRQpbLx"
    },
    {
     "kty":"OKP","kid":"bc","use":"enc","crv":"X448","alg":"ECDH-ES",
     "x":"pK5IRpLlX-8XcsRYWHejpzkfsHoDOmAYuBzAC7aTpewWOw_QFHSa64t9p2kuommI8JQQLohS2AIA"
    }
   ]
  },
  "encrypted_response_enc_values_supported": ["A128GCM", "A128CBC-HS256"]
 }
}
```

https://openid.net/specs/openid-4-verifiable-presentations-1_0.html#section-8.3.1
```
8.3.1. Response Mode "direct_post.jwt"
This specification also defines a new Response Mode direct_post.jwt, which allows for encryption to be used on top of the Response Mode direct_post defined in Section 8.2. The mechanisms described in Section 8.2 apply unless specified otherwise in this section.
```


暗号化対象のペイロード例
```
{
    "vp_token": {"example_credential_id": ["eyJhb...YMetA"]}
}
```

### 今回使用するアルゴリズム
```
* JWE Algorithm `ECDH-ES`, i.e. `Elliptic Curve Diffie-Hellman Ephemeral Static key agreement using the Concat KDF` 
* JWE Method `A128GCM`, i.e. `AES in Galois/Counter Mode (GCM) using a 128 bit key` 
```

### JWEの補足
- JWE compact

BASE64URL(ProtectedHeader).Blank (EncryptedKey).BASE64URL(IV).BASE64URL(Ciphertext).BASE64URL(Tag)

```
BASE64URL(ProtectedHeader)
.
(EncryptedKey)   ← 空なのでここはドットだけ
.
BASE64URL(IV)
.
BASE64URL(Ciphertext)
.
BASE64URL(Tag)
```

- ProtectedHeader

```
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
### 具体的な修正内容
- Authorization Requestの生成処理に、client_metadataの`jwks`と`encrypted_response_enc_values_supported`を渡せる仕組みを追加
- その場合の公開鍵はエフェメラルなので動的に生成、DBに保存する
- response endpointでpostされたペイロードが`response`でも受け付けられるようにする
- vp_tokenを取得、検証する処理に、暗号化されていた場合の分岐と暗号化の処理の実行を追加

