import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

for (const [key, name] of Object.entries({
  MIGRATION_POSTGRES_PASSWORD: "data_migrator_password",
  PLATFORM_MIGRATION_POSTGRES_PASSWORD: "platform_migrator_password",
})) {
  const value = readFileSync(`/run/secrets/${name}`, "utf8").trim();
  if (!value) throw new Error(`Required migration secret is empty: ${name}`);
  process.env[key] = value;
}

// This job owns schema changes. The backend neither mounts these secrets nor
// executes migrations. A fresh preproduction is provisioned via platform API.
for (const source of [
  "dist/data-source.js",
  "dist/platform/platform-data-source.js",
  "dist/tenant-data-source.js",
]) {
  const transactionMode =
    source === "dist/tenant-data-source.js" ? "all" : "each";
  const result = spawnSync(
    process.execPath,
    [
      "node_modules/typeorm/cli.js",
      "-d",
      source,
      "migration:run",
      "--transaction",
      transactionMode,
    ],
    {
      stdio: "inherit",
      env: process.env,
    },
  );
  if (result.error || result.status !== 0) process.exit(result.status || 1);
}
