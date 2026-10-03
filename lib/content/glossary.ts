export type Term = {
  slug: string;
  term: string;
  short: string; // 一句话定义
  body: string[]; // 段落
  related: string[]; // slugs
};

export const GLOSSARY: Term[] = [
  {
    slug: "answer-engine-optimization",
    term: "Answer Engine Optimization (AEO)",
    short: "The practice of getting your brand recommended by AI answer engines like ChatGPT, Perplexity and Google AI.",
    body: [
      "Answer engine optimization is the discipline of making your brand, products and facts easy for AI assistants to find, trust and recommend when a user asks a question. Where SEO optimizes for a ranked list of links, AEO optimizes for being named inside a single synthesized answer.",
      "AEO blends classic SEO fundamentals (crawlable, authoritative content) with new priorities: structured facts, third-party mentions, consistency across the web, and question-shaped content that AI can quote directly.",
    ],
    related: ["generative-engine-optimization", "ai-visibility", "share-of-model"],
  },
  {
    slug: "generative-engine-optimization",
    term: "Generative Engine Optimization (GEO)",
    short: "A near-synonym for AEO focused on optimizing for generative AI search experiences.",
    body: [
      "Generative engine optimization (GEO) refers to optimizing content for generative AI search engines that produce written answers rather than link lists. In practice GEO and AEO describe the same goal: influencing what AI says about you.",
      "GEO research has shown that citations, statistics, quotations and clearly-sourced claims increase the likelihood of being included in AI-generated answers.",
    ],
    related: ["answer-engine-optimization", "ai-overview", "citations"],
  },
  {
    slug: "ai-visibility",
    term: "AI Visibility",
    short: "How often and how prominently your brand appears in AI assistant answers for your category.",
    body: [
      "AI visibility measures whether AI assistants surface your brand when users ask buying questions. It combines mention rate (how often you appear), rank (where you appear among recommendations) and sentiment (how you're described).",
      "Unlike search rankings, AI visibility has no native dashboard — which is why brands often discover too late that AI never recommends them. Tools like AEOeye measure it directly by asking the engines.",
    ],
    related: ["mention-rate", "share-of-model", "answer-engine-optimization"],
  },
  {
    slug: "share-of-model",
    term: "Share of Model",
    short: "Your brand's share of recommendations across AI answers, relative to competitors.",
    body: [
      "Share of model (sometimes 'share of voice in AI') captures how much of the AI recommendation space you own compared to rivals. If AI names five brands for a query and you're one of them, your share for that query is roughly one fifth.",
      "Tracked over many questions and several engines, share of model is one of the clearest indicators of competitive AI visibility.",
    ],
    related: ["ai-visibility", "mention-rate", "competitor-gap"],
  },
  {
    slug: "mention-rate",
    term: "Mention Rate",
    short: "The percentage of relevant questions in which an AI engine mentions your brand.",
    body: [
      "Mention rate is the share of category questions where your brand appears in the AI's answer. A 0% mention rate means you're invisible for those prompts; a high rate means the AI consistently considers you.",
      "Because AI answers vary by phrasing and engine, mention rate should be measured across many questions and multiple engines to be meaningful.",
    ],
    related: ["ai-visibility", "share-of-model"],
  },
  {
    slug: "ai-overview",
    term: "AI Overview",
    short: "Google's AI-generated answer that appears above traditional search results.",
    body: [
      "AI Overviews (and the related AI Mode) are Google's generative answers shown at the top of many searches. They summarize information and cite a handful of sources, often reducing clicks to the underlying pages.",
      "Being referenced in AI Overviews depends on strong topical authority, clear structure and content that directly answers the query — the same signals AEO emphasizes.",
    ],
    related: ["generative-engine-optimization", "citations", "answer-engine-optimization"],
  },
  {
    slug: "llms-txt",
    term: "llms.txt",
    short: "A proposed text file that gives AI crawlers a curated map of your most important pages.",
    body: [
      "llms.txt is an emerging convention: a Markdown file at your domain root that points AI systems to your key, authoritative content in a clean, easy-to-parse form. Think of it as a sitemap written for language models.",
      "Adoption is still early and support is not universal, but adding one is low-cost and signals that your site is AI-friendly.",
    ],
    related: ["structured-data", "answer-engine-optimization"],
  },
  {
    slug: "structured-data",
    term: "Structured Data (Schema.org)",
    short: "Machine-readable markup that tells AI exactly what your page and brand are about.",
    body: [
      "Structured data uses schema.org vocabularies (Organization, Product, FAQPage, Review and more) to encode facts in a form machines can extract reliably. It helps AI understand who you are, what you sell, for whom and at what price.",
      "For AEO, Organization and Product markup establish identity and offerings, while FAQPage markup mirrors the question-and-answer format AI loves to quote.",
    ],
    related: ["llms-txt", "answer-engine-optimization", "citations"],
  },
  {
    slug: "citations",
    term: "Citations",
    short: "The sources an AI engine references when generating an answer.",
    body: [
      "Engines like Perplexity and Google AI cite the sources behind their answers. Earning citations means being a clear, authoritative source that the engine trusts enough to reference by name.",
      "Content rich in specific facts, statistics and quotable statements tends to earn more citations than vague marketing copy.",
    ],
    related: ["ai-overview", "generative-engine-optimization"],
  },
  {
    slug: "competitor-gap",
    term: "Competitor Gap",
    short: "Questions where AI recommends your competitors but not you.",
    body: [
      "A competitor gap is any high-intent question where the AI names rivals and omits you. Each gap is a concrete loss: a buyer being steered elsewhere at the moment of decision.",
      "Closing gaps is the fastest route to better AI visibility — it tells you exactly which topics and comparisons to win.",
    ],
    related: ["ai-visibility", "share-of-model", "mention-rate"],
  },
  {
    slug: "prompt-intent",
    term: "Prompt Intent",
    short: "The underlying goal behind the question a user asks an AI assistant.",
    body: [
      "Prompt intent is the AEO analog of search intent. 'Best CRM for startups' signals high purchase intent; 'what is a CRM' signals research. AEO prioritizes the high-intent prompts where recommendations turn into customers.",
      "Mapping the real prompts your buyers use is the starting point of any serious AI visibility effort.",
    ],
    related: ["answer-engine-optimization", "ai-visibility"],
  },
  {
    slug: "hallucination",
    term: "Hallucination",
    short: "When an AI states something false or invented with confidence.",
    body: [
      "Hallucinations matter for brands because an AI may describe your product inaccurately — wrong features, pricing or positioning. Strong, consistent, structured information across the web reduces the room for AI to get you wrong.",
      "Monitoring how AI describes you is part of protecting your brand in the answer-engine era.",
    ],
    related: ["ai-visibility", "structured-data"],
  },
  {
    slug: "query-fan-out",
    term: "Query Fan-Out",
    short: "The technique Google's AI Mode uses to break one question into many sub-queries, then synthesize the results into a single answer.",
    body: [
      "Query fan-out is how Google's AI Mode answers a question: instead of running one search, it expands your query into multiple related sub-queries — comparisons, definitions and likely follow-ups — retrieves results for each, and stitches the strongest passages into one response. It's why ranking for a single keyword no longer guarantees you appear in the answer.",
      "To win a fan-out slot, content must comprehensively answer the sub-questions around a topic, not just the head term. A page that covers definitions, pricing, comparisons and edge cases has more surface area across the sub-queries Google generates than one narrowly optimized page.",
    ],
    related: ["ai-overview", "google-ai-mode", "generative-engine-optimization"],
  },
  {
    slug: "retrieval-augmented-generation",
    term: "Retrieval-Augmented Generation (RAG)",
    short: "An AI technique that retrieves live external documents and feeds them to a language model so its answer is grounded in current, real sources.",
    body: [
      "Retrieval-augmented generation (RAG) is the method behind AI search answers that cite sources: rather than relying only on what a model memorized during training, the system first retrieves relevant documents from the live web or a database, then generates an answer grounded in them. ChatGPT search, Perplexity and Google AI Overviews all use a form of RAG.",
      "For brands, RAG is why being crawlable and clearly written matters again: if your page is retrieved, its facts can shape — and get cited in — the answer. Content that states claims plainly and backs them with data is easier for a RAG system to lift accurately.",
    ],
    related: ["grounding", "citations", "large-language-model"],
  },
  {
    slug: "grounding",
    term: "Grounding (in AI)",
    short: "Connecting an AI model's answer to verifiable external sources — like live search results — so it's factual rather than invented.",
    body: [
      "Grounding is the process of tying an AI's generated answer to real, retrievable evidence instead of letting it rely on memory alone. Google's Gemini, for example, grounds many answers in live Google Search results, which is why strong traditional rankings feed directly into whether Gemini recommends you.",
      "Grounding reduces hallucination and is what makes a citation possible: an ungrounded model can name a brand from fuzzy memory, but a grounded one pulls from sources it can point to. Clear, consistent facts across your site and the wider web make you a reliable grounding target.",
    ],
    related: ["retrieval-augmented-generation", "hallucination", "citations"],
  },
  {
    slug: "gptbot",
    term: "GPTBot",
    short: "OpenAI's crawler that collects web content for training its models. ChatGPT search uses a separate crawler, OAI-SearchBot.",
    body: [
      "GPTBot is the user agent OpenAI uses to collect content that may be used to train its foundation models. OpenAI documents it separately from OAI-SearchBot, which surfaces sites in ChatGPT search answers, and the two robots.txt settings are independent: blocking GPTBot does not remove you from ChatGPT search.",
      "Blocking GPTBot keeps future crawls out of training data; it is a reasonable choice for publishers with licensable content. For most brands we think it is the wrong default, because model memory is part of how ChatGPT describes a category. If you want to stay visible in ChatGPT search, never block OAI-SearchBot.",
    ],
    related: ["ai-crawler", "llms-txt", "ai-visibility"],
  },
  {
    slug: "zero-click-search",
    term: "Zero-Click Search",
    short: "A search where the user gets their answer directly on the results page — from an AI Overview, snippet or knowledge panel — without clicking any link.",
    body: [
      "Zero-click search describes queries answered on the results page itself, so no website gets the visit. AI Overviews accelerated the trend: when Google synthesizes an answer at the top, many users never scroll to the blue links below.",
      "Zero-click doesn't make visibility worthless — it shifts the prize from the click to the citation. Being the source named inside the AI answer still builds awareness and trust, even without the visit, which is exactly what answer engine optimization targets.",
    ],
    related: ["ai-overview", "answer-engine-optimization", "citations"],
  },
  {
    slug: "ai-crawler",
    term: "AI Crawler",
    short: "A bot that fetches web content to feed AI systems — for training, live retrieval, or both — such as GPTBot, ClaudeBot and PerplexityBot.",
    body: [
      "AI crawlers are the bots that let AI assistants read the web. Some gather data to train models; others fetch pages in real time to answer a live question. Whether these bots can reach your content directly affects whether AI engines can mention and cite you.",
      "You control AI crawler access through robots.txt and, increasingly, an llms.txt file. The strategic question isn't just whether Googlebot can see you anymore — it's whether the specific AI crawlers behind ChatGPT, Claude, Perplexity and Gemini can too.",
    ],
    related: ["gptbot", "llms-txt", "answer-engine-optimization"],
  },
  {
    slug: "semantic-search",
    term: "Semantic Search",
    short: "Search that matches meaning and intent rather than exact keywords, using language models to understand what a query really means.",
    body: [
      "Semantic search interprets the meaning behind a query instead of matching literal keywords. It's the foundation under AI answers: the system understands that 'tool to see if ChatGPT mentions my brand' and 'AI visibility checker' express the same intent, even with no shared keywords.",
      "For content, semantic search rewards clearly answering the underlying question over stuffing exact-match phrases. Covering a concept thoroughly — synonyms, related sub-topics, plain definitions — signals relevance better than keyword repetition.",
    ],
    related: ["large-language-model", "knowledge-graph", "prompt-intent"],
  },
  {
    slug: "knowledge-graph",
    term: "Knowledge Graph",
    short: "A structured network of entities (people, brands, places) and their relationships that search and AI systems use to understand the world.",
    body: [
      "A knowledge graph is a database of entities and how they connect — that a brand makes a product, competes with a rival, or was founded by a person. Google's Knowledge Graph powers knowledge panels and helps AI systems reason about who and what your brand is.",
      "Being a clear, consistent entity in these graphs improves AI visibility: when a model has a confident, structured understanding of your brand, it's likelier to name you accurately. Consistent naming, Organization schema and links to Wikidata all strengthen your entity.",
    ],
    related: ["entity-seo", "structured-data", "ai-visibility"],
  },
  {
    slug: "entity-seo",
    term: "Entity SEO",
    short: "Optimizing so search and AI systems recognize your brand as a clear, well-defined entity — not just a string of keywords.",
    body: [
      "Entity SEO is the practice of making your brand an unambiguous thing that machines understand: what category you're in, who you compete with, who runs you. Where keyword SEO targets phrases, entity SEO targets recognition in the knowledge graph and, increasingly, in AI models' internal picture of your market.",
      "It matters more in AI search because a model that can't confidently identify your entity has no reason to recommend you. Consistent brand naming everywhere, Organization and Product schema, an authoritative about page, and third-party mentions that describe you the same way all build a strong entity.",
    ],
    related: ["knowledge-graph", "structured-data", "answer-engine-optimization"],
  },
  {
    slug: "e-e-a-t",
    term: "E-E-A-T (Experience, Expertise, Authoritativeness, Trust)",
    short: "Google's framework for judging content quality by first-hand experience, expertise, authority and trustworthiness.",
    body: [
      "E-E-A-T stands for Experience, Expertise, Authoritativeness and Trust — the qualities Google's guidelines use to assess whether content is reliable. It isn't a direct ranking factor but describes what Google's systems are built to reward, especially for topics that affect money or wellbeing.",
      "E-E-A-T signals carry into AI search: models lean on the same trust cues — named authors, cited sources, real experience, a credible organization — when deciding which sources to ground an answer in. Building genuine expertise and showing it clearly helps you get both ranked and cited.",
    ],
    related: ["structured-data", "citations", "answer-engine-optimization"],
  },
  {
    slug: "google-ai-mode",
    term: "Google AI Mode",
    short: "Google's full conversational search experience — a chat-style interface distinct from the AI Overview box on a normal results page.",
    body: [
      "Google AI Mode is a dedicated, conversational search experience where you ask a question, get a synthesized answer, and can follow up in the same session. It's separate from AI Overviews, which are summary boxes on the standard results page — AI Mode replaces the results page with a chat.",
      "Ranking in AI Mode means being retrievable across a multi-turn conversation, not just matching one query. It leans on query fan-out, so comprehensive topical coverage and passage-level answers matter more than a single keyword match.",
    ],
    related: ["ai-overview", "query-fan-out", "generative-engine-optimization"],
  },
  {
    slug: "large-language-model",
    term: "Large Language Model (LLM)",
    short: "The AI system, trained on vast text, that powers ChatGPT, Claude and Gemini — generating answers rather than returning link lists.",
    body: [
      "A large language model (LLM) is a neural network trained on huge volumes of text to predict and generate language. LLMs are the engines behind ChatGPT, Claude and Gemini: ask one a question and it composes an answer, drawing on training data plus, increasingly, live retrieval.",
      "LLMs changed discovery because they answer instead of listing links — so being named inside that answer, not ranked below it, becomes the goal. Understanding that LLMs weigh training data, retrieved sources and third-party consensus explains why AEO looks different from classic SEO.",
    ],
    related: ["retrieval-augmented-generation", "hallucination", "ai-visibility"],
  },
  {
    slug: "share-of-voice-ai",
    term: "Share of Voice (in AI Search)",
    short: "Your brand's slice of all brand mentions across AI answers for your category — the AI-era version of a classic marketing metric.",
    body: [
      "Share of voice in AI search measures what portion of the total brand mentions in AI-generated answers belongs to you. If engines name five brands across your category's buyer questions and you account for a third of those mentions, that's your share of voice — the same competitive lens marketers have used for decades, pointed at a new surface.",
      "It differs from share of model, AEOeye's per-question recommendation metric, mainly in framing: share of voice aggregates mentions across a whole question set, while share of model looks at how recommendation slots split within answers. Both answer the same underlying question — are you or your competitors winning the AI conversation?",
    ],
    related: ["share-of-model", "mention-rate", "ai-visibility"],
  },
  {
    slug: "agentic-search",
    term: "Agentic Search",
    short: "Search performed by an AI agent that plans, runs multiple queries, reads results and synthesizes — instead of a human scanning links.",
    body: [
      "Agentic search is what happens when an AI agent handles the searching: it decomposes a task into sub-queries, fetches and reads pages, cross-checks claims, and returns a conclusion or action rather than a results page. Google's query fan-out in AI Mode is an early mainstream version of the pattern.",
      "For content, agentic search rewards machine-legible thoroughness: pages that answer sub-questions directly, carry verifiable facts, and parse cleanly get pulled into the agent's synthesis — while pages built to win a human glance on a results page may never be seen by a human at all.",
    ],
    related: ["query-fan-out", "google-ai-mode", "retrieval-augmented-generation"],
  },
  {
    slug: "vector-search",
    term: "Vector Search",
    short: "Search that matches by meaning using numeric embeddings of text, letting systems find relevant content with zero keyword overlap.",
    body: [
      "Vector search converts text into embeddings — long lists of numbers capturing meaning — and retrieves content whose vectors sit closest to the query's. It's the machinery that lets an engine match 'tool to check if ChatGPT mentions my brand' with a page that never uses those words.",
      "It's the technical layer beneath semantic search and most RAG pipelines: retrieval happens in vector space first, then the model reads the winners. The practical takeaway for content is to cover concepts clearly and completely — synonyms and related sub-topics — rather than repeating one exact phrase.",
    ],
    related: ["semantic-search", "retrieval-augmented-generation", "large-language-model"],
  },
];

export function getTerm(slug: string): Term | undefined {
  return GLOSSARY.find((t) => t.slug === slug);
}

/** 每个术语的权威来源(均为已校验真实存在的 URL),提升被引与 E-E-A-T */
export const TERM_SOURCES: Record<string, { label: string; url: string }[]> = {
  "share-of-voice-ai": [{ label: "Share of voice — Wikipedia", url: "https://en.wikipedia.org/wiki/Share_of_voice" }],
  "vector-search": [{ label: "Word embedding — Wikipedia", url: "https://en.wikipedia.org/wiki/Word_embedding" }],
  "query-fan-out": [{ label: "AI features in Google Search — Google Search Central", url: "https://developers.google.com/search/docs/appearance/ai-features" }],
  "retrieval-augmented-generation": [{ label: "Retrieval-augmented generation — Wikipedia", url: "https://en.wikipedia.org/wiki/Retrieval-augmented_generation" }],
  "gptbot": [{ label: "Overview of OpenAI crawlers — OpenAI", url: "https://developers.openai.com/api/docs/bots" }],
  "ai-crawler": [{ label: "Web crawler — Wikipedia", url: "https://en.wikipedia.org/wiki/Web_crawler" }],
  "semantic-search": [{ label: "Semantic search — Wikipedia", url: "https://en.wikipedia.org/wiki/Semantic_search" }],
  "knowledge-graph": [{ label: "Knowledge graph — Wikipedia", url: "https://en.wikipedia.org/wiki/Knowledge_graph" }],
  "entity-seo": [{ label: "Named-entity recognition — Wikipedia", url: "https://en.wikipedia.org/wiki/Named-entity_recognition" }],
  "e-e-a-t": [{ label: "Creating helpful, reliable, people-first content — Google Search Central", url: "https://developers.google.com/search/docs/fundamentals/creating-helpful-content" }],
  "google-ai-mode": [{ label: "AI features in Google Search — Google Search Central", url: "https://developers.google.com/search/docs/appearance/ai-features" }],
  "large-language-model": [{ label: "Large language model — Wikipedia", url: "https://en.wikipedia.org/wiki/Large_language_model" }],
  "answer-engine-optimization": [
    { label: "GEO: Generative Engine Optimization (Aggarwal et al., arXiv)", url: "https://arxiv.org/abs/2311.09735" },
    { label: "Search engine optimization — Wikipedia", url: "https://en.wikipedia.org/wiki/Search_engine_optimization" },
  ],
  "generative-engine-optimization": [
    { label: "GEO: Generative Engine Optimization (Aggarwal et al., arXiv)", url: "https://arxiv.org/abs/2311.09735" },
    { label: "Large language model — Wikipedia", url: "https://en.wikipedia.org/wiki/Large_language_model" },
  ],
  "ai-visibility": [
    { label: "Generative AI in Google Search — Google blog", url: "https://blog.google/products/search/generative-ai-search/" },
  ],
  "ai-overview": [
    { label: "Generative AI in Google Search — Google blog", url: "https://blog.google/products/search/generative-ai-search/" },
    { label: "Question answering — Wikipedia", url: "https://en.wikipedia.org/wiki/Question_answering" },
  ],
  "llms-txt": [{ label: "The /llms.txt proposal — llmstxt.org", url: "https://llmstxt.org/" }],
  "structured-data": [
    { label: "Schema.org", url: "https://schema.org/" },
    { label: "Structured data — Google Search Central", url: "https://developers.google.com/search/docs/appearance/structured-data" },
  ],
  citations: [
    { label: "Retrieval-augmented generation — Wikipedia", url: "https://en.wikipedia.org/wiki/Retrieval-augmented_generation" },
  ],
  "prompt-intent": [{ label: "Question answering — Wikipedia", url: "https://en.wikipedia.org/wiki/Question_answering" }],
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
  "answer-engine-optimization": { href: "/blog/what-is-answer-engine-optimization", label: "What is answer engine optimization, and how do you do it?" },
  "generative-engine-optimization": { href: "/blog/generative-engine-optimization", label: "Generative engine optimization: what works and what doesn't" },
  "ai-visibility": { href: "/answers/what-is-ai-visibility", label: "AI visibility: what it is and how to measure it" },
  "share-of-model": { href: "/blog/measuring-ai-visibility", label: "How to measure AI visibility" },
  "mention-rate": { href: "/blog/measuring-ai-visibility", label: "How to measure AI visibility" },
  "share-of-voice-ai": { href: "/blog/measuring-ai-visibility", label: "How to measure AI visibility" },
  "ai-overview": { href: "/blog/what-is-an-ai-overview", label: "What is a Google AI Overview?" },
  "zero-click-search": { href: "/blog/ai-overviews-and-your-traffic", label: "What AI Overviews do to your traffic" },
  "google-ai-mode": { href: "/blog/how-to-rank-in-google-ai-mode", label: "How to show up in Google AI Mode" },
  "query-fan-out": { href: "/blog/how-to-rank-in-google-ai-mode", label: "How to show up in Google AI Mode" },
  "llms-txt": { href: "/blog/what-is-llms-txt", label: "What is llms.txt, and does it matter?" },
  "structured-data": { href: "/blog/structured-data-for-ai", label: "Structured data for AI search" },
  "citations": { href: "/answers/what-makes-content-quotable-by-ai", label: "What makes content quotable by AI?" },
  "competitor-gap": { href: "/blog/why-ai-doesnt-mention-your-brand", label: "Why AI doesn't mention your brand" },
  "prompt-intent": { href: "/blog/how-ai-assistants-choose-brands", label: "How AI assistants choose which brands to recommend" },
  "hallucination": { href: "/guides/how-to-fix-ai-getting-your-brand-wrong", label: "How to fix AI getting your brand wrong" },
  "retrieval-augmented-generation": { href: "/blog/what-is-rag", label: "What is RAG, and why does it decide who gets cited?" },
  "grounding": { href: "/blog/what-is-rag", label: "What is RAG, and why does it decide who gets cited?" },
  "vector-search": { href: "/blog/what-is-rag", label: "What is RAG, and why does it decide who gets cited?" },
  "semantic-search": { href: "/blog/what-is-ai-search", label: "What is AI search?" },
  "agentic-search": { href: "/blog/what-is-ai-search", label: "What is AI search?" },
  "large-language-model": { href: "/answers/how-does-chatgpt-choose-sources", label: "How does ChatGPT choose its sources?" },
  "gptbot": { href: "/blog/blocking-gptbot-is-usually-a-mistake", label: "Blocking GPTBot is usually a mistake" },
  "ai-crawler": { href: "/blog/ai-crawler-user-agent-directory", label: "AI crawler user-agent directory" },
  "knowledge-graph": { href: "/blog/what-is-entity-seo", label: "What is entity SEO?" },
  "entity-seo": { href: "/blog/what-is-entity-seo", label: "What is entity SEO?" },
  "e-e-a-t": { href: "/answers/ai-search-ranking-factors", label: "AI search ranking factors" },
};
