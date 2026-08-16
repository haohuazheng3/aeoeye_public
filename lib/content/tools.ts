export type ToolMeta = {
  slug: string;
  name: string;
  tagline: string;
  description: string;
  keyword: string;
};

export const TOOLS: ToolMeta[] = [
  {
    slug: "llms-txt-generator",
    name: "llms.txt Generator",
    tagline: "Build a clean llms.txt in seconds",
    description:
      "Free llms.txt generator. Create a valid llms.txt file that tells AI crawlers (ChatGPT, Perplexity, Claude) which of your pages matter most — then copy or download it.",
    keyword: "llms.txt generator",
  },
  {
    slug: "schema-generator",
    name: "AI Schema Generator",
    tagline: "JSON-LD that makes you machine-readable",
    description:
      "Free JSON-LD schema generator for AEO. Produce valid Organization, Product and FAQPage structured data so AI assistants can extract and recommend your brand accurately.",
    keyword: "schema markup generator for ai",
  },
  {
    slug: "ai-robots-txt-generator",
    name: "AI Robots.txt Generator",
    tagline: "Control which AI bots crawl your site",
    description:
      "Free robots.txt generator for AI crawlers. Choose exactly which AI bots — GPTBot, ClaudeBot, PerplexityBot, Google-Extended and more — can access your site.",
    keyword: "ai robots.txt generator",
  },
  {
    slug: "seo-roi-calculator",
    name: "SEO ROI Calculator",
    tagline: "ROI math that survives the AI era",
    description:
      "Free SEO ROI calculator. Estimate extra visits, conversions, revenue and monthly ROI from your SEO spend — with an honest zero-click discount for AI Overviews.",
    keyword: "seo roi calculator",
  },
];

export function getTool(slug: string): ToolMeta | undefined {
  return TOOLS.find((t) => t.slug === slug);
}
