/* ============================================================
   内容页写作基因体检(写手自查 + 主编复核共用):node scripts/content-lint.mjs <file...> [--json]
   只查能机械判定的项 —— 字数、配图、FAQ、来源链接密度、站内链接是否指向现存页、一手数据有没有用上、
   标题/描述长度、人设与内部备注。事实真伪、观点质量、是否真的 answer-first,仍要人读。
   退出码:有 error = 1。warning 不拦,但写手应尽量清零。
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';
import { RETIRED_PATHS, pageExists, PAGE_SECTIONS } from './verify-content-quality.mjs';

const ROOT = process.cwd();
const HUBS = new Set(['ai-search-audit-methodology-template', 'ai-search-citation-evaluation-metrics', 'ai-brand-recommendation-measurement', 'ai-search-statistics', 'ai-crawler-user-agent-directory']);
const FIRST_HAND = /ai-crawler-access-study|crawler access study|AEOeye(?:'|’)s (?:own )?(?:audit|data|study|logs|crawler|records)|our (?:own )?(?:audit logs|audit records|crawler study|study|data)|we (?:checked|fetched|crawled|measured|retired|merged|audited)|when we (?:checked|ran|looked|audited)/i;
const DRAFT_NOTES = /\b(?:the supplied (?:plan |official )?(?:facts|information|guide|pricing|rate)|supplied (?:plan facts|official facts|pricing (?:summary|information)|plan limits|US pricing)|not specified in (?:the )?supplied facts|according to (?:the )?(?:writer|writing) brief|insert (?:price|source|image) here|TODO|TBD|lorem ipsum|evidence pack|writer brief|\[citation needed\])\b/i;
const AI_ISMS = /\b(?:delve|in today's (?:fast-paced|digital)|ever-evolving landscape|game-changer|unlock the power|it's important to note that|in conclusion,|navigating the complex|tapestry|revolutioni[sz]e)\b/i;
const PERSONA = /(?:^|[.!?]\s+|\n)I (?:am|was|have|tested|think|believe|ran|found|spent)\b|\bour team of \d+|\b\d+\+? years of experience\b|\bas a (?:seasoned|certified) /;
const AEOEYE_FALSE = /AEOeye(?:'|’)?s? (?:Pro\b|subscription|monthly plan|daily (?:tracking|monitoring))|AEOeye (?:tracks|monitors) (?:daily|continuously)/i;

const words = (t) => (t.match(/[A-Za-z0-9][A-Za-z0-9'’.-]*/g) || []).length;

function visible(md) {
  return md
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[#>*_`|-]/g, ' ');
}

function load(file) {
  const raw = fs.readFileSync(file, 'utf8');
  const rel = path.relative(ROOT, path.resolve(file));
  const m = rel.match(/^content\/([a-z]+)\/([^/]+?)\.(mdx?|json)$/);
  if (!m) throw new Error(`not a content file: ${rel}`);
  const [, section, slug, ext] = m;
  if (ext === 'json') {
    const p = JSON.parse(raw);
    const body = [p.intro, ...(p.sections ?? []).map((s) => `## ${s.heading}\n\n${s.body}`), ...(p.keyTakeaways ?? [])].filter(Boolean).join('\n\n');
    return {
      rel, section, slug, raw, kind: 'json', body,
      bodyForWords: [p.shortAnswer, body].filter(Boolean).join('\n\n'),
      title: p.metaTitle || p.title, h1: p.title, description: p.metaDescription, faqs: p.faqs ?? [],
      sources: p.sources ?? [], hero: p.image ?? null, date: p.updated, published: null, data: p,
    };
  }
  const { data, content } = matter(raw);
  return {
    rel, section, slug, raw, kind: 'mdx', body: content, bodyForWords: content,
    title: data.title, h1: data.title, description: data.description, faqs: data.faqs ?? [],
    sources: data.sources ?? [], hero: data.image ?? null, date: data.date, published: data.published ?? null, data,
  };
}

function pexelsIdsElsewhere(selfRel) {
  const ids = new Map();
  for (const sec of ['blog', ...PAGE_SECTIONS]) {
    const dir = path.join(ROOT, 'content', sec);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      const rel = `content/${sec}/${f}`;
      if (rel === selfRel || !/\.(mdx?|json)$/.test(f)) continue;
      if (RETIRED_PATHS.has(`/${sec}/${f.replace(/\.(mdx?|json)$/, '')}`)) continue;
      const t = fs.readFileSync(path.join(dir, f), 'utf8');
      for (const mm of t.matchAll(/images\.pexels\.com\/photos\/(\d+)\//g)) if (!ids.has(mm[1])) ids.set(mm[1], rel);
    }
  }
  return ids;
}

export function lint(file, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const d = load(file);
  const errors = [];
  const warnings = [];
  const E = (m) => errors.push(m);
  const W = (m) => warnings.push(m);

  // ---- 篇幅
  const n = words(visible(d.bodyForWords));
  const max = HUBS.has(d.slug) ? 1800 : 1500;
  if (n < 1200 || n > max) E(`body is ${n} words; target 1200–${max} (FAQs and frontmatter excluded)`);

  // ---- 配图:题图 + 正文 2–3 张,Pexels,alt 要描述画面,全站不重复
  if (!d.hero?.url) E('hero image missing (frontmatter image / JSON image)');
  const inline = [...d.body.matchAll(/!\[([^\]]*)\]\((https?:\/\/[^)\s]+)\)/g)];
  if (inline.length < 2 || inline.length > 3) E(`${inline.length} inline images; need 2–3 in the body`);
  for (const [, alt, url] of inline) {
    if (!/images\.pexels\.com\/photos\/\d+\//.test(url)) E(`inline image is not a Pexels photo URL: ${url}`);
    if (words(alt) < 5) E(`alt text too thin (describe what is in the picture): "${alt}"`);
  }
  const used = pexelsIdsElsewhere(d.rel);
  const mine = [d.hero?.url, ...inline.map((x) => x[2])].filter(Boolean).map((u) => (u.match(/photos\/(\d+)\//) || [])[1]).filter(Boolean);
  if (new Set(mine).size !== mine.length) E('the same photo is used twice on this page');
  for (const id of mine) if (used.has(id)) E(`Pexels photo ${id} is already used on ${used.get(id)} — pick an unused one`);

  // ---- FAQ
  if (d.faqs.length < 3 || d.faqs.length > 5) E(`${d.faqs.length} FAQs; need 3–5`);
  for (const f of d.faqs) if (!f.q || !f.a || words(f.a) < 25) W(`FAQ answer too short or missing: "${f.q}"`);
  if (/^#{2,3}\s+(?:FAQ|Frequently asked)/im.test(d.body)) E('FAQ is written in the body; FAQs belong in the faqs field only (the template renders them + FAQPage schema)');

  // ---- 来源:正文里的外链密度(约每 150–200 词一条),frontmatter sources ≥ 3
  const links = [...d.body.matchAll(/(?<!!)\[([^\]]+)\]\(([^)\s]+)\)/g)].map((x) => x[2]);
  const external = links.filter((u) => /^https:\/\//.test(u) && !/aeoeye\.com/.test(u));
  const minExternal = Math.max(5, Math.floor(n / 250));
  if (external.length < minExternal) E(`${external.length} inline source links; need ≥ ${minExternal} (one cited fact every ~150–250 words)`);
  if (new Set(external).size < Math.min(external.length, 4)) W('inline sources mostly repeat the same URL');
  if (d.sources.length < 3) E(`${d.sources.length} sources in the sources list; need ≥ 3`);
  for (const s of d.sources) if (!/^https:\/\//.test(s.url || '')) E(`source is not an https URL: ${s.url}`);
  for (const u of external) if (/^http:\/\//.test(u)) W(`http (not https) link: ${u}`);

  // ---- 站内链接:3+ 条,全部指向现存、未下线页
  const internal = links.filter((u) => u.startsWith('/') && !u.startsWith('//'));
  const absSelf = links.filter((u) => /^https?:\/\/(?:www\.)?aeoeye\.com/.test(u));
  if (absSelf.length) W(`use relative links for aeoeye.com pages: ${absSelf.slice(0, 3).join(', ')}`);
  if (internal.length + absSelf.length < 3) E(`${internal.length + absSelf.length} internal links; need ≥ 3 contextual links to related AEOeye pages`);
  for (const u of [...internal, ...absSelf.map((x) => x.replace(/^https?:\/\/(?:www\.)?aeoeye\.com/, '') || '/')]) {
    const clean = u.replace(/[#?].*$/, '').replace(/\/$/, '') || '/';
    if (RETIRED_PATHS.has(clean.toLowerCase())) E(`links to a retired page: ${u}`);
    else if (/^\/resources\//.test(clean)) { if (!fs.existsSync(path.join(ROOT, 'public', clean))) E(`links to a missing resource file: ${u}`); }
    else if (/^\/(blog|glossary|tools|answers|guides|compare|vs|alternatives|for)(\/|$)/.test(clean) && !pageExists(ROOT, clean)) E(`links to a page that does not exist: ${u}`);
  }
  if (internal.some((u) => u.replace(/[#?].*$/, '') === `/${d.section}/${d.slug}`)) W('page links to itself');

  // ---- 一手证据、人设、内部备注、AI 腔、AEOeye 事实
  if (!FIRST_HAND.test(d.body)) E('no first-hand AEOeye evidence used (crawler access study, audit logs, or what we actually do) — see docs/content/aeoeye-evidence-pack.md');
  const draft = d.raw.match(DRAFT_NOTES);
  if (draft) E(`internal drafting note left in the page: "${draft[0]}"`);
  const persona = d.body.match(PERSONA);
  if (persona) E(`first-person persona / fabricated credentials ("${persona[0].trim()}") — write as AEOeye ("we"), never as an individual`);
  const ism = d.body.match(AI_ISMS);
  if (ism) W(`stock AI phrasing: "${ism[0]}"`);
  const falseClaim = d.raw.match(AEOEYE_FALSE);
  if (falseClaim) E(`claims an AEOeye feature that does not exist: "${falseClaim[0]}"`);

  // ---- 结构:H2 数量、问句式比例、每节首段是否短而直接(answer-first 的机械近似)
  const h2 = [...d.body.matchAll(/^##\s+(.+)$/gm)].map((x) => x[1].trim());
  if (h2.length < 4) E(`${h2.length} H2 sections; need ≥ 4 semantic sections`);
  const q = h2.filter((h) => /\?\s*$/.test(h)).length;
  if (h2.length && q / h2.length < 0.5) W(`${q}/${h2.length} H2s are questions; aim for most H2s phrased as the reader's question`);
  const sectionsText = d.body.split(/^##\s+.+$/m).slice(1);
  sectionsText.forEach((sec, i) => {
    const first = sec.trim().split(/\n\s*\n/)[0] || '';
    if (/^(?:#{3}|[-*]|\d+\.|\||!\[)/.test(first.trim())) W(`section "${h2[i]}" opens with a list/table/image/subheading — open with a 1–2 sentence direct answer`);
    else if (words(visible(first)) > 75) W(`section "${h2[i]}" opens with a ${words(visible(first))}-word paragraph — lead with a 40–60 word direct answer`);
  });
  const paras = d.body.split(/\n\s*\n/).filter((p) => !/^\s*(?:#|[-*]|\d+\.|\||!\[|>)/.test(p));
  const long = paras.filter((p) => (p.match(/[.!?](?:\s|$)/g) || []).length > 5);
  if (long.length) W(`${long.length} paragraph(s) longer than ~5 sentences — keep paragraphs to 2–4 sentences`);

  // ---- 标题与描述
  if (!d.title) E('title missing');
  else if (d.title.length > 65) W(`title is ${d.title.length} chars; keep ≤ 60–65 so it isn't truncated`);
  if (!d.description) E('description missing');
  else if (d.description.length < 110 || d.description.length > 160) W(`description is ${d.description.length} chars; aim for 120–160`);

  // ---- 日期
  if (d.date !== today) W(`date/updated is ${d.date}; a substantive rewrite should set it to ${today}`);
  if (d.kind === 'mdx' && d.date === today && !d.published) W('set published: <original publication date> so datePublished keeps the original date');

  return { file: d.rel, words: n, inlineImages: inline.length, externalLinks: external.length, internalLinks: internal.length, faqs: d.faqs.length, h2: h2.length, errors, warnings };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const args = process.argv.slice(2);
  const asJson = args.includes('--json');
  const files = args.filter((a) => !a.startsWith('--'));
  if (!files.length) { console.error('usage: node scripts/content-lint.mjs <content file...> [--json]'); process.exit(2); }
  const results = [];
  for (const f of files) {
    try { results.push(lint(f)); } catch (e) { results.push({ file: f, errors: [String(e.message || e)], warnings: [] }); }
  }
  if (asJson) console.log(JSON.stringify(results, null, 1));
  else for (const r of results) {
    console.log(`\n${r.file}  ${r.words ?? '?'} words · ${r.inlineImages ?? '?'} inline images · ${r.externalLinks ?? '?'} source links · ${r.internalLinks ?? '?'} internal links · ${r.faqs ?? '?'} FAQs · ${r.h2 ?? '?'} H2`);
    for (const e of r.errors) console.log(`  ✗ ${e}`);
    for (const w of r.warnings) console.log(`  ! ${w}`);
    if (!r.errors.length && !r.warnings.length) console.log('  ✓ clean');
  }
  if (results.some((r) => r.errors.length)) process.exitCode = 1;
}
