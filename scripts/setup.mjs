import { readConfig } from "./config.mjs";
import { createHmac, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
let rl;
console.log(
  "NOBORI Highlight Studio 初期設定。秘密情報をチャットへ貼り付けないでください。",
);
async function hidden(prompt) {
  if (!stdin.isTTY)
    throw Error("ターミナルで実行してください。秘密情報は画面に表示しません。");
  const wasRaw = stdin.isRaw;
  if (stdin.isTTY) stdin.setRawMode(true);
  stdin.resume();
  stdout.write(prompt);
  let value = "";
  try {
    return await new Promise((resolve, reject) => {
      const handler = (chunk) => {
        for (const char of chunk.toString()) {
          if (char === "\u0003") {
            stdin.off("data", handler);
            reject(Error("中止しました"));
            return;
          }
          if (char === "\r" || char === "\n") {
            stdin.off("data", handler);
            stdout.write("\n");
            resolve(value);
            return;
          }
          if (char === "\u007f" || char === "\b") value = value.slice(0, -1);
          else value += char;
        }
      };
      stdin.on("data", handler);
    });
  } finally {
    if (stdin.isTTY) stdin.setRawMode(!!wasRaw);
  }
}
try {
  const target = ".dev.vars";
  try {
    await readFile(target);
    console.log("既存の .dev.vars があるため秘密情報の生成をスキップします。");
  } catch {
    const password = await hidden(
      "共通パスワード（12文字以上・入力は非表示）: ",
    );
    if (password.length < 12 || password.length > 256)
      throw Error("12〜256文字にしてください");
    const confirmation = await hidden("共通パスワードをもう一度入力: ");
    if (confirmation !== password)
      throw Error("共通パスワードが一致しません。もう一度実行してください");
    const pin = await hidden("管理者PIN（数字6〜12桁・入力は非表示）: ");
    if (!/^\d{6,12}$/.test(pin)) throw Error("数字6〜12桁にしてください");
    const pinConfirmation = await hidden("管理者PINをもう一度入力: ");
    if (pinConfirmation !== pin)
      throw Error("管理者PINが一致しません。もう一度実行してください");
    const auth = randomBytes(32).toString("base64url");
    const digest = (v) =>
      createHmac("sha256", auth).update(v).digest("base64url");
    await writeFile(
      target,
      `APP_ORIGIN=http://127.0.0.1:8790\nAUTH_KEY=${auth}\nTOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("base64url")}\nSTAFF_PASSWORD_HASH=${digest(password)}\nADMIN_PIN_HASH=${digest(pin)}\nTWITCH_CLIENT_ID=\nTWITCH_CLIENT_SECRET=\nGOOGLE_CLIENT_ID=\nGOOGLE_CLIENT_SECRET=\n`,
      { mode: 0o600, flag: "wx" },
    );
    console.log(".dev.vars を安全に作成しました。GitHubへは含まれません。");
  }
  if (process.argv.includes("--security-only")) {
    console.log(
      "パスワードとPINの初期設定が完了しました。値をチャットへ送らず、設定できたことだけお知らせください。",
    );
  } else {
    rl = createInterface({ input: stdin, output: stdout });
    const id = await rl.question(
      "Cloudflare D1 Database ID（ローカルのみならEnter）: ",
    );
    const origin = await rl.question("公開URL（ローカルのみならEnter）: ");
    if (id || origin) {
      let config = await readConfig();
      if (id) {
        if (!/^[0-9a-f-]{36}$/i.test(id))
          throw Error("D1 IDを確認してください");
        config.d1_databases[0].database_id = id;
      }
      if (origin) {
        const url = new URL(origin);
        if (
          url.protocol !== "https:" ||
          url.pathname !== "/" ||
          url.search ||
          url.hash
        )
          throw Error("httpsで始まる公開URLのドメイン部分を指定してください");
        config.vars.APP_ORIGIN = url.origin;
      }
      await writeFile("wrangler.jsonc", JSON.stringify(config, null, 2) + "\n");
    }
    console.log(
      "設定完了。npm run db:local を実行してください。本番秘密情報の登録は docs/SETUP.md を参照。",
    );
  }
} catch (e) {
  console.error(e.message);
  process.exitCode = 1;
} finally {
  rl?.close();
  stdin.pause();
}
