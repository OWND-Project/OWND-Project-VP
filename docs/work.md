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
