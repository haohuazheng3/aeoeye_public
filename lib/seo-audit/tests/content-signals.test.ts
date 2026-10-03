/* v3 内容信号(PageContentSignals)—— 用接近真实站点的 HTML 走完整的 parsePage 路径,
   再对每个纯函数做边界测试。期望值都按规格 §2 手算,不是把实现的输出抄回来。 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parse as parseHtml, NodeType, type HTMLElement, type Node as HtmlNode, type TextNode } from "node-html-parser";
import { parsePage, prepareMarkup } from "../parse";
import type { FetchResult } from "../fetch";
import type { PageContentSignals } from "../types";
import {
  bylineFromText,
  clickbaitHits,
  cleanAuthorName,
  countDataPoints,
  countMarkers,
  countSyllables,
  extractMainText,
  fleschReadingEase,
  looksEnglish,
  isAuthoritativeUrl,
  isPlausibleEmail,
  isPlausiblePhone,
  isQuestionHeading,
  isStockImageUrl,
  jsonLdFacts,
  MAX_BODY_YEARS,
  QUESTION_WORDS,
  splitSentences,
  textHasEmail,
  textHasPhone,
  titleBrand,
  titlePromisedNumber,
  titleYear,
  toIsoDate,
  yearsInText,
} from "../content-signals";

function fr(url: string, body: string, init: Partial<FetchResult> = {}): FetchResult {
  return {
    url,
    finalUrl: url,
    status: 200,
    headers: new Headers(),
    body,
    bytes: body.length,
    ms: 5,
    chain: [],
    contentType: "text/html; charset=utf-8",
    ...init,
  };
}

function signals(html: string, url: string, host = new URL(url).hostname): PageContentSignals {
  const page = parsePage(html, fr(url, html), 1, host);
  assert.ok(page.content, `content signals computed for ${url}`);
  return page.content as PageContentSignals;
}

/* ============================================================
   1. 一手经验丰富的英文文章:署名、日期、表格、权威引用、自托管图片
   ============================================================ */

const EXPERIENCE_ARTICLE = `<!DOCTYPE html>
<html lang="en-US">
<head>
<meta charset="utf-8">
<title>We Tested 12 AI Visibility Tools for 90 Days | Acme Analytics</title>
<meta name="description" content="Twelve AI visibility tools, 400 prompts, 90 days: what actually matched the answers.">
<meta property="og:site_name" content="Acme Analytics">
<meta property="article:published_time" content="2026-03-04T09:00:00+00:00">
<meta property="article:modified_time" content="2026-09-12T10:30:00-07:00">
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
 {"@type":"Organization","@id":"https://acme.test/#org","name":"Acme Analytics","url":"https://acme.test","sameAs":["https://www.linkedin.com/company/acme","https://x.com/acme","https://github.com/acme"]},
 {"@type":"Person","@id":"https://acme.test/#jane","name":"Jane Rivera","url":"https://acme.test/authors/jane-rivera"},
 {"@type":"BlogPosting","headline":"We Tested 12 AI Visibility Tools","author":{"@id":"https://acme.test/#jane"},"publisher":{"@id":"https://acme.test/#org"},"datePublished":"2026-03-04","dateModified":"2026-09-12"}
]}</script>
</head>
<body>
<header class="site-header"><nav><a href="/">Home</a><a href="/blog">Blog</a><a href="/pricing">Pricing</a></nav></header>
<main>
<article>
<header class="entry-header">
<h1>We Tested 12 AI Visibility Tools for 90 Days</h1>
<p class="byline">By <a href="/authors/jane-rivera" rel="author">Jane Rivera</a> · <time datetime="2026-03-04">March 4, 2026</time> · Updated <time class="updated" datetime="2026-09-12">September 12, 2026</time></p>
</header>
<div class="table-of-contents"><ol><li><a href="#method">Methodology</a></li><li><a href="#results">Results</a></li></ol></div>
<p>We tested twelve AI visibility tools side by side for 90 days, running the same 400 prompts through ChatGPT, Gemini and Perplexity every week. In our experience, most tools disagree with each other by 20% or more, so we measured how often each tool's numbers matched what we saw in the answers ourselves.</p>
<h2 id="method">Methodology</h2>
<p>Our methodology was simple: we tracked 3 brands across 400 prompts and logged every answer. We found that 37% of answers changed week to week, which matches what <a href="https://en.wikipedia.org/wiki/Large_language_model">Wikipedia describes</a> as non-deterministic sampling and what <a href="https://developers.google.com/search/docs/appearance/ai-features">Google's documentation</a> says about AI features.</p>
<figure><img src="/images/acme-dashboard-results.png" width="1200" height="700" alt="Our results dashboard"><figcaption>Screenshot of our tracking sheet after week 6.</figcaption></figure>
<h2 id="results">Results</h2>
<table>
<thead><tr><th>Tool</th><th>Accuracy</th><th>Price</th></tr></thead>
<tbody><tr><td>Tool A</td><td>82%</td><td>$99</td></tr><tr><td>Tool B</td><td>64%</td><td>$49</td></tr></tbody>
</table>
<p>After testing every tool for 90 days, our results show a clear winner. A <a href="https://www.nist.gov/publications/llm-variance">NIST report</a> and a <a href="https://arxiv.org/abs/2401.00001">2024 arXiv paper</a> both back up the variance we saw.</p>
<img src="https://cdn.acme.test/uploads/2026/03/prompt-log.jpg" width="900" height="500" alt="Prompt log">
<img src="/icons/check.svg" width="16" height="16" alt="">
<ul><li>Run each prompt at least 3 times.</li><li>Log the date of every answer.</li><li>Compare against a control brand.</li></ul>
<p>Want to run the same test on your own brand? Start with our <a href="/tools/visibility-checker">free visibility checker</a> or read the <a href="/blog/ai-visibility-guide">AI visibility guide</a>.</p>
</article>
</main>
<aside><h3>Related</h3><a href="/blog/other-post">Other post</a><time datetime="2025-01-01">Jan 1</time></aside>
<footer><a href="https://www.bbc.com/news">As seen on BBC</a><p>© 2026 Acme Analytics</p></footer>
</body></html>`;

test("experience-rich article: structure, markers, citations, own images, byline, dates and entity signals", () => {
  const c = signals(EXPERIENCE_ARTICLE, "https://acme.test/blog/we-tested-ai-visibility-tools");

  // 结构只看主体区域:文章 <header> 里的 H1、侧栏的 H3、目录里的 <ol> 都不算
  assert.equal(c.h2Count, 2);
  assert.equal(c.h3Count, 0, "the aside's 'Related' H3 is not content structure");
  assert.equal(c.listCount, 1, "the table-of-contents <ol> is navigation, not a content list");
  assert.equal(c.orderedListCount, 0);
  assert.equal(c.listItemCount, 3);
  assert.equal(c.tableCount, 1);

  // 4 段正文(图注不是段落);11 个句子 = 4 段里的 8 句 + 3 个列表项
  assert.equal(c.paragraphs, 4);
  assert.equal(c.sentences, 11);
  assert.ok(c.fleschReadingEase !== null && c.fleschReadingEase > 50 && c.fleschReadingEase < 85, `Flesch ${c.fleschReadingEase}`);
  assert.ok(c.avgSentenceWords > 10 && c.avgSentenceWords < 20, `avg sentence ${c.avgSentenceWords}`);
  assert.ok(c.avgParagraphWords > 25 && c.avgParagraphWords < 50, `avg paragraph ${c.avgParagraphWords}`);

  // we tested / in our experience / we measured / we found / screenshot of / after testing / our results
  assert.equal(c.experienceMarkers, 7);
  // methodology ×3(目录、H2、正文)/ we tracked 3 / we found that 37
  assert.equal(c.originalDataMarkers, 5);
  assert.equal(c.aiPhraseHits, 0);
  assert.equal(c.ymylHits, 0);
  // 90 days ×2、400 ×2、20%、37%、82%、64%、$99、$49;"2024"(年份)、"3 brands"、"week 6"、"3 times" 不算
  assert.equal(c.numberCount, 10);

  // 主体区域的外链:维基百科、Google 文档、nist.gov、arXiv 全是权威;页脚的 BBC 不是正文引用
  assert.equal(c.outboundLinks, 4);
  assert.equal(c.authoritativeOutlinks, 4);
  // 站内路径图 + 自家子域 CDN 图算自托管;16px 的 svg 图标不算
  assert.equal(c.imagesSelfHosted, 2);
  assert.equal(c.imagesStock, 0);

  assert.equal(c.byline, true);
  assert.equal(c.authorName, "Jane Rivera", "JSON-LD author @id resolved to the Person node");
  assert.equal(c.authorLink, "https://acme.test/authors/jane-rivera");
  assert.equal(c.authorInSchema, true);
  assert.equal(c.datePublished, "2026-03-04");
  assert.equal(c.dateModified, "2026-09-12");

  assert.equal(c.titleYear, null);
  assert.equal(c.titleNumber, 12, "'12 AI Visibility Tools' promises 12 items");
  assert.equal(c.clickbaitHits, 0);
  assert.equal(c.titleBrand, "Acme Analytics");
  assert.equal(c.orgName, "Acme Analytics");
  assert.equal(c.siteName, "Acme Analytics");
  assert.equal(c.sameAsCount, 3);

  // 正文开头:跳过标题与目录,从第一段说起
  assert.ok(c.leadText.startsWith("we tested twelve ai visibility tools side by side for 90 days"), c.leadText.slice(0, 80));
  assert.equal(c.leadText.split(" ").length, 150);
  assert.ok(!/[.,:;!?%$]/.test(c.leadText), "leadText is lowercase without punctuation");
  assert.ok(c.firstParagraph.startsWith("We tested twelve AI visibility tools"));
  assert.ok(c.firstParagraph.length <= 300);

  assert.equal(c.hasFaq, false);
  assert.equal(c.nextStepLinks, 2, "the checker + guide links at the end; the aside's related link is outside the main content");
  assert.equal(c.interstitialHints, 0);
  assert.deepEqual(c.contactDetails, { email: false, phone: false, address: false });

  // v4:"Methodology" / "Results" 不是问句;正文只提到 "a 2024 arXiv paper" ——
  // 文章 <header> 里的 <time>、图片路径里的 /2026/03/、页脚的 © 2026 都不是正文年份
  assert.equal(c.questionHeadings, 0);
  assert.deepEqual(c.bodyYears, [2024]);
});

/* ============================================================
   2. 图库图片 + AI 套话
   ============================================================ */

const BOILERPLATE_ARTICLE = `<!DOCTYPE html>
<html lang="en">
<head>
<title>Unlock the Power of AI Marketing in 2023 - BrandBoost</title>
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"Unlock the Power of AI Marketing","datePublished":"2023-02-01T08:00:00Z"}</script>
</head>
<body>
<div id="content">
<h1>Unlock the Power of AI Marketing</h1>
<p>In today's fast-paced digital world, marketers must navigate the complex landscape of AI. Let's delve into how AI can be a game-changer for your brand.</p>
<img src="https://images.unsplash.com/photo-1677442136019?w=1200&q=80" alt="robot">
<p>It’s important to note that AI tools can seamlessly integrate with your existing stack. Whether you’re a beginner or a seasoned pro, look no further.</p>
<img src="/wp-content/uploads/2023/02/shutterstock_1234567890.jpg" alt="team">
<img src="/_next/image?url=https%3A%2F%2Fimages.pexels.com%2Fphotos%2F3184292%2Fpexels-photo-3184292.jpeg&amp;w=1080&amp;q=75" alt="meeting">
<p>In the realm of marketing, AI offers a rich tapestry of possibilities. Embark on a journey to elevate your strategy and unlock the full potential of your data.</p>
<img src="https://brandboost.test/wp-content/uploads/2023/02/iStock-998877.jpg" alt="office">
<img class="avatar" src="https://secure.gravatar.com/avatar/abc?s=96" width="96" height="96" alt="">
<p>Navigating the ever-evolving landscape of search is no small feat for any team.</p>
</div>
</body></html>`;

test("stock-image AI boilerplate: every stock image is recognised (host, filename, proxied URL) and each AI phrase counts once", () => {
  const c = signals(BOILERPLATE_ARTICLE, "https://brandboost.test/blog/ai-marketing");
  // unsplash 主机、shutterstock 文件名、Next.js 代理里的 pexels、iStock 文件名;头像不算正文图片
  assert.equal(c.imagesStock, 4);
  assert.equal(c.imagesSelfHosted, 0);
  // H1 的 unlock the power + 4 + 4 + 5 + "navigating the ever-evolving landscape" 只记 1 次(重叠短语不重复计)
  assert.equal(c.aiPhraseHits, 15);
  assert.equal(c.experienceMarkers, 0);
  assert.equal(c.originalDataMarkers, 0);
  assert.equal(c.byline, false);
  assert.equal(c.authorName, null);
  assert.equal(c.authorInSchema, false);
  assert.equal(c.datePublished, "2023-02-01");
  assert.equal(c.dateModified, null);
  assert.equal(c.titleYear, 2023);
  assert.equal(c.titleBrand, "BrandBoost");
  assert.equal(c.clickbaitHits, 0);
  assert.equal(c.titleNumber, null);
  assert.equal(c.hasFaq, false);
  assert.equal(c.paragraphs, 4);
  assert.equal(c.sentences, 7);
  // 2023 只出现在标题、图片路径与 JSON-LD 的 datePublished 里 —— 都不是正文
  assert.deepEqual(c.bodyYears, []);
});

/* ============================================================
   3. 非英文页面 / 没有 lang:Flesch 为 null
   ============================================================ */

const GERMAN_PAGE = `<!DOCTYPE html>
<html lang="de">
<head><title>Wie funktioniert KI-Suche? | Beispiel GmbH</title></head>
<body><main>
<h1>Wie funktioniert KI-Suche?</h1>
<p>Die KI-Suche verändert gerade, wie Kunden neue Marken finden und vergleichen. Wir haben fünfzig typische Anfragen getestet und die Antworten sorgfältig miteinander verglichen.</p>
<p>Die Ergebnisse waren überraschend deutlich: Marken mit klaren Produktseiten wurden häufiger genannt. Kleine Anbieter tauchten dagegen kaum auf, selbst wenn ihre Inhalte gut waren.</p>
</main></body></html>`;

test("non-English page: Flesch is null (English-only formula), the rest of the signals still work", () => {
  const c = signals(GERMAN_PAGE, "https://beispiel.test/ki-suche");
  assert.equal(c.fleschReadingEase, null);
  assert.equal(c.sentences, 4);
  assert.equal(c.paragraphs, 2);
  assert.ok(c.mainWords >= 45, `mainWords ${c.mainWords}`);
  assert.ok(c.avgSentenceWords > 10);
  assert.equal(c.titleBrand, "Beispiel GmbH");
  assert.ok(c.leadText.startsWith("die ki suche verändert gerade"), c.leadText.slice(0, 40));
  assert.equal(c.experienceMarkers, 0, "English lexicon does not fire on German text");

  // 没有 <html lang>:看散文像不像英文 —— 英文文章照常算 Flesch,德文仍是 null;en-GB / EN 都算英文
  const noLang = EXPERIENCE_ARTICLE.replace('<html lang="en-US">', "<html>");
  const declared = signals(EXPERIENCE_ARTICLE, "https://acme.test/blog/x").fleschReadingEase;
  assert.equal(signals(noLang, "https://acme.test/blog/x").fleschReadingEase, declared, "English prose without lang is still scored");
  assert.equal(signals(GERMAN_PAGE.replace('<html lang="de">', "<html>"), "https://beispiel.test/ki-suche").fleschReadingEase, null);
  const enGb = EXPERIENCE_ARTICLE.replace('<html lang="en-US">', '<html lang="EN-gb">');
  assert.notEqual(signals(enGb, "https://acme.test/blog/x").fleschReadingEase, null);
  // 声明了别的语言就以声明为准,哪怕正文是英文
  assert.equal(signals(EXPERIENCE_ARTICLE.replace('<html lang="en-US">', '<html lang="fr">'), "https://acme.test/blog/x").fleschReadingEase, null);
});

test("looksEnglish: English prose passes, German / Spanish / short text do not", () => {
  const en = "The answer engine reads your page, picks the passage that answers the question, and cites it if it can trust the source. That is why a clear first sentence matters more than the length of the article, and why we test every page with real prompts before we publish it.";
  const de = "Die KI-Suche verändert gerade, wie Kunden neue Marken finden und vergleichen. Wir haben fünfzig typische Anfragen getestet und die Antworten sorgfältig miteinander verglichen, und die Ergebnisse waren überraschend deutlich für kleine Anbieter in diesem Markt.";
  const es = "La búsqueda con inteligencia artificial está cambiando la forma en que los clientes encuentran y comparan marcas nuevas. Probamos cincuenta consultas típicas y comparamos las respuestas con cuidado, y los resultados fueron sorprendentemente claros para los proveedores pequeños.";
  assert.equal(looksEnglish(en), true);
  assert.equal(looksEnglish(de), false);
  assert.equal(looksEnglish(es), false);
  assert.equal(looksEnglish("The quick answer is yes."), false, "too short to decide");
});

/* ============================================================
   4. 清单文:标题承诺的数字与正文对得上 / 对不上
   ============================================================ */

const LISTICLE_MATCH = `<!DOCTYPE html>
<html lang="en">
<head><title>7 Best AEO Tools for 2026 (Tested) | ToolPick</title></head>
<body><main>
<h1>7 Best AEO Tools for 2026</h1>
<p>We tested each tool below on the same 50 prompts before ranking it.</p>
${["Profound", "Peec AI", "Otterly", "AthenaHQ", "Scrunch", "AEOeye", "Goodie"].map((n, i) => `<h2>${i + 1}. ${n}</h2><p>${n} is a good pick when you need answer-engine tracking without extra setup.</p>`).join("\n")}
</main></body></html>`;

const LISTICLE_MISMATCH = `<!DOCTYPE html>
<html lang="en">
<head><title>10 Ways to Get Cited by ChatGPT</title></head>
<body><article>
<h1>10 Ways to Get Cited by ChatGPT</h1>
<p>Most brands only need a handful of fixes, and here they are in order of impact.</p>
<ol>
<li>Publish a clear answer in the first paragraph.</li>
<li>Name your brand the same way on every page.</li>
<li>Add an FAQ section with real customer questions.</li>
<li>Allow GPTBot and OAI-SearchBot in robots.txt.</li>
<li>Earn mentions on sites ChatGPT already cites.</li>
<li>Keep your pricing page crawlable and current.</li>
</ol>
<h2>What to do next</h2>
<p>Pick the two fixes that apply to you and ship them this week.</p>
</article></body></html>`;

test("listicles: the title's promised number is extracted so it can be checked against H2s / list items", () => {
  const match = signals(LISTICLE_MATCH, "https://toolpick.test/best-aeo-tools");
  assert.equal(match.titleNumber, 7);
  assert.equal(match.h2Count, 7, "7 promised, 7 delivered");
  assert.equal(match.titleYear, 2026);
  assert.equal(match.titleBrand, "ToolPick");
  assert.equal(match.experienceMarkers, 1, "'We tested'");
  assert.equal(match.numberCount, 1, "'50 prompts'; the '1.'–'7.' ordinals are single digits");
  assert.equal(match.questionHeadings, 0, "'1. Profound' … are not questions");
  assert.deepEqual(match.bodyYears, [2026], "the H1 inside <main> is body text");

  const mismatch = signals(LISTICLE_MISMATCH, "https://toolpick.test/get-cited-by-chatgpt");
  assert.equal(mismatch.titleNumber, 10);
  assert.equal(mismatch.orderedListCount, 1);
  assert.equal(mismatch.listCount, 1);
  assert.equal(mismatch.listItemCount, 6, "10 promised, only 6 delivered");
  assert.equal(mismatch.h2Count, 1);
  assert.equal(mismatch.titleBrand, null);
  assert.equal(mismatch.questionHeadings, 1, "'What to do next' starts with an interrogative");
  assert.deepEqual(mismatch.bodyYears, []);
});

test("titlePromisedNumber: top N / N <noun> (≤3 words apart) / leading number; units, years and codes are not promises", () => {
  assert.equal(titlePromisedNumber("10 Ways to Get Cited by ChatGPT"), 10);
  assert.equal(titlePromisedNumber("Top 7 AEO Tools Compared"), 7);
  assert.equal(titlePromisedNumber("top-5 llms.txt generators"), 5);
  assert.equal(titlePromisedNumber("The 12 Best AI Visibility Trackers"), 12);
  assert.equal(titlePromisedNumber("We Tested 12 AI Visibility Tools for 90 Days"), 12);
  assert.equal(titlePromisedNumber("7 Steps to Rank in Perplexity"), 7);
  assert.equal(titlePromisedNumber("3 Things Nobody Tells You About GEO"), 3);
  assert.equal(titlePromisedNumber("How to Rank in 30 Days With These Tools"), null, "30 days is a duration");
  assert.equal(titlePromisedNumber("5-Minute Guide to llms.txt"), null);
  assert.equal(titlePromisedNumber("2026 AEO Checklist"), null, "a year is not a count");
  assert.equal(titlePromisedNumber("404 Errors Explained"), null, "an HTTP status code is not a count");
  assert.equal(titlePromisedNumber("How to Fix 301 Redirects: 5 Common Mistakes"), 5);
  assert.equal(titlePromisedNumber("3D Product Photos for Ecommerce"), null);
  assert.equal(titlePromisedNumber("10x Your AI Citations"), null);
  assert.equal(titlePromisedNumber("24/7 Support Tools"), null);
  assert.equal(titlePromisedNumber("What Is Answer Engine Optimization?"), null);
});

/* ============================================================
   5. YMYL(健康)页面 + 标题党
   ============================================================ */

const YMYL_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><title>Type 2 Diabetes Symptoms: Early Signs and Treatment Options</title></head>
<body><article>
<h1>Type 2 Diabetes Symptoms</h1>
<p>Common symptoms of type 2 diabetes include frequent urination, constant thirst and blurred vision. An early diagnosis matters because treatment works best before complications appear.</p>
<p>Never change a medication or its dosage without talking to your doctor. Diabetes is a chronic disease, and mental health support is part of good therapy.</p>
</article></body></html>`;

test("YMYL health page: every health term in the main text counts (word families, word boundaries)", () => {
  const c = signals(YMYL_PAGE, "https://health.test/diabetes-symptoms");
  // H1:diabetes symptoms(2)+ 第一段:symptoms diabetes diagnosis treatment(4)
  // + 第二段:medication dosage diabetes disease "mental health" therapy(6)
  assert.equal(c.ymylHits, 12);
  assert.equal(c.experienceMarkers, 0);
  assert.equal(c.aiPhraseHits, 0);
  assert.equal(c.byline, false, "health content with no byline at all");
  assert.equal(c.clickbaitHits, 0);
});

test("clickbaitHits: phrases, an exclamation mark and shouting each count; acronyms and the brand suffix do not", () => {
  assert.equal(clickbaitHits("SHOCKING Secrets Doctors Won't Tell You!"), 3, "shocking + secrets + !");
  assert.equal(clickbaitHits("You Won’t Believe These 5 Secrets!"), 3, "curly apostrophe still matches");
  assert.equal(clickbaitHits("Mind-blowing results from this one trick"), 2);
  assert.equal(clickbaitHits("THE BEST AEO TOOLS EVER MADE"), 1, "4 of 6 words are shouting");
  assert.equal(clickbaitHits("AEO vs SEO: What Changes for GEO | Yahoo!"), 0, "short acronyms are not shouting; the brand's '!' is ignored");
  assert.equal(clickbaitHits("How to Rank in Perplexity"), 0);
  assert.equal(clickbaitHits(""), 0);
});

/* ============================================================
   6. 弹窗 / 遮罩线索
   ============================================================ */

const MODAL_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><title>Free llms.txt Generator | Example Tools</title></head>
<body>
<header><div class="search-modal" id="search"><input type="search" aria-label="Search"></div></header>
<main>
<h1>Free llms.txt Generator</h1>
<p>Paste your sitemap URL and we build a valid llms.txt file for you in seconds.</p>
<section class="multimodal-demo"><p>Works with text and image models alike.</p></section>
</main>
<div class="modal fade" id="newsletterModal" tabindex="-1"><div class="modal-dialog"><div class="modal-content"><h2>Get the weekly AEO digest</h2><form><input type="email"><button>Subscribe</button></form></div></div></div>
<div class="newsletter-overlay"></div>
<div id="cookie-popup" class="cookie-consent">We use cookies.</div>
<dialog class="modal" id="share-dialog"><p>Share this tool</p></dialog>
</body></html>`;

test("interstitial hints: outermost modal / newsletter overlay elements only; search, cookie, <dialog> and 'multimodal' are not interstitials", () => {
  const c = signals(MODAL_PAGE, "https://example.test/tools/llms-txt");
  assert.equal(c.interstitialHints, 2, "the Bootstrap newsletter modal (one, not its 3 nested layers) + the newsletter overlay");
  // 主体文本 = body 去掉外壳(与 minhash 同口径),挂在 body 里的弹窗标题也在其中;header 里的搜索框不在
  assert.equal(c.h2Count, 1);
});

/* ============================================================
   7. JSON-LD:机构 + sameAs、作者解析、嵌套评测不是本页作者
   ============================================================ */

test("jsonLdFacts: Organization with sameAs, @id author resolution, Article beats WebPage, nested Review is not the page author", () => {
  const graph = jsonLdFacts([
    {
      "@context": "https://schema.org",
      "@graph": [
        { "@type": "WebPage", "@id": "https://x.test/p#webpage", datePublished: "2024-01-01", dateModified: "2024-01-02" },
        { "@type": ["Organization", "Brand"], name: "  X Labs ", sameAs: ["https://twitter.com/xlabs", "https://www.linkedin.com/company/xlabs", "https://twitter.com/xlabs", "not a url"] },
        { "@type": "Person", "@id": "https://x.test/#ana", name: "Ana Ruiz", url: "https://x.test/team/ana" },
        { "@type": "NewsArticle", author: [{ "@id": "https://x.test/#ana" }, { "@type": "Person", name: "Second Author" }], datePublished: "2026-05-01T23:30:00-05:00", dateModified: "2026-06-02" },
      ],
    },
  ]);
  assert.equal(graph.orgName, "X Labs");
  assert.equal(graph.sameAsCount, 2, "unique http(s) URLs only");
  assert.equal(graph.authorName, "Ana Ruiz");
  assert.equal(graph.authorUrl, "https://x.test/team/ana");
  assert.equal(graph.authorInSchema, true);
  assert.equal(graph.datePublished, "2026-05-01", "the article's own date (as written, not shifted to UTC) beats the WebPage's");
  assert.equal(graph.dateModified, "2026-06-02");
  assert.equal(graph.hasFaqPage, false);

  const product = jsonLdFacts([
    { "@context": "https://schema.org", "@type": "Product", name: "Widget", review: { "@type": "Review", author: { "@type": "Person", name: "Bob Buyer" }, datePublished: "2024-01-01" } },
    { "@type": "LocalBusiness", name: "Joe's Plumbing", sameAs: "https://facebook.com/joesplumbing", address: { "@type": "PostalAddress", streetAddress: "12 Main St", addressLocality: "Springfield", postalCode: "62701" } },
  ]);
  assert.equal(product.authorName, null, "a reviewer is not the page's author");
  assert.equal(product.authorInSchema, false);
  assert.equal(product.datePublished, null, "a review's date is not the page's date");
  assert.equal(product.orgName, "Joe's Plumbing");
  assert.equal(product.sameAsCount, 1, "a single sameAs string counts");
  assert.equal(product.hasPostalAddress, true);

  const misc = jsonLdFacts([
    { "@type": "FAQPage", mainEntity: [{ "@type": "Question", name: "Q?", acceptedAnswer: { "@type": "Answer", text: "A." } }] },
    { "@type": "BlogPosting", author: { "@id": "#nobody" }, datePublished: "not a date" },
    { "@type": "WebPage", author: "AEOeye Editorial", datePublished: "September 30, 2026" },
  ]);
  assert.equal(misc.hasFaqPage, true);
  assert.equal(misc.authorName, "AEOeye Editorial", "an unresolvable @id is skipped; a plain string author counts");
  assert.equal(misc.datePublished, "2026-09-30");

  assert.deepEqual(jsonLdFacts([]).authorInSchema, false);
  assert.equal(jsonLdFacts([null, 42, "x"]).orgName, null);
});

test("jsonLdFacts is bounded: very deep or very wide JSON-LD finishes quickly", () => {
  let deep: Record<string, unknown> = { "@type": "Organization", name: "Bottom" };
  for (let i = 0; i < 5_000; i++) deep = { "@type": "Thing", child: deep };
  const wide = { "@graph": Array.from({ length: 200_000 }, (_, i) => ({ "@type": "Thing", name: `t${i}` })) };
  const t0 = Date.now();
  const f = jsonLdFacts([deep, wide]);
  assert.ok(Date.now() - t0 < 2_000, `took ${Date.now() - t0}ms`);
  assert.equal(f.orgName, null, "nodes past the depth limit are not read");
});

test("JSON-LD Organization with sameAs flows into the page signals", () => {
  const c = signals(EXPERIENCE_ARTICLE, "https://acme.test/blog/x");
  assert.equal(c.orgName, "Acme Analytics");
  assert.equal(c.sameAsCount, 3);
  const noLd = signals(LISTICLE_MATCH, "https://toolpick.test/x");
  assert.equal(noLd.orgName, null);
  assert.equal(noLd.sameAsCount, 0);
  assert.equal(noLd.siteName, null);
});

/* ============================================================
   8. 署名:WordPress 式标记、评论区排除、纯文本 "By …"
   ============================================================ */

const WORDPRESS_POST = `<!DOCTYPE html>
<html lang="en-GB">
<head><title>How llms.txt Works – WP Demo</title></head>
<body>
<div id="page">
<header id="masthead" class="site-header"><p class="site-title"><a href="/">WP Demo</a></p></header>
<div id="content"><main id="main" class="site-main">
<article class="post type-post">
<header class="entry-header"><h1 class="entry-title">How llms.txt Works</h1>
<div class="entry-meta"><span class="posted-on"><a href="/2025/11/02/llms-txt/" rel="bookmark"><time class="entry-date published" datetime="2025-11-02T08:00:00+00:00">2 November 2025</time><time class="updated" datetime="2026-01-15T10:00:00+00:00">15 January 2026</time></a></span><span class="byline"> by <span class="author vcard"><a class="url fn n" href="https://wp.test/author/jdoe/">John Doe</a></span></span></div>
</header>
<div class="entry-content">
<p>llms.txt is a plain text file at the root of your site that lists the pages you want AI assistants to read first.</p>
<p>It does not replace robots.txt or your sitemap; it simply points models at your best answers.</p>
</div>
</article>
<div id="comments" class="comments-area"><ol class="comment-list"><li class="comment"><article class="comment-body"><footer class="comment-meta"><div class="comment-author vcard"><b class="fn">Spam Bot</b></div><time datetime="2024-01-01T00:00:00+00:00">Jan 1</time></footer><p>Great post, visit my site!</p></article></li></ol></div>
</main></div>
<footer id="colophon" class="site-footer"><p>Contact: <a href="mailto:hello@wp-demo.com">hello@wp-demo.com</a></p></footer>
</div>
</body></html>`;

test("WordPress byline markup: author name and author page from the byline, dates from <time>, the comments section is ignored", () => {
  const c = signals(WORDPRESS_POST, "https://wp.test/2025/11/02/llms-txt/");
  assert.equal(c.byline, true);
  assert.equal(c.authorName, "John Doe");
  assert.equal(c.authorLink, "https://wp.test/author/jdoe/");
  assert.equal(c.authorInSchema, false, "no JSON-LD on this page");
  assert.equal(c.datePublished, "2025-11-02", "the comment's 2024 timestamp is not the article's date");
  assert.equal(c.dateModified, "2026-01-15");
  assert.equal(c.titleBrand, "WP Demo", "WordPress's default en dash separator");
  assert.ok(c.fleschReadingEase !== null, "en-GB is English");
  assert.equal(c.contactDetails?.email, true, "footer mailto: link");
});

test("plain-text 'By <Name>' in the first 400 characters is a byline; 'By default' is not; byline lines are not the first paragraph", () => {
  const html = `<!DOCTYPE html><html lang="en"><head><title>Answer Engine Optimization Basics</title></head><body><main>
<h1>Answer Engine Optimization Basics</h1>
<p>By Maria Lopez | Sep 30, 2026</p>
<p>Answer engine optimization is the practice of making your pages easy for AI assistants to quote and cite.</p>
</main></body></html>`;
  const c = signals(html, "https://aeo.test/basics");
  assert.equal(c.byline, true);
  assert.equal(c.authorName, "Maria Lopez");
  assert.equal(c.authorLink, null);
  assert.ok(c.firstParagraph.startsWith("Answer engine optimization is the practice"), c.firstParagraph);
  assert.ok(c.leadText.startsWith("answer engine optimization is the practice"), c.leadText);

  const notByline = html.replace("<p>By Maria Lopez | Sep 30, 2026</p>", "<p>By default, ChatGPT search cites pages that answer the question directly.</p>");
  const d = signals(notByline, "https://aeo.test/basics");
  assert.equal(d.byline, false);
  assert.equal(d.authorName, null);
});

test("bylineFromText / cleanAuthorName", () => {
  assert.equal(bylineFromText("Guides AEO 101 By Jane Doe · Updated Jul 17, 2026 · 7 min read"), "Jane Doe");
  assert.equal(bylineFromText("All articles AI Search Title By the AEOeye editorial team · Updated Jul 17, 2026"), "AEOeye editorial team");
  assert.equal(bylineFromText("Written by Jane Doe and John Roe"), "Jane Doe");
  assert.equal(bylineFromText("By AEOeye | September 2026"), "AEOeye");
  assert.equal(bylineFromText("By default, all plans include it."), null);
  assert.equal(bylineFromText("By Monday we will ship the fix."), null);
  assert.equal(bylineFromText("By Using our site you agree to the terms."), null);
  assert.equal(bylineFromText("By The Way, here is a tip"), null);

  assert.equal(cleanAuthorName("By Jane Doe · Sep 30, 2026"), "Jane Doe");
  assert.equal(cleanAuthorName("Written by Jane Doe on September 30"), "Jane Doe");
  assert.equal(cleanAuthorName("Author: Ludwig van Beethoven"), "Ludwig van Beethoven");
  assert.equal(cleanAuthorName("admin"), null, "generic account names are not names");
  assert.equal(cleanAuthorName("Jane Doe is a senior editor with ten years of experience in search"), null, "an author bio is not a name");
  assert.equal(cleanAuthorName("https://facebook.com/jane"), null);
  assert.equal(cleanAuthorName("View all posts"), null);
  assert.equal(cleanAuthorName("张三"), "张三");
  assert.equal(cleanAuthorName(""), null);
});

/* ============================================================
   9. 联系方式(整页,含页头页脚)
   ============================================================ */

const contactPage = (body: string, head = "") =>
  `<!DOCTYPE html><html lang="en"><head><title>Contact Us | Acme</title>${head}</head><body><main><h1>Contact us</h1><p>We usually reply within one business day.</p></main>${body}</body></html>`;

test("contactDetails: footer mailto, tel: link, visible phone, JSON-LD PostalAddress, <address> and microdata address", () => {
  const mailto = signals(contactPage(`<footer><a href="mailto:Hello@Acme-Analytics.com?subject=Hi">Email us</a></footer>`), "https://acme.test/contact");
  assert.deepEqual(mailto.contactDetails, { email: true, phone: false, address: false });

  const tel = signals(contactPage(`<footer><a href="tel:+1-555-123-4567">Call us</a></footer>`), "https://acme.test/contact");
  assert.deepEqual(tel.contactDetails, { email: false, phone: true, address: false });
  const shortTel = signals(contactPage(`<footer><a href="tel:911">Emergency</a></footer>`), "https://acme.test/contact");
  assert.equal(shortTel.contactDetails?.phone, false, "tel: needs at least 7 digits");

  const visible = signals(contactPage(`<footer><p>Call us: +44 20 7946 0958 · support@acme-analytics.com</p></footer>`), "https://acme.test/contact");
  assert.deepEqual(visible.contactDetails, { email: true, phone: true, address: false });

  const ld = `<script type="application/ld+json">{"@context":"https://schema.org","@type":"Organization","name":"Acme","address":{"@type":"PostalAddress","streetAddress":"221B Baker Street","addressLocality":"London","postalCode":"NW1 6XE"}}</script>`;
  assert.deepEqual(signals(contactPage("", ld), "https://acme.test/contact").contactDetails, { email: false, phone: false, address: true });

  const addressEl = signals(contactPage(`<footer><address>Acme Analytics, 221B Baker Street, London NW1 6XE</address></footer>`), "https://acme.test/contact");
  assert.equal(addressEl.contactDetails?.address, true);
  const bylineAddress = signals(contactPage(`<footer><address>By Jane Doe, staff writer</address></footer>`), "https://acme.test/contact");
  assert.equal(bylineAddress.contactDetails?.address, false, "<address> used for a byline (no street number / postcode) is not a postal address");

  const micro = signals(contactPage(`<footer><div itemscope itemtype="https://schema.org/PostalAddress"><span itemprop="streetAddress">1 Infinite Loop</span></div></footer>`), "https://acme.test/contact");
  assert.equal(micro.contactDetails?.address, true);
});

test("contactDetails: placeholder emails and image filenames are ignored; years, prices, dates, versions and IDs are not phones", () => {
  const placeholders = signals(
    contactPage(`<section><form><input type="email" placeholder="you@domain.com"></form><p>Write to example@example.com or name@company.com. Retina logo: logo@2x.png. Follow @acme on X.</p></section>`),
    "https://acme.test/contact"
  );
  assert.equal(placeholders.contactDetails?.email, false);

  const numbers = signals(
    contactPage(`<section><p>Founded in 2026. Plans from $1,299.99 per year. Our 2025-2026 roadmap ships version 10.15.7, published 2026-09-30, order 1234567890123, over 10 000 000 users.</p></section>`),
    "https://acme.test/contact"
  );
  assert.equal(numbers.contactDetails?.phone, false);

  // 表格里相邻的单元格不能被拼成一个"电话号码";跨元素的 "Call us on <b>…</b>" 上下文仍然有效
  const table = signals(
    contactPage(`<section><table><tr><th>2024</th><th>2025</th><th>2026</th></tr><tr><td>82</td><td>64</td><td>91</td><td>77</td></tr></table></section>`),
    "https://acme.test/contact"
  );
  assert.equal(table.contactDetails?.phone, false);
  const callOn = signals(contactPage(`<footer><p>Call us on <b>912 345 678</b></p></footer>`), "https://acme.test/contact");
  assert.equal(callOn.contactDetails?.phone, true);

  assert.equal(isPlausibleEmail("hello@acme-analytics.com"), true);
  assert.equal(isPlausibleEmail("mailto:team@sub.acme.co.uk"), true);
  for (const e of ["example@example.com", "you@domain.com", "name@company.com", "logo@2x.png", "jane@acme.test", "email@yourbrand.com", "not-an-email", "a@b"]) {
    assert.equal(isPlausibleEmail(e), false, e);
  }
  assert.equal(textHasEmail("Write to support@acme-analytics.com."), true, "a sentence-final period is not part of the domain");
  assert.equal(textHasEmail(`${"x".repeat(200_000)}@${"y".repeat(200_000)}`), false, "a long run around one @ is a bounded window, not a quadratic scan");

  for (const p of ["+1 (555) 123-4567", "(555) 123-4567", "020 7946 0958", "+44 20 7946 0958", "1-800-555-0199", "555.123.4567", "+33 1 23 45 67 89", "+15551234567"]) {
    assert.equal(textHasPhone(`Call ${p} today`), true, p);
  }
  for (const n of ["Founded in 2026", "between 2025-2026", "2024 2025 2026", "$1,299.99", "€ 1 299", "version 10.15.7", "ID 1234567890123", "2026-09-30", "30.09.2026", "192.168.100.200", "4111 1111 1111 1111", "ORD-2026-0001-2345", "3,400,000 visits"]) {
    assert.equal(textHasPhone(n), false, n);
  }
  assert.equal(isPlausiblePhone("912 345 678"), false, "thousands-style grouping without phone context");
  assert.equal(isPlausiblePhone("912 345 678", "Call us on "), true, "the same digits after 'Call us on' are a phone number");
});

/* ============================================================
   10. 边界:没有正文、非 2xx、DOM 炸弹、超大文本节点、嵌套过深
   ============================================================ */

test("a page with no main text still gets well-formed signals (zeros, nulls, empty strings) — and footer contacts are seen", () => {
  const html = `<!DOCTYPE html><html lang="en"><head><title>Shell</title></head><body><header><nav><a href="/a">A</a><a href="/b">B</a></nav></header><footer><p>© 2026 Shell Inc.</p><a href="mailto:team@shell-inc.com">Email</a></footer></body></html>`;
  const c = signals(html, "https://shell.test/");
  assert.equal(c.mainWords, 0);
  assert.equal(c.sentences, 0);
  assert.equal(c.paragraphs, 0);
  assert.equal(c.fleschReadingEase, null);
  assert.equal(c.avgSentenceWords, 0);
  assert.equal(c.avgParagraphWords, 0);
  assert.equal(c.leadText, "");
  assert.equal(c.firstParagraph, "");
  assert.equal(c.nextStepLinks, 0);
  assert.equal(c.numberCount, 0);
  assert.equal(c.byline, false);
  assert.equal(c.contactDetails?.email, true);
  assert.equal(c.questionHeadings, 0);
  assert.deepEqual(c.bodyYears, [], "the footer's © 2026 is not body text");
});

test("non-2xx, non-HTML and failed fetches get no content signals (undefined = not measured, never zeros)", () => {
  const html = "<html><body><main><p>Page not found, sorry about that.</p></main></body></html>";
  assert.equal(parsePage(html, fr("https://x.test/missing", html, { status: 404 }), 1, "x.test").content, undefined);
  assert.equal(parsePage("", fr("https://x.test/f.pdf", "", { contentType: "application/pdf" }), 1, "x.test").content, undefined);
  assert.equal(parsePage("", fr("https://x.test/dead", "", { status: 0, error: "ECONNREFUSED", contentType: "" }), 1, "x.test").content, undefined);
  assert.equal(parsePage("%PDF-1.7 binary", fr("https://x.test/doc", "%PDF-1.7 binary", { contentType: "application/pdf" }), 1, "x.test").content, undefined);
});

test("DOM guard still respected: a 2 MB page is truncated before parsing, signals stay small and fast, late links still count as next steps", () => {
  const units: string[] = [`<html lang="en"><head><title>Big page</title></head><body><main><p>${"Intro words for the big page. ".repeat(20)}</p>`];
  let len = units[0].length;
  for (let i = 0; len < 2 * 1024 * 1024; i++) {
    const u = `<a href="/p${i}">link ${i}</a>\n`;
    units.push(u);
    len += u.length;
  }
  const body = units.join("");
  const t0 = Date.now();
  const page = parsePage(body, fr("https://big.test/", body), 1, "big.test");
  const ms = Date.now() - t0;
  assert.ok(ms < 3_000, `parse took ${ms}ms`);
  assert.ok(page.issues.some((i) => i.startsWith("Unusually large DOM")), page.issues.join(" | "));
  assert.ok(page.content, "content computed on the truncated DOM");
  const c = page.content as PageContentSignals;
  assert.ok(c.mainWords > 10_000);
  assert.ok(c.nextStepLinks > 2_000, `late internal links are not dropped by a first-come cap (${c.nextStepLinks})`);
  assert.ok(JSON.stringify(c).length < 4_000, `stored signals are ${JSON.stringify(c).length} bytes`);
  assert.ok(JSON.stringify(page).length < 100_000);
});

test("one huge text node: analysis is capped (fast), word count is not", () => {
  const body = `<html lang="en"><head><title>Wall of text</title></head><body><main><p>${"word ".repeat(400_000)}</p></main></body></html>`;
  const t0 = Date.now();
  const c = signals(body, "https://wall.test/");
  const ms = Date.now() - t0;
  assert.ok(ms < 3_000, `took ${ms}ms`);
  assert.equal(c.mainWords, 400_000, "the full main text is still counted (same text as minhash)");
  assert.equal(c.paragraphs, 1);
  assert.equal(c.sentences, 1);
  assert.equal(c.fleschReadingEase, 0, "one endless sentence clamps to 0");
  assert.equal(c.leadText.split(" ").length, 150);
  assert.ok(c.leadText.length <= 1_500 && c.firstParagraph.length <= 300);
});

test("markup nested too deeply: the shallow re-read still yields signals instead of failing the page", () => {
  const body = `<html lang="en"><head><title>Deep page title long enough ok</title></head><body>${"<div>".repeat(20_000)}<p>deep text here</p></body></html>`;
  const t0 = Date.now();
  const page = parsePage(body, fr("https://deep.test/", body), 0, "deep.test");
  assert.ok(Date.now() - t0 < 3_000);
  assert.ok(page.issues.some((i) => /nested too deeply/.test(i)), page.issues.join(" | "));
  assert.ok(page.content);
  assert.equal(page.content?.mainWords, 0, "the deep paragraph is past the shallow re-read's element cap");
});

const EXPECTED_KEYS = [
  "mainWords", "sentences", "paragraphs", "fleschReadingEase", "avgSentenceWords", "avgParagraphWords", "h2Count", "h3Count",
  "listCount", "orderedListCount", "listItemCount", "tableCount", "numberCount", "experienceMarkers", "originalDataMarkers",
  "aiPhraseHits", "authoritativeOutlinks", "outboundLinks", "imagesSelfHosted", "imagesStock", "byline", "authorName",
  "authorLink", "authorInSchema", "datePublished", "dateModified", "titleYear", "leadText", "firstParagraph", "hasFaq",
  "nextStepLinks", "clickbaitHits", "titleNumber", "ymylHits", "orgName", "siteName", "titleBrand", "sameAsCount",
  "interstitialHints", "contactDetails", "questionHeadings", "bodyYears",
].sort();

test("every PageContentSignals field is present, JSON-safe, small, and the output is deterministic", () => {
  for (const [html, url] of [
    [EXPERIENCE_ARTICLE, "https://acme.test/blog/x"],
    [BOILERPLATE_ARTICLE, "https://brandboost.test/blog/x"],
    [GERMAN_PAGE, "https://beispiel.test/x"],
    [WORDPRESS_POST, "https://wp.test/x/"],
    [MODAL_PAGE, "https://example.test/x"],
  ] as const) {
    const a = signals(html, url);
    assert.deepEqual(Object.keys(a).sort(), EXPECTED_KEYS, url);
    assert.deepEqual(signals(html, url), a, "same input → same signals");
    const json = JSON.stringify(a);
    assert.deepEqual(JSON.parse(json), a);
    assert.ok(json.length < 3_000, `${url}: ${json.length} bytes`);
  }
  // 截断不劈开代理对(半个 emoji 会让 jsonb 拒收整份报告)
  const emoji = `<html lang="en"><head><title>Emoji page</title></head><body><main><p>${"x".repeat(298)}😀 and more words after the emoji to fill the paragraph.</p></main></body></html>`;
  const c = signals(emoji, "https://emoji.test/");
  const last = c.firstParagraph.charCodeAt(c.firstParagraph.length - 1);
  assert.ok(!(last >= 0xd800 && last <= 0xdbff), "firstParagraph does not end in a lone high surrogate");
});

/* ============================================================
   11. 主体文本与 v2 的抽取完全一致(minhash 不因 v3 改变)
   ============================================================ */

/** v2 parse.ts 里给 minhash 用的抽取(collectText + 外壳 / 不可见剔除),原样抄在这里作对照 */
function legacyMainText(html: string): string {
  const root = parseHtml(prepareMarkup(html).html, { lowerCaseTagName: true, comment: false, blockTextElements: {}, parseNoneClosedTags: true });
  const textRoot = root.querySelector("body") ?? root;
  const CHROME = new Set(["nav", "header", "footer", "aside"]);
  const INVISIBLE = new Set(["script", "style", "noscript", "template", "svg"]);
  const tag = (el: HTMLElement) => (el.rawTagName ?? "").toLowerCase();
  const chrome = (el: HTMLElement) => {
    const t = tag(el);
    if (CHROME.has(t)) return true;
    if (t === "div" || t === "ul" || t === "section" || t === "aside") {
      const r = (el.getAttribute("role") ?? "").toLowerCase();
      if (r === "navigation" || r === "banner" || r === "contentinfo") return true;
    }
    return false;
  };
  const out: string[] = [];
  const stack: HtmlNode[] = [];
  for (let i = textRoot.childNodes.length - 1; i >= 0; i--) stack.push(textRoot.childNodes[i]);
  while (stack.length) {
    const n = stack.pop() as HtmlNode;
    if (n.nodeType === NodeType.TEXT_NODE) out.push((n as TextNode).text);
    else if (n.nodeType === NodeType.ELEMENT_NODE) {
      const el = n as HTMLElement;
      if (INVISIBLE.has(tag(el)) || chrome(el)) continue;
      for (let i = el.childNodes.length - 1; i >= 0; i--) stack.push(el.childNodes[i]);
    }
  }
  return out.join(" ").replace(/\s+/g, " ").trim();
}

test("main text is exactly the v2 minhash text (extractMainText and page.textSample agree with the legacy extraction)", () => {
  const roleChrome = `<html><body><div role="banner">Banner text</div><ul role="navigation"><li>Nav</li></ul><section role="contentinfo">Info</section><p>Body <b>bold</b><i>italic</i> text</p><svg><text>svg words</text></svg><noscript>ns</noscript></body></html>`;
  for (const html of [EXPERIENCE_ARTICLE, BOILERPLATE_ARTICLE, WORDPRESS_POST, MODAL_PAGE, GERMAN_PAGE, roleChrome]) {
    const legacy = legacyMainText(html);
    const root = parseHtml(prepareMarkup(html).html, { lowerCaseTagName: true, comment: false, blockTextElements: {}, parseNoneClosedTags: true });
    assert.equal(extractMainText(root), legacy);
    const page = parsePage(html, fr("https://same.test/p", html), 1, "same.test");
    assert.equal(page.textSample, legacy.slice(0, 400));
  }
  assert.equal(legacyMainText(roleChrome), "Body bold italic text");
});

/* ============================================================
   12. 纯函数
   ============================================================ */

test("countSyllables: vowel-group heuristic with silent -e / -es / -ed", () => {
  const cases: [string, number][] = [
    ["cat", 1],
    ["the", 1],
    ["table", 2],
    ["reading", 2],
    ["jumped", 1],
    ["wanted", 2],
    ["makes", 1],
    ["yellow", 2],
    ["readability", 5],
    ["2026", 1],
  ];
  for (const [w, n] of cases) assert.equal(countSyllables(w), n, w);
});

test("fleschReadingEase: exact formula, clamped to 0–100, null below 30 words", () => {
  // 每句 12 词 17 音节,3 句:206.835 − 1.015 × 12 − 84.6 × 51/36 = 74.805
  const s = "Reading tables makes the cat jump over yellow mats and wanted toys. ";
  assert.equal(fleschReadingEase(s.repeat(3)), 74.8);
  assert.equal(fleschReadingEase("The cat sat on the mat. ".repeat(6)), 100, "116.1 clamps to 100");
  assert.equal(fleschReadingEase("Too short to judge. Really."), null);
  assert.equal(fleschReadingEase(""), null);
  const hard = "Comprehensive organizational interoperability necessitates sophisticated institutional coordination mechanisms. ".repeat(5);
  assert.equal(fleschReadingEase(hard), 0, "very hard text clamps to 0");
});

test("splitSentences: '. ! ?' + whitespace, line breaks end sentences, abbreviations and initials do not", () => {
  assert.deepEqual(splitSentences("Dr. Smith went to Washington. He arrived at 3 p.m. on Monday! Was it fun? Yes."), [
    "Dr. Smith went to Washington.",
    "He arrived at 3 p.m. on Monday!",
    "Was it fun?",
    "Yes.",
  ]);
  assert.equal(splitSentences("See e.g. ChatGPT and the U.S. market.").length, 1);
  assert.equal(splitSentences("John F. Kennedy spoke. Then he left.").length, 2);
  assert.equal(splitSentences("A heading without a period\nA paragraph. Another one.").length, 3);
  assert.equal(splitSentences('He said "stop." Then it stopped.').length, 2);
  assert.equal(splitSentences("Version 3.5 is out. Prices rose 2.5% today.").length, 2);
  assert.deepEqual(splitSentences(""), []);
  assert.deepEqual(splitSentences("  \n  "), []);
});

test("countMarkers: word boundaries, case-insensitive, curly quotes, no double counting of overlapping phrases", () => {
  assert.equal(countMarkers("Navigating the ever-evolving landscape of AI search", "aiPhrase"), 1);
  assert.equal(countMarkers("It’s worth noting that delving into data is a game changer.", "aiPhrase"), 3);
  assert.equal(countMarkers("The modal delivered results.", "aiPhrase"), 0);
  assert.equal(countMarkers("We used to guess. Now I used Ahrefs and we used Semrush.", "experience"), 2, "'we used to' is habitual past, not experience");
  assert.equal(countMarkers("WE TESTED it hands-on, first-hand, firsthand. Get your hands on it.", "experience"), 4);
  assert.equal(countMarkers("Two case studies and one case study.", "experience"), 2);
  assert.equal(countMarkers("Our survey of 1,000 marketers (n = 1,000) and our methodology.", "originalData"), 3);
  assert.equal(countMarkers("We analyzed 500 sites and we found that 43% lacked schema.", "originalData"), 2);
  assert.equal(countMarkers("We analyzed 500 sites and we found that 43% lacked schema.", "experience"), 1, "'we found'");
  assert.equal(countMarkers("Our dataset and our datasets.", "originalData"), 2);
  assert.equal(countMarkers("Investigators investigate tax rules and investing.", "ymyl"), 2, "investigate is not invest");
  assert.equal(countMarkers("Syntax, taxonomy and cryptography are not YMYL.", "ymyl"), 0);
  assert.equal(countMarkers("", "experience"), 0);
});

test("countDataPoints: currency / percent / unit numbers and ≥2-digit numbers; not years, dates, times, ordinals or codes", () => {
  assert.equal(countDataPoints("In 2026, 43% of 1,200 marketers spent $5k on 3 tools over 12 months (published Jul 17, 2026 at 10:30)."), 4);
  assert.equal(countDataPoints("H2 headings, B2B SaaS, the 21st century, the 1990s, 3D renders, GPT-4o, step 01 and 2026-09-30."), 0);
  assert.equal(countDataPoints("A 3.5x lift and 0.5% churn."), 2);
  assert.equal(countDataPoints("€20, £15 and ¥300."), 3);
  assert.equal(countDataPoints("~$9 billion to ≈$47 billion, an 80x jump."), 3);
  assert.equal(countDataPoints(""), 0);
});

test("isAuthoritativeUrl: .gov/.edu/.mil/.int, country gov/academic domains, the spec's source list (with subdomains)", () => {
  for (const u of [
    "https://www.nist.gov/x",
    "https://cs.stanford.edu/paper",
    "https://www.army.mil/",
    "https://www.who.int/news",
    "https://www.gov.uk/guidance",
    "https://www.ox.ac.uk/research",
    "https://en.wikipedia.org/wiki/SEO",
    "https://pubmed.ncbi.nlm.nih.gov/123/",
    "https://developers.google.com/search",
    "https://link.springer.com/article/1",
    "https://www.reuters.com/tech",
    "https://www.bbc.co.uk/news",
  ]) {
    assert.equal(isAuthoritativeUrl(u), true, u);
  }
  for (const u of ["https://www.google.com/", "https://example.com/gov", "https://notwikipedia.org/", "https://blog.example.edu.fake.com/", "not a url", ""]) {
    assert.equal(isAuthoritativeUrl(u), false, u);
  }
});

test("isStockImageUrl: stock hosts (with subdomains), proxied stock URLs and stock filenames re-hosted on the site", () => {
  for (const u of [
    "https://images.pexels.com/photos/7947996/pexels-photo-7947996.jpeg?auto=compress",
    "https://plus.unsplash.com/premium_photo-1.jpg",
    "https://t3.ftcdn.net/jpg/01/23/45/67.jpg",
    "https://media.istockphoto.com/id/1/photo.jpg",
    "https://example.com/_next/image?url=https%3A%2F%2Fimages.unsplash.com%2Fphoto-1&w=1080",
    "https://example.com/wp-content/uploads/2024/01/shutterstock_123456789.jpg",
    "https://example.com/uploads/iStock-1234567.jpg",
    "https://example.com/uploads/AdobeStock_123456.jpeg",
    "https://example.com/uploads/john-doe-abc123-unsplash.jpg",
    "https://example.com/uploads/pexels-photo-3184292.jpeg",
  ]) {
    assert.equal(isStockImageUrl(u), true, u);
  }
  for (const u of ["https://example.com/images/team-photo.jpg", "https://example.com/stockholm.jpg", "https://example.com/pexelsfan.jpg", "https://cdn.example.com/uploads/screenshot-1.png", ""]) {
    assert.equal(isStockImageUrl(u), false, u);
  }
});

test("titleYear / titleBrand", () => {
  assert.equal(titleYear("Best AEO Tools 2025–2026"), 2026, "a range reports its latest year");
  assert.equal(titleYear("FY2026 planning guide"), 2026);
  assert.equal(titleYear("Top 20 in 1989"), null, "outside 1990–2099");
  assert.equal(titleYear("1080p video tips"), null);
  assert.equal(titleYear("No year here"), null);

  assert.equal(titleBrand("Post Title | Brand"), "Brand");
  assert.equal(titleBrand("How llms.txt Works – WP Demo"), "WP Demo");
  assert.equal(titleBrand("A | B | Brand Name"), "Brand Name", "the last separator wins");
  assert.equal(titleBrand("Pricing · Acme"), "Acme");
  assert.equal(titleBrand("AEO vs SEO - What's the Difference?"), null, "a question after the dash is a subtitle, not a brand");
  assert.equal(titleBrand("Anthropic Revenue 2026: The Full Run-Rate Timeline"), null, "hyphens inside words are not separators");
  assert.equal(titleBrand(""), null);
});

test("toIsoDate: ISO dates as written, RFC / long-form dates, invalid and year-only values rejected", () => {
  assert.equal(toIsoDate("2026-09-30T23:30:00-05:00"), "2026-09-30", "the date as published, not shifted to UTC");
  assert.equal(toIsoDate("2026-9-3"), "2026-09-03");
  assert.equal(toIsoDate("2026/09/30"), "2026-09-30");
  assert.equal(toIsoDate("20260930"), "2026-09-30");
  assert.equal(toIsoDate("September 30, 2026"), "2026-09-30");
  assert.equal(toIsoDate("Wed, 30 Sep 2026 23:30:00 GMT"), "2026-09-30");
  assert.equal(toIsoDate("2026"), null, "a bare year is not a date");
  assert.equal(toIsoDate("2026-02-31"), null);
  assert.equal(toIsoDate("1985-01-01"), null);
  assert.equal(toIsoDate("not a date"), null);
  assert.equal(toIsoDate(20260930), null);
  assert.equal(toIsoDate(null), null);
});

/* ============================================================
   13. v4:问句式标题(可引用性)与正文年份(过时数据)
   ============================================================ */

const QUESTION_PAGE = `<!DOCTYPE html>
<html lang="en">
<head><title>Answer Engine Optimization: The Practical Guide | AEO Lab</title></head>
<body>
<header><nav><a href="/">Home</a><a href="/guides">Guides</a></nav><h2>Why trust us?</h2></header>
<main>
<h1>What is answer engine optimization?</h1>
<p>Answer engine optimization is the practice of making your pages easy for AI assistants to quote and cite.</p>
<h2>What does an answer engine actually read?</h2>
<p>It reads the passage that answers the question, not the whole page.</p>
<h3>How ChatGPT picks its sources</h3>
<h3>Key takeaways</h3>
<h2>Pricing</h2>
<h2>Is llms.txt worth adding</h2>
<h3>Ready to get cited?</h3>
<h2><span>Why</span> <em>does</em> schema matter</h2>
<h2>Can AI assistants read PDFs?<a class="anchor" href="#pdfs" aria-hidden="true">#</a></h2>
<h3>What’s new in 2026</h3>
<h2>Whatever happened to keyword density</h2>
<h3>Don't block OAI-SearchBot</h3>
<h2>2. Which pages get cited</h2>
<h4>Do I need a sitemap?</h4>
<h2>Still invisible in ChatGPT?<a class="headerlink" href="#still" title="Permalink to this heading">¶</a></h2>
</main>
<aside><h3>Who writes these guides?</h3></aside>
<footer><h2>Should you subscribe?</h2></footer>
</body></html>`;

test("questionHeadings: H2/H3 in the main content that end with '?' or start with an interrogative; H1/H4 and header/aside/footer headings excluded", () => {
  const c = signals(QUESTION_PAGE, "https://aeolab.test/guide");
  // ✓ What does…? / How ChatGPT… / Is llms.txt… / Ready to get cited? / Why does…(内联标记)/ Can AI…?#(永久链接)/
  //   What's new…(缩写)/ 2. Which…(编号)/ Still invisible…?¶ —— 9 个
  // ✗ Key takeaways / Pricing / Whatever… / Don't…(祈使句)/ H1 / H4 / 页头、侧栏、页脚里的问句
  assert.equal(c.questionHeadings, 9);
  assert.equal(c.h2Count, 8, "same element set as h2Count");
  assert.equal(c.h3Count, 5);
  assert.ok((c.questionHeadings ?? 0) <= c.h2Count + c.h3Count);

  // 坏标记:H3 嵌在没闭合的 H2 里 —— 算外层标题的一部分,不重复计数
  const nested = signals(`<html lang="en"><head><title>t</title></head><body><main><h2>Overview<h3>What is X?</h3></h2><p>Body text for the page.</p></main></body></html>`, "https://x.test/n");
  assert.equal(nested.h2Count, 1);
  assert.equal(nested.h3Count, 1);
  assert.equal(nested.questionHeadings, 1);
});

test("isQuestionHeading: '?' ending (after closing quotes / permalink symbols) or interrogative first word; contractions; numbering and emoji skipped", () => {
  assert.deepEqual([...QUESTION_WORDS].sort(), ["are", "can", "do", "does", "how", "is", "should", "what", "when", "where", "which", "who", "why"], "the spec's list, unchanged");
  const yes = [
    "What is answer engine optimization?",
    "How ChatGPT picks its sources",
    "why AI Overviews cite Reddit",
    "WHEN TO USE LLMS.TXT",
    "Where do AI answers come from",
    "Which AEO tool is best for agencies",
    "Who should own AEO",
    "Can ChatGPT read JavaScript",
    "Does Perplexity cite Reddit",
    "Do you need llms.txt",
    "Is AEO the same as SEO",
    "Are AI Overviews killing clicks",
    "Should you block GPTBot",
    "What’s new in 2026",
    "Who're the biggest AEO vendors",
    "2. Which pages get cited",
    "🚀 How to launch on Perplexity",
    "How-to: set up llms.txt",
    "“Is this real?”",
    "Is AEO worth it? (2026 update)",
    "Ready to get cited?",
    "Ready for AI search?¶",
    "Still invisible in ChatGPT?”",
    "AEO vs SEO: which one wins?",
    "什么是答案引擎优化？",
  ];
  const no = [
    "Pricing",
    "Key takeaways",
    "Whatever happened to keyword density",
    "Howto guides",
    "Don't block OAI-SearchBot",
    "Can't-miss AEO tactics",
    "10 questions to ask an AEO agency",
    "Showcase: how we built it",
    "FAQ",
    "?",
    "2026",
    "",
  ];
  for (const h of yes) assert.equal(isQuestionHeading(h), true, h);
  for (const h of no) assert.equal(isQuestionHeading(h), false, h);

  // 解析时边读文本节点边判的结果,与对整段标题调用 isQuestionHeading 一致
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const all = [...yes, ...no];
  const html = `<html lang="en"><head><title>t</title></head><body><main>${all.map((h) => `<h2>${esc(h)}</h2>`).join("\n")}</main></body></html>`;
  assert.equal(signals(html, "https://q.test/all").questionHeadings, yes.length);
});

const YEARS_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<title>AI Search Statistics Since 1995 | Data Desk</title>
<meta property="article:published_time" content="1996-05-01T08:00:00Z">
<script type="application/ld+json">{"@context":"https://schema.org","@type":"Article","headline":"AI search statistics","datePublished":"1997-01-01","dateModified":"1997-06-01"}</script>
</head>
<body>
<header><nav><a href="/archive/1998/">1998 archive</a></nav></header>
<main>
<div class="toc"><ul><li><a href="#recap">2015 recap</a></li></ul></div>
<h1>AI search statistics</h1>
<p>Updated: March 4, 2013</p>
<p>September 30, 2014</p>
<p>In 2021, 43% of searches ended without a click (Rand, 2022), and the share kept rising through 2023–2024.</p>
<p>The 2025's playbook, Q3 2026 numbers and the 1990s web all appear in this guide, last checked on <time datetime="1999-01-01">January 1, 2000</time>.</p>
<h2>What changed in 2027?</h2>
<table><tr><th>Year</th><th>Share</th></tr><tr><td>2028</td><td>61%</td></tr></table>
<p>Raw data: https://www.census.gov/library/2001/report.html and example.com/2002/05/post — version 2003.5, 12030 rows, $2005 per seat, 2006% growth, 2007 ms latency, issue #2009, FY2010, 1989 and 2100. In 2021 we re-ran it.</p>
<div class="site-credits">© 2011–2012 Data Desk. All rights reserved.</div>
</main>
<aside><p>From the 2017 archive</p></aside>
<footer><p>© 2016 Data Desk</p></footer>
</body></html>`;

test("bodyYears: standalone years in the main text only — not in the title, meta, JSON-LD, URLs, <time>, date stamps, TOC, copyright lines, chrome, decimals, prices, units or IDs", () => {
  const c = signals(YEARS_PAGE, "https://datadesk.test/ai-search-statistics");
  // 计入:2021(两次,去重)、2022、2023–2024、2025's、Q3 2026、H2 里的 2027、表格里的 2028
  // 不计:标题 1995、meta 1996、JSON-LD 1997、导航 1998、<time> 的 datetime 1999 与文字 2000、网址里的 2001 / 2002、
  //      小数 2003.5、12030、$2005、2006%、2007 ms、#2009、FY2010、版权行 2011–2012、日期戳行 2013 / 2014、
  //      目录 2015、页脚 2016、侧栏 2017、1990s(年代)、范围外的 1989 / 2100
  assert.deepEqual(c.bodyYears, [2021, 2022, 2023, 2024, 2025, 2026, 2027, 2028]);
  assert.equal(c.questionHeadings, 1, "'What changed in 2027?'");
  assert.equal(c.datePublished, "1997-01-01", "the page's own dates still come from metadata, untouched");

  // 超过 12 个:升序、留最新的 12 个
  const many = `<!DOCTYPE html><html lang="en"><head><title>Timeline</title></head><body><main><p>Milestones: ${Array.from({ length: 15 }, (_, i) => 2015 - i).join(", ")}.</p></main></body></html>`;
  const years = signals(many, "https://timeline.test/").bodyYears ?? [];
  assert.equal(years.length, MAX_BODY_YEARS);
  assert.deepEqual(years, Array.from({ length: 12 }, (_, i) => 2004 + i));
});

test("bodyYears date stamps: byline / updated / date-only lines are the page's own date; prose dates, changelog entries and 'By 2030' sentences still count", () => {
  const page = (body: string) => signals(`<!DOCTYPE html><html lang="en"><head><title>Stamp test</title></head><body><main>${body}<p>Plain body text without any year in it at all.</p></main></body></html>`, "https://stamp.test/p").bodyYears;
  assert.deepEqual(page(`<p>By Jane Doe · Sep 30, 2019</p>`), []);
  assert.deepEqual(page(`<p>Sep 30, 2019 · 7 min read</p>`), []);
  assert.deepEqual(page(`<p>Last updated on 2019-09-30</p>`), []);
  assert.deepEqual(page(`<p>Date: 2019-09-30</p>`), []);
  assert.deepEqual(page(`<ul class="post-meta"><li>September 30, 2019</li></ul>`), []);
  assert.deepEqual(page(`<p>On July 17, 2019, Google rolled out the update.</p>`), [2019]);
  assert.deepEqual(page(`<p>Jan 5, 2019: launched v2 of the tracker</p>`), [2019]);
  assert.deepEqual(page(`<p>By 2030, half of all searches will start in an AI assistant.</p>`), [2030]);
  assert.deepEqual(page(`<h3>September 30, 2019</h3>`), [2019], "a dated heading (release notes) is content, not a stamp");
  assert.deepEqual(page(`<table><tr><td>2019-09-30</td><td>Core update</td></tr><tr><td>2020-01-13</td><td>Another one</td></tr></table>`), [2019, 2020]);
  // 超过 25 词的段落不是日期戳行:<time> 里的 2026 不算,正文里的 2019 / 2024 照算
  assert.deepEqual(
    page(`<p>Updated <time datetime="2026-09-30">Sep 30, 2026</time>. Our 2019 survey of answer engines still holds, and a 2024 rerun confirmed it for every one of the twelve tools we track in our weekly benchmark.</p>`),
    [2019, 2024],
    "<time> text is excluded even inside a long paragraph"
  );
  // ≤ 25 词、以 Updated 开头又含完整日期:整行算日期戳(连同里面顺带提到的年份)
  assert.deepEqual(page(`<p>Updated Sep 30, 2026 with our 2019 survey data.</p>`), []);
});

test("yearsInText: standalone 1990–2099 tokens; URLs, decimals, longer numbers, prices, units, decades, IDs and copyright lines are not years", () => {
  assert.deepEqual(yearsInText("In 2021, 43% of searches ended without a click (2022). Q3 2026 and 2025's plans."), [2021, 2022, 2025, 2026]);
  assert.deepEqual(yearsInText("2023–2024, 2019-2020, 2018/2019 and 2016,2017"), [2016, 2017, 2018, 2019, 2020, 2023, 2024], "ranges and lists, deduped and sorted");
  assert.deepEqual(yearsInText("2025.5 index, 12024 rows, 20245, 1.2024 ratio, $2024 plan, € 2023, 2022% growth, 2000 years ago, 2048 px, 1999 ms"), []);
  assert.deepEqual(yearsInText("the 1990s, FY2026, v2024, #2021, issue_2020, 1989 and 2100"), []);
  assert.deepEqual(yearsInText("Source: https://www.census.gov/library/2021/acs.html, (www.example.com/2019/post) and example.com/2018/05/x"), []);
  assert.deepEqual(yearsInText("© 2019–2026 Acme Inc. Copyright © 2020 Acme. (c) 2018"), []);
  assert.deepEqual(yearsInText("Released 2024.10.05; IntelliJ 2023.2.1; on 30.09.2022."), [2022, 2023, 2024], "dotted dates and year-based versions keep their year");
  assert.deepEqual(yearsInText("In 2024 X rebranded; 2023 M&A deals; 2021x faster"), [2023, 2024], "a spaced single letter is the next word, not a unit");
  assert.deepEqual(yearsInText(Array.from({ length: 20 }, (_, i) => 2010 - i).join(", ")), Array.from({ length: 12 }, (_, i) => 1999 + i), "≤12, newest kept");
  assert.deepEqual(yearsInText(""), []);

  // 线性:超长的"像网址又不是网址"的词、成串的四位数都不会拖慢
  const t0 = Date.now();
  yearsInText(`${"a-".repeat(100_000)}/2024 ${"2024.".repeat(40_000)} ${"1.2024 ".repeat(20_000)}`);
  assert.ok(Date.now() - t0 < 1_000, `took ${Date.now() - t0}ms`);
});

test("question headings: marketing section titles ('What we do', 'How it works') are not questions unless they end with '?'", () => {
  assert.equal(isQuestionHeading("What we do"), false);
  assert.equal(isQuestionHeading("Who we are"), false);
  assert.equal(isQuestionHeading("How it works"), false);
  assert.equal(isQuestionHeading("Why our customers stay"), false);
  assert.equal(isQuestionHeading("How it works?"), true, "an explicit question mark still counts");
  assert.equal(isQuestionHeading("What is AEO"), true);
  assert.equal(isQuestionHeading("How to audit your site"), true);
  // 前两个词分在两个文本节点里时,流式判定与整段判定一致
  const html = `<!DOCTYPE html><html lang="en"><head><title>T</title></head><body><main><h2><strong>What</strong> we do</h2><p>${"Plain words for the paragraph. ".repeat(4)}</p><h2><em>How</em> to start</h2><p>${"More plain words here. ".repeat(4)}</p></main></body></html>`;
  assert.equal(signals(html, "https://acme.test/x").questionHeadings, 1);
});

