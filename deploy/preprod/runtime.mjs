import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";

const mode = process.argv[2];
if (!["backend", "frontend"].includes(mode))
  throw new Error("Expected backend or frontend runtime");

function secret(name) {
  const value = readFileSync(`/run/secrets/${name}`, "utf8").trim();
  if (!value) throw new Error(`Required secret is empty: ${name}`);
  return value;
}

if (mode === "frontend") {
  process.env.NUXT_TENANCY_PROXY_SECRET = secret("tenancy_proxy_secret");
} else {
  const mappings = {
    POSTGRES_PASSWORD: "data_password",
    PLATFORM_POSTGRES_PASSWORD: "platform_password",
    JWT_SECRET: "jwt_secret",
    TENANCY_PROXY_SECRET: "tenancy_proxy_secret",
    PLATFORM_ADMIN_PASSWORD_HASH: "platform_admin_password_hash",
    AWS_ACCESS_KEY_ID: "storage_access_key",
    AWS_SECRET_ACCESS_KEY: "storage_secret_key",
    GIT_CREDENTIAL_KEY: "git_credential_key",
    MEDIASOUP_TURN_SECRET: "turn_secret",
    MAILBOX_TENANTS_JSON: "mail_tenants_json",
  };
  for (const [key, name] of Object.entries(mappings))
    process.env[key] = secret(name);
  if (process.env.PUSH_ENABLED !== "false") {
    process.env.VAPID_PUBLIC_KEY = secret("vapid_public_key");
    process.env.VAPID_PRIVATE_KEY = secret("vapid_private_key");
  }
  process.env.REDIS_URL = `redis://:${encodeURIComponent(secret("redis_password"))}@redis:6379/0`;
  for (const key of Object.keys(process.env)) {
    if (key.startsWith("MIGRATION_") || key.startsWith("PLATFORM_MIGRATION_"))
      delete process.env[key];
  }
}

const child = spawn(
  process.execPath,
  [mode === "frontend" ? ".output/server/index.mjs" : "dist/main.js"],
  {
    stdio: "inherit",
    env: process.env,
  },
);
for (const signal of ["SIGTERM", "SIGINT"])
  process.on(signal, () => child.kill(signal));
child.on("error", () => {
  console.error("Application process could not start");
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
