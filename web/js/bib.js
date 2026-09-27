/*
 * BibTool：浏览器端 BibTeX journal 字段缩写替换器。
 * 字节级保留改写——除 journal 字段的值本体以外，输入文本的其余一切
 * （缩进、空白、注释、@preamble、@string、字段顺序、条目顺序）原样不动。
 * 暴露浏览器全局 BibTool，并双兼容 Node（module.exports）。
 */
(function (global) {
  'use strict';

  var STATUS_ABBREVIATED = '已缩写';
  var STATUS_UNCHANGED = '未变化';
  var STATUS_NO_JOURNAL = '无 journal 字段（跳过）';
  var PARSE_ERROR = '未解析到任何 bib 条目，请检查文件格式是否正确。';
  var SKIP_TYPES = { comment: true, preamble: true, string: true };

  function resolveISO4() {
    if (typeof ISO4 !== 'undefined') return ISO4;
    if (typeof module !== 'undefined' && typeof require === 'function') {
      try { return require('./abbreviator.js'); } catch (e) { return null; }
    }
    return null;
  }

  // 在 [start, end) 内寻找满足 pred 的顶层字符：忽略 {...} 嵌套内部、
  // "..." 字符串内部以及反斜杠转义字符。找到返回下标，否则 -1。
  function findTopLevel(text, start, end, pred) {
    var depth = 0;
    var inStr = false;
    for (var i = start; i < end; i++) {
      var c = text.charAt(i);
      if (c === '\\') { i++; continue; }
      if (inStr) { if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') { depth++; continue; }
      if (c === '}') { if (depth > 0) depth--; continue; }
      if (depth === 0 && pred(c)) return i;
    }
    return -1;
  }

  // 从 openIdx（'{' 所在位置）找与其匹配的 '}'，规则同上。未闭合返回 -1。
  function findMatchingBrace(text, openIdx) {
    var depth = 0;
    var inStr = false;
    for (var i = openIdx; i < text.length; i++) {
      var c = text.charAt(i);
      if (c === '\\') { i++; continue; }
      if (inStr) { if (c === '"') inStr = false; continue; }
      if (c === '"') { inStr = true; continue; }
      if (c === '{') depth++;
      else if (c === '}') { depth--; if (depth === 0) return i; }
    }
    return -1;
  }

  function isSpace(c) {
    return c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === '\f' || c === '\v';
  }

  function isLetter(c) {
    return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z');
  }

  function isComma(c) { return c === ','; }
  function isEquals(c) { return c === '='; }
  function isHash(c) { return c === '#'; }

  // 解析单个字段片段 [start, end)。若是 journal 字段则按需登记替换并
  // 写入报告，返回 true；否则返回 false。
  function handleFieldPiece(text, start, end, key, iso, replacements, report) {
    var eq = findTopLevel(text, start, end, isEquals);
    if (eq === -1) return false;
    var name = text.slice(start, eq).trim().toLowerCase();
    if (name !== 'journal') return false;

    var vStart = eq + 1;
    var vEnd = end;
    while (vStart < vEnd && isSpace(text.charAt(vStart))) vStart++;
    while (vEnd > vStart && isSpace(text.charAt(vEnd - 1))) vEnd--;
    var raw = text.slice(vStart, vEnd);

    // 顶层含 # 连接符的值不改动，按“未变化”计。
    if (findTopLevel(raw, 0, raw.length, isHash) !== -1) {
      report.push([key, raw, raw, STATUS_UNCHANGED]);
      return true;
    }

    // 仅处理 {...}（可嵌套）与 "..." 两种包裹形式；裸值（宏名/数字等）不改动。
    var innerS = -1;
    var innerE = -1;
    var open = raw.charAt(0);
    if (open === '{') {
      if (findMatchingBrace(raw, 0) === raw.length - 1) {
        innerS = vStart + 1;
        innerE = vEnd - 1;
      }
    } else if (open === '"') {
      if (raw.length >= 2 && raw.charAt(raw.length - 1) === '"') {
        innerS = vStart + 1;
        innerE = vEnd - 1;
      }
    }
    if (innerS === -1) {
      report.push([key, raw, raw, STATUS_UNCHANGED]);
      return true;
    }

    // 只替换值本体，保留包裹风格与其内外空白。
    while (innerS < innerE && isSpace(text.charAt(innerS))) innerS++;
    while (innerE > innerS && isSpace(text.charAt(innerE - 1))) innerE--;
    var original = text.slice(innerS, innerE);
    var abbr = original.length > 0 ? iso.abbreviate(original) : '';
    if (abbr !== original) {
      replacements.push([innerS, innerE, abbr]);
      report.push([key, original, abbr, STATUS_ABBREVIATED]);
    } else {
      report.push([key, original, abbr, STATUS_UNCHANGED]);
    }
    return true;
  }

  // 尝试在 atIdx（'@' 所在位置）解析一个 @type{...} 块。
  // 不是合法块起始时返回 null；否则返回 { next, counted }。
  function parseEntryAt(text, atIdx, iso, replacements, report) {
    var n = text.length;
    var j = atIdx + 1;
    var typeStart = j;
    while (j < n && isLetter(text.charAt(j))) j++;
    if (j === typeStart) return null;
    var type = text.slice(typeStart, j).toLowerCase();
    while (j < n && isSpace(text.charAt(j))) j++;
    if (text.charAt(j) !== '{') return null;
    var closeIdx = findMatchingBrace(text, j);
    if (closeIdx === -1) throw new Error(PARSE_ERROR);

    if (SKIP_TYPES[type]) return { next: closeIdx + 1, counted: false };

    var innerStart = j + 1;
    var comma = findTopLevel(text, innerStart, closeIdx, isComma);
    var key = text.slice(innerStart, comma === -1 ? closeIdx : comma).trim();
    var pieceStart = comma === -1 ? closeIdx : comma + 1;

    var found = false;
    while (pieceStart < closeIdx && !found) {
      var pieceEnd = findTopLevel(text, pieceStart, closeIdx, isComma);
      if (pieceEnd === -1) pieceEnd = closeIdx;
      found = handleFieldPiece(text, pieceStart, pieceEnd, key, iso, replacements, report);
      pieceStart = pieceEnd + 1;
    }
    if (!found) report.push([key, '', '', STATUS_NO_JOURNAL]);
    return { next: closeIdx + 1, counted: true };
  }

  function processBib(input) {
    if (typeof input !== 'string' || input.length === 0) {
      throw new Error(PARSE_ERROR);
    }
    var iso = resolveISO4();
    if (!iso || typeof iso.abbreviate !== 'function') {
      throw new Error('ISO4 缩写模块未加载：请先加载 js/abbreviator.js 并等待 ISO4.init() 完成。');
    }

    var replacements = [];
    var report = [];
    var entryCount = 0;
    var i = 0;
    var n = input.length;
    while (i < n) {
      if (input.charAt(i) !== '@') { i++; continue; }
      var parsed = parseEntryAt(input, i, iso, replacements, report);
      if (!parsed) { i++; continue; }
      if (parsed.counted) entryCount++;
      i = parsed.next;
    }
    if (entryCount === 0) throw new Error(PARSE_ERROR);

    // 替换区间按扫描顺序递增，自后向前套用则原下标始终有效。
    var out = input;
    for (var k = replacements.length - 1; k >= 0; k--) {
      var r = replacements[k];
      out = out.slice(0, r[0]) + r[2] + out.slice(r[1]);
    }
    return { text: out, report: report };
  }

  var BibTool = { processBib: processBib };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = BibTool;
  }
  global.BibTool = BibTool;
})(typeof window !== 'undefined' ? window : globalThis);
