import { readConfig } from "./config.mjs";
import { readFile } from "node:fs/promises";
const config = await readConfig();
const errors = [];
if (!config.vars?.APP_ORIGIN?.startsWith("https://"))
  errors.push(
    "公開URLが未設定です。npm run setup でHTTPSの公開URLを設定してください。",
  );
if (
  !config.d1_databases?.[0]?.database_id ||
  config.d1_databases[0].database_id === "00000000-0000-0000-0000-000000000000"
)
  errors.push(
    "D1 Database IDが未設定です。docs/SETUP.md のCloudflare設定を実施してください。",
  );
if (errors.length) {
  console.error(errors.join("\n"));
  process.exitCode = 1;
} else
  console.log(
    "公開URLとD1設定を確認しました。秘密情報と外部OAuthは別途設定が必要です。",
  );
