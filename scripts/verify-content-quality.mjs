import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';
import matter from 'gray-matter';

export const CORE_TOPICS = new Set([
  'ai-search-visibility', 'answer-engine-optimization', 'brand-citations',
  'ai-crawler-indexing', 'aeo-measurement', 'aeo-buyer-decisions',
]);
const KINDS = new Set(['guide', 'pricing-guide', 'documentation-guide', 'hands-on-review', 'research-asset']);
const INTERNAL_NOTES = /\b(?:the supplied (?:plan |official )?(?:facts|information|guide|pricing|rate)|supplied (?:plan facts|official facts|pricing (?:summary|information)|plan limits|US pricing)|not specified in (?:the )?supplied facts|storage shown in supplied facts|according to (?:the )?(?:writer|writing) brief|insert (?:price|source) here|TODO:\s*(?:price|source|verify))\b/i;
const GENERIC_PRICING = /^(?:slack|dropbox|zoom|mailchimp|mailgun|hootsuite|meltwater|brandwatch|hubspot|canva-pro)-pricing$/;
const sha256 = (raw) => crypto.createHash('sha256').update(raw).digest('hex');
const meaningful = (value, min = 25) => typeof value === 'string' && value.trim().length >= min;
const dated = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value));
const httpsUrl = (value) => {
  try { return new URL(value).protocol === 'https:'; } catch { return false; }
};

/** This is a mechanical evidence gate, not an automated judgment of factual truth. */
export function checkPost({ file, raw, baselineHash, evidence, artifactExists = () => false }) {
  const errors = [];
  const { data, content } = matter(raw);
  const fail = (message) => errors.push(`${file}: ${message}`);
  const residue = raw.match(INTERNAL_NOTES);
  if (residue) fail(`internal drafting note: ${residue[0]}`);
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
  const slug = path.basename(file).replace(/\.mdx?$/, '');
  if (isNew && GENERIC_PRICING.test(slug)) fail('generic software pricing cannot be used to fill an AEOeye quota');
  if (evidence.kind === 'documentation-guide') {
    if (/\breview\b/i.test(String(data.title))) fail('untested documentation guides must not be presented as hands-on reviews');
    const opening = content.slice(0, 2400);
    if (!/documentation[- ]based|public documentation|documented features/i.test(opening) || !/not (?:a )?hands-on|have not|did not|not tested/i.test(opening)) fail('documentation guide must disclose source scope and unperformed tests near its opening');
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
    if (pricing.status === 'published' && !/[$€£]\s*\d|\b(?:USD|EUR|GBP)\s*\d/i.test(content)) fail('published pricing needs concrete amounts in the visible body');
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

export function verifyContent(root = process.cwd()) {
  const baseline = JSON.parse(fs.readFileSync(path.join(root, 'content/editorial-baseline.json'), 'utf8'));
  const evidenceDir = path.join(root, 'content/editorial-evidence');
  const files = fs.readdirSync(path.join(root, 'content/blog')).filter((f) => /\.mdx?$/.test(f));
  const errors = [];
  let reviewed = 0;
  const artifactExists = (value) => {
    if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//') || value.includes('..')) return false;
    const target = path.resolve(root, 'public', value.slice(1));
    return target.startsWith(path.resolve(root, 'public') + path.sep) && fs.existsSync(target) && fs.statSync(target).isFile() && fs.statSync(target).size > 0;
  };
  for (const name of files) {
    const file = `content/blog/${name}`;
    const raw = fs.readFileSync(path.join(root, file), 'utf8');
    const evidenceFile = path.join(evidenceDir, name.replace(/\.mdx?$/, '.json'));
    let evidence;
    if (fs.existsSync(evidenceFile)) {
      try { evidence = JSON.parse(fs.readFileSync(evidenceFile, 'utf8')); reviewed++; }
      catch { errors.push(`${file}: malformed editorial evidence JSON`); continue; }
    }
    errors.push(...checkPost({ file, raw, baselineHash: baseline.posts[file], evidence, artifactExists }));
  }
  const featured = JSON.parse(fs.readFileSync(path.join(root, 'content/editorial-featured.json'), 'utf8'));
  if (featured.length < 1 || featured.length > 10 || new Set(featured).size !== featured.length) errors.push('featured list must contain 1–10 unique core-topic pages');
  for (const slug of featured) {
    if (!files.some((f) => f.replace(/\.mdx?$/, '') === slug)) errors.push(`featured page does not exist: ${slug}`);
    if (GENERIC_PRICING.test(slug)) errors.push(`generic software price guide cannot lead the AEO blog: ${slug}`);
  }
  return { pages: files.length, reviewed, legacyUnchanged: files.length - reviewed, errors };
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
