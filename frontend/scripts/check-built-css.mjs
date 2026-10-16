import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { resolve, join } from "node:path";

const directory = resolve(process.argv[2] || "dist");
const html = await readFile(join(directory, "index.html"), "utf8");
const sheets = [
  ...html.matchAll(/<link\b[^>]*rel="stylesheet"[^>]*href="([^"]+)"/g),
];
assert(sheets.length, "Built HTML must load a stylesheet");
const css = (
  await Promise.all(
    sheets.map(([, path]) =>
      readFile(join(directory, path.replace(/^\//, "")), "utf8"),
    ),
  )
).join("\n");
assert(
  /:root\s*\{/.test(css),
  "Global root styles were removed from the production build",
);
assert(
  /--ink\s*:\s*#18382d/.test(css),
  "Production CSS is missing the color palette",
);
assert(
  /font-family\s*:\s*Inter/.test(css),
  "Production CSS is missing the application font",
);
console.log("Built CSS: global styles, palette and font are present.");
