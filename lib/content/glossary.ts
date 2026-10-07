export type Term = {
  slug: string;
  term: string;
  short: string; // 一句话定义
  body: string[]; // 段落
  related: string[]; // slugs
};

export const GLOSSARY: Term[] = [   
  {
    slug: "mention-rate",
    term: "Mention Rate",
    short: "The percentage of relevant questions in which an AI engine mentions your brand.",
    body: [
      "Mention rate is the share of category questions where your brand appears in the AI's answer. A 0% mention rate means you're invisible for those prompts; a high rate means the AI consistently considers you.",
      "Because AI answers vary by phrasing and engine, mention rate should be measured across many questions and multiple engines to be meaningful.",
    ],
    related: [],
  },      
  {
    slug: "query-fan-out",
    term: "Query Fan-Out",
    short: "The technique Google's AI Mode uses to break one question into many sub-queries, then synthesize the results into a single answer.",
    body: [
      "Query fan-out is how Google's AI Mode answers a question: instead of running one search, it expands your query into multiple related sub-queries — comparisons, definitions and likely follow-ups — retrieves results for each, and stitches the strongest passages into one response. It's why ranking for a single keyword no longer guarantees you appear in the answer.",
      "To win a fan-out slot, content must comprehensively answer the sub-questions around a topic, not just the head term. A page that covers definitions, pricing, comparisons and edge cases has more surface area across the sub-queries Google generates than one narrowly optimized page.",
    ],
    related: [],
  }, 
  {
    slug: "gptbot",
    term: "GPTBot",
    short: "OpenAI's crawler that collects web content for training its models. ChatGPT search uses a separate crawler, OAI-SearchBot.",
    body: [
      "GPTBot is the user agent OpenAI uses to collect content that may be used to train its foundation models. OpenAI documents it separately from OAI-SearchBot, which surfaces sites in ChatGPT search answers, and the two robots.txt settings are independent: blocking GPTBot does not remove you from ChatGPT search.",
      "Blocking GPTBot keeps future crawls out of training data; it is a reasonable choice for publishers with licensable content. For most brands we think it is the wrong default, because model memory is part of how ChatGPT describes a category. If you want to stay visible in ChatGPT search, never block OAI-SearchBot.",
    ],
    related: ["ai-crawler"],
  },
  {
    slug: "ai-crawler",
    term: "AI Crawler",
    short: "A bot that fetches web content to feed AI systems — for training, live retrieval, or both — such as GPTBot, ClaudeBot and PerplexityBot.",
    body: [
      "AI crawlers are the bots that let AI assistants read the web. Some gather data to train models; others fetch pages in real time to answer a live question. Whether these bots can reach your content directly affects whether AI engines can mention and cite you.",
      "You control AI crawler access through robots.txt and, increasingly, an llms.txt file. The strategic question isn't just whether Googlebot can see you anymore — it's whether the specific AI crawlers behind ChatGPT, Claude, Perplexity and Gemini can too.",
    ],
    related: ["gptbot"],
  }, 
  {
    slug: "entity-seo",
    term: "Entity SEO",
    short: "Optimizing so search and AI systems recognize your brand as a clear, well-defined entity — not just a string of keywords.",
    body: [
      "Entity SEO is the practice of making your brand an unambiguous thing that machines understand: what category you're in, who you compete with, who runs you. Where keyword SEO targets phrases, entity SEO targets recognition in the knowledge graph and, increasingly, in AI models' internal picture of your market.",
      "It matters more in AI search because a model that can't confidently identify your entity has no reason to recommend you. Consistent brand naming everywhere, Organization and Product schema, an authoritative about page, and third-party mentions that describe you the same way all build a strong entity.",
    ],
    related: [],
  },  
  {
    slug: "share-of-voice-ai",
    term: "Share of Voice (in AI Search)",
    short: "Your brand's slice of all brand mentions across AI answers for your category — the AI-era version of a classic marketing metric.",
    body: [
      "Share of voice in AI search measures what portion of the total brand mentions in AI-generated answers belongs to you. If engines name five brands across your category's buyer questions and you account for a third of those mentions, that's your share of voice — the same competitive lens marketers have used for decades, pointed at a new surface.",
      "It differs from share of model, AEOeye's per-question recommendation metric, mainly in framing: share of voice aggregates mentions across a whole question set, while share of model looks at how recommendation slots split within answers. Both answer the same underlying question — are you or your competitors winning the AI conversation?",
    ],
    related: ["mention-rate"],
  },
  {
    slug: "agentic-search",
    term: "Agentic Search",
    short: "Search performed by an AI agent that plans, runs multiple queries, reads results and synthesizes — instead of a human scanning links.",
    body: [
      "Agentic search is what happens when an AI agent handles the searching: it decomposes a task into sub-queries, fetches and reads pages, cross-checks claims, and returns a conclusion or action rather than a results page. Google's query fan-out in AI Mode is an early mainstream version of the pattern.",
      "For content, agentic search rewards machine-legible thoroughness: pages that answer sub-questions directly, carry verifiable facts, and parse cleanly get pulled into the agent's synthesis — while pages built to win a human glance on a results page may never be seen by a human at all.",
    ],
    related: ["query-fan-out"],
  },
];

export function getTerm(slug: string): Term | undefined {
  return GLOSSARY.find((t) => t.slug === slug);
}

/** 每个术语的权威来源(均为已校验真实存在的 URL),提升被引与 E-E-A-T */
export const TERM_SOURCES: Record<string, { label: string; url: string }[]> = {
  "share-of-voice-ai": [{ label: "Share of voice — Wikipedia", url: "https://en.wikipedia.org/wiki/Share_of_voice" }],
  "query-fan-out": [{ label: "AI features in Google Search — Google Search Central", url: "https://developers.google.com/search/docs/appearance/ai-features" }],
  "gptbot": [{ label: "Overview of OpenAI crawlers — OpenAI", url: "https://developers.openai.com/api/docs/bots" }],
  "ai-crawler": [{ label: "Web crawler — Wikipedia", url: "https://en.wikipedia.org/wiki/Web_crawler" }],
  "entity-seo": [{ label: "Named-entity recognition — Wikipedia", url: "https://en.wikipedia.org/wiki/Named-entity_recognition" }],
  citations: [
    { label: "Retrieval-augmented generation — Wikipedia", url: "https://en.wikipedia.org/wiki/Retrieval-augmented_generation" },
  ],
  hallucination: [
    { label: "Hallucination (artificial intelligence) — Wikipedia", url: "https://en.wikipedia.org/wiki/Hallucination_(artificial_intelligence)" },
  ],
};

/**
 * 每个术语的"深读"去处:术语页只给定义,完整的做法与证据在对应的主文章里。
 * 2026-10-03 清理后约 12 个词条与博客的 "what is X" 重复 —— 不再各写一遍,而是让术语页把读者送到那一篇。
 * 目标必须是现存页(scripts/verify-content-quality.mjs 会核对)。
 */
export const TERM_DEEP_DIVE: Record<string, { href: string; label: string }> = {
  "mention-rate": { href: "/blog/measuring-ai-visibility", label: "How to measure AI visibility" },
  "share-of-voice-ai": { href: "/blog/measuring-ai-visibility", label: "How to measure AI visibility" },
  "query-fan-out": { href: "/blog/how-to-rank-in-google-ai-mode", label: "How to show up in Google AI Mode" },
  "agentic-search": { href: "/blog/what-is-ai-search", label: "What is AI search?" },
  "gptbot": { href: "/blog/blocking-gptbot-is-usually-a-mistake", label: "Blocking GPTBot is usually a mistake" },
  "ai-crawler": { href: "/blog/ai-crawler-user-agent-directory", label: "AI crawler user-agent directory" },
  "entity-seo": { href: "/blog/what-is-entity-seo", label: "What is entity SEO?" },
};
