import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkPost, offTopicReason, RETIRED_SLUGS, RETIRED_PATHS } from '../verify-content-quality.mjs';

const hash = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const source = 'https://example.com/official-pricing';
function article(body = 'The plan is $20 per month in the US. See [official pricing]('+source+').', title = 'AEO Platform Pricing') {
  return `---\ntitle: ${title}\ndate: '2026-09-18'\n---\n${body}\n`;
}
function evidence(raw, patch = {}) {
  return {
    contentSha256: hash(raw), reviewedAt: '2026-09-18', kind: 'pricing-guide',
    assessment: 'The article answers the actual AEO purchasing question and distinguishes documented vendor pricing from untested performance.',
    topic: { area: 'aeo-buyer-decisions', readerProblem: 'Select an appropriate AI visibility audit product.', connection: 'Directly supports choosing a brand recommendation measurement workflow.' },
    sources: [{ url: source, checkedAt: '2026-09-18', supports: 'The published US monthly starting price and billing term.' }],
    checks: ['Confirmed currency and billing period against the source.', 'Recomputed the example using the published starting price.', 'Read the final title, opening, table and FAQ for consistency.'],
    pricing: { status: 'published', region: 'US / USD', billing: 'Monthly subscription', checkedAt: '2026-09-18', verification: 'Checked the official monthly price and recomputed twelve monthly payments without inventing annual discounts.' },
    ...patch,
  };
}
const check = (raw, extra = {}) => checkPost({ file: 'content/blog/aeo-platform-pricing.mdx', raw, ...extra });

test('new core pricing article with complete reviewed evidence passes', () => {
  const raw = article(); assert.deepEqual(check(raw, { evidence: evidence(raw) }), []);
});
test('new article cannot publish without evidence', () => assert.match(check(article()).join('\n'), /needs content\/editorial-evidence/));
test('unchanged legacy is not forced into a fabricated retrospective certification', () => {
  const raw = article(); assert.deepEqual(check(raw, { baselineHash: hash(raw) }), []);
});
test('changed legacy requires fresh evidence', () => assert.match(check(article(), { baselineHash: hash('old') }).join('\n'), /needs content\/editorial-evidence/));
test('changing text after editorial approval invalidates its fingerprint', () => {
  const raw = article(); assert.match(check(raw+'Changed.', { evidence: evidence(raw) }).join('\n'), /fingerprint is stale/);
});
test('internal drafting notes fail even on grandfathered content', () => {
  const raw = article('Not specified in the supplied facts.'); assert.match(check(raw, { baselineHash: hash(raw) }).join('\n'), /internal drafting note/);
});
test('legitimate discussion of user-supplied research is not blocked', () => {
  const raw = article('Citations must support the supplied research material.'); assert.deepEqual(check(raw, { baselineHash: hash(raw) }), []);
});
test('scenario numbering cannot silently begin at two', () => {
  const raw = article('### Scenario 2: A team'); assert.match(check(raw, { baselineHash: hash(raw) }).join('\n'), /numbering/);
});
test('generic SaaS quota filler cannot masquerade as a core topic', () => {
  const raw = article(); assert.match(checkPost({ file: 'content/blog/slack-pricing.mdx', raw, evidence: evidence(raw) }).join('\n'), /generic software pricing/);
});
test('legacy-adjacent category cannot be assigned to a new page', () => {
  const raw = article(); const e = evidence(raw); e.topic.area = 'legacy-adjacent'; assert.match(check(raw, { evidence: e }).join('\n'), /core topic/);
});
test('a changed legacy adjacent page may be honestly corrected without deleting its URL', () => {
  const raw = article(); const e = evidence(raw); e.topic.area = 'legacy-adjacent'; assert.deepEqual(check(raw, { baselineHash: hash('previous'), evidence: e }), []);
});
test('pricing with published status must provide a concrete price', () => {
  const raw = article('Compare pricing on '+source); assert.match(check(raw, { evidence: evidence(raw) }).join('\n'), /concrete amounts/);
});
test('quote-only price is allowed when clearly disclosed and sourced', () => {
  const raw = article('This product is quote-only. Request a scoped quote from '+source); const e = evidence(raw); e.pricing.status = 'quote-only'; assert.deepEqual(check(raw, { evidence: e }), []);
});
test('sources must be available to readers, not just internal metadata', () => {
  const raw = article(); const e = evidence(raw); e.sources[0].url='https://other.example.com/hidden'; assert.match(check(raw, { evidence: e }).join('\n'), /visible in the article/);
});
test('untested new guides cannot retain a review headline', () => {
  const raw = article('Documentation and limitations '+source, 'AEO Platform Review'); const e = evidence(raw, { kind: 'documentation-guide' }); assert.match(check(raw, { evidence: e }).join('\n'), /hands-on reviews/);
});
test('changed historical reviews also need honest documentation-guide titles', () => {
  const raw = article('Documentation-based guide. We did not test the product. '+source, 'AEO Platform Review');
  assert.match(check(raw, { baselineHash:hash('old'), evidence:evidence(raw,{kind:'documentation-guide'}) }).join('\n'), /hands-on reviews/);
});
test('documentation guide discloses what was and was not checked', () => {
  const raw = article('Documentation-based guide. We did not test the product. '+source, 'AEO Platform Buyer Guide');
  assert.deepEqual(check(raw, { evidence:evidence(raw,{kind:'documentation-guide'}) }), []);
});
test('documentation label in internal evidence is not a visible disclosure', () => {
  const raw = article('A product discussion '+source, 'AEO Platform Buyer Guide');
  assert.match(check(raw, { evidence:evidence(raw,{kind:'documentation-guide'}) }).join('\n'), /disclose source scope/);
});
test('changed price articles cannot bypass pricing checks by changing evidence kind', () => {
  const raw = article('Plan details '+source); const e=evidence(raw,{kind:'guide'}); delete e.pricing;
  assert.match(check(raw, { baselineHash:hash('old'), evidence:e }).join('\n'), /pricing disclosure/);
});
test('an empty template cannot pass as an evidenced asset', () => {
  const raw = article(); assert.match(check(raw, { evidence: evidence(raw, { kind: 'research-asset' }) }).join('\n'), /actual reader-accessible evidence/);
});
test('fabricated artifact path fails even with a filled evidence form', () => {
  const raw = article('Example [results](/research/results.json) '+source); const e = evidence(raw, { kind:'research-asset', artifacts:[{path:'/research/results.json',description:'A real data release with source records and definitions.'}], methodology:'A sufficiently detailed method describing inputs, sampling, processing, calculation, checks and reproducibility.', limitations:'A small convenience sample that cannot describe the whole industry.' }); assert.match(check(raw,{evidence:e}).join('\n'),/missing\/invalid artifact/);
});
test('verified asset file, public link, method and limits satisfy mechanical checks', () => {
  const raw = article('Example [results](/research/results.json) '+source, 'AI citation research dataset'); const e = evidence(raw, { kind:'research-asset', artifacts:[{path:'/research/results.json',description:'A real data release with source records and definitions.'}], methodology:'A sufficiently detailed method describing inputs, sampling, processing, calculation, checks and reproducibility.', limitations:'A small convenience sample that cannot describe the whole industry.' }); assert.deepEqual(check(raw,{evidence:e,artifactExists:()=>true}),[]);
});

// ---- 2026-09-24 选题边界:跑题页在门禁就被拦住,定时管线不能再把它们写回来 ----
test('retired slugs cannot be re-created even with full evidence', () => {
  assert.ok(RETIRED_SLUGS.has('zoom-pricing') && RETIRED_SLUGS.has('profound-ai-review'));
  const raw = article();
  const out = checkPost({ file: 'content/blog/zoom-pricing.mdx', raw, evidence: evidence(raw) }).join('\n');
  assert.match(out, /was retired/);
});
test('generic SaaS and SEO-tool pricing/review pages are off-topic', () => {
  for (const slug of ['slack-pricing', 'midjourney-pricing', 'semrush-review', 'ahrefs-alternatives', 'grammarly-review', 'best-keyword-research-tools']) assert.ok(offTopicReason(slug), slug);
});
test('AI assistant plans, features and assistant-vs-assistant pages are off-topic', () => {
  for (const slug of ['claude-max-pricing', 'chatgpt-projects', 'gemini-gems', 'grok-vs-gemini', 'chatgpt-review', 'what-is-fine-tuning', 'prompt-engineer-salary']) assert.ok(offTopicReason(slug), slug);
});
test('AEO tools, engine search behaviour and AI-visibility topics stay allowed (hypothetical slugs — every real page is retired since 2026-10-24)', () => {
  for (const slug of ['example-aeo-tool-pricing', 'example-aeo-tool-vs-other-aeo-tool', 'how-does-example-engine-choose-sources', 'example-engine-citation-patterns', 'example-geo-tool-pricing', 'example-ai-visibility-pricing']) assert.equal(offTopicReason(slug), null, slug);
});
test('published INR pricing is accepted as a concrete visible amount', () => {
  const raw = article(`GEOpta is ₹4,999 per month. See [official pricing](${source}).`, 'GEOpta Pricing');
  const out = checkPost({ file: 'content/blog/example-geo-tool-pricing.mdx', raw, evidence: evidence(raw, { pricing: { status:'published', region:'India / INR', billing:'Monthly plus GST', checkedAt:'2026-09-18', verification:'Checked the official INR amount, billing cadence, and tax basis and recomputed the GST-inclusive total.' } }) });
  assert.deepEqual(out, []);
});
test('a new off-topic page fails the gate with the reason spelled out', () => {
  const raw = article('Slack costs $8.75 per seat. See [official pricing](' + source + ').', 'Slack Pricing');
  const out = checkPost({ file: 'content/blog/slack-pricing-2027.mdx', raw, evidence: evidence(raw) }).join('\n');
  assert.match(out, /off-topic for AEOeye/);
});

// ---- 2026-10-03 第二轮清理:规则扩到全部内容栏目,并补上第一轮漏掉的几类跑题 ----
test('retirements cover every content section, not just the blog', () => {
  for (const p of ['/answers/what-is-llm-visibility', '/guides/how-to-rank-in-chatgpt', '/compare/geo-vs-seo', '/glossary/ai-agent', '/blog/chatgpt-market-share', '/blog/perplexity-vs-claude', '/answers/what-is-ai-visibility', '/blog/chatgpt-seo']) assert.ok(RETIRED_PATHS.has(p), p);
  assert.ok(RETIRED_SLUGS.has('chatgpt-market-share') && !RETIRED_SLUGS.has('what-is-llm-visibility'), 'blog view only holds blog slugs');
  assert.ok(offTopicReason('what-is-llm-visibility', 'answers'));
  // 2026-10-24 起连曾经的规范页也已下线;门禁必须拒绝重建
  assert.match(offTopicReason('what-is-ai-visibility', 'answers'), /retired/);
});
test('assistant or search-engine comparisons need a brand-visibility angle', () => {
  for (const slug of ['grok-vs-perplexity', 'copilot-vs-chatgpt', 'google-vs-perplexity', 'claude-vs-gemini-for-coding']) assert.ok(offTopicReason(slug), slug);
  for (const slug of ['chatgpt-vs-perplexity-citations', 'gemini-vs-chatgpt-brand-recommendations', 'perplexity-vs-google-ai-overviews-seo']) assert.equal(offTopicReason(slug), null, slug);
});
test('AI company revenue, market share and usage statistics are off-topic', () => {
  for (const slug of ['deepseek-revenue', 'grok-market-share', 'copilot-statistics', 'ai-adoption-statistics', 'gemini-users']) assert.ok(offTopicReason(slug), slug);
});
test('generic AI explainers and SEO utilities stay out', () => {
  for (const slug of ['what-is-a-vector-database', 'how-does-gemini-work', 'json-ld-generator', 'people-also-ask', 'turn-off-ai-mode']) assert.ok(offTopicReason(slug), slug);
});
test('JSON content pages are checked like posts: fields are read as visible text, evidence and retirement apply', () => {
  const page = { slug: 'is-peec-ai-worth-it-for-agencies', title: 'Is Peec AI Worth It for Agencies?', shortAnswer: 'Peec AI starts at $20 per month.', intro: 'See [official pricing](' + source + ').', sections: [{ heading: 'Price', body: 'The plan is $20 per month in the US.' }], faqs: [] };
  const raw = JSON.stringify(page, null, 1);
  const file = 'content/answers/is-peec-ai-worth-it-for-agencies.json';
  assert.deepEqual(checkPost({ file, raw, evidence: evidence(raw) }), []);
  assert.match(checkPost({ file, raw }).join('\n'), /needs content\/editorial-evidence/);
  assert.match(checkPost({ file: 'content/answers/what-is-llm-visibility.json', raw, evidence: evidence(raw) }).join('\n'), /was retired/);
  assert.match(checkPost({ file, raw: '{not json' }).join('\n'), /malformed content file/);
});


/* ---------- SEO 底座 v2(2026-10-24):A 级工具页 + B 级决策页 ---------- */
const toolSource = 'https://developers.google.com/search/docs/crawling-indexing/301-redirects';
function toolPage(patch = {}) {
  const sentence = 'We fetch the URL from our server, follow every hop and report the status code, the target and the time each hop took. ';
  return {
    slug: 'redirect-checker', category: 'crawl-index', name: 'Redirect Checker', title: 'Redirect Checker: Trace Every Hop',
    description: 'Free redirect checker.', answer: 'Paste a URL to see every redirect hop and whether the chain hurts SEO.', keywords: ['redirect checker'],
    runner: { component: 'runner', tool: 'redirect', submitLabel: 'Check' }, trust: 'We fetch live.',
    body: `## Redirect check: what it shows\n\n${sentence.repeat(14)}See [Google on redirects](${toolSource}).\n\n## How to read it\n\n${sentence.repeat(10)}`,
    faqs: [{ q: 'A?', a: 'Yes.' }, { q: 'B?', a: 'No.' }, { q: 'C?', a: 'Maybe.' }],
    sources: [{ label: 'Google', url: toolSource }],
    images: [1, 2].map((i) => ({ url: `https://images.pexels.com/photos/10${i}/pexels-photo.jpeg`, alt: 'Server racks with blinking network lights in a data centre', photographer: 'Someone', photographerUrl: 'https://www.pexels.com/@someone' })),
    related: [], cta: 'seo', published: '2026-10-24', updated: '2026-10-24', ...patch,
  };
}
function toolEvidence(raw, patch = {}) {
  return {
    contentSha256: hash(raw), reviewedAt: '2026-10-24', kind: 'tool-page',
    assessment: 'The tool runs a live redirect trace first; the copy explains how to read each status code and when a chain costs crawl budget.',
    topic: { area: 'technical-seo-tools', readerProblem: 'Find out where a URL redirects and whether the chain is harmful.', connection: 'The free SEO audit checks redirect chains site-wide; this is the single-URL version.' },
    sources: [{ url: toolSource, checkedAt: '2026-10-24', supports: 'Google treats 301/308 as permanent and 302/307 as temporary.' }],
    checks: ['Ran the tool against three real URLs with chains.', 'Checked every status-code claim against Google docs.', 'Read title, H1, answer and FAQ for one intent.'],
    ...patch,
  };
}
const toolFile = 'content/tools/redirect-checker.json';
test('an A-level tool page with a runner, 300–800 words, 2–3 Pexels images and 3–5 FAQs passes', () => {
  const raw = JSON.stringify(toolPage(), null, 1);
  assert.deepEqual(checkPost({ file: toolFile, raw, evidence: toolEvidence(raw) }), []);
});
test('tool pages outside the A-level word range fail', () => {
  const raw = JSON.stringify(toolPage({ body: '## Short\n\nToo short. See [Google](' + toolSource + ').' }), null, 1);
  assert.match(checkPost({ file: toolFile, raw, evidence: toolEvidence(raw) }).join('\n'), /must be 300–800/);
});
test('placeholders and template residue cannot ship on a tool page', () => {
  const p = toolPage();
  p.body += '\n\nTODO: add the screenshot here.';
  const raw = JSON.stringify(p, null, 1);
  assert.match(checkPost({ file: toolFile, raw, evidence: toolEvidence(raw) }).join('\n'), /placeholder/);
});
test('tool pages need 2–3 images and 3–5 FAQs', () => {
  const raw = JSON.stringify(toolPage({ images: [], faqs: [] }), null, 1);
  const out = checkPost({ file: toolFile, raw, evidence: toolEvidence(raw) }).join('\n');
  assert.match(out, /2–3 Pexels images/);
  assert.match(out, /need 3–5/);
});
test('technical SEO tools are on-topic in the tools section, but third-party pricing pages are not', () => {
  for (const slug of ['seo-audit-checklist', 'robots-txt-tester', 'schema-validator', 'twitter-card-validator']) assert.equal(offTopicReason(slug, 'tools'), null, slug);
  assert.ok(offTopicReason('semrush-pricing', 'tools'));
});
test('only the owner-approved technical decisions are allowed as blog comparisons', () => {
  for (const slug of ['301-vs-302', 'https-vs-http', 'subdomain-vs-subfolder', 'webp-vs-avif']) assert.equal(offTopicReason(slug, 'blog'), null, slug);
  assert.ok(offTopicReason('react-vs-vue', 'blog'));
});
test('B-level decision pages need a verdict card and 1200–1500 words', () => {
  const raw = `---\ntitle: 301 vs 302\ndate: '2026-10-24'\n---\nShort body. See [Google](${toolSource}).\n`;
  const ev = toolEvidence(raw, { kind: 'research-asset', topic: { area: 'technical-seo-decisions', readerProblem: 'Pick the right redirect type for a URL move.', connection: 'The free SEO audit flags temporary redirects used for permanent moves.' } });
  const out = checkPost({ file: 'content/blog/301-vs-302.mdx', raw, evidence: ev }).join('\n');
  assert.match(out, /verdict card/);
  assert.match(out, /must be 1200–1500/);
});
