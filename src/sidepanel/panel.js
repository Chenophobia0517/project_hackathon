// Side Panel 工作台（M2）：三 Tab、Loading/Error/Empty 状态机、连续深读。
// 交互原则（PRD 05-UI-UX）：Tab 切换不改变 Claim；新选区自动重分析；结果逐层出现。
(function () {
  'use strict';

  var els = {
    empty: document.getElementById('empty-state'),
    card: document.getElementById('claim-card'),
    text: document.getElementById('claim-text'),
    expand: document.getElementById('claim-expand'),
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
    mode: 'truth',        // 当前 Tab
    results: {},          // mode -> { result, cached }
    analyzing: false,
    seq: 0                // 丢弃过期响应（连续深读时旧响应作废）
  };

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
      els.cacheFlag.textContent = cached.cached ? '缓存' : '';
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
            state.results[mode] = { result: resp.analysis.result, cached: resp.analysis.cached };
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

  function renderTruth(result) {
    var pane = els.panes.truth;
    pane.innerHTML = '';
    var c1 = cardWith('支持程度');
    c1.appendChild(el('span', 'badge ' + esc(result.supportLevel), SUPPORT_BADGES[result.supportLevel] || result.supportLevel));
    c1.appendChild(el('div', 'summary-text', esc(result.summary)));
    pane.appendChild(c1);

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
          nodesWrap.appendChild(el('span', 'node-chip', esc(n)));
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

  function renderResult(mode, entry) {
    hide(els.error);
    if (!entry) { // 该模式上次失败
      showError(state.lastError);
      return;
    }
    RENDERERS[mode](entry.result);
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

  // 面板打开时拉取当前 Active Selection
  try {
    chrome.runtime.sendMessage({ type: WCC_MSG.GET_ACTIVE_SELECTION }, function (resp) {
      if (chrome.runtime.lastError) return;
      if (resp && resp.ok && resp.selection && resp.selection.payload) {
        showClaim(resp.selection.payload);
      } else {
        renderView();
      }
    });
  } catch (e) { /* context invalidated */ }

  // 连续深读：面板开着时新选区实时更新并重分析
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
