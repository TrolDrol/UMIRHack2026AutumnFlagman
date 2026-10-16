import { spawnSync } from "node:child_process";
const result = spawnSync(
  process.execPath,
  ["node_modules/@playwright/test/cli.js", "test"],
  { stdio: "inherit", env: { ...process.env, FLAGMAN_DEMO_TESTS: "1" } },
);
process.exit(result.status ?? 1);
