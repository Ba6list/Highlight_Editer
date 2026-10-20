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
- 公開URL（2026-10-20の変更先）： https://nobori-highlight-studio.nbrhg.workers.dev （ユーザーの管理画面でアカウントSubdomainを確認済み）。共通パスワード・管理者PINのローカル設定は確認済み。2026-10-19にユーザーの明示許可を受け、8項目の本番Secrets登録を完了。
- Cloudflareのアカウント作成はユーザーが完了。D1はnobori-highlightとして作成され、ユーザー提供のDatabase IDを設定済み。Cloudflareにキーチェーン保護のOAuth接続済み。D1のID・名前とR2 nobori-highlight-media（Standard、空）を実際に確認済み。2026-10-19に初回公開完了。今後の更新公開は改めてユーザーの許可を得る。

- Google Cloudプロジェクトは nobori-highlight-studio。Drive API有効、OAuthクライアント作成、2TB契約の保存先アカウントをテストユーザー登録、drive.fileスコープ登録をユーザー画面で確認済み。Google・Twitchの接続情報はローカル.dev.varsへ保存・形式確認済み。秘密情報を出力しない。実OAuth接続は未確認。
- 2026-10-19: GitHub ActionsのCLOUDFLARE_API_TOKENは登録済み画面を確認。CLOUDFLARE_ACCOUNT_IDもユーザーから登録完了の報告あり（値・実権限の本番動作は未確認）。公開予定URL設定後のビルドと40件のテスト成功。その後ユーザー「どうぞ」で初回公開を明示許可。

- 初回公開コミット b4f5d8552c6b1749cc6de8b551b634759291c9cc。GitHub Actions run 39209676581（workflow_dispatch、deploy=true）でcheckとdeploy成功。D1本番マイグレーション成功、Worker・静的ファイル公開済み。公開トップとJS/CSSがHTTP 200、未ログインの/api/session・/api/stateが401、Chromeでログイン画面の表示を確認。共通パスワードは保存された照合値しか保持しないため、ユーザーによる実ログインと外部OAuth認可待ち。

- 2026-10-20: ユーザーがCloudflare account subdomainをnbrhgに変更済み（画面確認）。変更直後にはTLSハンドシェイク失敗が発生し、その後ユーザーから反映待ちが解消しアクセスできたとの報告あり。ローカルAPP_ORIGINは新URLへ更新。ユーザー「おk」で今回の本番反映を許可。GitHub Actions run 39353379590でコミット7253654da4486c4585b3aa1379fef2cce589721dを公開し、check・deployとも成功。本番APP_ORIGINは新URLへ反映済み。Twitchの新リダイレクトURIを画面で確認済み、Google側もユーザーから変更・保存完了の報告あり。2026-10-19の画面では両サービス接続済みを確認済み。実動画・OBSテストはユーザー希望で後日。

- 2026-10-20公開後の確認: 新URLトップ・JS/CSSは200、未認証の/api/session・/api/stateは401。/api/loginへパスワードを含まない空JSONを送信し、新Originは入力検証の400、不正Originは403（認証処理・セッション作成なし）。新URLのOrigin設定が本番で有効であることを確認。TwitchのSecret再発行はユーザーが後で行う予定。秘密値は記録しない。

- 2026-10-20: ユーザー希望でChrome拡張NOBORI Clipを実装。extension/にMV3、worker/extension.tsに一度限りのコード引換と限定Bearer API、migrations/0002_extension.sql追加。Web側の保存処理はworker/capture.tsへ共通化。ローカル57件成功。Chrome実機と実Twitch保存は未検証。今回ユーザー「とりあえず本番反映お願いするでok??」で公開を許可。コミット28bc3b0024949a8ff9423ebf3cde953855cd2736をActions run39359336850から公開し、0002_extension.sql適用・check・deploy成功。ユーザーが後日に延期した実動画・OBSテストを勝手に開始しない。

- 拡張対応の本番確認: 新JS/CSSとトップは200、未認証の拡張API・コード発行は401。Chromeでシステム設定の拡張接続パネル表示を確認。接続コードは発行していない。拡張インストール・実Twitch保存・OBSは未実施。ローカルWranglerからのD1読取クエリは7403権限エラーになったため、追加マイグレーション成功はGitHubのdeployログで確認（バージョン0bdb05c6-931d-4076-b6df-760d64e2de63）。
