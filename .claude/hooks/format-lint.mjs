#!/usr/bin/env node
// Cross-platform PostToolUse hook (no bash/jq needed): formats + lints the file Claude just edited.
// Exit code 2 sends the error text back to Claude so it fixes the problem.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

let input = "";
try { input = readFileSync(0, "utf8"); } catch { process.exit(0); }
let file;
try { file = JSON.parse(input)?.tool_input?.file_path; } catch { process.exit(0); }
if (!file || !existsSync(file)) process.exit(0);

const isWin = process.platform === "win32";
const run = (cmd, args, opts = {}) =>
  execFileSync(isWin ? `${cmd}.cmd` : cmd, args, { stdio: "pipe", encoding: "utf8", ...opts });

const ext = file.split(".").pop().toLowerCase();
const jsLike = ["ts", "tsx", "js", "jsx", "mjs", "cjs"];
const prettierable = [...jsLike, "json", "md", "css"];

if (prettierable.includes(ext)) {
  try { run("npx", ["--no-install", "prettier", "--write", file]); } catch { /* prettier not installed yet */ }
}
if (jsLike.includes(ext)) {
  try {
    run("npx", ["--no-install", "eslint", "--no-warn-ignored", file]);
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    if (/could not determine executable|not found|ENOENT/i.test(out) || !out.trim()) process.exit(0); // eslint not set up yet
    process.stderr.write(`ESLint issues in ${file} — fix before continuing:\n${out}`);
    process.exit(2);
  }
}
if (ext === "py") {
  try {
    execFileSync("uv", ["run", "--directory", "apps/voice-agent", "ruff", "format", file], { stdio: "pipe" });
    execFileSync("uv", ["run", "--directory", "apps/voice-agent", "ruff", "check", file], { stdio: "pipe", encoding: "utf8" });
  } catch (e) {
    const out = `${e.stdout ?? ""}${e.stderr ?? ""}`;
    if (e.code === "ENOENT" || !out.trim()) process.exit(0);
    process.stderr.write(`Ruff issues in ${file}:\n${out}`);
    process.exit(2);
  }
}
process.exit(0);
