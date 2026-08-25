// 正文提取与结构化（V1.5 U0）：DOM → 章节 → 段落 → 句子。
// 隐私原则（v1.5_UPGRADE §8）：仅在用户主动触发时调用；纯本地执行，不发送任何数据。
// 数据模型（§5）：Document{title,url} → Section → Paragraph → Sentence{id, paraId, text, start, end}。
// start/end 是句子在段落原始文本中的字符偏移（trim 后的精确范围），供 U3 Hover 回定位网页原文。
(function () {
  'use strict';

  if (window.__QIUZHEN_EXTRACTOR__) return; // 防重复注入

  var MIN_PARA_LENGTH = 10;    // 段落最小字符数（过滤按钮/菜单碎文本）
  var MIN_SENTENCE_LENGTH = 6; // 句子最小字符数（过滤残句）
  var MAX_LINK_RATIO = 0.6;    // 段落内链接文字占比上限（导航/推荐位特征）

  // paraId → 段落 DOM 元素（仅供本隔离世界使用，不序列化传输）
  var paraEls = new Map();

  // ---------- 候选正文根 ----------

  function scoreAsContent(el) {
    var ps = el.querySelectorAll('p, li, blockquote');
    var total = 0;
    for (var i = 0; i < ps.length; i++) {
      if (ps[i].closest('nav, aside, footer, header')) continue;
      total += (ps[i].textContent || '').length;
    }
    return total;
  }

  function findContentRoot() {
    var candidates = document.querySelectorAll('article, main, [role="main"], .article, .post, #content, .content');
    var best = null, bestScore = 0;
    for (var i = 0; i < candidates.length; i++) {
      var s = scoreAsContent(candidates[i]);
      if (s > bestScore) { best = candidates[i]; bestScore = s; }
    }
    if (best && bestScore >= 200) return best;
    return document.body; // 兜底：逐段排除法仍能滤掉导航/页脚
  }

  // ---------- 句子切分（带偏移） ----------

  var BREAK_CHARS = '。！？!?…';
  var CLOSERS = '」』”）"\')\]】>、，,；;：: ';

  function isSentenceBreak(raw, i) {
    var ch = raw.charAt(i);
    if (BREAK_CHARS.indexOf(ch) >= 0) return true;
    if (ch === '.') {
      // 英文句点：后随空白/结尾，且前后都不是数字（排除 3.14、v2.5）
      var prev = raw.charAt(i - 1);
      var next = raw.charAt(i + 1);
      if ((next === '' || /\s/.test(next)) && !/\d/.test(prev)) return true;
    }
    return false;
  }

  function splitSentences(raw) {
    var out = [];
    var start = 0;
    var i = 0;
    while (i < raw.length) {
      if (!isSentenceBreak(raw, i)) { i++; continue; }
      // 吞掉句读后的收尾字符（引号/括号/空白）
      var end = i + 1;
      while (end < raw.length && CLOSERS.indexOf(raw.charAt(end)) >= 0) end++;
      pushSentence(out, raw, start, end);
      start = end;
      i = end;
    }
    if (start < raw.length) pushSentence(out, raw, start, raw.length);
    return out;
  }

  function pushSentence(out, raw, start, end) {
    // 收紧到非空白边界，保证 slice(start,end) === text（精确不变量）
    while (start < end && /\s/.test(raw.charAt(start))) start++;
    while (end > start && /\s/.test(raw.charAt(end - 1))) end--;
    var text = raw.slice(start, end);
    if (text.length >= MIN_SENTENCE_LENGTH) {
      out.push({ text: text, start: start, end: end });
    }
  }

  // ---------- 段落级提取 ----------

  function isJunkParagraph(el) {
    if (el.closest('nav, aside, footer, header, script, style, noscript, form, button, svg, figure figcaption')) return true;
    if (el.getClientRects().length === 0) return true; // 未渲染
    var text = (el.textContent || '').trim();
    if (text.length < MIN_PARA_LENGTH) return true;
    // 链接占比过高 → 导航/推荐位
    var linkLen = 0;
    var anchors = el.querySelectorAll('a');
    for (var i = 0; i < anchors.length; i++) linkLen += (anchors[i].textContent || '').length;
    if (linkLen / text.length > MAX_LINK_RATIO) return true;
    return false;
  }

  // ---------- 主流程 ----------

  function extractDocument() {
    paraEls.clear();
    var root = findContentRoot();

    var sections = [];
    var paragraphs = [];
    var sentences = [];
    var currentSection = null;

    function openSection(title) {
      currentSection = { id: 'sec-' + sections.length, title: title || '', paraIds: [] };
      sections.push(currentSection);
    }
    openSection('');

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, {
      acceptNode: function (el) {
        var tag = el.tagName;
        if (/^H[1-4]$/.test(tag) || tag === 'P' || tag === 'LI' || tag === 'BLOCKQUOTE' || tag === 'DD' || tag === 'DT') {
          return NodeFilter.FILTER_ACCEPT;
        }
        return NodeFilter.FILTER_SKIP; // 继续深入子节点
      }
    });

    var el;
    while ((el = walker.nextNode())) {
      var tag = el.tagName;
      if (/^H[1-4]$/.test(tag)) {
        var hText = (el.textContent || '').trim();
        if (hText) openSection(hText.slice(0, 80));
        continue;
      }
      if (isJunkParagraph(el)) continue;

      var raw = el.textContent || '';
      var paraId = 'p-' + paragraphs.length;
      var sents = splitSentences(raw);
      if (!sents.length) continue;

      el.setAttribute('data-qz-pid', paraId); // U3 Hover 回定位锚点
      paraEls.set(paraId, el);

      paragraphs.push({ id: paraId, sectionId: currentSection.id, text: raw });
      currentSection.paraIds.push(paraId);
      for (var i = 0; i < sents.length; i++) {
        sentences.push({
          id: 's-' + sentences.length,
          paraId: paraId,
          text: sents[i].text,
          start: sents[i].start,
          end: sents[i].end
        });
      }
    }

    // 空标题的初始章节若无段落则移除
    var keptSections = sections.filter(function (s) {
      return s.paraIds.length > 0 || s.title;
    });

    return {
      doc: {
        title: document.title || '',
        url: location.href || '',
        host: location.host || '',
        extractedAt: new Date().toISOString()
      },
      sections: keptSections,
      paragraphs: paragraphs,
      sentences: sentences
    };
  }

  // ---------- 对外 ----------

  // SW 经 tabs.sendMessage 请求提取（U2 悬浮球走本地直调，此通道供面板/调试复用）
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (!message || message.type !== WCC_MSG.EXTRACT_DOCUMENT) return;
    try {
      sendResponse({ ok: true, document: extractDocument() });
    } catch (e) {
      sendResponse({ ok: false, reason: String((e && e.message) || e) });
    }
    // 同步应答
  });

  window.__QIUZHEN_EXTRACTOR__ = {
    extractDocument: extractDocument,
    getParaElement: function (paraId) { return paraEls.get(paraId) || null; }
  };
})();
