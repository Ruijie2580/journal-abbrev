/*
 * bib.js 的 Node 测试。运行：node web/tests/bib.test.cjs
 * 控制台兼容 GBK：输出只使用 ASCII 标记（[PASS] / [FAIL]），
 * 失败详情中的非 ASCII 字符一律替换为 '?' 后再打印。
 */
'use strict';

const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ISO4 = require('../js/abbreviator.js');
const BibTool = require('../js/bib.js');

let passed = 0;
let failed = 0;

function ascii(s) {
  return String(s == null ? '' : s).replace(/[^\x20-\x7E]/g, '?');
}

function check(name, fn) {
  try {
    fn();
    passed++;
    console.log('[PASS] ' + name);
  } catch (e) {
    failed++;
    console.log('[FAIL] ' + name + ' :: ' + ascii(e && e.message));
  }
}

function expectParseError(fn) {
  assert.throws(fn, (e) => e && e.message === '未解析到任何 bib 条目，请检查文件格式是否正确。');
}

async function main() {
  // Windows 上 path.join 产生反斜杠，abbreviator.js 按 '/' 切分目录，故统一为正斜杠路径。
  const ltwaPath = path.join(__dirname, '..', 'data', 'ltwa.json').replace(/\\/g, '/');
  await ISO4.init(ltwaPath);

  check('sample.bib: report content and order', () => {
    const sample = fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'sample.bib'), 'utf8');
    const res = BibTool.processBib(sample);
    assert.deepStrictEqual(res.report, [
      ['smith2020jacs', 'Journal of the American Chemical Society', 'J. Am. Chem. Soc.', '已缩写'],
      ['wang2021natcommun', 'Nature Communications', 'Nat. Commun.', '已缩写'],
      ['zhang2019prl', 'Physical Review Letters', 'Phys. Rev. Lett.', '已缩写'],
      ['doe2018book', '', '', '无 journal 字段（跳过）'],
      ['liu2022conf', '', '', '无 journal 字段（跳过）'],
      ['nojournal2023', '', '', '无 journal 字段（跳过）'],
    ]);
  });

  check('sample.bib: byte-identical except journal values', () => {
    const sample = fs.readFileSync(path.join(__dirname, '..', '..', 'tests', 'sample.bib'), 'utf8');
    const res = BibTool.processBib(sample);
    const expected = sample
      .replace('journal = {Journal of the American Chemical Society}', 'journal = {J. Am. Chem. Soc.}')
      .replace('journal = {Nature Communications}', 'journal = {Nat. Commun.}')
      .replace('journal = {Physical Review Letters}', 'journal = {Phys. Rev. Lett.}');
    assert.strictEqual(res.text, expected);
  });

  check('uppercase JOURNAL field name is processed', () => {
    const src = '@article{k1,\n  JOURNAL = {Physical Review Letters},\n  year = {2000}\n}\n';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, '@article{k1,\n  JOURNAL = {Phys. Rev. Lett.},\n  year = {2000}\n}\n');
    assert.deepStrictEqual(res.report, [['k1', 'Physical Review Letters', 'Phys. Rev. Lett.', '已缩写']]);
  });

  check('journal={...} without spaces keeps compact style', () => {
    const src = '@article{k2,journal={Nature Communications},year={2021}}';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, '@article{k2,journal={Nat. Commun.},year={2021}}');
    assert.deepStrictEqual(res.report, [['k2', 'Nature Communications', 'Nat. Commun.', '已缩写']]);
  });

  check('nested braces in title do not break parsing', () => {
    const src = '@article{k3,\n'
      + '  title = {Study of {Bcl-2} Family {Proteins}},\n'
      + '  journal = {Physical Review Letters},\n'
      + '  note = "Braces {inside} quotes {stay} put"\n'
      + '}';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, '@article{k3,\n'
      + '  title = {Study of {Bcl-2} Family {Proteins}},\n'
      + '  journal = {Phys. Rev. Lett.},\n'
      + '  note = "Braces {inside} quotes {stay} put"\n'
      + '}');
  });

  check('double-quoted journal value keeps quote style', () => {
    const src = '@article{k4,\n  journal = "Physical Review Letters",\n  year = {2019}\n}';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, '@article{k4,\n  journal = "Phys. Rev. Lett.",\n  year = {2019}\n}');
    assert.deepStrictEqual(res.report, [['k4', 'Physical Review Letters', 'Phys. Rev. Lett.', '已缩写']]);
  });

  check('top-level # concatenated value is left unchanged', () => {
    const src = '@string{jacs = {Journal of the American Chemical Society}}\n'
      + '\n'
      + '@article{k5,\n  journal = jacs # " 2020",\n  year = {2020}\n}\n';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, src);
    assert.deepStrictEqual(res.report, [['k5', 'jacs # " 2020"', 'jacs # " 2020"', '未变化']]);
  });

  check('@preamble / @comment / @string pass through and are not reported', () => {
    const src = '@preamble{"\\newcommand{\\noopsort}[1]{}"}\n'
      + '@comment{journal = {This Must Not Change}}\n'
      + '@string{nc = {Nature Communications}}\n'
      + '@article{k6, journal = {Nature Communications}}';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, '@preamble{"\\newcommand{\\noopsort}[1]{}"}\n'
      + '@comment{journal = {This Must Not Change}}\n'
      + '@string{nc = {Nature Communications}}\n'
      + '@article{k6, journal = {Nat. Commun.}}');
    assert.deepStrictEqual(res.report, [['k6', 'Nature Communications', 'Nat. Commun.', '已缩写']]);
  });

  check('single-word journal that stays the same is reported unchanged', () => {
    const src = '@article{k7, journal = {Nature}}';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, src);
    assert.deepStrictEqual(res.report, [['k7', 'Nature', 'Nature', '未变化']]);
  });

  check('inner whitespace around value is preserved', () => {
    const src = '@article{k8, journal = {  Nature Communications  } }';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, '@article{k8, journal = {  Nat. Commun.  } }');
  });

  check('CRLF line endings are preserved', () => {
    const src = '@article{k9,\r\n  journal = {Nature Communications},\r\n  year = {2021}\r\n}\r\n';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, '@article{k9,\r\n  journal = {Nat. Commun.},\r\n  year = {2021}\r\n}\r\n');
  });

  check('bare macro value is not touched', () => {
    const src = '@article{k10, journal = jacs}';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, src);
    assert.deepStrictEqual(res.report, [['k10', 'jacs', 'jacs', '未变化']]);
  });

  check('entry without comma after key reports no journal field', () => {
    const src = '@misc{k11}';
    const res = BibTool.processBib(src);
    assert.strictEqual(res.text, src);
    assert.deepStrictEqual(res.report, [['k11', '', '', '无 journal 字段（跳过）']]);
  });

  check('empty string input throws', () => {
    expectParseError(() => BibTool.processBib(''));
  });

  check('whitespace-only input throws', () => {
    expectParseError(() => BibTool.processBib('   \n\t  '));
  });

  check('pure garbage text throws', () => {
    expectParseError(() => BibTool.processBib('this is @@ not a bib { [ ] } file at all'));
  });

  check('unbalanced braces throw', () => {
    expectParseError(() => BibTool.processBib('@article{k12, journal = {Nature Communications}'));
  });

  check('file with only @string / @comment blocks throws', () => {
    expectParseError(() => BibTool.processBib('@string{a = {x}}\n@comment{hello}'));
  });

  check('non-string input throws', () => {
    expectParseError(() => BibTool.processBib(null));
    expectParseError(() => BibTool.processBib(undefined));
    expectParseError(() => BibTool.processBib(42));
  });

  console.log('---');
  console.log('total: ' + (passed + failed) + ', passed: ' + passed + ', failed: ' + failed);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.log('[FATAL] ' + ascii(e && e.stack ? e.stack : e));
  process.exit(1);
});
