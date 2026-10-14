# NOBORI Highlight Studio の作業方針

- このフォルダが専用プロジェクト。親フォルダ・別のNOBORI配信ツールを変更しない。
- 初回セットアップ後も、作業ごとに変更内容・確認結果をユーザーへ報告し、今回の本番公開の明示的な許可を受けてからデプロイする。
- GitHubへPushしても本番を自動更新しない。Push・PRはテストのみ。
- 本番D1マイグレーション、公開Workflowの実行、Cloudflareへの直接デプロイは、今回の本番公開の許可を受けるまで実行しない。
- 本番公開はmainの確認済みコミットを対象にし、workflow_dispatchのdeploy=trueを使う。過去の許可を次回の公開に流用しない。
- GitHub Pagesは有効化しない。サーバー処理とサイトの公開先はCloudflare Workers Static Assets。
- GitHubリポジトリのURLとアクセス権は専用リポジトリ作成後に確認する。既存リポジトリへの接続を新しいリポジトリの権限と混同しない。
- 秘密情報はGitHub、配布ZIP、フロントエンド、チャットへ出さない。
- 完了報告はローカル・模擬APIの確認と、実サービス・OBS実機の確認を区別する。

## 専用リポジトリ

- 対象URL： https://github.com/Ba6list/Highlight_Editer
- Cloudflareのアカウント作成はユーザーが完了。D1はnobori-highlightとして作成され、ユーザー提供のDatabase IDを設定済み。Cloudflareへの実接続はまだ未確認。R2・Workers・Secretsは未設定で、本番公開の許可もまだ受けていない。
