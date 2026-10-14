import { readD1Migrations } from "@cloudflare/vitest-plugin";
import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readFileSync } from "node:fs";
export default defineConfig(async () => ({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          APP_ORIGIN: "https://studio.test",
          AUTH_KEY: "test-only-hmac-secret-not-for-production",
          TOKEN_ENCRYPTION_KEY: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
          STAFF_PASSWORD_HASH: "",
          ADMIN_PIN_HASH: "",
          TWITCH_CLIENT_ID: "test-id",
          TWITCH_CLIENT_SECRET: "test-secret",
          GOOGLE_CLIENT_ID: "test-id",
          GOOGLE_CLIENT_SECRET: "test-secret",
          TEST_SCHEMA: JSON.stringify(await readD1Migrations("./migrations")),
        },
      },
    }),
  ],
  test: {
    fsModuleCachePath: join(tmpdir(), "nobori-vitest-cache"),
    include: ["tests/**/*.test.ts"],
    fileParallelism: false,
  },
}));
