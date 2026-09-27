#!/usr/bin/env node
/*
 * web/tests/abbreviator.test.cjs
 * 逐条比对 web/js/abbreviator.js 与 Python iso4 黄金集（golden.json）的输出。
 * 通过标准：4 个基准用例 100% 一致，且黄金集整体一致率 >= 98%（目标 100%）。
 * stdout 仅使用 ASCII 标记（[PASS]/[FAIL] 等），非 ASCII 内容转义为 \uXXXX。
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ISO4 = require(path.join(__dirname, '..', 'js', 'abbreviator.js'));

const BENCHMARKS = [
  ['Journal of the American Chemical Society', 'J. Am. Chem. Soc.'],
  ['Physical Review Letters', 'Phys. Rev. Lett.'],
  ['Angewandte Chemie International Edition', 'Angew. Chem. Int. Ed.'],
  ['Nature Communications', 'Nat. Commun.']
];

function ascii(s) {
  return String(s).replace(/[^\x00-\x7F]/g, (c) => {
    const hex = c.codePointAt(0).toString(16).padStart(4, '0');
    return '\\u' + hex;
  });
}

(async () => {
  let failures = 0;

  // init 幂等性：连续调用两次应都成功
  await ISO4.init();
  await ISO4.init();
  await ISO4.init('data/ltwa.json');
  console.log('[PASS] ISO4.init idempotent (Node fs path)');

  // 1) 基准用例（硬编码期望值，必须 100% 一致）
  let benchFail = 0;
  for (const [name, expected] of BENCHMARKS) {
    const got = ISO4.abbreviate(name);
    if (got === expected) {
      console.log(`[PASS] benchmark: ${ascii(name)} => ${ascii(got)}`);
    } else {
      benchFail++;
      console.log(`[FAIL] benchmark: ${ascii(name)} => ${ascii(got)} (expected ${ascii(expected)})`);
    }
  }

  // 单词标题原样返回
  const single = ISO4.abbreviate('Nature');
  if (single === 'Nature') {
    console.log('[PASS] single-word title: Nature => Nature');
  } else {
    benchFail++;
    console.log(`[FAIL] single-word title: Nature => ${ascii(single)} (expected Nature)`);
  }

  // 2) 黄金集逐条比对
  const goldenPath = path.join(__dirname, 'golden.json');
  const golden = JSON.parse(fs.readFileSync(goldenPath, 'utf8'));
  let pass = 0;
  const diffs = [];
  for (const [name, expected] of golden) {
    let got;
    try {
      got = ISO4.abbreviate(name);
    } catch (err) {
      got = '<THROW> ' + err.message;
    }
    if (got === expected) {
      pass++;
    } else {
      diffs.push([name, expected, got]);
    }
  }
  const total = golden.length;
  const rate = pass / total;
  console.log(`[INFO] golden set: ${pass}/${total} match (${(rate * 100).toFixed(2)}%)`);
  for (const [name, expected, got] of diffs.slice(0, 30)) {
    console.log(`[DIFF] ${ascii(name)}`);
    console.log(`       expected: ${ascii(expected)}`);
    console.log(`       got:      ${ascii(got)}`);
  }
  if (diffs.length > 30) {
    console.log(`[INFO] ... and ${diffs.length - 30} more diffs`);
  }

  // 3) abbreviateMany 契约：[[name, abbr], ...]
  const many = ISO4.abbreviateMany(['Nature Communications', 'Nature']);
  if (Array.isArray(many) && many.length === 2 &&
      many[0][0] === 'Nature Communications' && many[0][1] === 'Nat. Commun.' &&
      many[1][0] === 'Nature' && many[1][1] === 'Nature') {
    console.log('[PASS] ISO4.abbreviateMany contract');
  } else {
    failures++;
    console.log('[FAIL] ISO4.abbreviateMany contract: ' + ascii(JSON.stringify(many)));
  }

  // 4) 浏览器 fetch 分支（在 Node 中模拟 window + fetch 验证）
  {
    const savedWindow = globalThis.window;
    const savedFetch = globalThis.fetch;
    const modPath = path.join(__dirname, '..', 'js', 'abbreviator.js');
    delete require.cache[require.resolve(modPath)];
    globalThis.window = {};
    globalThis.fetch = async (url) => {
      const p = path.join(__dirname, '..', url);   // url 形如 'data/...'
      if (!fs.existsSync(p)) return { ok: false, status: 404 };
      const buf = fs.readFileSync(p);
      return {
        ok: true, status: 200,
        json: async () => JSON.parse(buf.toString('utf8')),
        text: async () => buf.toString('utf8')
      };
    };
    let browserOk = false;
    try {
      const ISO4Browser = require(modPath);
      await ISO4Browser.init('data/ltwa.json');   // 走 fetch 分支
      browserOk =
        ISO4Browser.abbreviate('Nature Communications') === 'Nat. Commun.' &&
        ISO4Browser.abbreviate('Physical Review Letters') === 'Phys. Rev. Lett.' &&
        globalThis.window.ISO4 === ISO4Browser;   // 全局对象挂在 window 上
    } catch (err) {
      console.log('[FAIL] browser fetch path: ' + ascii(err && err.stack || err));
    } finally {
      globalThis.window = savedWindow;
      globalThis.fetch = savedFetch;
      delete require.cache[require.resolve(modPath)];
    }
    if (browserOk) {
      console.log('[PASS] browser fetch path (window/fetch simulated)');
    } else {
      failures++;
      console.log('[FAIL] browser fetch path');
    }
  }

  // 5) 汇总判定
  let ok = true;
  if (benchFail > 0) {
    ok = false;
    console.log(`[FAIL] benchmarks: ${benchFail} failed (must be 0)`);
  } else {
    console.log('[PASS] benchmarks: 4/4 + single-word case');
  }
  if (rate < 0.98) {
    ok = false;
    console.log(`[FAIL] golden match rate ${(rate * 100).toFixed(2)}% < 98%`);
  } else if (diffs.length > 0) {
    console.log(`[WARN] golden match rate ${(rate * 100).toFixed(2)}% (>=98% but not 100%)`);
  } else {
    console.log('[PASS] golden set: 100% match');
  }
  if (failures > 0) ok = false;

  console.log(ok ? '[PASS] ALL CHECKS PASSED' : '[FAIL] CHECKS FAILED');
  process.exit(ok ? 0 : 1);
})().catch((err) => {
  console.log('[FAIL] unexpected error: ' + ascii(err && err.stack || err));
  process.exit(1);
});
