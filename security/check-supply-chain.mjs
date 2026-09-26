#!/usr/bin/env node
import fs from "node:fs";
import crypto from "node:crypto";
import process from "node:process";

const file = process.argv[2] || "index.html";
const html = fs.readFileSync(file, "utf8");

const APPROVED_FIREBASE_VERSION = "10.14.1";
const APPROVED_DYNAMIC_MODULES = new Set([
  `https://www.gstatic.com/firebasejs/${APPROVED_FIREBASE_VERSION}/firebase-app.js`,
  `https://www.gstatic.com/firebasejs/${APPROVED_FIREBASE_VERSION}/firebase-app-check.js`,
]);
const APPROVED_SCRIPT_ORIGINS = new Set([
  "https://www.gstatic.com",
  "https://www.google.com",
  "https://apis.google.com",
]);

const errors = [];
const info = [];

function fail(msg) { errors.push(msg); }
function ok(msg) { info.push(msg); }

// Extract the CSP meta tag first, then its content attribute.
const cspTagMatch = html.match(
  /<meta\b[^>]*http-equiv=(?:"Content-Security-Policy"|'Content-Security-Policy')[^>]*>/i
);
if (!cspTagMatch) {
  fail("CSP meta tag が見つかりません");
} else {
  const tag = cspTagMatch[0];
  const contentMatch =
    tag.match(/\bcontent="([^"]*)"/i) ||
    tag.match(/\bcontent='([^']*)'/i);

  if (!contentMatch) {
    fail("CSP content 属性が読み取れません");
  } else {
    const csp = contentMatch[1];

    if (csp.includes("'unsafe-inline'")) fail("CSPに unsafe-inline が含まれています");
    if (csp.includes("'unsafe-eval'")) fail("CSPに unsafe-eval が含まれています");
    if (!/script-src-attr\s+'none'/.test(csp)) fail("script-src-attr 'none' がありません");

    const scriptSrcDirective = csp.match(/(?:^|;\s*)script-src\s+([^;]+)/);
    if (!scriptSrcDirective) {
      fail("script-src ディレクティブがありません");
    } else {
      const scriptSrc = scriptSrcDirective[1];

      // Inline script hashes
      const inlineScripts = [];
      const scriptRe = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
      let m;
      while ((m = scriptRe.exec(html))) {
        const attrs = m[1] || "";
        const body = m[2] || "";
        const src = attrs.match(/\bsrc=["']([^"']+)["']/i);
        if (!src) inlineScripts.push(body);
      }

      const computed = inlineScripts.map((body) =>
        `'sha256-${crypto.createHash("sha256").update(body, "utf8").digest("base64")}'`
      );

      for (const h of computed) {
        if (!scriptSrc.includes(h)) {
          fail(`CSPにインラインスクリプトのハッシュがありません: ${h}`);
        }
      }
      ok(`インラインスクリプト ${computed.length} 本のCSPハッシュを確認`);

      // External <script src>
      const externalScriptRe = /<script\b[^>]*\bsrc=["'](https:\/\/[^"']+)["'][^>]*>/gi;
      while ((m = externalScriptRe.exec(html))) {
        const url = new URL(m[1]);
        if (!APPROVED_SCRIPT_ORIGINS.has(url.origin)) {
          fail(`未承認の外部script src: ${m[1]}`);
        }
      }
    }
  }
}

// Dynamic imports
const importRe = /import\(\s*["'](https:\/\/[^"']+)["']\s*\)/g;
const dynamicImports = new Set();
let im;
while ((im = importRe.exec(html))) dynamicImports.add(im[1]);

for (const url of dynamicImports) {
  if (url.includes("www.gstatic.com/firebasejs/")) {
    if (!APPROVED_DYNAMIC_MODULES.has(url)) {
      fail(`未承認またはバージョン変更されたFirebase CDN module: ${url}`);
    }
  } else {
    fail(`未承認の外部dynamic import: ${url}`);
  }
}

for (const required of APPROVED_DYNAMIC_MODULES) {
  if (!dynamicImports.has(required)) {
    fail(`必須Firebase moduleが見つかりません: ${required}`);
  }
}
ok(`Firebase CDN version: ${APPROVED_FIREBASE_VERSION}`);

if (errors.length) {
  console.error("❌ Supply Chain Security check failed");
  for (const e of errors) console.error(` - ${e}`);
  process.exit(1);
}

console.log("✅ Supply Chain Security check passed");
for (const i of info) console.log(` - ${i}`);
