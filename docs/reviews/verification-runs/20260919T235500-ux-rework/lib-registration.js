/* 核对「新增 lib/*.js 必须同时改四处」这条约定，并区分「已接线」与「尚未接线」模块。
 *
 * 四处 = index.html 的 <script>、sw.js 的 ASSETS(+缓存版本号)、
 *        test-regressions.js 的 LIB_SOURCES、test-smoke.js 的加载列表。
 *
 * 判据说明（避免误报）：只有**被 index.html 真正加载**的 lib 才属于「已接线」，
 * 才必须四处齐全；只被 test-unit.js / scripts 用 Node require 的模块是「尚未接线」，
 * 四条注册点都还没有意义，但必须在报告里登记，因为一旦接线就会踩同一个坑。
 *
 * 用法：node lib-registration.js   （在仓库根目录下运行；产物写在本文件同目录）
 */
const fs = require("fs");
const path = require("path");

const RUN = __dirname;
const REPO = path.resolve(__dirname, "../../../..");
const read = (p) => fs.readFileSync(path.join(REPO, p), "utf8");

const libs = fs.readdirSync(path.join(REPO, "lib")).filter((f) => f.endsWith(".js")).sort();
const idx = read("index.html");
const sw = read("sw.js");
const smoke = read("test-smoke.js");
const reg = read("test-regressions.js");

// index.html 里真正被 <script src> 加载的 lib
const loaded = new Set(
  [...idx.matchAll(/<script[^>]+src=["']lib\/([^"']+)["']/g)].map((m) => m[1])
);

const rows = libs.map((f) => {
  const key = "lib/" + f;
  const r = {
    file: key,
    wiredInBrowser: loaded.has(f),
    indexHtml: idx.includes(key),
    swAssets: sw.includes(key),
    smoke: smoke.includes(key),
    regressions: reg.includes(key),
  };
  r.complete = r.indexHtml && r.swAssets && r.smoke && r.regressions;
  return r;
});

const wiredGaps = rows.filter((r) => r.wiredInBrowser && !r.complete);
const unwired = rows.filter((r) => !r.wiredInBrowser);

// sw.js ASSETS 是否覆盖所有「已接线」的 lib
const swListed = new Set([...sw.matchAll(/["']\.\/lib\/([^"']+)["']/g)].map((m) => m[1]));
const swMissing = [...loaded].filter((f) => !swListed.has(f)).sort();
const cache = sw.match(/const\s+CACHE\s*=\s*["'`]([^"'`]+)/);

const report = {
  checkedAt: new Date().toISOString(),
  libCount: libs.length,
  wiredInBrowser: [...loaded].sort(),
  unwiredModules: unwired.map((r) => r.file),
  rows,
  wiredGaps,               // 已接线但四处不齐 = 真缺陷
  swAssetsMissing: swMissing, // sw.js ASSETS 漏掉的已接线 lib = 离线首载风险
  swCacheId: cache ? cache[1] : null,
  verdict:
    wiredGaps.length === 0 && swMissing.length === 0
      ? "OK"
      : (wiredGaps.length ? "WIRED_GAP" : "") + (swMissing.length ? " SW_ASSETS_GAP" : ""),
};

fs.writeFileSync(path.join(RUN, "lib-registration.json"), JSON.stringify(report, null, 2));

console.log("已接线 lib:", report.wiredInBrowser.join(", "));
console.log("尚未接线模块:", report.unwiredModules.join(", ") || "(无)");
console.log("四注册点缺口:", wiredGaps.length ? JSON.stringify(wiredGaps.map((r) => r.file)) : "无");
console.log("sw.js ASSETS 漏项:", swMissing.length ? swMissing.join(", ") : "无");
console.log("sw 缓存版本:", report.swCacheId);
console.log("VERDICT:", report.verdict);
