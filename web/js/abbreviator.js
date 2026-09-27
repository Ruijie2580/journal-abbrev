/*
 * ISO4 —— ISO 4 / LTWA 期刊名缩写引擎（浏览器端纯 JS 移植版）
 *
 * 忠实移植自 Python `iso4` 包（abbreviate.py，LTWA 20170914 数据），
 * 名词词形还原移植自 NLTK 3.10.3 的 WordNetLemmatizer（pos='n'，
 * 即 morphy：例外表 + 词尾替换规则 + 词元有效性过滤，取最短词元）。
 *
 * 数据文件（默认与 ltwa.json 同目录）：
 *   - ltwa.json              LTWA 官方词表 {l: {p,s,i,f}, m: [多词短语], c: 冲突表}
 *   - wordnet_noun_exc.json  WordNet noun.exc 例外表 {变形: [词元, ...]}
 *   - wordnet_nouns.txt      WordNet 名词词元集合（index.noun 单词词元，一行一个）
 *
 * 浏览器用法（普通 <script> 标签加载）：
 *   await ISO4.init();                          // 幂等，默认 'data/ltwa.json'
 *   ISO4.abbreviate('Nature Communications');   // => 'Nat. Commun.'
 *   ISO4.abbreviateMany(['Nature', 'Science']);
 *
 * Node 用法（测试）：
 *   const ISO4 = require('../js/abbreviator.js');
 *   await ISO4.init();   // 相对路径自动落到本文件所在目录的 ../data/ 下
 */
(function (global) {
  'use strict';

  var NOT_ABBREVIATED = 'n.a.';
  var PREFIX = 'p', SUFFIX = 's', INFIX = 'i', FULLWORD = 'f';
  var LOWERCASE = 'l', UPPERCASE = 'u', TITLECASE = 't';

  // iso4/stopwords.txt 内容（init 时做 NFKD 归一化，与 Python 端一致）
  var STOPWORDS_RAW = [
    'a', 'about', 'afore', 'after', 'ago', 'along', 'amid', 'among', 'amongst',
    'an', 'and', 'apropos', 'as', 'at', 'atop', 'but', 'by', 'ca', 'circa',
    'for', 'from', 'hence', 'in', 'into', 'like', 'nor', 'of', 'off', 'on',
    'onto', 'ontop', 'or', 'out', 'over', 'per', 'since', 'so', 'than', 'the',
    'though', 'til', 'till', 'to', 'unlike', 'until', 'unto', 'up', 'upon',
    'upside', 'versus', 'via', 'vis-a-vis', 'vs', 'when', 'whenever', 'where',
    'whereas', 'wherever', 'while', 'with', 'within', 'yet',
    // 注意：Python 端以 locale 默认编码（本机 cp936/GBK）读取 UTF-8 的
    // stopwords.txt，'für' 被误读为 'f眉r'，永远不会命中归一化后的
    // 标题词。为与基准实现逐字节一致，此处保留该误读结果。
    'aus', 'des', 'der', 'f\\u7709r', 'im', 'und', 'zu', 'zur',
    'da', 'de', 'del', 'della', 'delle', 'di', 'do', 'e', 'el', 'en', 'et',
    'i', 'la', 'le', 'lo', 'las', 'les', 'los', 'y', 'van', 'voor', 'og'
  ];

  // iso4/stopwords_keep_as_last.txt 内容
  var KEEP_AS_LAST_RAW = ['a', 'e', 'i', 'y'];

  // NLTK MORPHOLOGICAL_SUBSTITUTIONS[NOUN]，顺序敏感
  var NOUN_RULES = [
    ['s', ''], ['ses', 's'], ['ves', 'f'], ['xes', 'x'], ['zes', 'z'],
    ['ches', 'ch'], ['shes', 'sh'], ['men', 'man'], ['ies', 'y']
  ];

  // 冲突表命中时抛出（对应 Python 端无消歧语言时的 Exception，
  // 外层按项目包装器语义兜底返回原始标题）
  function ConflictError(word) {
    this.name = 'ConflictError';
    this.message = 'Ambiguous word in title: ' + word;
  }
  ConflictError.prototype = Object.create(Error.prototype);
  ConflictError.prototype.constructor = ConflictError;

  var LTWA = null;               // {p: {}, s: {}, i: {}, f: {}}
  var CONFLICT_MAP = null;       // {f: {word: {lang: abbr}}}
  var TOKENIZER_REGEX = null;    // 由多词短语表 'm' 构造
  var STOPWORDS = null;
  var KEEP_AS_LAST = null;
  var NOUN_EXC = null;           // {form: [lemma, ...]}
  var NOUN_LEMMAS = null;        // Set(lemma)
  var SORTED_KEYS = null;        // {p: [...], s: [...], i: [...]} 长度降序
  var initPromise = null;

  function has(obj, key) {
    return Object.prototype.hasOwnProperty.call(obj, key);
  }

  // Python 旧版 re.escape 会把空格等非字母数字字符转义（如 'a\ coruña'），
  // 先还原为字面文本，再按 JS 正则语法重新转义。
  function unescapePyRe(term) {
    return term.replace(/\\([\s\S])/g, '$1');
  }
  function escapeJsRe(text) {
    return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function buildTokenizer(multiWordTerms) {
    var parts = multiWordTerms.map(function (raw) {
      return '(?:^|\\s)' + escapeJsRe(unescapePyRe(raw)) + '(?:\\s|$)';
    });
    return new RegExp('(' + parts.join('|') + '|\\s+)', 'iu');
  }

  // 与 Python sorted(keys, key=lambda p: (-len(p), p)) 一致：
  // 码点长度降序，等长按字符串（BMP 内码点序与 UTF-16 序一致）
  function sortKeysLongestFirst(obj) {
    return Object.keys(obj).map(function (k) {
      return { k: k, len: Array.from(k).length };
    }).sort(function (a, b) {
      if (b.len !== a.len) return b.len - a.len;
      return a.k < b.k ? -1 : (a.k > b.k ? 1 : 0);
    }).map(function (e) { return e.k; });
  }

  function normalizeWord(word) {
    // 移植 __normalize_word：按空格分段，去前导连字符与尾部标点，小写，NFKD
    var parts = word.split(' ').map(function (part) {
      var stripped = part.replace(/(^-|\p{P}+$)/gu, '').trim();
      return stripped.toLowerCase().normalize('NFKD');
    });
    return parts.join(' ').trim();
  }

  function isUpperChar(ch) {
    return ch.toUpperCase() === ch && ch.toLowerCase() !== ch;
  }

  function getCapitalization(word) {
    // 移植 __get_capitalization
    if (word.toUpperCase() === word) return UPPERCASE;
    var first = Array.from(word)[0];
    if (isUpperChar(first)) return TITLECASE;
    return LOWERCASE;
  }

  function capwords(part) {
    // 移植 string.capwords：分段后每段首字母大写、其余小写
    return part.split(/\s+/).filter(function (s) { return s.length > 0; })
      .map(function (s) {
        return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
      }).join(' ');
  }

  function finalizeOutput(word, capitalization, periods) {
    // 移植 __finalize_output
    return word.split(' ').map(function (part) {
      if (capitalization === UPPERCASE) {
        part = part.toUpperCase();
      } else if (capitalization === TITLECASE) {
        part = capwords(part);
      }
      if (periods) part += '.';
      return part;
    }).join(' ');
  }

  function lemmatizeNoun(form) {
    // 移植 NLTK 3.10.3 WordNetLemmatizer.lemmatize(word, 'n')：
    // _morphy 候选 = [原形] + (例外表命中 ? 例外词元 : 词尾替换结果)，
    // 仅保留真实名词词元，lemmatize 取其中最短者（等长取第一个）。
    var candidates, i, oldS, newS;
    if (has(NOUN_EXC, form)) {
      candidates = [form].concat(NOUN_EXC[form]);
    } else {
      candidates = [form];
      for (i = 0; i < NOUN_RULES.length; i++) {
        oldS = NOUN_RULES[i][0]; newS = NOUN_RULES[i][1];
        if (form.endsWith(oldS)) {
          candidates.push(form.slice(0, form.length - oldS.length) + newS);
        }
      }
    }
    var seen = new Set();
    var valid = [];
    for (i = 0; i < candidates.length; i++) {
      var c = candidates[i];
      if (!seen.has(c) && NOUN_LEMMAS.has(c)) {
        seen.add(c);
        valid.push(c);
      }
    }
    if (valid.length === 0) return form;
    var best = valid[0];
    for (i = 1; i < valid.length; i++) {
      if (valid[i].length < best.length) best = valid[i];
    }
    return best;
  }

  function abbreviatePipeline(title) {
    title = title.normalize('NFKD');

    var titleWords = title.split(TOKENIZER_REGEX).filter(function (w) {
      return w.trim().length > 0;
    });

    // 单词标题例外：原样（NFKD 后）返回
    if (titleWords.length === 1 && titleWords[0].split(' ').length === 1) {
      return title;
    }

    var result = [];

    for (var iw = 0; iw < titleWords.length; iw++) {
      var origWord = titleWords[iw];
      var wordNorm = normalizeWord(origWord);

      // 停用词跳过（末词且属于 {a,e,i,y} 时保留）
      if (STOPWORDS.has(wordNorm) &&
          !(iw === titleWords.length - 1 && KEEP_AS_LAST.has(wordNorm))) {
        continue;
      }

      var wordLemma = lemmatizeNoun(wordNorm);
      var candidates = wordNorm !== wordLemma ? [wordNorm, wordLemma] : [wordNorm];

      var wordAbbr = '';
      var word = candidates[0];
      var capitalization = getCapitalization(origWord);

      for (var ci = 0; ci < candidates.length; ci++) {
        word = candidates[ci];

        // 冲突表：LTWA 20170914 数据仅有 fullword 冲突
        // （nombre / labor / real）。无消歧语言参数时 Python 端必抛异常。
        if (CONFLICT_MAP[FULLWORD] && has(CONFLICT_MAP[FULLWORD], word)) {
          throw new ConflictError(word);
        }

        // fullword 整词命中
        if (LTWA[FULLWORD] && has(LTWA[FULLWORD], word)) {
          wordAbbr = LTWA[FULLWORD][word];
          break;
        }
        // prefix（长度降序）
        if (!wordAbbr && SORTED_KEYS[PREFIX]) {
          for (var pi = 0; pi < SORTED_KEYS[PREFIX].length; pi++) {
            if (word.startsWith(SORTED_KEYS[PREFIX][pi])) {
              wordAbbr = LTWA[PREFIX][SORTED_KEYS[PREFIX][pi]];
              break;
            }
          }
        }
        // suffix（长度降序）
        if (!wordAbbr && SORTED_KEYS[SUFFIX]) {
          for (var si = 0; si < SORTED_KEYS[SUFFIX].length; si++) {
            if (word.endsWith(SORTED_KEYS[SUFFIX][si])) {
              wordAbbr = LTWA[SUFFIX][SORTED_KEYS[SUFFIX][si]];
              break;
            }
          }
        }
        // infix（长度降序）
        if (!wordAbbr && SORTED_KEYS[INFIX]) {
          for (var ii = 0; ii < SORTED_KEYS[INFIX].length; ii++) {
            if (word.indexOf(SORTED_KEYS[INFIX][ii]) !== -1) {
              wordAbbr = LTWA[INFIX][SORTED_KEYS[INFIX][ii]];
              break;
            }
          }
        }
        if (wordAbbr) break;
      }

      // 命中 'n.a.' 或全部未命中：保留（最后尝试的）词形且不加句点
      if (wordAbbr === '' || wordAbbr === NOT_ABBREVIATED) {
        wordAbbr = finalizeOutput(word, capitalization, false);
      } else {
        wordAbbr = finalizeOutput(wordAbbr, capitalization, true);
      }

      result.push(wordAbbr);
    }

    return result.join(' ').normalize('NFKC');
  }

  function abbreviate(title) {
    if (!LTWA) {
      throw new Error('ISO4.init() must be awaited before ISO4.abbreviate()');
    }
    // 与项目 Python 包装器 abbreviate_journal 一致：去首尾空白，空串原样返回
    var cleaned = (title == null ? '' : String(title)).trim();
    if (!cleaned) return '';
    try {
      return abbreviatePipeline(cleaned);
    } catch (err) {
      if (err instanceof ConflictError) {
        // 包装器兜底：冲突无法消歧时返回原始标题
        return cleaned;
      }
      throw err;
    }
  }

  function abbreviateMany(names) {
    return names.map(function (n) { return [n, abbreviate(n)]; });
  }

  // ---------- 数据加载 ----------

  function isNode() {
    return typeof window === 'undefined';
  }

  // Node 下把 url 解析为本地文件路径：绝对路径直接用；
  // 相对路径先试 cwd，再落到本模块所在目录的上一级（web/）下。
  function resolveNodePath(url) {
    var path = require('path');
    var fs = require('fs');
    if (path.isAbsolute(url)) return url;
    if (fs.existsSync(url)) return path.resolve(url);
    return path.join(__dirname, '..', url);
  }

  function siblingUrl(url, filename) {
    var idx = url.lastIndexOf('/');
    return (idx === -1 ? '' : url.slice(0, idx + 1)) + filename;
  }

  function applyData(ltwaJson, excJson, nounsText) {
    LTWA = ltwaJson.l;
    CONFLICT_MAP = ltwaJson.c || {};
    TOKENIZER_REGEX = buildTokenizer(ltwaJson.m || []);
    STOPWORDS = new Set(STOPWORDS_RAW.map(function (w) { return w.normalize('NFKD'); }));
    KEEP_AS_LAST = new Set(KEEP_AS_LAST_RAW.map(function (w) { return w.normalize('NFKD'); }));
    NOUN_EXC = excJson || {};
    NOUN_LEMMAS = new Set(
      nounsText.split('\n').filter(function (w) { return w.length > 0; })
    );
    SORTED_KEYS = {};
    [PREFIX, SUFFIX, INFIX].forEach(function (t) {
      SORTED_KEYS[t] = LTWA[t] ? sortKeysLongestFirst(LTWA[t]) : [];
    });
  }

  function doInit(url) {
    url = String(url).replace(/\\/g, '/');
    var excUrl = siblingUrl(url, 'wordnet_noun_exc.json');
    var nounsUrl = siblingUrl(url, 'wordnet_nouns.txt');

    if (isNode()) {
      return new Promise(function (resolve, reject) {
        try {
          var fs = require('fs');
          var ltwaJson = JSON.parse(fs.readFileSync(resolveNodePath(url), 'utf8'));
          var excJson = JSON.parse(fs.readFileSync(resolveNodePath(excUrl), 'utf8'));
          var nounsText = fs.readFileSync(resolveNodePath(nounsUrl), 'utf8');
          applyData(ltwaJson, excJson, nounsText);
          resolve();
        } catch (err) {
          reject(err);
        }
      });
    }

    return Promise.all([
      fetch(url).then(function (r) {
        if (!r.ok) throw new Error('ISO4: failed to load ' + url + ' (' + r.status + ')');
        return r.json();
      }),
      fetch(excUrl).then(function (r) {
        if (!r.ok) throw new Error('ISO4: failed to load ' + excUrl + ' (' + r.status + ')');
        return r.json();
      }),
      fetch(nounsUrl).then(function (r) {
        if (!r.ok) throw new Error('ISO4: failed to load ' + nounsUrl + ' (' + r.status + ')');
        return r.text();
      })
    ]).then(function (parts) {
      applyData(parts[0], parts[1], parts[2]);
    });
  }

  function init(url) {
    if (initPromise) return initPromise;   // 幂等
    initPromise = doInit(url || 'data/ltwa.json');
    return initPromise;
  }

  var ISO4 = {
    init: init,
    abbreviate: abbreviate,
    abbreviateMany: abbreviateMany,
    _ConflictError: ConflictError
  };

  global.ISO4 = ISO4;
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = ISO4;
  }
})(typeof window !== 'undefined' ? window : globalThis);
