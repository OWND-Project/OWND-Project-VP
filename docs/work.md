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