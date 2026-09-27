#!/usr/bin/env node
import fs from "node:fs";
import process from "node:process";

const files = process.argv.slice(2);
if (!files.length) files.push("index.html", "sw.js", "finance-core.mjs");
let failed = false;
for (const file of files) {
  const text = fs.readFileSync(file, "utf8");
  if (text.includes("\r")) {
    console.error(`❌ ${file}: CRLF/CR を検出しました。配布ファイルは LF 固定です。`);
    failed = true;
  } else {
    console.log(`✅ ${file}: LF only`);
  }
}
if (failed) process.exit(1);
