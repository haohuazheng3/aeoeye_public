/* ============================================================
   爬虫注册表:工具页里"以某爬虫身份请求"用的 UA 串、robots.txt 里的 token、
   运营方与用途(用途一律以运营方自己的文档为准,docs 字段即出处)。

   注意:我们从自己的服务器发出带这些 UA 的请求。真正的爬虫从各自公布的 IP 段来,
   按 IP 校验爬虫身份的防火墙(Cloudflare 的 Verified Bots 等)会把我们当成"冒充者"——
   工具页必须把这一点写清楚,结果里"被拦"不一定等于真爬虫也被拦。
   ============================================================ */

export type BotPurpose = "search" | "training" | "user-fetch" | "assistant" | "social" | "browser";

export interface BotInfo {
  id: string;
  name: string;
  /** robots.txt 里匹配用的 product token */
  token: string;
  operator: string;
  purpose: BotPurpose;
  /** 一句话用途(运营方文档原意) */
  role: string;
  ua: string;
  docs: string;
}

const CHROME = "Chrome/129.0.6668.89";

export const BOTS: Record<string, BotInfo> = {
  googlebot: {
    id: "googlebot", name: "Googlebot Smartphone", token: "Googlebot", operator: "Google", purpose: "search",
    role: "Crawls pages for Google Search; mobile-first indexing uses the smartphone crawler.",
    ua: `Mozilla/5.0 (Linux; Android 6.0.1; Nexus 5X Build/MMB29P) AppleWebKit/537.36 (KHTML, like Gecko) ${CHROME} Mobile Safari/537.36 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)`,
    docs: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
  },
  bingbot: {
    id: "bingbot", name: "Bingbot", token: "Bingbot", operator: "Microsoft", purpose: "search",
    role: "Crawls pages for Bing, which also supplies web results to other search products.",
    ua: `Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm) ${CHROME} Safari/537.36`,
    docs: "https://www.bing.com/webmasters/help/which-crawlers-does-bing-use-8c184ec0",
  },
  gptbot: {
    id: "gptbot", name: "GPTBot", token: "GPTBot", operator: "OpenAI", purpose: "training",
    role: "Collects public web content that may be used to train OpenAI's generative AI models.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.3; +https://openai.com/gptbot",
    docs: "https://developers.openai.com/api/docs/bots",
  },
  oaisearchbot: {
    id: "oaisearchbot", name: "OAI-SearchBot", token: "OAI-SearchBot", operator: "OpenAI", purpose: "search",
    role: "Surfaces websites in ChatGPT search results; not used to train models.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.3; +https://openai.com/searchbot",
    docs: "https://developers.openai.com/api/docs/bots",
  },
  chatgptuser: {
    id: "chatgptuser", name: "ChatGPT-User", token: "ChatGPT-User", operator: "OpenAI", purpose: "user-fetch",
    role: "Fetches a page when a ChatGPT user or custom GPT asks it to; OpenAI says robots.txt may not apply.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    docs: "https://developers.openai.com/api/docs/bots",
  },
  claudebot: {
    id: "claudebot", name: "ClaudeBot", token: "ClaudeBot", operator: "Anthropic", purpose: "training",
    role: "Collects public web content that could contribute to training Anthropic's models.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    docs: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  claudesearchbot: {
    id: "claudesearchbot", name: "Claude-SearchBot", token: "Claude-SearchBot", operator: "Anthropic", purpose: "search",
    role: "Navigates the web to improve the quality of search results shown to Claude users.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
    docs: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  claudeuser: {
    id: "claudeuser", name: "Claude-User", token: "Claude-User", operator: "Anthropic", purpose: "user-fetch",
    role: "Fetches a page when a Claude user asks a question that needs it.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Claude-User/1.0; +https://www.anthropic.com)",
    docs: "https://support.claude.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler",
  },
  perplexitybot: {
    id: "perplexitybot", name: "PerplexityBot", token: "PerplexityBot", operator: "Perplexity", purpose: "search",
    role: "Indexes sites so they can be surfaced and linked in Perplexity answers; not used for training.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    docs: "https://docs.perplexity.ai/guides/bots",
  },
  googleextended: {
    id: "googleextended", name: "Google-Extended", token: "Google-Extended", operator: "Google", purpose: "training",
    role: "A robots.txt token only (no separate crawler): controls use of content for Gemini training and grounding.",
    ua: "",
    docs: "https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers",
  },
  applebot: {
    id: "applebot", name: "Applebot", token: "Applebot", operator: "Apple", purpose: "search",
    role: "Crawls for Apple's search features in Siri, Spotlight and Safari.",
    ua: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15 (Applebot/0.1; +http://www.apple.com/go/applebot)",
    docs: "https://support.apple.com/en-us/119829",
  },
  applebotextended: {
    id: "applebotextended", name: "Applebot-Extended", token: "Applebot-Extended", operator: "Apple", purpose: "training",
    role: "A robots.txt token only: lets you opt out of Apple using Applebot-crawled data to train its AI models.",
    ua: "",
    docs: "https://support.apple.com/en-us/119829",
  },
  amazonbot: {
    id: "amazonbot", name: "Amazonbot", token: "Amazonbot", operator: "Amazon", purpose: "training",
    role: "Amazon's general crawler: Amazon says it improves its products and services and may be used to train Amazon AI models.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amazonbot/0.1) Chrome/126.0.0.0 Safari/537.36",
    docs: "https://developer.amazon.com/amazonbot",
  },
  amznsearchbot: {
    id: "amznsearchbot", name: "Amzn-SearchBot", token: "Amzn-SearchBot", operator: "Amazon", purpose: "search",
    role: "Makes content eligible for Amazon search experiences such as Alexa answers; Amazon says it does not crawl for AI training.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-SearchBot/0.1) Chrome/126.0.0.0 Safari/537.36",
    docs: "https://developer.amazon.com/amazonbot",
  },
  amznuser: {
    id: "amznuser", name: "Amzn-User", token: "Amzn-User", operator: "Amazon", purpose: "user-fetch",
    role: "Fetches live pages when an Alexa user asks a question; user-initiated, so it may not follow every robots.txt rule.",
    ua: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Amzn-User/0.1) Chrome/126.0.0.0 Safari/537.36",
    docs: "https://developer.amazon.com/amazonbot",
  },
  bytespider: {
    id: "bytespider", name: "Bytespider", token: "Bytespider", operator: "ByteDance", purpose: "training",
    role: "ByteDance's crawler, reported to collect data for its AI products; it publishes little documentation.",
    ua: "Mozilla/5.0 (Linux; Android 5.0) AppleWebKit/537.36 (KHTML, like Gecko) Mobile Safari/537.36 (compatible; Bytespider; spider-feedback@bytedance.com)",
    docs: "https://udger.com/resources/ua-list/bot-detail?bot=Bytespider",
  },
  ccbot: {
    id: "ccbot", name: "CCBot", token: "CCBot", operator: "Common Crawl", purpose: "training",
    role: "Builds the open Common Crawl dataset that many AI models have been trained on.",
    ua: "CCBot/2.0 (https://commoncrawl.org/faq/)",
    docs: "https://commoncrawl.org/ccbot",
  },
  metaexternalagent: {
    id: "metaexternalagent", name: "Meta-ExternalAgent", token: "meta-externalagent", operator: "Meta", purpose: "training",
    role: "Meta's crawler for AI training and for indexing content directly.",
    ua: "meta-externalagent/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/crawler)",
    docs: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers",
  },
  metawebindexer: {
    id: "metawebindexer", name: "Meta-WebIndexer", token: "Meta-WebIndexer", operator: "Meta", purpose: "search",
    role: "Meta's crawler for Meta AI search results; Meta says allowing it helps Meta AI cite and link to your content.",
    ua: "meta-webindexer/1.1 (+https://developers.facebook.com/docs/sharing/webmasters/web-crawlers)",
    docs: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers",
  },
  facebook: {
    id: "facebook", name: "facebookexternalhit", token: "facebookexternalhit", operator: "Meta", purpose: "social",
    role: "Fetches pages when they are shared on Facebook, Instagram or Messenger to build the link preview.",
    ua: "facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)",
    docs: "https://developers.facebook.com/docs/sharing/webmasters/web-crawlers",
  },
  twitterbot: {
    id: "twitterbot", name: "Twitterbot", token: "Twitterbot", operator: "X", purpose: "social",
    role: "Fetches shared URLs to build X (Twitter) cards.",
    ua: "Twitterbot/1.0",
    docs: "https://developer.x.com/en/docs/x-for-websites/cards/guides/getting-started",
  },
  linkedinbot: {
    id: "linkedinbot", name: "LinkedInBot", token: "LinkedInBot", operator: "LinkedIn", purpose: "social",
    role: "Fetches shared URLs to build LinkedIn link previews.",
    ua: "LinkedInBot/1.0 (compatible; Mozilla/5.0; Apache-HttpClient +http://www.linkedin.com)",
    docs: "https://www.linkedin.com/help/linkedin/answer/a521928",
  },
  browser: {
    id: "browser", name: "Chrome (desktop browser)", token: "*", operator: "—", purpose: "browser",
    role: "A normal desktop browser request, for comparison.",
    ua: `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) ${CHROME} Safari/537.36`,
    docs: "",
  },
  mobilebrowser: {
    id: "mobilebrowser", name: "Chrome on Android", token: "*", operator: "—", purpose: "browser",
    role: "A normal phone browser request, used to read the mobile page itself.",
    ua: `Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) ${CHROME} Mobile Safari/537.36`,
    docs: "",
  },
};

/** AI 相关爬虫(ai-crawlers 页一次全测) */
export const AI_BOT_IDS = [
  "gptbot", "oaisearchbot", "chatgptuser", "claudebot", "claudesearchbot", "claudeuser", "perplexitybot",
  "googleextended", "applebotextended", "amazonbot", "amznsearchbot", "bytespider", "ccbot", "metaexternalagent", "metawebindexer",
] as const;

/** robots.txt 测试器默认测的 17 个 */
export const ROBOTS_TEST_IDS = [
  "googlebot", "bingbot", "gptbot", "oaisearchbot", "chatgptuser", "claudebot", "claudesearchbot", "perplexitybot",
  "googleextended", "applebot", "applebotextended", "amazonbot", "amznsearchbot", "bytespider", "ccbot", "metaexternalagent",
] as const;

export function bot(id: string): BotInfo {
  const b = BOTS[id];
  if (!b) throw new Error(`unknown bot ${id}`);
  return b;
}
