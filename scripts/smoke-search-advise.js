// search_advise + upgrade.md 改造回归冒烟测试（§39 Test A/B/C 的可执行子集）
// 运行：node scripts/smoke-search-advise.js
// 只测纯逻辑（不发起任何真实 API 请求）：实体识别 / 跨语言 Query / 双核计划 /
// 八维排序（官方优先、全国 vs 县级降权）/ 转载分级 / 多样性验证池 /
// Evidence Targeting（匿名人物/显式来源）/ Academic Exact-Source / Provenance 共同上游。
'use strict';

const path = require('path');
const root = path.join(__dirname, '..');
function load(p) { require(path.join(root, 'src', 'core', 'ai', p)); }

(async function main() {
  globalThis.QIUZHEN_CONFIG = {
    DEEPSEEK_API_KEY: 'sk-test', DEEPSEEK_BASE_URL: 'https://api.deepseek.com', DEEPSEEK_MODEL: 'deepseek-chat',
    ZHIHU_ACCESS_SECRET: 'zh-test', ZHIHU_API_BASE: 'https://developer.zhihu.com/api/v1/content',
    METASO_API_KEY: 'mk-test', METASO_ENDPOINT: 'https://metaso.cn/api/v1/search',
    EXA_API_KEY: 'ex-test'
  };

  load('url-utils.js');
  load('query-analyzer.js');
  load('datasource.js');
  load('web-reader.js');
  load('source-registry.js');
  load('source-analyzer.js');
  load('evidence-graph.js');
  load('scoring-engine.js');
  load('verify-engine.js');
  load('search-controller.js');
  load('evidence-target.js');
  load('academic.js');
  load('provenance.js');
  load('v25-pipeline.js');

  const QA = globalThis.WCC_QUERY_ANALYZER;
  const EG = globalThis.WCC_EVIDENCE_GRAPH;
  const SE = globalThis.WCC_SCORING_ENGINE;
  const VE = globalThis.WCC_VERIFY_ENGINE;
  const V25 = globalThis.WCC_V25;
  const ET = globalThis.WCC_EVIDENCE_TARGET;
  const AC = globalThis.WCC_ACADEMIC;
  const PV = globalThis.WCC_PROVENANCE;

  let pass = 0, fail = 0;
  function ok(cond, name) {
    if (cond) { pass++; console.log('  PASS ' + name); }
    else { fail++; console.log('  FAIL ' + name); }
  }

  console.log('\n[1] 实体识别 + 官方域名（§3.3/§24：NASA 案例）');
  const ents = QA.detectEntities('NASA 阿尔忒弥斯任务为什么取消？');
  ok(ents.some(e => e.name === 'nasa' && (e.domains || []).indexOf('nasa.gov') >= 0), 'NASA → nasa.gov');
  ok(QA.detectEntities('2025年国家统计局发布的数据').some(e => e.domains && e.domains.indexOf('stats.gov.cn') >= 0), '国家统计局 → stats.gov.cn');

  console.log('\n[2] 地域范围识别（§10：全国 vs 县级）');
  ok(QA.detectScopeLevel('2025年全国人口是多少', []) === 'national', '"全国人口" → national');
  ok(QA.detectScopeLevel('某县人口统计', []) === 'county', '"某县" → county');
  ok(QA.detectScopeLevel('NASA 阿尔忒弥斯任务', ents) === 'global', 'NASA → global');

  console.log('\n[3] 跨语言 Query 展开（§3.2：NASA 三路查询）');
  const nasaStrategy = {
    questionType: 'fact', keywords: ['NASA 阿尔忒弥斯 任务 取消 原因'], keywordsEn: ['NASA Artemis mission cancellation reason'],
    entities: ents, scopeLevel: 'global', questionFocus: '取消原因', preferredSources: ['gov', 'media'], timeWindow: null, budget: 2, dualEngine: false
  };
  const q3 = QA.buildQueries(nasaStrategy, 'NASA 阿尔忒弥斯任务为什么取消？');
  ok(Array.isArray(q3.en) && q3.en.length > 0, '生成英文 Query');
  ok(q3.official.some(o => /site:nasa\.gov/.test(o.query) || o.domain === 'nasa.gov'), '生成官方域 Query site:nasa.gov');

  console.log('\n[4] 双核检索计划（§5.1：fact 不再排除 Exa）');
  const plan = V25.buildPlan(nasaStrategy, 'NASA 阿尔忒弥斯任务为什么取消？');
  const engines = plan.steps.map(s => s.engine);
  ok(engines.indexOf('exa') >= 0 && engines.indexOf('metaso') >= 0, 'exa + metaso 都在计划内');
  ok(plan.steps.some(s => s.engine === 'exa' && s.opts && s.opts.includeDomains && s.opts.includeDomains[0] === 'nasa.gov'), '官方步：exa includeDomains=[nasa.gov]');
  ok(plan.steps.some(s => s.engine === 'metaso' && s.opts && s.opts.siteDomain === 'nasa.gov'), '官方步：metaso site:nasa.gov');
  const zhihuCount = engines.filter(e => e === 'zhihu').length;
  ok(zhihuCount === 1, 'zhihu 低配额单步（1 步）');

  console.log('\n[5] 八维排序：官方原始源 > 中文媒体（§7/§13：NASA 案例）');
  function srcItem(url, title, snippet, a, reg, pub) {
    return { url: url, title: title, snippet: snippet, publishedDate: pub,
      sourceAnalysis: a, registryInfo: reg, evidenceClusterId: 'ec-0', suspectedSyndication: false, sameAsOriginal: null };
  }
  const nasaGov = srcItem('https://www.nasa.gov/news-release/artemis/', 'NASA Statement on Artemis Mission',
    'NASA announced the Artemis mission adjustment and the reason for cancellation on March 2025.',
    { sourceType: 'gov', identityType: 'government_official', originality: 'original', scopeLevel: 'global' },
    { tier: 'verified', prior: 95, label: 'NASA' }, '2025-03-01');
  const cnMedia = srcItem('https://www.thepaper.cn/newsDetail_forward_1', 'NASA宣布阿尔忒弥斯任务调整 取消原因公布',
    'NASA 阿尔忒弥斯 任务 调整 取消 原因 2025年3月 报道',
    { sourceType: 'media', identityType: 'mainstream_media', originality: 'secondary', scopeLevel: 'province' },
    { tier: 'candidate', prior: 60, label: '澎湃新闻' }, '2025-03-02');
  let r5 = SE.rank([cnMedia, nasaGov], nasaStrategy, 'NASA 阿尔忒弥斯任务为什么取消？');
  ok(r5.ranked[0].url.indexOf('nasa.gov') >= 0, 'nasa.gov 官方页排第一（当前: ' + r5.ranked[0].title.slice(0, 20) + ' score=' + r5.ranked[0].scoreTotal + '）');

  console.log('\n[6] 地域范围匹配：县级报告必须降权（§10：全国人口案例）');
  const popStrategy = { questionType: 'fact', keywords: ['2025年 中国 人口'], keywordsEn: [], entities: [], scopeLevel: 'national', questionFocus: '人口数量', preferredSources: ['gov', 'media'], timeWindow: '1y', budget: 2, dualEngine: false };
  const statsGov = srcItem('https://www.stats.gov.cn/sj/zxfb/202501/t20250117_1950000.html', '2025年国民经济运行情况',
    '2025年末全国人口 140828 万人 比上年减少 139 万人 国家统计局 公报',
    { sourceType: 'gov', identityType: 'government_official', originality: 'original', scopeLevel: 'national' },
    { tier: 'verified', prior: 95, label: '国家统计局' }, '2025-01-17');
  const countyGov = srcItem('https://www.xxx.gov.cn/tjgb/2025.html', '中宁县2025年国民经济和社会发展统计公报',
    '2025年 中宁县 常住人口 12.5万人 县统计局',
    { sourceType: 'gov', identityType: 'government_official', originality: 'original', scopeLevel: 'county' },
    { tier: 'verified', prior: 95, label: '中国政府' }, '2025-03-01');
  let r6 = SE.rank([countyGov, statsGov], popStrategy, '2025年中国大陆人口是多少？');
  ok(r6.ranked[0].url.indexOf('stats.gov.cn') >= 0, '国家统计局 > 县级统计局（当前第一: ' + r6.ranked[0].title.slice(0, 18) + '）');
  ok(countyGov.scores.scope < 60, '县级来源 scope 分被压低（scope=' + countyGov.scores.scope + '）');

  console.log('\n[7] preferredSources 真正生效（§6.1：政策类 gov 优先）');
  const policyStrategy = { questionType: 'policy', keywords: ['民法典 颁布 时间'], keywordsEn: [], entities: [], scopeLevel: 'national', questionFocus: '颁布时间', preferredSources: ['gov'], timeWindow: '3y', budget: 2, dualEngine: true };
  const npcPage = srcItem('https://www.npc.gov.cn/npc/c30834/202006/75ba6473b85a4d5d9b3b7e8f1a2c3d4e.shtml', '中华人民共和国民法典',
    '2020年5月28日 十三届全国人大三次会议表决通过 中华人民共和国民法典 2021年1月1日起施行',
    { sourceType: 'gov', identityType: 'government_official', originality: 'original', scopeLevel: 'national' },
    { tier: 'verified', prior: 95, label: '全国人大' }, '2020-06-01');
  const procCase = srcItem('https://www.jcy.gov.cn/ajsf/2023/20230315.html', '某县检察院民法典实施典型案例',
    '民法典 实施 案例 民事 检察 监督',
    { sourceType: 'gov', identityType: 'government_official', originality: 'secondary', scopeLevel: 'county' },
    { tier: 'verified', prior: 95, label: '中国政府' }, '2023-03-15');
  let r7 = SE.rank([procCase, npcPage], policyStrategy, '中华人民共和国民法典什么时候颁布？');
  ok(r7.ranked[0].url.indexOf('npc.gov.cn') >= 0, '全国人大法律文本 > 地方检察院案例（当前第一: ' + r7.ranked[0].title.slice(0, 16) + '）');
  ok(npcPage.scores.directness >= 30, 'directness 关键词部分命中已注册（npcPage=' + npcPage.scores.directness + '，基准 20）');

  console.log('\n[8] 转载分级（§17：改标题转载识别）');
  const a1 = { title: 'NASA宣布XX任务调整', snippet: 'NASA 今日宣布 阿尔忒弥斯 任务 进行调整 原因是 成本 超支', url: 'https://a.com/1' };
  const a2 = { title: 'NASA最新决定：XX任务发生变化', snippet: 'NASA 今日宣布 阿尔忒弥斯 任务 进行调整 原因是 成本 超支', url: 'https://b.com/2' };
  const a3 = { title: '某高校食堂推出新菜品', snippet: '该校食堂 推出 时令 菜品 深受学生欢迎', url: 'https://c.com/3' };
  EG.buildClusters([a1, a2, a3]);
  ok(a2.suspectedSyndication === true && a2.evidenceClusterId === a1.evidenceClusterId, '改标题转载被并入同一证据簇');
  ok(a3.suspectedSyndication === false, '无关条目独立成簇');

  console.log('\n[9] 多样性验证池（§19：Top-6 覆盖不同来源类型）');
  const pool = [];
  for (let i = 0; i < 8; i++) pool.push({ url: 'https://media' + i + '.com/' + i, title: '媒体转载' + i, snippet: 'x', sourceAnalysis: { sourceType: 'media' }, scoreTotal: 100 - i });
  pool.push({ url: 'https://www.nasa.gov/1', title: 'NASA 官方', snippet: 'y', sourceAnalysis: { sourceType: 'gov' }, scoreTotal: 60 });
  const picked = VE.selectDiverseTopN(pool, 6);
  const types = {};
  picked.forEach(p => { types[p.sourceAnalysis.sourceType] = true; });
  ok(picked.length === 6 && types.gov === true, '验证池含 gov 类型（数量=' + picked.length + ', 类型=' + Object.keys(types).join(',') + '）');

  console.log('\n[10] Evidence Targeting：匿名人物（upgrade.md §34.1 / Test A）');
  ok(ET.ruleClaimType('朱女士表示该公司已经停止生产某产品') === 'PERSON_EVENT', '匿名人物声明 → PERSON_EVENT');
  ok(ET.ruleEntityResolution('朱女士表示该公司已经停止生产某产品') === 'AMBIGUOUS', '匿名人物 → AMBIGUOUS（禁止强行绑定）');
  ok(ET.ruleEntityResolution('国家统计局发布2025年数据') === 'RESOLVED', '知名机构 → RESOLVED');
  const prevKey = globalThis.QIUZHEN_CONFIG.DEEPSEEK_API_KEY;
  globalThis.QIUZHEN_CONFIG.DEEPSEEK_API_KEY = ''; // 走规则兜底（不触发真实 LLM）
  const etA = await ET.analyze({ text: '朱女士表示该公司已经停止生产某产品' }, { title: '某报道', url: 'https://x.com/1', paragraph: '朱女士表示该公司已经停止生产某产品。' });
  globalThis.QIUZHEN_CONFIG.DEEPSEEK_API_KEY = prevKey;
  ok(etA.claimType === 'PERSON_EVENT' && etA.entityResolutionStatus === 'AMBIGUOUS', 'analyze() 规则兜底：PERSON_EVENT + AMBIGUOUS');
  ok(etA.searchStrategy === 'IDENTIFIER_SEARCH', 'searchStrategy=IDENTIFIER_SEARCH');

  console.log('\n[11] 显式来源提取 + Academic Exact-Source（upgrade.md §14/§15/Test C）');
  const ctxPaper = '本文分析了原论文 https://doi.org/10.1038/s41586-024-00000-1 与 arXiv:2401.12345 的结果。';
  const ex = ET.extractExplicitSources(ctxPaper);
  ok(ex.some(s => s.kind === 'DOI' && s.value.indexOf('10.1038') >= 0), '提取 DOI');
  ok(ex.some(s => s.kind === 'ARXIV'), '提取 arXiv');
  ok(ex.some(s => s.kind === 'URL'), '提取 URL');
  const paperTarget = AC.buildTarget(ex, '论文《某大型语言模型》声称...');
  ok(paperTarget.doi && paperTarget.title === '某大型语言模型', 'buildTarget：DOI + 《标题》');
  const paperOK = AC.validatePaper({ url: 'https://doi.org/10.1038/s41586-024-00000-1', title: '某大型语言模型', snippet: '...' }, paperTarget);
  ok(paperOK.status === 'TARGET_PAPER' && paperOK.matchedOn.indexOf('DOI') >= 0, 'DOI 精确命中 → TARGET_PAPER');
  const paperNear = AC.validatePaper({ url: 'https://www.semanticscholar.org/paper/xyz', title: '某大型语言模型的另一种分析', snippet: '相关研究' }, paperTarget);
  ok(paperNear.status === 'RELATED_PAPER', '非目标论文 → RELATED_PAPER（禁止冒充 TARGET_PAPER）');

  console.log('\n[12] Provenance：共同上游检测（upgrade.md §19~§23/§34.2/Test B）');
  const cluesA = PV.extractProvenance('据路透社报道，该公司昨日宣布... Source: https://reuters.com/a1');
  ok(cluesA.some(c => /路透社/.test(c.publisher || '')), '提取"据X报道"');
  ok(cluesA.some(c => c.relation === 'EXPLICIT_LINK' && c.url), '提取 Source: 直接链接');
  const itemsB = [
    { url: 'https://a.com/1', title: 'A', provenanceClues: [{ publisher: '路透社', relation: 'EXPLICIT_CITATION', url: null }] },
    { url: 'https://b.com/1', title: 'B', provenanceClues: [{ publisher: '路透社', relation: 'EXPLICIT_CITATION', url: null }] },
    { url: 'https://c.com/1', title: 'C', provenanceClues: [] }
  ];
  PV.buildGraph(itemsB);
  ok(itemsB[0].independence === 'SHARED_UPSTREAM' && itemsB[1].provenanceClusterId === itemsB[0].provenanceClusterId, 'A/B 共享同一上游 → 同一 provenance 簇');
  ok(itemsB[2].independence === 'INDEPENDENT', '无上游线索 → INDEPENDENT');

  console.log('\n[13] 验证池避开同溯源簇 + Binding/硬校验（upgrade.md §29/§30/§31）');
  const poolB = [
    { url: 'https://a.com/1', title: 'A媒体', sourceAnalysis: { sourceType: 'media' }, scoreTotal: 95, provenanceClusterId: 'pc-0' },
    { url: 'https://b.com/1', title: 'B媒体', sourceAnalysis: { sourceType: 'media' }, scoreTotal: 90, provenanceClusterId: 'pc-0' },
    { url: 'https://d.com/1', title: 'D上游', sourceAnalysis: { sourceType: 'media' }, scoreTotal: 85, provenanceClusterId: 'pc-1' },
    { url: 'https://gov.cn/1', title: '官方', sourceAnalysis: { sourceType: 'gov' }, scoreTotal: 80 }
  ];
  const pickedB = VE.selectDiverseTopN(poolB, 3);
  ok(pickedB.filter(p => p.provenanceClusterId === 'pc-0').length === 1, '同溯源簇 pc-0 只保留 1 个代表（当前 ' + pickedB.filter(p => p.provenanceClusterId === 'pc-0').length + '）');
  const bindTest = ET.buildBinding({ verdict: 'no_source', evidences: [] }, { claim: 'x', entities: [{ name: '朱女士' }], eventHints: [], entityResolutionStatus: 'AMBIGUOUS', directSourceAvailable: false, claimType: 'PERSON_EVENT', explicitSources: [] }, []);
  ok(bindTest.bindingStatus === 'UNBOUND' && bindTest.hardValidation.passed === false, '无证据 → UNBOUND + 硬校验不过');
  ok(bindTest.ambiguity === true, 'AMBIGUOUS 状态被保留');

  console.log('\n[14] 集成：EvidenceTarget 显式来源步最优先（upgrade.md §14.3）');
  const planET = V25.buildPlan(
    { questionType: 'academic', keywords: ['某论文'], keywordsEn: [], entities: [], scopeLevel: 'unknown', preferredSources: ['paper'], timeWindow: '5y', budget: 2, dualEngine: false },
    '论文《某大型语言模型》的结果如何？',
    { claimType: 'ACADEMIC', explicitSources: [{ kind: 'DOI', value: '10.1038/s41586-024-00000-1', level: 2 }], entities: [], eventHints: [], targetType: 'EXACT_PAPER', searchStrategy: 'EXACT_SOURCE' }
  );
  ok(planET.steps[0].engine === 'explicit' && planET.steps[0].query.indexOf('doi.org/10.1038') >= 0, '显式 DOI 步排最前（当前第一步: ' + planET.steps[0].engine + '）');

  console.log('\n[15] 超链接论文引用（upgrade.md §14：<a href> 场景回归）');
  const WR = globalThis.WCC_WEB_READER;
  const htmlPage = '<html><title>某文章</title><body><p>本文分析原论文：</p>' +
    '<a href="https://doi.org/10.1038/s41586-024-99999-9">Language models are few-shot learners</a>，' +
    '<a href="https://arxiv.org/abs/2401.12345">arXiv 预印本</a>，<a href="https://zhihu.com/question/1">无关</a></body></html>';
  const links = WR.extractLinks(htmlPage);
  ok(links.some(l => l.href.indexOf('doi.org') >= 0 && l.text.indexOf('Language models') >= 0), 'extractLinks 提取超链接 href + 锚文本');
  const linkSources = ET.extractExplicitSourcesFromHtml(htmlPage);
  ok(linkSources.some(s => s.kind === 'DOI' && s.value === '10.1038/s41586-024-99999-9' && s.anchorText.indexOf('Language models') >= 0), 'DOI 链接分类 + 锚文本=论文标题');
  ok(linkSources.some(s => s.kind === 'ARXIV'), 'arXiv 链接分类');
  ok(!linkSources.some(s => s.kind === 'URL' && s.value.indexOf('zhihu.com/question') >= 0), '忽略无关站内链接');
  const etM = ET.mergeExplicitSources({ claimType: 'ACADEMIC', explicitSources: [], directSourceAvailable: false }, '无正文', linkSources);
  ok(etM.directSourceAvailable && etM.explicitSources.some(s => s.kind === 'DOI'), '页面来源并入 evidenceTarget → directSourceAvailable=true');
  const paperTarget2 = AC.buildTarget(etM.explicitSources, '某论文的结果如何？');
  ok(paperTarget2.doi === '10.1038/s41586-024-99999-9' && paperTarget2.title.indexOf('Language models') >= 0, 'buildTarget：DOI + 锚文本标题');
  const viaUrl = AC.validatePaper({ url: 'https://doi.org/10.1038/s41586-024-99999-9', title: 'other', snippet: '' }, { url: 'https://doi.org/10.1038/s41586-024-99999-9' });
  ok(viaUrl.status === 'TARGET_PAPER' && viaUrl.matchedOn.indexOf('EXPLICIT_URL') >= 0, '显式 URL 直中 → TARGET_PAPER（EXPLICIT_URL）');

  console.log('\n结果: ' + pass + ' passed, ' + fail + ' failed');
  process.exit(fail ? 1 : 0);
})().catch(function (e) {
  console.error('SMOKE TEST ERROR:', e && e.stack || e);
  process.exit(99);
});
