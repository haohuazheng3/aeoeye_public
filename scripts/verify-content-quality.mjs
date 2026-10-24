import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';

// 2026-09-24 清理后固化的选题边界,2026-10-03 扩到全部内容栏目。名单文件与 middleware(410)/next.config(301)共用。
// 名单键是完整站内路径;没有前导斜杠的老条目 = /blog/<slug>。
const RETIRED = JSON.parse(fs.readFileSync(new URL('../content/retired.json', import.meta.url), 'utf8'));
const retiredPath = (k) => (k.startsWith('/') ? k.toLowerCase() : `/blog/${k.toLowerCase()}`);
export const RETIRED_PATHS = new Set([...RETIRED.gone, ...Object.keys(RETIRED.merged)].map(retiredPath));
/** 博客 slug 视图(老接口,测试与 featured 校验在用) */
export const RETIRED_SLUGS = new Set([...RETIRED_PATHS].filter((p) => p.startsWith('/blog/')).map((p) => p.slice('/blog/'.length)));
/** 除博客外,按 JSON 存放的内容栏目(老栏目;2026-10-24 起整树 410,目录为空) */
export const PAGE_SECTIONS = ['answers', 'guides', 'compare', 'vs', 'alternatives', 'for'];
/** SEO 底座 v2(2026-10-24 下午):A 级工具优先页 content/tools/<slug>.json,证据 tools--<slug>.json */
export const TOOL_SECTION = 'tools';

const seg = (re) => new RegExp(`(^|-)(?:${re})(-|$)`);
// 只有这些 AI 可见度 / AEO 工具与服务,才允许出 pricing / review / alternatives / vs 页
const AEO_SUBJECTS = seg('profound|peec|peec-ai|otterly|otterly-ai|athenahq|scrunch|scrunch-ai|llmrefs|trakkr|goodie|rank-prompt|airank|aerank|geostars|geopher-ai|geopta|se-ranking-ai-search|yext-scout|brandlight|evertune|nightwatch|quattr|knowatoa|promptwatch|qwairy|rankscale|waikay|ziptie|airops|bluefish|bluefish-ai|geneo|igeo|igeo-ai|xfunnel|geordy|serprecon|koalr|scope-ai-visibility|searchable|gauge-ai-visibility|hall-ai-visibility|am-i-on-ai|mentionsflow|getmentioned|mentionowl|visibility-so|ai-search-visibility|mentions-so|aeo-grader|hubspot-aeo-grader|brand-radar|ahrefs-brand-radar|semrush-ai|semrush-ai-toolkit|similarweb-ai|aeo|geo|seo|aeo-tool|aeo-tools|geo-tool|geo-tools|ai-visibility|ai-visibility-tool|ai-visibility-tools|llm-visibility|chatgpt-rank-tracker|ai-rank-tracker|ai-search-optimization|generative-engine-optimization|answer-engine-optimization');
// AI 助手/模型本身:允许写"它如何检索、引用、推荐品牌",不允许写它的套餐价格、功能教程、产品评测
const AI_ASSISTANTS = seg('chatgpt|claude|gemini|copilot|perplexity|grok|deepseek|openai|anthropic|genspark|character-ai|notebooklm|manus|manus-ai|together-ai|mistral|llama|meta-ai|kimi|qwen');
const SEARCH_SIDE = /perplexity|google|bing|ai-mode|ai-overview/;
const PRODUCT_PAGE = /(^|-)(pricing|price|cost|review|reviews|alternatives?|projects|gems|spaces|operator|deep-research|custom-instructions|enterprise|codex|for-business|plus|pro|max|worth-it|browser|atlas)(-|$)|api-pricing|claude-code/;
const GENERIC_SEO = /^(what-is-(a-)?(serp|crawling|indexing|alt-text|backlink|domain-authority|anchor-text|canonical-tag|meta-description|technical-seo|on-page-seo|off-page-seo|keyword-research|organic-traffic|link-building|featured-snippet|keyword-difficulty)|is-seo-(still-relevant|worth-it)|seo-(in-\d{4}|statistics|experiments|forecasting|vs-sem|vs-ppc|pricing|automation-tools|audit-checklist)|how-(long-does-seo-take|to-measure-seo|many-websites-are-there)|saas-seo(-agency)?|white-label-seo|programmatic-seo|parasite-seo|keyword-cannibalization|keyword-clustering-tool|informational-keywords|content-marketing-statistics|browser-market-share|technical-seo-checklist|(webflow|squarespace|wix|shopify|wordpress)-seo|best-(keyword-research-tools|rank-tracking-software|competitor-analysis-tools|enterprise-seo-tools|free-seo-reporting-tools|seo-tools-for-agencies)|free-seo-audit-tools)$/;
const GENERIC_AI = /^(what-is-(fine-tuning|a-token-in-ai|an-ai-agent|an-ai-model|nlp|multimodal-ai|inference-in-ai|a-diffusion-model|a-foundation-model|a-chatbot|agentic-ai|prompt-engineering|generative-ai|an-llm|a-large-language-model|embeddings|vector-search|a-vector-database|semantic-search|ai-hallucination|grounding-in-ai|a-knowledge-graph|sge|a-transformer|a-neural-network|machine-learning|deep-learning|artificial-intelligence)|how-does-(claude|chatgpt|gemini|copilot|grok|deepseek|perplexity|google-ai-mode)-work|autonomous-ai-agents|best-ai-(agent|chatbot|assistant|for-research|for-writing|humanizer|browser)|ai-(agent-builder|seo-agent|content-writing|model-comparison|shopping|shopping-assistant)|prompt-engineer-salary|comet-vs-atlas|google-knowledge-graph-api|is-google-dying|will-(chatgpt|ai)-replace-google|future-of-search|turn-off-ai-mode)$/;
// 2026-10-03:泛 SEO 工具页 / 消费者意图(生成器、测试工具 —— 站内已有对应的免费工具页)
const GENERIC_TOOL_PAGE = /^((schema-markup|faq-schema|json-ld|robots-txt|llms-txt)-generator|structured-data-testing-tool|people-also-ask|digital-pr)$/;
// AI 公司营收 / 市场份额 / 用户量这类行业统计:与"品牌在 AI 答案里被不被推荐"无关
const AI_INDUSTRY_STATS = /(^|-)(revenue|market-share|valuation|funding|net-worth|user-count)$|^(?:[a-z0-9-]+-)?(chatgpt|claude|gemini|perplexity|copilot|grok|deepseek|openai|anthropic|llm|generative-ai|ai-usage|ai-adoption|voice-search|search-engine|ai-hallucination|ai-misinformation)-(statistics|stats|users|usage)$/;
// SEO 底座 v2(站长 2026-10-24 下午):选题边界扩到"免费 SEO 审计 / AI 可见度审计能直接承接的技术 SEO 单点检查与决策"。
// B 级决策页只允许这份点名清单 —— 放宽只能由站长拍板后改这里。
export const TECH_SEO_DECISIONS = new Set(['301-vs-302', 'https-vs-http', 'subdomain-vs-subfolder', 'webp-vs-avif']);
// 对比页要有"品牌可见度"这条线,否则就是助手 / 搜索引擎测评
const VISIBILITY_ANGLE = /(^|-)(brand|brands|visibility|citations?|cited|seo|aeo|geo|ranking|rank|mentions?|recommend[a-z]*|traffic|optimization)(-|$)/;

/** 返回跑题原因;null = 允许。规则与 2026-09-24 的清理决策一致(docs/audit/2026-09-24-content-pruning.md)。 */
export function offTopicReason(slug, section = 'blog') {
  if (RETIRED_PATHS.has(`/${section}/${slug}`.toLowerCase())) return 'retired URL (content/retired.json) — must not be re-created';
  // 工具页本身就是"免费审计承接的单点检查";只挡 AI 通识、行业统计与第三方产品价格评测
  if (section === TOOL_SECTION) {
    if (GENERIC_AI.test(slug)) return 'generic AI explainer / assistant roundup';
    if (AI_INDUSTRY_STATS.test(slug)) return 'AI industry revenue / market-share / usage statistics with no brand-visibility angle';
    if (PRODUCT_PAGE.test(slug)) return 'third-party software pricing/review/alternatives page';
    return null;
  }
  if (section === 'blog' && TECH_SEO_DECISIONS.has(slug)) return null;
  if (GENERIC_SEO.test(slug)) return 'generic SEO fundamentals without an AI-visibility angle';
  if (GENERIC_AI.test(slug)) return 'generic AI explainer / assistant roundup';
  if (GENERIC_TOOL_PAGE.test(slug)) return 'generic SEO utility / consumer topic (AEOeye already has the matching free tool page)';
  if (AI_INDUSTRY_STATS.test(slug)) return 'AI industry revenue / market-share / usage statistics with no brand-visibility angle';
  if (AEO_SUBJECTS.test(slug)) return null;
  if (/-vs-/.test(slug)) {
    if (!AI_ASSISTANTS.test(slug) && !SEARCH_SIDE.test(slug)) return 'comparison between products outside AI visibility';
    if (!VISIBILITY_ANGLE.test(slug)) return 'AI assistant / search engine comparison with no brand-visibility angle';
    return null;
  }
  if (PRODUCT_PAGE.test(slug)) {
    return AI_ASSISTANTS.test(slug) ? 'AI product pricing/feature/review page (not about how it cites or recommends brands)' : 'third-party software pricing/review/alternatives page';
  }
  return null;
}

export const CORE_TOPICS = new Set([
  'ai-search-visibility', 'answer-engine-optimization', 'brand-citations',
  'ai-crawler-indexing', 'aeo-measurement', 'aeo-buyer-decisions',
  // SEO 底座 v2:免费 SEO 审计承接的技术检查工具与决策
  'technical-seo-tools', 'technical-seo-decisions',
]);
const KINDS = new Set(['guide', 'pricing-guide', 'documentation-guide', 'hands-on-review', 'research-asset', 'tool-page']);
// 发布门禁 · 无内部备注/占位符(底座 v2 四道门之一):模板残留、待填项、草稿标记
const PLACEHOLDERS = /\b(?:TODO|TBD|FIXME|lorem ipsum|placeholder text|insert [a-z ]{2,20} here|writer brief|evidence pack)\b|\{\{[^}]*\}\}|\[(?:citation needed|link|source|image)\]|\bXX(?:%|\.X)?\b/i;
/** 可见词数(与 content-lint 同口径:去代码块、图片、链接地址、标记符号) */
export function visibleWords(md) {
  const t = String(md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_`|-]/g, ' ');
  return (t.match(/[A-Za-z0-9][A-Za-z0-9'’.-]*/g) || []).length;
}
/** A 级 300–800 词(答案句 + 正文,不含 FAQ);B 级 1200–1500 词(正文,不含 FAQ 与 frontmatter) */
export const WORD_RANGE = { tool: [300, 800], decision: [1200, 1500] };
const INTERNAL_NOTES = /\b(?:the supplied (?:plan |official )?(?:facts|information|guide|pricing|rate)|supplied (?:plan facts|official facts|pricing (?:summary|information)|plan limits|US pricing)|not specified in (?:the )?supplied facts|storage shown in supplied facts|according to (?:the )?(?:writer|writing) brief|insert (?:price|source) here|TODO:\s*(?:price|source|verify))\b/i;
const GENERIC_PRICING = /^(?:slack|dropbox|zoom|mailchimp|mailgun|hootsuite|meltwater|brandwatch|hubspot|canva-pro)-pricing$/;
const sha256 = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const meaningful = (value, min = 25) => typeof value === 'string' && value.trim().length >= min;
const dated = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const httpsUrl = (value) => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

/** This is a mechanical evidence gate, not an automated judgment of factual truth. */
/** JSON 内容页(answers / guides / compare / vs / alternatives / for)的可见文字,供与 mdx 正文同样的检查 */
function pageText(page) {
  if (typeof page.body === 'string' && page.runner) {
    // 工具页:标题 / 答案句 / 可信说明 / 正文 / FAQ / 来源 都是可见文字
    const tp = [page.title, page.answer, page.trust, page.body];
    for (const f of page.faqs ?? []) tp.push(`### ${f.q}`, f.a);
    for (const src of page.sources ?? []) tp.push(`${src.label} ${src.url}`);
    return tp.filter(Boolean).join('\n\n');
  }
  const parts = [page.title, page.shortAnswer, page.intro];
  for (const sec of page.sections ?? []) parts.push(`## ${sec.heading}`, sec.body);
  if (page.comparisonTable) parts.push(JSON.stringify(page.comparisonTable));
  for (const t of page.keyTakeaways ?? []) parts.push(t);
  for (const f of page.faqs ?? []) parts.push(`### ${f.q}`, f.a);
  for (const src of page.sources ?? []) parts.push(`${src.label} ${src.url}`);
  for (const st of page.howToSteps ?? []) parts.push(st.name, st.text);
  return parts.filter(Boolean).join('\n\n');
}

function parseDoc(file, raw) {
  if (file.endsWith('.json')) {
    const page = JSON.parse(raw);
    return { data: page, content: pageText(page) };
  }
  return matter(raw);
}

/** content/<section>/<slug>.(mdx|md|json) → { section, slug } */
export function docId(file) {
  const m = file.match(/content\/([a-z]+)\/([^/]+?)\.(?:mdx?|json)$/);
  return m ? { section: m[1], slug: m[2] } : { section: 'blog', slug: path.basename(file).replace(/\.(?:mdx?|json)$/, '') };
}

export function checkPost({ file, raw, baselineHash, evidence, artifactExists = () => false }) {
  const errors = [];
  let parsed;
  try { parsed = parseDoc(file, raw); } catch { return [`${file}: malformed content file`]; }
  const { data, content } = parsed;
  const fail = (message) => errors.push(`${file}: ${message}`);
  const residue = raw.match(INTERNAL_NOTES);
  if (residue) fail(`internal drafting note: ${residue[0]}`);
  const { section: sec0 } = docId(file);
  if (sec0 === TOOL_SECTION || evidence?.topic?.area === 'technical-seo-decisions' || evidence?.kind === 'tool-page') {
    const ph = content.match(PLACEHOLDERS);
    if (ph) fail(`placeholder / unfinished text in the published page: "${ph[0]}"`);
  }
  const scenarios = [...content.matchAll(/^#{2,4}\s+Scenario\s+(\d+)\s*:/gmi)].map((m) => Number(m[1]));
  if (scenarios.some((n, i) => n !== i + 1)) fail('scenario numbering must start at 1 and be consecutive');
  const hash = sha256(raw);
  // Historical unchanged pages are not silently certified; corrections and all new pages require evidence.
  if (baselineHash === hash && !evidence) return errors;
  if (!evidence) { fail('new/changed article needs content/editorial-evidence/<slug>.json'); return errors; }
  if (evidence.contentSha256 !== hash) fail('evidence fingerprint is stale; review the final article again');
  if (!dated(evidence.reviewedAt)) fail('reviewedAt must be an ISO date');
  if (!meaningful(evidence.assessment, 60)) fail('record a substantive editorial assessment, not a pass checkbox');
  if (!KINDS.has(evidence.kind)) fail('unrecognized article kind');
  const isNew = !baselineHash;
  const topic = evidence.topic || {};
  if (!CORE_TOPICS.has(topic.area) && !(baselineHash && topic.area === 'legacy-adjacent')) fail('new articles must serve an AEOeye core topic');
  if (!meaningful(topic.readerProblem) || !meaningful(topic.connection)) fail('explain the reader problem and actual AEOeye connection');
  const { section, slug } = docId(file);
  if (isNew && GENERIC_PRICING.test(slug)) fail('generic software pricing cannot be used to fill an AEOeye quota');
  if (RETIRED_PATHS.has(`/${section}/${slug}`)) fail('this URL was retired (2026-09-24 / 2026-10-03 cleanups, content/retired.json) and must not be re-created');
  else if (isNew) { const offTopic = offTopicReason(slug, section); if (offTopic) fail(`off-topic for AEOeye (${offTopic}); only AI-visibility / AEO topics may be published`); }
  if (evidence.kind === 'documentation-guide') {
    if (/\breview\b/i.test(String(data.title))) fail('untested documentation guides must not be presented as hands-on reviews');
    const opening = content.slice(0, 2400);
    if (!/documentation[- ]based|public documentation|documented features/i.test(opening) || !/not (?:a )?hands-on|have not|did not|not tested/i.test(opening)) fail('documentation guide must disclose source scope and unperformed tests near its opening');
  }
  if (section === TOOL_SECTION) {
    // A 级工具优先页:首屏即工具、单一意图、300–800 词、2–3 张 Pexels 图、3–5 FAQ、相关工具真实存在
    if (evidence.kind !== 'tool-page') fail('tool pages must be recorded as kind "tool-page"');
    if (data.slug !== slug) fail('slug field must match the file name');
    if (!data.runner || typeof data.runner.component !== 'string') fail('tool page needs a runner (the tool is the first screen)');
    const n = visibleWords([data.answer, data.body].join('\n\n'));
    const [lo, hi] = WORD_RANGE.tool;
    if (n < lo || n > hi) fail(`A-level tool page body is ${n} words; must be ${lo}–${hi}`);
    if (visibleWords(data.answer) > 60) fail('answer sentence under the H1 must be ≤ 60 words');
    const imgs = Array.isArray(data.images) ? data.images : [];
    if (imgs.length < 2 || imgs.length > 3) fail(`${imgs.length} images; tool pages need 2–3 Pexels images`);
    for (const im of imgs) if (!/^https:\/\/images\.pexels\.com\/photos\/\d+\//.test(im.url || '') || !meaningful(im.alt, 20) || !meaningful(im.photographer, 1)) fail(`image needs a Pexels URL, descriptive alt and photographer: ${im.url}`);
    const faqs = Array.isArray(data.faqs) ? data.faqs : [];
    if (faqs.length < 3 || faqs.length > 5) fail(`${faqs.length} FAQs; need 3–5`);
    if (!Array.isArray(data.keywords) || data.keywords.length === 0) fail('bind at least one validated keyword');
    if (!/^## /m.test(String(data.body))) fail('body needs H2 sections (one per secondary keyword / sub-question)');
  }
  if (section === 'blog' && isNew && evidence.topic?.area === 'technical-seo-decisions' || (section === 'blog' && isNew && data.verdict)) {
    // B 级决策页:首屏结论卡 + 1200–1500 词
    if (!data.verdict || !meaningful(data.verdict.summary, 40) || !Array.isArray(data.verdict.picks) || data.verdict.picks.length < 2) fail('B-level decision page needs a verdict card (summary + at least two "when → pick" lines)');
    const n = visibleWords(content);
    const [lo, hi] = WORD_RANGE.decision;
    if (n < lo || n > hi) fail(`B-level decision page body is ${n} words; must be ${lo}–${hi}`);
  }
  const sources = evidence.sources;
  if (!Array.isArray(sources) || sources.length === 0) fail('at least one checked source is required');
  else for (const source of sources) {
    if (!httpsUrl(source.url) || !dated(source.checkedAt) || !meaningful(source.supports, 15)) fail('source needs an HTTPS URL, check date and supported claim');
    if (!raw.includes(source.url)) fail(`source must also be visible in the article: ${source.url}`);
  }
  if (!Array.isArray(evidence.checks) || evidence.checks.length < 3 || evidence.checks.some((v) => !meaningful(v, 15))) fail('record at least three specific completed editorial checks');
  const isPricing = evidence.kind === 'pricing-guide' || /\b(pricing|cost)\b/i.test(String(data.title));
  if (isPricing) {
    const pricing = evidence.pricing || {};
    if (!['published', 'quote-only', 'not-publicly-verified'].includes(pricing.status)) fail('pricing disclosure status is required');
    if (!meaningful(pricing.region, 2) || !meaningful(pricing.billing, 8) || !dated(pricing.checkedAt)) fail('pricing must identify region, billing basis and check date');
    if (!meaningful(pricing.verification, 50)) fail('explain the actual price/limit/arithmetic verification');
    if (pricing.status === 'published' && !/[$€£₹]\s*\d|\b(?:USD|EUR|GBP|INR)\s*\d/i.test(content)) fail('published pricing needs concrete amounts in the visible body');
    if (pricing.status !== 'published' && !/quote|not publicly|not independently verified|could not verify|not verified/i.test(content.slice(0, 2400))) fail('unavailable pricing must be disclosed near the opening, not buried');
  }
  const needsArtifacts = evidence.kind === 'hands-on-review' || evidence.kind === 'research-asset';
  if (needsArtifacts) {
    const artifacts = evidence.artifacts;
    if (!Array.isArray(artifacts) || artifacts.length === 0) fail('hands-on reviews and research assets need actual reader-accessible evidence/artifacts');
    else for (const artifact of artifacts) {
      if (!meaningful(artifact.description, 25) || !artifactExists(artifact.path)) fail(`missing/invalid artifact: ${artifact.path}`);
      if (!content.includes(artifact.path)) fail(`artifact must be linked in the visible body: ${artifact.path}`);
    }
    if (!meaningful(evidence.methodology, 80) || !meaningful(evidence.limitations, 40)) fail('state methodology and limits rather than inventing results');
  }
  if (evidence.kind === 'hands-on-review') {
    if (!Array.isArray(evidence.observations) || evidence.observations.length < 2 || evidence.observations.some((x) => !meaningful(x.input, 15) || !meaningful(x.output, 15))) fail('hands-on review needs at least two actual input/output observations');
  }
  return errors;
}

/** 站内路径是否指向一个现存、未下线的页(拓扑 / 术语深读 / featured 的链接都要过这一关) */
export function pageExists(root, href) {
  const clean = href.replace(/[#?].*$/, '').replace(/\/$/, '').toLowerCase();
  if (RETIRED_PATHS.has(clean)) return false;
  const hub = clean.match(/^\/tools\/category\/([a-z0-9-]+)$/);
  if (hub) return fs.readFileSync(path.join(root, 'lib/content/tool-pages.ts'), 'utf8').includes(`slug: "${hub[1]}"`);
  const m = clean.match(/^\/([a-z]+)(?:\/([a-z0-9-]+))?$/);
  if (!m) return false;
  const [, section, slug] = m;
  if (!slug) return ['blog', 'glossary', 'tools', ...PAGE_SECTIONS].includes(section);
  if (section === 'blog') return ['.mdx', '.md'].some((ext) => fs.existsSync(path.join(root, 'content/blog', slug + ext)));
  if (PAGE_SECTIONS.includes(section)) return fs.existsSync(path.join(root, 'content', section, `${slug}.json`));
  if (section === 'glossary') return fs.readFileSync(path.join(root, 'lib/content/glossary.ts'), 'utf8').includes(`slug: "${slug}"`);
  if (section === 'tools') return fs.existsSync(path.join(root, 'content/tools', `${slug}.json`)) || fs.readFileSync(path.join(root, 'lib/content/tools.ts'), 'utf8').includes(`"${slug}"`);
  return false;
}

export function verifyContent(root = process.cwd()) {
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'content/editorial-baseline.json'), 'utf8'));
  const evidenceDir = path.join(root, 'content/editorial-evidence');
  const blogFiles = fs.readdirSync(path.join(root, 'content/blog')).filter((f) => /\.mdx?$/.test(f));
  // 博客 + JSON 内容页一视同仁:新页 / 改过的页都要有编辑证据;JSON 页的证据文件名是 <section>--<slug>.json
  const docs = [
    ...blogFiles.map((name) => ({ file: `content/blog/${name}`, evidenceName: name.replace(/\.mdx?$/, '.json') })),
    ...[...PAGE_SECTIONS, TOOL_SECTION].flatMap((section) => {
      const dir = path.join(root, 'content', section);
      if (!fs.existsSync(dir)) return [];
      return fs.readdirSync(dir).filter((f) => f.endsWith('.json')).map((name) => ({ file: `content/${section}/${name}`, evidenceName: `${section}--${name}` }));
    }),
  ];
  const errors = [];
  let reviewed = 0;
  // 2026-10-24 上午停做 SEO 时这里曾拒绝一切内容页;同日下午站长以 SEO 底座 v2 重启(A 级工具页 + B 级决策页),
  // 改为:老栏目仍不许出现文件(整树 410),新页一律走编辑证据与 A/B 结构门禁。
  for (const d of docs) {
    const { section } = docId(d.file);
    if (PAGE_SECTIONS.includes(section)) errors.push(`${d.file}: legacy content sections (answers/guides/compare/vs/alternatives/for) stay retired (HTTP 410) — publish tool pages under content/tools or decision pages under content/blog`);
  }
  const artifactExists = (value) => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('..')) return false;
    const target = path.resolve(root, 'public', value.slice(1));
    return target.startsWith(path.resolve(root, 'public') + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile() && fs.statSync(target).size > 0;
  };
  for (const { file, evidenceName } of docs) {
    const { section, slug } = docId(file);
    if (RETIRED_PATHS.has(`/${section}/${slug}`)) { errors.push(`${file}: retired page file is still in the repo — delete it (its URL now returns 410 / 301 via content/retired.json)`); continue; }
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    const evidenceFile = path.join(evidenceDir, evidenceName);
    let evidence;
    if (fs.existsSync(evidenceFile)) {
      try { evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8')); reviewed++; }
      catch { errors.push(`${file}: malformed editorial evidence JSON`); continue; }
    }
    errors.push(...checkPost({ file, raw, baselineHash: baseline.posts[file], evidence, artifactExists }));
  }
  const featured = JSON.parse(fs.readFileSync(path.join(root, 'content/editorial-featured.json'), 'utf8'));
  for (const slug of featured) {
    if (!blogFiles.some((f) => f.replace(/\.mdx?$/, '') === slug)) errors.push(`featured page does not exist: ${slug}`);
    if (GENERIC_PRICING.test(slug)) errors.push(`generic software price guide cannot lead the AEO blog: ${slug}`);
    if (RETIRED_SLUGS.has(slug)) errors.push(`retired page cannot be featured: ${slug}`);
  }
  // 工具页 related 与正文 / 决策页正文里的站内链接必须指向现存、未下线页
  for (const { file } of docs) {
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    let hrefs = [];
    if (file.startsWith('content/tools/')) {
      const page = JSON.parse(raw);
      for (const r of page.related ?? []) if (!pageExists(root, `/tools/${r}`)) errors.push(`${file}: related tool does not exist: ${r}`);
      hrefs = [...String(page.body).matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
    } else if (file.startsWith('content/blog/')) {
      const { data, content } = matter(raw);
      for (const r of data.relatedTools ?? []) if (!pageExists(root, `/tools/${r}`)) errors.push(`${file}: related tool does not exist: ${r}`);
      hrefs = [...content.matchAll(/\]\((\/[^)\s]*)\)/g)].map((m) => m[1]);
    }
    for (const h of hrefs) {
      const clean = h.replace(/[#?].*$/, '').replace(/\/$/, '') || '/';
      if (/^\/(blog|tools|glossary|answers|guides|compare|vs|alternatives|for)(\/|$)/.test(clean) && !pageExists(root, clean)) errors.push(`${file}: links to a missing or retired page: ${h}`);
    }
  }
  // 代码里写死的站内链接(主题拓扑、术语"深读")必须指向现存页 —— 清理后最容易留下的就是这种死链
  for (const rel of ['lib/content/clusters.ts', 'lib/content/glossary.ts']) {
    const src = fs.readFileSync(path.join(root, rel), 'utf8');
    for (const [, href] of src.matchAll(/href:\s*"([^"]+)"/g)) {
      if (href.startsWith('/') && !pageExists(root, href)) errors.push(`${rel}: link to a missing or retired page: ${href}`);
    }
  }
  return { pages: docs.length, reviewed, legacyUnchanged: docs.length - reviewed, errors };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const result = verifyContent();
    if (result.errors.length) {
      console.error(result.errors.join('\n'));
      console.error(`Content quality gate FAILED: ${result.errors.length} issue(s).`);
      process.exitCode = 1;
    } else console.log(`Content quality gate PASS: ${result.pages} pages; ${result.reviewed} evidence-reviewed; ${result.legacyUnchanged} historical unchanged (not newly certified).`);
  } catch (error) { console.error(`Content quality gate failed closed: ${error.message}`); process.exitCode = 1; }
}
