# NOBORI Highlight Studio

NOBORI大会のTwitchクリップを収集し、必要な範囲と順番を編集してOBSで上映する独立したWebアプリです。React / TypeScript / Vite / Tailwind CSS、Cloudflare Workers Static Assets / D1 / R2、Twitch Helix、Google Driveを使用します。既存のHUB・タイマー等には依存しません。

## 現在の状態

ソース実装とローカル検証用の構成です。外部アカウント・本番環境は未接続です。**本番配信での利用前に [受け入れ確認](docs/ACCEPTANCE.md) を実施してください。** 模擬APIによる検証と実サービスでの検証を区別しています。

- 共通パスワード、12時間セッション、管理者PIN、CSRF対策、試行制限、暗号化トークン
- Twitch OAuth、最大60秒指定のクリップ要求、非同期の生成確認、公式ダウンロードAPI、R2保存
- 一覧、検索、タグ、タイトル、期限変更、再試行、削除確認
- 0.1秒単位の非破壊トリミング、並び替え、複製、全体プレビュー、自動保存、更新競合検知
- 再生リストの複製・公開・公開停止、公開時点の内容の固定
- OBS専用トークン、連続再生、次素材の先読み、再試行、黒画面待機、再生素材の保護
- PNGアップロード、後からフレーム適用、素材別表示切り替え。仮フレームは作成していません
- Drive OAuth、4MBずつの再開可能な転送、保存検証後にR2削除、自動期限、復元
- 保存容量・履歴・転送進捗・操作ログ、main更新で自動テスト、ユーザーの許可後にGitHub Actionsでデプロイ

MP4結合書き出しは第2段階で、今回のアプリには含めていません。ブラウザでの完全な無音なし切り替え・60fps・通信断中の連続上映を保証するものではありません。OBS実機検証が必要です。

## ローカル起動

Node.js 22以上を用意し、このフォルダで次を順番に実行します。

```bash
npm ci
npm run setup
npm run db:local
npm run dev
```

表示された `http://127.0.0.1:8790` を開き、setupで設定した共通パスワードを入力します。ローカルD1/R2はPC内の模擬環境です。外部接続なしでは実際のTwitch保存・Drive転送はできません。スマートフォンでの共有運用には公開URLを使用してください。

```bash
npm run check
```

本番ではHTTPS専用Cookieを利用します。ローカルHTTPだけSecureを省略します。

## 初期設定と資料

1. [初心者向け初期設定](docs/SETUP.md)：Cloudflare、GitHub、Twitch、Google
2. [大会スタッフの操作手順](docs/MANUAL.md)：保存、編集、公開、OBS、アーカイブ、PNG
3. [設計と制限・費用](docs/ARCHITECTURE.md)
4. [困ったときの対処](docs/TROUBLESHOOTING.md)
5. [本番前の受け入れ確認](docs/ACCEPTANCE.md)
6. [検証結果](docs/TEST-RESULTS.md)

## フォルダ

```text
src/                  日本語のスタッフ画面・編集・OBSプレーヤー
worker/               認証・API・Twitch・Drive・転送処理
migrations/           D1の定義と整合性保護
scripts/              対話式セットアップ
 tests/               Workers実行環境・D1・R2を使う自動テスト
 docs/                初期設定・操作・設計・本番チェック
.github/workflows/    GitHub Actions
wrangler.jsonc        Workers・D1・R2・定期実行の設定
.env.example          秘密情報の項目見本（値は空）
```

このフォルダだけを新しいGitHubリポジトリへ登録してください。親フォルダの既存プロジェクトを一緒に登録しないでください。`.dev.vars`・`.env`・秘密情報は絶対に登録しません。
