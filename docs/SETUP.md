# 初心者向け：運用開始までの設定

コードを書く必要はありません。このフォルダのファイルを変更する設定は対話式の補助を使います。秘密情報は**チャットへ貼り付けず**、手元の端末または各サービスのSecret入力欄へ入力します。

本番アカウントへの実接続・公開はまだ行っていません。R2には従量課金があります。無料枠を目標にし、低い容量上限からテストしてください。

## 1. 手元で起動する

**何をするか**：必要なソフトを入れ、アプリ用パスワードを決めます。外部サービス設定の前でもログインと空の編集画面を確認できます。

1. [Node.js](https://nodejs.org/)を開き、22以上のLTS版をインストールします。
2. Macの「ターミナル」を開き、次をコピーして実行します。

```bash
cd "/Users/KKIKT/Documents/AI Editer/nobori-highlight-studio"
npm ci
npm run setup
```

3. 共通パスワードを12文字以上、管理者PINを数字6〜12桁で入力します。入力は非表示です。あとから画面で変更できます。
4. D1のIDと公開URLは、この時点では空欄のままEnterを押します。
5. 次を順番に実行します。

```bash
npm run db:local
npm run dev
```

6. [ローカル画面](http://127.0.0.1:8790)を開き、設定したパスワードでログインできれば成功です。

失敗した場合：`npm ci`をもう一度実行してください。「初期設定が未完了」と出る場合は`npm run setup`が完了したか確認します。既存の`.dev.vars`がある場合は上書きしません。初期検証用の設定をやり直す場合は、それを安全な場所に退避してからsetupします。

## 2. Cloudflareの専用保存先を作る

**目的**：別拠点のスタッフで共有するデータベースと動画置き場を用意します。既存NOBORI HUBとは別の名前を使います。

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)にログインします。Workersの契約はFreeを選びます。有料プランに変更する必要はありません。
2. 左メニュー「Storage & databases」→「D1」→「Create database」を選び、名前に`nobori-highlight`を入力します。
3. 作成された画面の「Database ID」を控えます。これは秘密のパスワードではありません。
4. 「R2 Object Storage」を開きます。未利用の場合、利用開始と支払い方法の登録が必要になることがあります。従量課金の条件を確認してから有効化します。
5. 「Create bucket」で`nobori-highlight-media`を作成し、ストレージクラスは**Standard**を選びます。公開URL・r2.devの公開は有効にしません。
6. ターミナルで次を実行します。

```bash
npx wrangler login
```

ブラウザが開いたら、自分のCloudflareアカウントで許可します。

7. 次のコマンドで専用Workerの名前を確認します。

```bash
npx wrangler whoami
```

8. `npm run setup`を再度実行し、D1 Database IDと公開予定URLを入力します。公開URLは通常 `https://nobori-highlight-studio.<あなたのWorkersサブドメイン>.workers.dev` です。Cloudflare「Workers & Pages」のアカウント設定でWorkersサブドメインを確認してください。

成功確認：`wrangler.jsonc`のD1 IDが最初のゼロの値から変わり、APP_ORIGINがhttpsの公開URLになります。setupが自動で変更します。ローカル`.dev.vars`はHTTPのローカルURLのままで構いません。

失敗時：名前がすでに使われている場合、別の既存リソースを流用せずご相談ください。変更が必要な名前をこちらで対応できます。

## 3. Cloudflareへ秘密情報を登録する

**目的**：GitHubにパスワード・鍵を置かず、Workersの実行環境だけに保存します。

`npm run setup`で作った`.dev.vars`にはAUTH_KEY、TOKEN_ENCRYPTION_KEY、STAFF_PASSWORD_HASH、ADMIN_PIN_HASHが入っています。値は平文の共通パスワードではありません。

手元のエディターで`.dev.vars`を開いて該当値を確認し、次を1行ずつ実行します。入力欄に**その値だけ**を貼り付けてEnterを押します。Secret入力は非表示です。このチャットには送らないでください。

```bash
npx wrangler secret put --config wrangler.jsonc AUTH_KEY
npx wrangler secret put --config wrangler.jsonc TOKEN_ENCRYPTION_KEY
npx wrangler secret put --config wrangler.jsonc STAFF_PASSWORD_HASH
npx wrangler secret put --config wrangler.jsonc ADMIN_PIN_HASH
```

Workerがまだないという案内が出た場合は、`nobori-highlight-studio`の新規作成を許可します。既存の他サービスのWorkerに登録しないでください。

次を実行します。

```bash
npm run db:remote
npm run deploy
```

成功確認：表示されたhttpsのURLにアクセスし、設定した共通パスワードでログインできること。URLがsetupで設定したAPP_ORIGINと完全に一致すること。

失敗時：D1 ID、バケット名、Cloudflareアカウントを確認します。公開URLやD1 IDが未設定の場合は安全のためデプロイを停止します。npm run setupで設定してください。「アクセス元が一致しません」はAPP_ORIGINの設定違いです。

## 4. Twitchを接続する

**目的**：公式配信のクリップ作成と動画取得を、管理者が一度だけ認可します。

1. [Twitch Developer Console](https://dev.twitch.tv/console/apps)を`nobori_official`アカウントで開きます。Twitch側の二段階認証が必要な場合は先に設定します。
2. 「Register Your Application」を押します。名前は`NOBORI Highlight Studio`、カテゴリは用途に合うWebアプリ、Client Typeは**Confidential**です。
3. OAuth Redirect URLに次を入力します。`あなたの公開URL`は実際のhttpsドメインに置き換えます。

```text
https://あなたの公開URL/api/oauth/twitch/callback
```

4. 登録後の「Manage」でClient IDを確認し、Client Secretを生成します。これらを次の入力欄へ登録します。

```bash
npx wrangler secret put --config wrangler.jsonc TWITCH_CLIENT_ID
npx wrangler secret put --config wrangler.jsonc TWITCH_CLIENT_SECRET
```

5. アプリの「システム設定」→「Twitch 接続する」→管理者PINを入力します。
6. Twitch認可画面で、`clips:edit`と`channel:manage:clips`に同意します。nobori_official以外のアカウントはアプリ側で拒否します。
7. アプリに戻り「接続済み」となれば成功です。
8. Twitch側でクリップ作成を有効にし、短いテスト配信でSAVE CLIPを押して保存完了を確認します。配信オフライン時のクリップ生成はできません。

失敗時：Redirect URLの末尾まで一致しているか確認します。権限が不足している場合は再接続します。ローカルOAuthをテストする場合はローカルURLのcallbackもConsoleに追加し、`.dev.vars`にClient ID/Secretを設定します。本番接続を先に推奨します。

## 5. Google Driveを接続する

**目的**：5TBのDrive契約を持つ自分のアカウントへ、スタッフの個別ログインなしで動画を保存します。

1. [Google Cloud Console](https://console.cloud.google.com/)を開き、専用プロジェクト`NOBORI Highlight Studio`を作ります。請求先アカウントの有効化や有料APIの追加は不要です。
2. 「APIs & Services」→「Library」→「Google Drive API」を検索し、「Enable」を押します。
3. 「Google Auth Platform」（またはOAuth同意画面）を開きます。「Branding」にアプリ名・自分の連絡先を設定します。
4. 個人アカウントの場合「Audience」はExternalを選びます。開発中はTest usersに自分のGoogleアカウントを追加します。
5. 「Data Access」でスコープ`https://www.googleapis.com/auth/drive.file`を追加します。Drive全体への権限は要求しません。
6. 「Clients」→「Create client」→「Web application」を選びます。
7. Authorized redirect URIsに実際の公開URLと次のパスを登録します。

```text
https://あなたの公開URL/api/oauth/google/callback
```

8. Client ID・Client Secretを次のコマンドでWorkersへ登録します。

```bash
npx wrangler secret put --config wrangler.jsonc GOOGLE_CLIENT_ID
npx wrangler secret put --config wrangler.jsonc GOOGLE_CLIENT_SECRET
```

9. アプリの「システム設定」→「Google Drive 接続する」→PINを入力し、5TB契約があるGoogleアカウントで許可します。
10. 接続済みになれば成功です。最初のアーカイブ処理で、Driveに「NOBORI Highlight Studio」フォルダが自動作成されます。

**長期運用前の注意**：ExternalアプリのTesting状態では、Driveスコープを使う更新トークンは通常7日で失効します。運用前にGoogle Auth PlatformのAudienceでProductionへ移行してください。審査や警告の扱いはGoogleの表示に従います。有料サービスへ切り替える操作ではありません。アプリ公開状態を変えた後は再接続して新しい認可を保存してください。

失敗時：Redirect URL、Test users、Driveの空き容量を確認します。同じGoogleアカウントで再接続してください。外部認可を取り消すと転送が止まりますが、R2の元動画は保持します。

## 6. GitHubへ一式を登録する

**目的**：mainへの更新時は自動テストだけを実行し、ユーザーの許可後に公開できるようにします。既存プロジェクトとは別のリポジトリにします。GitHub Pagesは有効にしません。公開先はCloudflareです。

1. [GitHub](https://github.com/new)を開き、新しいリポジトリを作成します。例：`nobori-highlight-studio`。公開・非公開の選択はご自身で決めてください。秘密情報はどちらでも含めません。
2. GitHub Desktopを使う場合は、この専用フォルダを新しいローカルリポジトリとして追加してPublishします。
3. ターミナルを使う場合は、このフォルダだけで次を実行します。最後のURLを自分のリポジトリURLに置き換えます。

```bash
git init -b main
git add .
git status
```

**確認**：`.dev.vars`、`.env`、node_modules、.wranglerが表示されないこと。親フォルダの既存アプリが含まれないことを確認してから続けます。

```bash
git commit -m "Create NOBORI Highlight Studio"
git remote add origin https://github.com/あなたのユーザー名/nobori-highlight-studio.git
git push -u origin main
```

4. Cloudflare右上のプロフィール→「API Tokens」→「Create Token」で、Workers編集、D1編集、対象アカウントのR2編集権限を持つトークンを作ります。対象をこのアカウントに限定します。
5. CloudflareのAccount IDを控えます。
6. GitHubリポジトリ→「Settings」→「Secrets and variables」→「Actions」→「New repository secret」に次を登録します。

| 名前                  | 入力する値            |
| --------------------- | --------------------- |
| CLOUDFLARE_API_TOKEN  | 今作ったAPIトークン   |
| CLOUDFLARE_ACCOUNT_ID | Cloudflare Account ID |

7. 必要なら「Settings」→「Environments」で`production`を作り、承認者を設定します。利用できる保護機能はGitHubの契約条件に従います。
8. 通常のPushでは「check」のみ動き、本番は変更されません。
9. 今回の公開についてユーザーが明示的に許可した後、「Actions」→「Check and deploy」→「Run workflow」を開きます。ブランチは`main`を選び、「今回の本番公開についてユーザーの許可を受けた」をオンにして実行します。この操作とDBの本番マイグレーションはCodexが許可を受けてから実施します。

成功確認：「check」「deploy」が緑になり公開URLを開けること。DBのマイグレーションが成功した後に公開します。

失敗時：Secret名、権限、D1 ID、APP_ORIGINを確認します。PRのテストだけでは本番へデプロイしません。無料Actions時間を使い切った場合はGitHubで上限を確認し、支出を増やす前に相談してください。

GitHubへ登録しただけではTwitch・GoogleのOAuth設定は完了しません。

## 7. 本番配信前

[受け入れ確認](ACCEPTANCE.md)を順番に行ってください。別ネットワークのスタッフ端末、OBS実機、Drive保存検証、CloudflareのCPU・課金画面の確認まで終わってから大会で使用します。
