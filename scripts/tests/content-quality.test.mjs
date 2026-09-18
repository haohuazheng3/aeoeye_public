import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { checkPost } from '../verify-content-quality.mjs';

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
