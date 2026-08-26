// Side Panel 工作台（M2）：三 Tab、Loading/Error/Empty 状态机、连续深读。
// 交互原则（PRD 05-UI-UX）：Tab 切换不改变 Claim；新选区自动重分析；结果逐层出现。
(function () {
  'use strict';

  var els = {
    empty: document.getElementById('empty-state'),
    overview: document.getElementById('overview-state'),
    ovTitle: document.getElementById('ov-title'),
    ovStats: document.getElementById('ov-stats'),
    ovList: document.getElementById('ov-list'),
    card: document.getElementById('claim-card'),
    text: document.getElementById('claim-text'),
    expand: document.getElementById('claim-expand'),
    backOverview: document.getElementById('back-overview'),
    sourceTitle: document.getElementById('claim-source-title'),
    tabs: document.getElementById('mode-tabs'),
    loading: document.getElementById('loading-state'),
    loadingTitle: document.getElementById('loading-title'),
    loadingSteps: document.getElementById('loading-steps'),
    error: document.getElementById('error-state'),
    errorTitle: document.getElementById('error-title'),
    errorDetail: document.getElementById('error-detail'),
    retryBtn: document.getElementById('retry-btn'),
    result: document.getElementById('result-state'),
    panes: {
      truth: document.getElementById('result-truth'),
      deep: document.getElementById('result-deep'),
      differ: document.getElementById('result-differ')
    },
    regen: document.getElementById('regen-btn'),
    foot: document.querySelector('.panel-foot'),
    cacheFlag: document.getElementById('cache-flag')
  };

  // ---------- 全局状态 ----------
  var state = {
    claimPayload: null,   // 当前 Active Selection payload
    docIndex: null,       // 本文 Claim Index（U4 概览态）
    mode: 'truth',        // 当前 Tab
    results: {},          // mode -> { result, cached }
    verified: {},         // claimId -> supportLevel（概览已核实统计）
    analyzing: false,
    seq: 0                // 丢弃过期响应（连续深读时旧响应作废）
  };

  var CLAIM_TYPE_NAMES = { fact: '事实', number: '数字', causal: '因果', compare: '比较', predict: '预测', define: '定义', other: '其他', opinion: '观点' };

  var LOADING_STEPS = {
    truth: ['解析当前 Claim', '检索相关知识', '核对表述与证据'],
    deep: ['解析当前 Claim', '梳理相关概念', '构建知识关系'],
    differ: ['解析当前 Claim', '寻找不同观点', '分析遗漏维度']
  };

  var MODE_NAMES = { truth: '求真', deep: '求深', differ: '求异' };

  // ---------- 视图切换 ----------

  function show(el) { el.hidden = false; }
  function hide(el) { el.hidden = true; }

  function renderView() {
    var hasClaim = !!state.claimPayload;
    els.card.hidden = !hasClaim;
    els.tabs.hidden = !hasClaim;
    show(els.empty); // 先统一显示 empty，再按需隐藏
    if (hasClaim) hide(els.empty);
    // 概览态（U4）：无 Claim 工作台但已有本文 Index（VD3：有 Index 默认概览）
    els.overview.hidden = !(!hasClaim && state.docIndex && state.docIndex.index && state.docIndex.index.claims.length > 0);
    if (!els.overview.hidden) {
      showOverview();
      hide(els.loading); hide(els.error); hide(els.result); hide(els.foot); hide(els.regen);
      return;
    }
    if (!hasClaim) {
      hide(els.loading); hide(els.error); hide(els.result); hide(els.foot); hide(els.regen);
      return;
    }

    var cached = state.results[state.mode];
    if (state.analyzing && !cached) {
      hide(els.result); hide(els.error); hide(els.regen); hide(els.foot);
      showLoading();
    } else if (cached) {
      hide(els.loading); hide(els.error);
      renderResult(state.mode, cached);
      show(els.result); show(els.regen); show(els.foot);
      els.cacheFlag.textContent = cached.verified
        ? (cached.cached ? '已核验 · 缓存' : '已核验')
        : (cached.cached ? '未联网核验 · 缓存' : '未联网核验');
    } else {
      // 该模式尚未分析：自动触发
      startAnalysis(state.mode);
    }
  }

  function showLoading() {
    els.loadingTitle.textContent = MODE_NAMES[state.mode] + '分析中……';
    els.loadingSteps.innerHTML = '';
    LOADING_STEPS[state.mode].forEach(function (s, i) {
      var li = document.createElement('li');
      li.className = i === 0 ? 'doing' : (i === 1 ? 'todo' : 'todo');
      li.textContent = s;
      els.loadingSteps.appendChild(li);
    });
    // 分步推进的视觉节奏（真实进度不可知，但状态可感知）
    var stepEls = [].slice.call(els.loadingSteps.children);
    setTimeout(function () { stepEls[0] && stepEls[0].classList.replace('doing', 'done'); stepEls[1] && stepEls[1].classList.replace('todo', 'doing'); }, 1400);
    setTimeout(function () { stepEls[1] && stepEls[1].classList.replace('doing', 'done'); stepEls[2] && stepEls[2].classList.replace('todo', 'doing'); }, 3600);
    show(els.loading);
  }

  function showError(reason) {
    var map = {
      config_missing: ['未配置 API Key', '请在项目根放置 deepseek_api.key 并运行 node scripts/gen-config.js，然后重新加载扩展'],
      http_401: ['鉴权失败', 'API Key 无效或已过期'],
      http_402: ['额度不足', 'DeepSeek 账户余额不足'],
      http_429: ['请求过于频繁', '请稍后再试'],
      abort: ['请求超时', '网络较慢或服务繁忙，请重试']
    };
    var m = map[reason] || ['暂时无法完成深读', reason || '未知错误'];
    els.errorTitle.textContent = m[0];
    els.errorDetail.textContent = m[1];
    hide(els.result); hide(els.loading);
    show(els.error);
  }

  // ---------- 分析流程 ----------

  function startAnalysis(mode, force) {
    var seq = ++state.seq;
    if (force) delete state.results[mode];
    state.analyzing = true;
    state.mode = mode;
    renderView();
    try {
      chrome.runtime.sendMessage(
        { type: WCC_MSG.ANALYZE, mode: mode, payload: state.claimPayload },
        function (resp) {
          void chrome.runtime.lastError;
          if (seq !== state.seq) return; // 已有新 Claim/模式，丢弃过期响应
          state.analyzing = false;
          if (resp && resp.ok) {
            state.results[mode] = {
              result: resp.analysis.result,
              cached: resp.analysis.cached,
              verified: resp.analysis.verified,
              sources: resp.analysis.sources
            };
            // 记录概览"已核实"（从本文概览进入的求真）
            if (mode === 'truth' && state.claimPayload.__claimId && resp.analysis.result && resp.analysis.result.supportLevel) {
              state.verified[state.claimPayload.__claimId] = resp.analysis.result.supportLevel;
            }
          } else {
            state.results[mode] = null;
            state.lastError = (resp && resp.reason) || 'no_response';
          }
          renderView();
        }
      );
    } catch (e) {
      state.analyzing = false;
      showError('extension_reloaded');
    }
  }

  // ---------- 渲染 ----------

  function el(tag, cls, text) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }

  var SUPPORT_BADGES = {
    supported: '✓ 有较充分证据支持', partial: '🟡 部分支持',
    insufficient: '⚠️ 证据不足', unsupported: '✕ 不支持', opinion: '◎ 观点表达'
  };

  function cardWith(label) {
    var c = el('div', 'card glass');
    c.appendChild(el('div', 'card-label', label));
    return c;
  }

  function esc(s) { return String(s == null ? '' : s); }

  function renderTruth(result, entry) {
    var pane = els.panes.truth;
    pane.innerHTML = '';
    var c1 = cardWith('支持程度');
    c1.appendChild(el('span', 'badge ' + esc(result.supportLevel), SUPPORT_BADGES[result.supportLevel] || result.supportLevel));
    c1.appendChild(el('div', 'summary-text', esc(result.summary)));
    pane.appendChild(c1);

    // 联网检索到的来源（M3：知乎开放平台；origin 区分知乎站内/全网）
    var srcs = entry && entry.sources;
    var srcItems = srcs ? (srcs.zhihu || []).concat(srcs.global || []) : [];
    if (srcItems.length) {
      var zhihuN = (srcs.zhihu || []).length;
      var globN = (srcs.global || []).length;
      var cs = cardWith('检索来源（知乎站内 ' + zhihuN + ' · 全网 ' + globN + '）');
      srcItems.slice(0, 8).forEach(function (it) {
        var line = el('div', 'src-line');
        var a = el('a', 'src-link', esc(it.title || '(无标题)'));
        a.href = it.url; a.target = '_blank'; a.rel = 'noopener';
        line.appendChild(a);
        line.appendChild(el('span', 'src-meta',
          esc((it.origin === 'global'
                ? '全网 · ' + (it.sourceType === 'Answer' ? '回答' : it.sourceType === 'Article' ? '文章' : '网页')
                : it.sourceType === 'Answer' ? '知乎回答' : it.sourceType === 'Article' ? '知乎文章' : '知乎') +
              (it.author ? ' · ' + it.author : '') +
              (it.votes ? ' · ' + it.votes + ' 赞' : ''))));
        cs.appendChild(line);
      });
      pane.appendChild(cs);
    }

    var evs = Array.isArray(result.evidences) ? result.evidences : [];
    if (evs.length) {
      var c2 = cardWith('证据（' + evs.length + '）');
      evs.forEach(function (ev) {
        var ec = el('div', 'ev-card glass');
        var head = el('div', 'ev-head');
        head.appendChild(el('span', 'ev-type', esc(ev.sourceType)));
        head.appendChild(el('div', 'ev-point', esc(ev.point)));
        ec.appendChild(head);
        if (ev.detail) ec.appendChild(el('div', 'ev-detail', esc(ev.detail)));
        c2.appendChild(ec);
      });
      pane.appendChild(c2);
    }

    var c3 = cardWith('原文 / 来源对照');
    if (result.comparison && result.comparison.original) {
      var cmp = result.comparison;
      c3.appendChild(el('div', 'compare-tag', '原文'));
      c3.appendChild(el('div', 'compare-original', '「' + esc(cmp.original) + '」'));
      c3.appendChild(el('div', 'compare-tag', '来源实际表达'));
      c3.appendChild(el('div', 'compare-actual', '「' + esc(cmp.actual) + '」'));
      if (cmp.gap) c3.appendChild(el('div', 'compare-gap', '⚠️ ' + esc(cmp.gap)));
    } else {
      c3.appendChild(el('div', 'compare-none', '暂无可靠来源可对照——本判断基于模型内部知识，建议自行检索核实。'));
    }
    pane.appendChild(c3);
  }

  // ---------- 探索循环（PRD 04 §8 / 05 §14.3）：知识节点点击 → 成为新 Claim 重新三连探索 ----------

  function exploreNode(text) {
    var t = String(text || '').trim();
    if (!t || !state.claimPayload) return;
    showClaim({
      title: String(state.claimPayload.title || '').replace(/ · 知识探索$/, '') + ' · 知识探索',
      url: state.claimPayload.url,
      selectedText: t,
      capturedAt: new Date().toISOString()
    });
  }

  function renderDeep(result) {
    var pane = els.panes.deep;
    pane.innerHTML = '';
    var c1 = cardWith('背后的原理');
    c1.appendChild(el('div', 'summary-text', esc(result.principle)));
    pane.appendChild(c1);

    var concepts = Array.isArray(result.concepts) ? result.concepts : [];
    if (concepts.length) {
      var c2 = cardWith('相关概念');
      concepts.forEach(function (cp) {
        var line = el('div', 'concept-line');
        line.appendChild(el('span', 'concept-name', esc(cp.name)));
        line.appendChild(el('span', 'muted', esc(cp.description)));
        c2.appendChild(line);
      });
      pane.appendChild(c2);
    }

    var tree = result.tree || {};
    var c3 = cardWith('知识树');
    if (tree.root) {
      c3.appendChild(el('div', '', '')).appendChild(el('span', 'tree-root', esc(tree.root)));
      (Array.isArray(tree.branches) ? tree.branches : []).forEach(function (br) {
        var branch = el('div', 'tree-branch');
        branch.appendChild(el('div', 'tree-label', esc(br.label)));
        var nodesWrap = el('div', 'tree-nodes');
        (Array.isArray(br.nodes) ? br.nodes : []).forEach(function (n) {
          var chip = el('span', 'node-chip', esc(n));
          chip.title = '以此节点继续深读';
          chip.addEventListener('click', function () { exploreNode(n); });
          nodesWrap.appendChild(chip);
        });
        branch.appendChild(nodesWrap);
        c3.appendChild(branch);
      });
    } else {
      c3.appendChild(el('div', 'compare-none', '知识树生成中不可用。'));
    }
    pane.appendChild(c3);

    var qs = Array.isArray(result.questions) ? result.questions : [];
    if (qs.length) {
      var c4 = cardWith('继续探索');
      var ul = el('ul', 'q-list');
      qs.forEach(function (q) {
        var li = el('li', 'q-link', esc(q));
        li.title = '点击复制到剪贴板';
        li.addEventListener('click', function () {
          navigator.clipboard && navigator.clipboard.writeText(String(q));
          li.style.color = 'var(--accent)';
          setTimeout(function () { li.style.color = ''; }, 800);
        });
        ul.appendChild(li);
      });
      c4.appendChild(ul);
      pane.appendChild(c4);
    }
  }

  var VP_DOTS = { '乐观派': 'g', '谨慎派': 'y', '怀疑派': 'r' };

  function renderDiffer(result) {
    var pane = els.panes.differ;
    pane.innerHTML = '';
    var c1 = cardWith('当前观点');
    c1.appendChild(el('div', 'summary-text', esc(result.currentStance)));
    pane.appendChild(c1);

    var vps = Array.isArray(result.viewpoints) ? result.viewpoints : [];
    if (vps.length) {
      var c2 = cardWith('不同观点（' + vps.length + '）');
      vps.forEach(function (vp, i) {
        var vc = el('div', 'vp-card glass');
        var head = el('div', 'vp-head');
        head.appendChild(el('span', 'vp-dot ' + (VP_DOTS[vp.stance] || ['b', 'g', 'y', 'r'][i % 4])));
        head.appendChild(el('span', 'vp-stance', esc(vp.stance)));
        vc.appendChild(head);
        vc.appendChild(el('div', 'vp-point', esc(vp.point)));
        if (vp.reason) vc.appendChild(el('div', 'vp-reason', esc(vp.reason)));
        c2.appendChild(vc);
      });
      pane.appendChild(c2);
    }

    var bs = Array.isArray(result.blindSpots) ? result.blindSpots : [];
    if (bs.length) {
      var c3 = cardWith('⚠️ 认知盲区');
      bs.forEach(function (b) {
        var line = el('div', 'concept-line');
        line.appendChild(el('span', 'concept-name', esc(b.topic)));
        line.appendChild(el('div', 'blind-why', esc(b.why)));
        c3.appendChild(line);
      });
      pane.appendChild(c3);
    }
  }

  var RENDERERS = { truth: renderTruth, deep: renderDeep, differ: renderDiffer };

  // ---------- 本文概览（U4） ----------

  function showOverview() {
    var di = state.docIndex;
    var index = di.index;
    var claims = index.claims || [];
    var opinions = index.opinions || [];
    els.ovTitle.textContent = di.title || '本文';
    els.ovStats.innerHTML = '';
    var stats = [
      { label: '可验证声明', n: claims.length, cls: '' },
      { label: '主观观点', n: opinions.length, cls: '' },
      { label: '已核实', n: Object.keys(state.verified).length, cls: '' }
    ];
    stats.forEach(function (s) {
      var span = el('span', 'ov-stat');
      span.innerHTML = s.label + ' <b>' + s.n + '</b>';
      els.ovStats.appendChild(span);
    });
    els.ovList.innerHTML = '';
    claims.forEach(function (claim) {
      var item = el('button', 'ov-item glass');
      var head = el('div', 'ov-item-head');
      head.appendChild(el('span', 'ov-type', CLAIM_TYPE_NAMES[claim.type] || '声明'));
      var v = state.verified[claim.id];
      if (v) head.appendChild(el('span', 'ov-verified', SUPPORT_BADGES[v] || v));
      item.appendChild(head);
      item.appendChild(el('div', 'ov-text', esc(claim.text)));
      item.addEventListener('click', function () {
        showClaim({
          title: String(di.title || '') + ' · 本文声明',
          url: di.url || '',
          selectedText: claim.text,
          capturedAt: new Date().toISOString(),
          __claimId: claim.id
        });
      });
      els.ovList.appendChild(item);
    });
    if (!claims.length) {
      els.ovList.appendChild(el('div', 'muted', '本文没有识别出可验证声明。'));
    }
  }

  function renderResult(mode, entry) {
    hide(els.error);
    if (!entry) { // 该模式上次失败
      showError(state.lastError);
      return;
    }
    RENDERERS[mode](entry.result, entry);
    Object.keys(els.panes).forEach(function (m) {
      els.panes[m].hidden = (m !== mode);
    });
  }

  // ---------- Claim 展示 ----------

  function showClaim(payload) {
    var isNewClaim = !state.claimPayload ||
      state.claimPayload.selectedText !== payload.selectedText ||
      state.claimPayload.url !== payload.url;

    state.claimPayload = payload;
    if (isNewClaim) {
      state.results = {};   // 新 Claim 清空三模式缓存结果
      state.analyzing = false;
      state.seq++;          // 作废在途响应
    }

    var text = String(payload.selectedText || '');
    els.text.textContent = '“' + text + '”';
    els.expand.hidden = text.length <= 90;
    els.text.classList.remove('expanded');
    els.expand.textContent = '展开全文';
    els.sourceTitle.textContent = payload.title || '';
    els.backOverview.hidden = !state.docIndex; // 有本文 Index 时可返回概览
    renderView();
  }

  function resetToEmpty() {
    state.claimPayload = null;
    state.results = {};
    state.analyzing = false;
    state.seq++;
    renderView();
  }

  // ---------- 事件绑定 ----------

  els.tabs.addEventListener('click', function (e) {
    var tab = e.target.closest('.tab');
    if (!tab) return;
    state.mode = tab.dataset.mode;
    [].forEach.call(els.tabs.querySelectorAll('.tab'), function (t) {
      var active = t === tab;
      t.classList.toggle('active', active);
      t.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    renderView(); // Tab 切换不改变 Claim（PRD 05-UI-UX §8.2）
  });

  els.expand.addEventListener('click', function () {
    var expanded = els.text.classList.toggle('expanded');
    els.expand.textContent = expanded ? '收起' : '展开全文';
  });

  els.retryBtn.addEventListener('click', function () {
    startAnalysis(state.mode, true);
  });

  els.regen.addEventListener('click', function () {
    startAnalysis(state.mode, true); // 绕过前端缓存重新请求
  });

  els.backOverview.addEventListener('click', function () {
    resetToEmpty(); // 保留 docIndex → renderView 回到概览态
  });

  // 面板打开时拉取当前 Active Selection + 本文 Index（U4 概览）
  try {
    chrome.runtime.sendMessage({ type: WCC_MSG.GET_ACTIVE_SELECTION }, function (resp) {
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok && resp.selection && resp.selection.payload) {
        showClaim(resp.selection.payload);
        return;
      }
      // 无选区 → 读本文 Index → 概览态
      chrome.storage.session.get('docIndex', function (data) {
        if (data && data.docIndex) {
          state.docIndex = data.docIndex;
          state.verified = {};
        }
        renderView();
      });
    });
  } catch (e) { /* context invalidated */ }

  // 连续深读：面板开着时新选区实时更新并重分析。
  // 双通道（M4 修复）：storage.onChanged 为主（storage 变更在所有扩展上下文可靠触发，
  // 不受"onMessage 处理中再广播"的时序影响）；runtime 广播为辅助。
  chrome.storage.onChanged.addListener(function (changes, area) {
    if (area !== 'session') return;
    if (changes.activeSelection) {
      var v = changes.activeSelection.newValue;
      if (!v || !v.payload || !v.payload.selectedText) { resetToEmpty(); return; }
      showClaim(v.payload);
      return;
    }
    // 悬浮球 Ready 后 docIndex 更新 → 无选区工作台时切概览（U4）
    if (changes.docIndex && changes.docIndex.newValue && !state.claimPayload) {
      state.docIndex = changes.docIndex.newValue;
      state.verified = {};
      renderView();
    }
  });

  chrome.runtime.onMessage.addListener(function (message) {
    if (!message || message.type !== WCC_MSG.ACTIVE_SELECTION_UPDATED) return;
    if (!message.payload || !message.payload.selectedText) { resetToEmpty(); return; }
    showClaim(message.payload);
  });

  // 背景光斑（毛玻璃需要背后有内容）
  (function injectOrbs() {
    var wrap = document.createElement('div');
    wrap.className = 'orbs';
    wrap.appendChild(el('div', 'orb o1'));
    wrap.appendChild(el('div', 'orb o2'));
    document.body.prepend(wrap);
  })();

  renderView();
})();
