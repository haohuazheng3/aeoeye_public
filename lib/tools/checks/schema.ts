/* ============================================================
   结构化数据:JSON-LD 解析与校验(语法 + Google 富结果文档里的必填 / 推荐属性),
   以及按结果类型的富结果资格判定。
   规则表来自 Google Search Central 各结构化数据类型页面(developers.google.com/search/docs/appearance/structured-data/*)。
   注意:Google 的"必填"是**拿到该富结果**的条件,不是 schema.org 语法要求 —— 缺必填照样是合法 JSON-LD。
   ============================================================ */

import { parseTarget, fetchAs, isHtml, fetchFailure } from "../net";
import { parseDoc } from "../html";
import { type ToolResult, type CheckItem, type Status, worst, errorResult } from "../types";

const now = () => new Date().toISOString();

interface TypeRule {
  /** 拿到富结果必须有的属性;"a|b" 表示二选一 */
  required: string[];
  recommended: string[];
  /** 富结果名称 */
  feature: string;
  docs: string;
  /** Google 已停止展示的富结果 */
  retired?: string;
}

const G = "https://developers.google.com/search/docs/appearance/structured-data/";

export const RULES: Record<string, TypeRule> = {
  Article: { feature: "Article (top stories, headline/image)", required: [], recommended: ["headline", "image", "datePublished", "dateModified", "author"], docs: G + "article" },
  NewsArticle: { feature: "Article", required: [], recommended: ["headline", "image", "datePublished", "dateModified", "author"], docs: G + "article" },
  BlogPosting: { feature: "Article", required: [], recommended: ["headline", "image", "datePublished", "dateModified", "author"], docs: G + "article" },
  BreadcrumbList: { feature: "Breadcrumb trail", required: ["itemListElement"], recommended: [], docs: G + "breadcrumb" },
  Event: { feature: "Event listing", required: ["name", "startDate", "location"], recommended: ["description", "endDate", "eventStatus", "eventAttendanceMode", "image", "offers", "organizer", "performer"], docs: G + "event" },
  FAQPage: { feature: "FAQ", required: ["mainEntity"], recommended: [], docs: G + "faqpage", retired: "Google stopped showing FAQ rich results on May 7, 2026. The markup is harmless and still machine-readable for other parsers, but it no longer earns a rich result." },
  HowTo: { feature: "How-to", required: ["name", "step"], recommended: ["image", "totalTime", "supply", "tool"], docs: "https://developers.google.com/search/blog/2023/08/howto-faq-changes", retired: "Google stopped showing How-to rich results in September 2023." },
  JobPosting: { feature: "Job posting (Google for Jobs)", required: ["title", "description", "datePosted", "hiringOrganization", "jobLocation|applicantLocationRequirements"], recommended: ["validThrough", "employmentType", "baseSalary", "identifier"], docs: G + "job-posting" },
  LocalBusiness: { feature: "Local business details", required: ["name", "address"], recommended: ["telephone", "url", "geo", "openingHoursSpecification", "priceRange", "image"], docs: G + "local-business" },
  Organization: { feature: "Organization knowledge (logo, sameAs)", required: [], recommended: ["name", "url", "logo", "sameAs", "contactPoint", "address"], docs: G + "organization" },
  Product: { feature: "Product snippet / merchant listing", required: ["name", "offers|review|aggregateRating"], recommended: ["image", "description", "brand", "sku", "gtin", "offers"], docs: G + "product-snippet" },
  Offer: { feature: "Price", required: ["price|priceSpecification", "priceCurrency"], recommended: ["availability", "url", "priceValidUntil"], docs: G + "merchant-listing" },
  Recipe: { feature: "Recipe", required: ["name", "image"], recommended: ["author", "datePublished", "description", "recipeIngredient", "recipeInstructions", "totalTime", "recipeYield", "nutrition", "aggregateRating", "video"], docs: G + "recipe" },
  Review: { feature: "Review snippet", required: ["author", "reviewRating", "itemReviewed"], recommended: ["datePublished", "reviewBody"], docs: G + "review-snippet" },
  AggregateRating: { feature: "Review stars", required: ["ratingValue", "ratingCount|reviewCount"], recommended: ["bestRating", "itemReviewed"], docs: G + "review-snippet" },
  SoftwareApplication: { feature: "Software app", required: ["name", "offers", "aggregateRating|review"], recommended: ["applicationCategory", "operatingSystem"], docs: G + "software-app" },
  WebApplication: { feature: "Software app", required: ["name", "offers", "aggregateRating|review"], recommended: ["applicationCategory", "operatingSystem"], docs: G + "software-app" },
  VideoObject: { feature: "Video", required: ["name", "thumbnailUrl", "uploadDate"], recommended: ["description", "contentUrl|embedUrl", "duration"], docs: G + "video" },
  Course: { feature: "Course info", required: ["name", "description", "provider"], recommended: ["offers", "hasCourseInstance"], docs: G + "course", retired: "Google phased out the Course info rich result in 2025 and removed its documentation in September 2025." },
  ClaimReview: { feature: "Fact check", required: ["claimReviewed", "reviewRating", "url"], recommended: ["author", "itemReviewed"], docs: G + "factcheck", retired: "Google phased out the fact-check rich result in 2025." },
  Dataset: { feature: "Dataset search", required: ["name", "description"], recommended: ["url", "creator", "license"], docs: "https://developers.google.com/search/updates", retired: "Google announced in November 2025 that it is phasing the Dataset rich result out of Google Search (Dataset Search is a separate product)." },
  Quiz: { feature: "Practice problem", required: ["hasPart"], recommended: ["about", "educationalLevel"], docs: "https://developers.google.com/search/updates", retired: "Google removed the practice problem rich result; its documentation was deleted in January 2026." },
  SpecialAnnouncement: { feature: "Special announcement", required: ["name", "datePosted"], recommended: ["text", "expires"], docs: "https://developers.google.com/search/updates", retired: "Google deprecated special announcements on July 31, 2025." },
  WebSite: { feature: "Site name", required: [], recommended: ["name", "url", "alternateName"], docs: G + "site-names" },
  Person: { feature: "(no rich result — entity information)", required: [], recommended: ["name", "url", "sameAs"], docs: "https://schema.org/Person" },
};

// LocalBusiness 的子类型很多(Restaurant、Dentist…),统一按 LocalBusiness 规则
const LOCAL_SUBTYPES = /^(Restaurant|Store|Dentist|Physician|Hotel|AutoRepair|LegalService|Attorney|RealEstateAgent|HealthAndBeautyBusiness|HomeAndConstructionBusiness|ProfessionalService|FinancialService|FoodEstablishment|LodgingBusiness|MedicalBusiness|SportsActivityLocation|EntertainmentBusiness|AutomotiveBusiness|ChildCare|DryCleaningOrLaundry|EmergencyService|EmploymentAgency|GovernmentOffice|InternetCafe|Library|RadioStation|RecyclingCenter|SelfStorage|ShoppingCenter|TouristInformationCenter|TravelAgency|CafeOrCoffeeShop|Bakery|BarOrPub)$/;

function ruleFor(type: string): { rule: TypeRule; as: string } | null {
  if (RULES[type]) return { rule: RULES[type], as: type };
  if (LOCAL_SUBTYPES.test(type)) return { rule: RULES.LocalBusiness, as: "LocalBusiness" };
  return null;
}

interface Node { type: string; obj: Record<string, unknown>; path: string }

function collect(value: unknown, path: string, out: Node[]) {
  if (Array.isArray(value)) { value.forEach((v, i) => collect(v, `${path}[${i}]`, out)); return; }
  if (!value || typeof value !== "object") return;
  const o = value as Record<string, unknown>;
  const t = o["@type"];
  const types = ([] as unknown[]).concat(t ?? []).filter((x) => typeof x === "string") as string[];
  for (const ty of types) out.push({ type: ty, obj: o, path });
  for (const [k, v] of Object.entries(o)) if (k !== "@context" && typeof v === "object") collect(v, `${path}.${k}`, out);
}

function hasProp(o: Record<string, unknown>, spec: string): boolean {
  return spec.split("|").some((k) => {
    const v = o[k];
    if (v === undefined || v === null || v === "") return false;
    if (Array.isArray(v)) return v.length > 0;
    return true;
  });
}

function jsonError(raw: string): string {
  try { JSON.parse(raw); return ""; } catch (e) {
    const msg = (e as Error).message;
    const pos = Number(/position (\d+)/.exec(msg)?.[1]);
    if (Number.isFinite(pos)) {
      const line = raw.slice(0, pos).split("\n").length;
      return `${msg} (line ${line}: "${raw.split("\n")[line - 1]?.trim().slice(0, 80) ?? ""}")`;
    }
    return msg;
  }
}

function extraChecks(n: Node): CheckItem[] {
  const out: CheckItem[] = [];
  const o = n.obj;
  for (const k of ["datePublished", "dateModified", "startDate", "endDate", "uploadDate", "datePosted", "validThrough"]) {
    const v = o[k];
    if (typeof v === "string" && Number.isNaN(Date.parse(v))) out.push({ label: `${n.type}.${k}`, status: "fail", value: v, detail: "Dates must be ISO 8601 (e.g. 2026-10-24 or 2026-10-24T09:00:00+00:00)." });
  }
  for (const k of ["url", "image", "logo", "thumbnailUrl", "contentUrl", "embedUrl"]) {
    const v = o[k];
    const vals = ([] as unknown[]).concat(v ?? []).map((x) => (typeof x === "string" ? x : x && typeof x === "object" ? (x as Record<string, unknown>).url : null)).filter((x) => typeof x === "string") as string[];
    for (const s of vals) if (!/^https?:\/\//i.test(s)) out.push({ label: `${n.type}.${k}`, status: "warn", value: s.slice(0, 80), detail: "Use an absolute URL (https://…)." });
  }
  if (n.type === "BreadcrumbList") {
    const items = ([] as unknown[]).concat(o.itemListElement ?? []) as Record<string, unknown>[];
    items.forEach((it, i) => {
      if (!it || typeof it !== "object") return;
      if (it.position === undefined) out.push({ label: `ListItem ${i + 1}`, status: "fail", value: "no position", detail: "Each ListItem needs a numeric position." });
      if (!it.name && !(it.item && typeof it.item === "object" && (it.item as Record<string, unknown>).name)) out.push({ label: `ListItem ${i + 1}`, status: "fail", value: "no name" });
      if (!it.item && i < items.length - 1) out.push({ label: `ListItem ${i + 1}`, status: "warn", value: "no item URL", detail: "Only the last breadcrumb may omit item." });
    });
  }
  if (n.type === "FAQPage") {
    const qs = ([] as unknown[]).concat(o.mainEntity ?? []) as Record<string, unknown>[];
    qs.forEach((q, i) => {
      const a = q?.acceptedAnswer as Record<string, unknown> | undefined;
      if (!q?.name) out.push({ label: `Question ${i + 1}`, status: "fail", value: "no name (question text)" });
      if (!a || !a.text) out.push({ label: `Question ${i + 1}`, status: "fail", value: "no acceptedAnswer.text" });
    });
  }
  if ((n.type === "Product") && o.offers && typeof o.offers === "object") {
    const offers = ([] as unknown[]).concat(o.offers) as Record<string, unknown>[];
    offers.forEach((of) => { if (of && !hasProp(of, "price|priceSpecification|lowPrice")) out.push({ label: "Product.offers", status: "fail", value: "no price", detail: "Product snippets with offers need a price (and priceCurrency)." }); });
  }
  return out;
}

async function loadSchema(input: string) {
  const t = parseTarget(input);
  const r = await fetchAs(t.url, "googlebot");
  if (r.status === 0) return { error: fetchFailure(r) ?? "Unreachable" } as const;
  if (!isHtml(r)) return { error: `Not an HTML page (${r.contentType}).` } as const;
  const doc = parseDoc(r.body);
  const nodes: Node[] = [];
  const blocks = doc.jsonLd.map((raw, i) => {
    const err = jsonError(raw.trim());
    if (!err) {
      const j = JSON.parse(raw.trim());
      const ctx = JSON.stringify((Array.isArray(j) ? j[0] : j)?.["@context"] ?? "");
      collect(j, `block ${i + 1}`, nodes);
      return { i, err: "", ctxOk: /schema\.org/i.test(ctx), raw };
    }
    return { i, err, ctxOk: false, raw };
  });
  const microdata = doc.root.querySelectorAll("[itemscope]").map((e) => e.getAttribute("itemtype") ?? "").filter(Boolean);
  const rdfa = doc.root.querySelectorAll("[typeof]").map((e) => e.getAttribute("typeof") ?? "").filter(Boolean);
  return { t, r, blocks, nodes, microdata, rdfa } as const;
}

export async function schemaValidator(input: string): Promise<ToolResult> {
  const s = await loadSchema(input);
  if ("error" in s) return errorResult("schema", input, s.error ?? "Unreachable");
  const { r, blocks, nodes, microdata, rdfa } = s;
  const items: CheckItem[] = [];
  if (!blocks.length && !microdata.length && !rdfa.length) {
    return { ok: true, tool: "schema", input, url: r.finalUrl, fetchedAt: now(), verdict: "fail", headline: "No structured data found on this page (no JSON-LD, microdata or RDFa).", sections: [{ title: "Structured data", kind: "checks", items: [{ label: "JSON-LD", status: "fail", value: "none", detail: "Add a <script type=\"application/ld+json\"> block. Google recommends JSON-LD over microdata." }] }] };
  }
  for (const b of blocks) {
    items.push(b.err ? { label: `JSON-LD block ${b.i + 1}`, status: "fail", value: "syntax error", detail: b.err } : { label: `JSON-LD block ${b.i + 1}`, status: b.ctxOk ? "pass" : "warn", value: b.ctxOk ? "valid JSON, schema.org context" : "valid JSON, but @context isn't schema.org", detail: b.ctxOk ? undefined : "Set \"@context\": \"https://schema.org\"." });
  }
  const typeRows: (string | number)[][] = [];
  for (const n of nodes) {
    const rr = ruleFor(n.type);
    const missingReq = rr ? rr.rule.required.filter((p) => !hasProp(n.obj, p)) : [];
    const missingRec = rr ? rr.rule.recommended.filter((p) => !hasProp(n.obj, p)) : [];
    typeRows.push([n.type, n.path, rr ? (missingReq.length ? `missing: ${missingReq.join(", ")}` : "all present") : "no Google requirements", rr ? (missingRec.length ? missingRec.join(", ") : "—") : "—"]);
    if (rr && missingReq.length) items.push({ label: `${n.type} (${n.path})`, status: "fail", value: `missing required: ${missingReq.map((x) => x.replace("|", " or ")).join(", ")}`, detail: `Without these, Google won't show the ${rr.rule.feature} rich result. See ${rr.rule.docs}` });
    else if (rr && missingRec.length) items.push({ label: `${n.type} (${n.path})`, status: "warn", value: `missing recommended: ${missingRec.slice(0, 5).join(", ")}`, detail: "Valid, but adding these gives Google more to show." });
    else if (rr) items.push({ label: `${n.type} (${n.path})`, status: "pass", value: "required and recommended properties present" });
    items.push(...extraChecks(n));
  }
  if (microdata.length) items.push({ label: "Microdata", status: "info", value: `${microdata.length} itemscope(s): ${Array.from(new Set(microdata.map((x) => x.split("/").pop()))).slice(0, 5).join(", ")}`, detail: "Valid for Google, but we only deep-check JSON-LD." });
  if (rdfa.length) items.push({ label: "RDFa", status: "info", value: `${rdfa.length} typeof attribute(s)` });
  const types = Array.from(new Set(nodes.map((n) => n.type)));
  return {
    ok: true, tool: "schema", input, url: r.finalUrl, fetchedAt: now(), verdict: worst(items.map((i) => i.status)),
    headline: `${blocks.length} JSON-LD block(s), ${nodes.length} item(s): ${types.slice(0, 6).join(", ") || "no typed items"}${items.some((i) => i.status === "fail") ? " — errors found" : ""}.`,
    sections: [
      { title: "Validation", kind: "checks", items },
      { title: "Every type on the page", kind: "table", table: { columns: ["Type", "Where", "Google required", "Missing recommended"], rows: typeRows } },
      ...blocks.map((b) => ({ title: `JSON-LD block ${b.i + 1}`, kind: "code" as const, code: { lang: "json", text: b.err ? b.raw.trim() : JSON.stringify(JSON.parse(b.raw.trim()), null, 2), filename: `block-${b.i + 1}.json` } })),
    ],
  };
}

export async function richResultsTest(input: string): Promise<ToolResult> {
  const s = await loadSchema(input);
  if ("error" in s) return errorResult("rich", input, s.error ?? "Unreachable");
  const { r, nodes, blocks } = s;
  const byFeature = new Map<string, { status: Status; why: string; docs: string; types: string[] }>();
  for (const n of nodes) {
    const rr = ruleFor(n.type);
    if (!rr || rr.rule.feature.startsWith("(")) continue;
    const missing = rr.rule.required.filter((p) => !hasProp(n.obj, p));
    const extra = extraChecks(n).filter((x) => x.status === "fail");
    let status: Status; let why: string;
    if (rr.rule.retired) { status = "info"; why = rr.rule.retired; }
    else if (missing.length || extra.length) { status = "fail"; why = `Not eligible: missing ${[...missing.map((x) => x.replace("|", " or ")), ...extra.map((x) => `${x.label} ${x.value}`)].join(", ")}.`; }
    else { const rec = rr.rule.recommended.filter((p) => !hasProp(n.obj, p)); status = rec.length ? "warn" : "pass"; why = rec.length ? `Eligible; add ${rec.slice(0, 4).join(", ")} for a richer result.` : "Eligible: all required and recommended properties found."; }
    const prev = byFeature.get(rr.rule.feature);
    if (!prev || (prev.status === "fail" && status !== "fail")) byFeature.set(rr.rule.feature, { status, why, docs: rr.rule.docs, types: [...(prev?.types ?? []), n.type] });
  }
  const items: CheckItem[] = Array.from(byFeature.entries()).map(([feature, v]) => ({ label: feature, status: v.status, value: v.types.join(", "), detail: `${v.why} ${v.docs}` }));
  if (!items.length) items.push({ label: "Rich result types", status: blocks.length ? "warn" : "fail", value: blocks.length ? "structured data found, but none for a rich-result type" : "no structured data", detail: "Organization, WebPage and similar types help Google understand the page but don't produce a rich result on their own." });
  const eligible = items.filter((i) => i.status === "pass" || i.status === "warn").length;
  return {
    ok: true, tool: "rich", input, url: r.finalUrl, fetchedAt: now(), verdict: eligible ? (items.some((i) => i.status === "fail") ? "warn" : "pass") : "fail",
    headline: eligible ? `Eligible for ${eligible} rich result type(s). Eligibility isn't a guarantee — Google decides per query.` : "Not eligible for any rich result yet.",
    sections: [{ title: "Rich result eligibility by type", kind: "checks", items }],
  };
}
