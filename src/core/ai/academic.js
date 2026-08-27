// Academic Exact-Source Mode（upgrade.md §15/§16，P0 + Phase2）
// 论文身份验证：Explicit URL/DOI/arXiv/PMID 优先（Level 0~2）→ Exact Title 匹配（Level 3）。
// 语义相似只能用于候选发现，不能单独证明"就是目标论文"（§15.2 禁止的错误路径）。
(function (global) {
  'use strict';

  // 标题归一：小写、去标点空白
  function normTitle(t) {
    return String(t || '').toLowerCase().replace(/[《》「」"''""'()（）\[\]{}.,;:!?、。，；：！？\s-]+/g, '').trim();
  }

  // URL 归一（显式链接直中比较用）：小写、去 www、去尾斜杠、去 tracking
  function normUrl(u) {
    return String(u || '').toLowerCase()
      .replace(/^https?:\/\//, '')
      .replace(/^www\./, '')
      .replace(/[?#].*$/, '')
      .replace(/\/+$/, '');
  }

  // 从显式来源 + claim 文本构建论文目标
  // return { doi, arxiv, pmid, title, url }（全可空）
  function buildTarget(explicitSources, claimText) {
    var t = { doi: null, arxiv: null, pmid: null, title: null, url: null };
    (explicitSources || []).forEach(function (s) {
      if (s.kind === 'DOI') t.doi = s.value;
      if (s.kind === 'ARXIV') t.arxiv = s.value;
      if (s.kind === 'PMID') t.pmid = s.value;
      if (s.kind === 'URL') t.url = s.value;
      // 超链接锚文本 = 论文标题提示（upgrade.md §14：页面以超链接形式引用论文）
      if (!t.title) {
        var hint = s.anchorText || s.titleHint;
        if (hint && hint.length >= 4 && hint.length <= 100 && /[\u4e00-\u9fa5A-Za-z]{2,}/.test(hint)) t.title = hint;
      }
    });
    // 《论文标题》 → 标题线索（Level 3 用，优先级高于锚文本）
    var m = String(claimText || '').match(/《([^》]{4,80})》/);
    if (m) t.title = m[1];
    return t;
  }

  // DOI 解析为可访问 URL
  function resolveUrl(target) {
    if (target.url && /^https?:\/\//.test(target.url)) return target.url;
    if (target.doi) return 'https://doi.org/' + target.doi;
    if (target.arxiv) return 'https://arxiv.org/abs/' + target.arxiv;
    if (target.pmid) return 'https://pubmed.ncbi.nlm.nih.gov/' + target.pmid + '/';
    return null;
  }

  // 是否有可精确定位的标识（Level 0~2）
  function hasExactIdentifier(target) {
    return !!(target && (target.doi || target.arxiv || target.pmid || target.url));
  }

  // §16 Paper Validation：DOI/ID 精确匹配 > Title(+作者) 精确/近似匹配
  // item: 候选来源（url/title/snippet）
  // target: buildTarget 输出
  // return { status: 'TARGET_PAPER'|'RELATED_PAPER'|'UNVERIFIED', matchedOn: [...] }
  function validatePaper(item, target) {
    var status = 'UNVERIFIED';
    var matchedOn = [];
    target = target || {};
    var url = String(item.url || '').toLowerCase();
    var text = (String(item.title || '') + ' ' + String(item.snippet || '')).toLowerCase();

    if (target.doi) {
      var doiNorm = String(target.doi).toLowerCase().replace(/\/+$/, '');
      if (url.indexOf(doiNorm) >= 0 || url.indexOf('doi.org/' + doiNorm) >= 0 || text.indexOf(doiNorm) >= 0) {
        status = 'TARGET_PAPER'; matchedOn.push('DOI');
      }
    }
    if (status === 'UNVERIFIED' && target.arxiv) {
      if (url.indexOf('arxiv.org/abs/' + target.arxiv) >= 0 || url.indexOf('arxiv.org/pdf/' + target.arxiv) >= 0 || text.indexOf(target.arxiv) >= 0) {
        status = 'TARGET_PAPER'; matchedOn.push('ARXIV');
      }
    }
    if (status === 'UNVERIFIED' && target.pmid) {
      if (url.indexOf('pubmed.ncbi.nlm.nih.gov/' + target.pmid) >= 0 || text.indexOf(target.pmid) >= 0) {
        status = 'TARGET_PAPER'; matchedOn.push('PMID');
      }
    }
    if (status === 'UNVERIFIED' && target.url && /^https?:\/\//i.test(target.url)) {
      // §14 Level 0：页面直接给出的原文链接 = 目标论文
      if (normUrl(item.url) === normUrl(target.url)) {
        status = 'TARGET_PAPER'; matchedOn.push('EXPLICIT_URL');
      }
    }
    if (status === 'UNVERIFIED' && target.title) {
      var nt = normTitle(item.title);
      var ntt = normTitle(target.title);
      if (nt && ntt) {
        if (nt === ntt) {
          status = 'TARGET_PAPER'; matchedOn.push('TITLE');
        } else {
          // §16 匹配优先级：精确/近精确 > 语义相似（语义相似只能候选发现，不能单独证明）
          var sim = diceSimilarity(nt, ntt);
          if (sim >= 0.85) { status = 'TARGET_PAPER'; matchedOn.push('TITLE_NEAR'); }
          else if (sim >= 0.5) { status = 'RELATED_PAPER'; matchedOn.push('TITLE_SIM_' + Math.round(sim * 100)); }
          else { status = 'RELATED_PAPER'; matchedOn.push('TITLE_DIFF'); }
        }
      }
    }
    return { status: status, matchedOn: matchedOn };
  }

  function bigrams(s) {
    var set = {};
    var n = 0;
    for (var i = 0; i < s.length - 1; i++) {
      var g = s.slice(i, i + 2);
      if (!set[g]) { set[g] = 0; n++; }
      set[g]++;
    }
    return { set: set, count: n };
  }
  function diceSimilarity(a, b) {
    var A = bigrams(a), B = bigrams(b);
    if (!A.count || !B.count) return 0;
    var inter = 0;
    for (var g in A.set) {
      if (B.set[g]) inter += Math.min(A.set[g], B.set[g]);
    }
    return 2 * inter / (A.count + B.count);
  }

  global.WCC_ACADEMIC = {
    buildTarget: buildTarget,
    validatePaper: validatePaper,
    resolveUrl: resolveUrl,
    hasExactIdentifier: hasExactIdentifier,
    normTitle: normTitle,
    normUrl: normUrl
  };
})(typeof globalThis !== 'undefined' ? globalThis : self);
