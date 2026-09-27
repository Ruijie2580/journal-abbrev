/* 期刊缩写助手 —— 前端交互逻辑
 * 依赖全局对象（由 js/abbreviator.js、js/bib.js 提供）：
 *   ISO4.init(url)           -> Promise，幂等
 *   ISO4.abbreviateMany(ns)  -> [[name, abbr], ...]
 *   BibTool.processBib(text) -> { text, report }，report 行 [key, 原名, 缩写, 状态]
 */
(function () {
  'use strict';

  var STORAGE_KEY = 'journal-abbrev-helper.manual.v1';

  /* ---------- DOM 引用 ---------- */
  var mask, maskSpinner, maskText, maskErrorMsg, maskRetry;
  var toastContainer;
  var dropzone, fileInput, fileChip, fileChipName, fileChipSize, fileChipRemove;
  var sampleLink, convertBtn, resultCard, reportSummary, reportBody, downloadBtn;
  var manualInput, addBtn, copyAllBtn, exportBtn, clearBtn;
  var manualCount, manualEmpty, manualTableWrap, manualBody;

  /* ---------- 状态 ---------- */
  var ltwaReady = false;
  var bibState = { fileName: '', text: '', converted: '' };
  var manualRows = [];

  function $(id) { return document.getElementById(id); }

  function grabDom() {
    mask = $('loading-mask');
    maskSpinner = $('mask-spinner');
    maskText = $('mask-text');
    maskErrorMsg = $('mask-error-msg');
    maskRetry = $('mask-retry');
    toastContainer = $('toast-container');

    dropzone = $('dropzone');
    fileInput = $('file-input');
    fileChip = $('file-chip');
    fileChipName = $('file-chip-name');
    fileChipSize = $('file-chip-size');
    fileChipRemove = $('file-chip-remove');
    sampleLink = $('sample-link');
    convertBtn = $('convert-btn');
    resultCard = $('result-card');
    reportSummary = $('report-summary');
    reportBody = $('report-body');
    downloadBtn = $('download-btn');

    manualInput = $('manual-input');
    addBtn = $('add-btn');
    copyAllBtn = $('copy-all-btn');
    exportBtn = $('export-btn');
    clearBtn = $('clear-btn');
    manualCount = $('manual-count');
    manualEmpty = $('manual-empty');
    manualTableWrap = $('manual-table-wrap');
    manualBody = $('manual-body');
  }

  /* ---------- Toast 通知 ---------- */
  function showToast(message, type) {
    var el = document.createElement('div');
    el.className = 'toast toast-' + (type === 'error' ? 'error' : 'success');
    el.textContent = message;
    toastContainer.appendChild(el);
    requestAnimationFrame(function () { el.classList.add('show'); });
    setTimeout(function () {
      el.classList.remove('show');
      setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 300);
    }, 3200);
  }

  /* ---------- 通用工具 ---------- */
  function formatSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(2) + ' MB';
  }

  function downloadText(text, filename, mime) {
    var blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 100);
  }

  function legacyCopy(text) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.top = '-1000px';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    document.body.removeChild(ta);
    return ok;
  }

  function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      return navigator.clipboard.writeText(text).then(
        function () { return true; },
        function () { return legacyCopy(text); }
      );
    }
    return Promise.resolve(legacyCopy(text));
  }

  function appendCell(tr, text) {
    var td = document.createElement('td');
    td.textContent = text == null ? '' : String(text);
    tr.appendChild(td);
    return td;
  }

  /* ---------- 启动：加载 LTWA 词表 ---------- */
  function setButtonsEnabled(enabled) {
    var btns = document.querySelectorAll('button');
    for (var i = 0; i < btns.length; i++) {
      if (btns[i] === maskRetry) continue;
      btns[i].disabled = !enabled;
    }
  }

  function showMaskLoading() {
    mask.classList.remove('hidden');
    maskSpinner.style.display = '';
    maskText.textContent = '正在加载 LTWA 词表（约 1.4MB）…';
    maskErrorMsg.hidden = true;
    maskRetry.hidden = true;
  }

  function showMaskError(msg) {
    maskSpinner.style.display = 'none';
    maskText.textContent = 'LTWA 词表加载失败';
    maskErrorMsg.textContent = msg || '未知错误';
    maskErrorMsg.hidden = false;
    maskRetry.hidden = false;
  }

  function initLtwa() {
    showMaskLoading();
    setButtonsEnabled(false);
    var p;
    try {
      if (typeof ISO4 === 'undefined' || typeof ISO4.init !== 'function') {
        throw new Error('缩写引擎脚本未正确加载（js/abbreviator.js）');
      }
      p = ISO4.init('data/ltwa.json');
    } catch (err) {
      showMaskError(err && err.message ? err.message : String(err));
      return;
    }
    Promise.resolve(p).then(function () {
      ltwaReady = true;
      mask.classList.add('hidden');
      setButtonsEnabled(true);
    }).catch(function (err) {
      showMaskError(err && err.message ? err.message : String(err));
    });
  }

  /* ---------- Tab 切换 ---------- */
  function bindTabs() {
    var btns = document.querySelectorAll('.tab-btn');
    var panels = document.querySelectorAll('.tab-panel');
    Array.prototype.forEach.call(btns, function (btn) {
      btn.addEventListener('click', function () {
        var target = 'tab-' + btn.getAttribute('data-tab');
        Array.prototype.forEach.call(btns, function (b) {
          var active = b === btn;
          b.classList.toggle('active', active);
          b.setAttribute('aria-selected', active ? 'true' : 'false');
        });
        Array.prototype.forEach.call(panels, function (p) {
          p.classList.toggle('active', p.id === target);
        });
      });
    });
  }

  /* ---------- Bib 文件转换 ---------- */
  function readFileText(file) {
    return file.arrayBuffer().then(function (buf) {
      var bytes = new Uint8Array(buf);
      try {
        return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch (e) {
        try { return new TextDecoder('gbk').decode(bytes); }
        catch (e2) { return new TextDecoder('utf-8').decode(bytes); }
      }
    });
  }

  function setBibSource(fileName, text, sizeLabel) {
    bibState.fileName = fileName;
    bibState.text = text;
    bibState.converted = '';
    fileChipName.textContent = fileName;
    fileChipSize.textContent = sizeLabel || '';
    fileChip.hidden = false;
    resultCard.hidden = true;
  }

  function clearBibSource() {
    bibState.fileName = '';
    bibState.text = '';
    bibState.converted = '';
    fileChip.hidden = true;
    resultCard.hidden = true;
    fileInput.value = '';
  }

  function acceptFile(file) {
    if (!file) return;
    if (!/\.bib$/i.test(file.name)) {
      showToast('仅支持 .bib 文件，请重新选择。', 'error');
      return;
    }
    readFileText(file).then(function (text) {
      setBibSource(file.name, text, formatSize(file.size));
      showToast('已读取文件：' + file.name, 'success');
    }).catch(function () {
      showToast('文件读取失败，请重试。', 'error');
    });
  }

  function statusBadgeClass(status) {
    if (status === '已缩写') return 'status-abbreviated';
    if (status === '未变化') return 'status-unchanged';
    return 'status-skipped';
  }

  function renderReport(report) {
    reportBody.innerHTML = '';
    var counts = { '已缩写': 0, '未变化': 0, '无 journal 字段（跳过）': 0 };
    report.forEach(function (row) {
      var status = row[3] || '';
      if (Object.prototype.hasOwnProperty.call(counts, status)) counts[status]++;
      var tr = document.createElement('tr');
      appendCell(tr, row[0]);
      appendCell(tr, row[1] || '—');
      appendCell(tr, row[2] || '—');
      var badge = document.createElement('span');
      badge.className = 'status-badge ' + statusBadgeClass(status);
      badge.textContent = status;
      appendCell(tr, '').appendChild(badge);
      reportBody.appendChild(tr);
    });
    reportSummary.textContent = '共 ' + report.length + ' 个条目：已缩写 ' + counts['已缩写'] +
      ' · 未变化 ' + counts['未变化'] + ' · 跳过 ' + counts['无 journal 字段（跳过）'];
    resultCard.hidden = false;
    resultCard.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function convertBib() {
    if (!bibState.text) {
      showToast('请先选择或载入一个 .bib 文件。', 'error');
      return;
    }
    var result;
    try {
      result = BibTool.processBib(bibState.text);
    } catch (err) {
      resultCard.hidden = true;
      showToast('转换失败：' + (err && err.message ? err.message : '未知错误'), 'error');
      return;
    }
    bibState.converted = result.text;
    renderReport(result.report || []);
    showToast('转换完成，共处理 ' + (result.report ? result.report.length : 0) + ' 个条目。', 'success');
  }

  function downloadBib() {
    if (!bibState.converted) {
      showToast('请先完成转换再下载。', 'error');
      return;
    }
    var base = bibState.fileName ? bibState.fileName.replace(/\.bib$/i, '') : 'references';
    var name = base + '_abbreviated.bib';
    downloadText(bibState.converted, name, 'text/plain;charset=utf-8');
    showToast('已开始下载 ' + name + '。', 'success');
  }

  function bindBibEvents() {
    dropzone.addEventListener('click', function () { fileInput.click(); });
    dropzone.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        fileInput.click();
      }
    });
    ['dragenter', 'dragover'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.add('dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      dropzone.addEventListener(evt, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dropzone.classList.remove('dragover');
      });
    });
    dropzone.addEventListener('drop', function (e) {
      var files = e.dataTransfer && e.dataTransfer.files;
      acceptFile(files && files[0]);
    });
    // 防止文件拖到页面其他位置时浏览器直接打开
    ['dragover', 'drop'].forEach(function (evt) {
      window.addEventListener(evt, function (e) { e.preventDefault(); });
    });

    fileInput.addEventListener('change', function () {
      acceptFile(fileInput.files && fileInput.files[0]);
      fileInput.value = '';
    });

    fileChipRemove.addEventListener('click', clearBibSource);

    sampleLink.addEventListener('click', function (e) {
      e.preventDefault();
      fetch('sample.bib').then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.text();
      }).then(function (text) {
        setBibSource('sample.bib', text, formatSize(new Blob([text]).size));
        showToast('已载入示例文件，点击「开始转换」查看效果。', 'success');
      }).catch(function () {
        showToast('示例文件加载失败，请检查 sample.bib 是否存在。', 'error');
      });
    });

    convertBtn.addEventListener('click', convertBib);
    downloadBtn.addEventListener('click', downloadBib);
  }

  /* ---------- 手动输入 ---------- */
  function loadManualRows() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      if (!Array.isArray(arr)) return [];
      return arr
        .filter(function (r) { return Array.isArray(r) && r.length >= 2; })
        .map(function (r) { return [String(r[0]), String(r[1])]; });
    } catch (e) {
      return [];
    }
  }

  function saveManualRows() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(manualRows));
    } catch (e) { /* 存储不可用时静默降级，仅失去持久化 */ }
  }

  function renderManual() {
    manualBody.innerHTML = '';
    manualRows.forEach(function (row, idx) {
      var tr = document.createElement('tr');
      appendCell(tr, String(idx + 1));
      appendCell(tr, row[0]);
      appendCell(tr, row[1]);
      var btn = document.createElement('button');
      btn.className = 'row-copy';
      btn.type = 'button';
      btn.textContent = '复制';
      btn.disabled = !ltwaReady;
      btn.addEventListener('click', function () {
        copyText(row[1]).then(function (ok) {
          showToast(ok ? '已复制缩写：' + row[1] : '复制失败，请手动选择文本复制。',
            ok ? 'success' : 'error');
        });
      });
      appendCell(tr, '').appendChild(btn);
      manualBody.appendChild(tr);
    });
    var has = manualRows.length > 0;
    manualEmpty.hidden = has;
    manualTableWrap.hidden = !has;
    manualCount.textContent = '共 ' + manualRows.length + ' 条';
  }

  function submitManual() {
    var names = manualInput.value
      .split(/\r?\n/)
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s.length > 0; });
    if (!names.length) {
      showToast('请输入至少一个期刊名（每行一个）。', 'error');
      return;
    }
    var results;
    try {
      results = ISO4.abbreviateMany(names);
    } catch (err) {
      showToast('缩写失败：' + (err && err.message ? err.message : '未知错误'), 'error');
      return;
    }
    results.forEach(function (pair) { manualRows.push([pair[0], pair[1]]); });
    saveManualRows();
    renderManual();
    manualInput.value = '';
    showToast('已生成 ' + results.length + ' 条缩写，结果已追加到列表。', 'success');
  }

  function bindManualEvents() {
    addBtn.addEventListener('click', submitManual);
    manualInput.addEventListener('keydown', function (e) {
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
        e.preventDefault();
        submitManual();
      }
    });

    clearBtn.addEventListener('click', function () {
      if (!manualRows.length) {
        showToast('列表已经是空的。', 'error');
        return;
      }
      manualRows = [];
      saveManualRows();
      renderManual();
      showToast('列表已清空。', 'success');
    });

    exportBtn.addEventListener('click', function () {
      if (!manualRows.length) {
        showToast('列表为空，没有可导出的内容。', 'error');
        return;
      }
      var text = manualRows.map(function (r) { return r[0] + '\t' + r[1]; }).join('\n') + '\n';
      downloadText(text, 'journal_abbreviations.txt', 'text/plain;charset=utf-8');
      showToast('已导出 journal_abbreviations.txt。', 'success');
    });

    copyAllBtn.addEventListener('click', function () {
      if (!manualRows.length) {
        showToast('列表为空，没有可复制的内容。', 'error');
        return;
      }
      var text = manualRows.map(function (r) { return r[0] + '\t' + r[1]; }).join('\n');
      copyText(text).then(function (ok) {
        showToast(ok ? '已复制全部 ' + manualRows.length + ' 条记录。' : '复制失败，请手动选择文本复制。',
          ok ? 'success' : 'error');
      });
    });
  }

  /* ---------- 启动 ---------- */
  function start() {
    grabDom();
    bindTabs();
    bindBibEvents();
    bindManualEvents();
    maskRetry.addEventListener('click', initLtwa);
    manualRows = loadManualRows();
    renderManual();
    initLtwa();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
