# 前提
- 本リポジトリのソースコードはBool Checkというウェブシステムを実装したものである。
- 特に、OID4VPプロトコルに準拠し、特定のクレデンシャルをウォレットから受け取る機能を有するものであり、システムの根幹を成している。

# 作業依頼
- 今回、今のコードベースを基にして、新しいウェブシステムを構成する。
- 純粋なOID4VPによるクレデンシャル要求と受け取り機能を有するウェブシステムとする。
    - Boolcheckに固有の機能は捨て去ってOK
    - SIOPv2に関する機能も不要なので削除してOK
    - UIの要件は別途AIと相談して決定する
- Boolcheckに特徴的だった分散データベースにまつわる設計やコードは除去する
    - OrbitDBは不要。永続層にはSQLiteを使用する
    - API Node, Bool Node, Verifier Nodeという分離も不要

# 質問に対する回答
>   1. 残すOID4VP機能の具体的な範囲
>     - Presentation Definition作成
>     - VP Token受信・検証
>     - SD-JWT処理
>     - X.509証明書チェーン検証
>   これらすべてを残しますか？
はい。全て残してください。

>  2. 削除対象の確認
>    - OrbitDB関連: src/orbit-db/, src/local-data/replication.ts,
>  src/local-data/syncer.ts
>    - Boolcheck固有: src/usecases/claim-interactor.ts,
>  URL/Claim管理
>    - 3ノード構成: src/api.tsの分岐処理
はい。全て削除してください。

>  3. 新システムのデータ保存要件
>    - OID4VPセッション管理をSQLiteで実装
はい。
>    - 受け取ったクレデンシャルの保存は必要ですか？
いいえ、不要です。