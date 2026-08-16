import fs from "node:fs";
import path from "node:path";

export type PageType = "answers" | "compare" | "for" | "vs" | "alternatives" | "guides";

const ALL_TYPES: PageType[] = ["answers", "compare", "for", "vs", "alternatives", "guides"];

export type PageImage = { url: string; alt: string; photographer?: string; photographerUrl?: string } | null;

export type ContentSource = { label: string; url: string };
export type ContentDefinition = { term: string; definition: string; sourceUrl?: string };
export type HowToStep = { name: string; text: string };

export type ContentPage = {
  slug: string;
  type: string;
  title: string;
  metaTitle: string;
  metaDescription: string;
  primaryKeyword: string;
  shortAnswer: string;
  intro: string;
  sections: { heading: string; body: string }[];
  comparisonTable?: { columns: string[]; rows: { label: string; values: string[] }[] } | null;
  keyTakeaways: string[];
  faqs: { q: string; a: string }[];
  image?: PageImage;
  // 新标准:可引用事实与结构化
  sources?: ContentSource[];
  definitions?: ContentDefinition[];
  howToSteps?: HowToStep[]; // 仅 guides 类型(HowTo schema)
  updated?: string;
};

const dirFor = (type: PageType) => path.join(process.cwd(), "content", type);

function readType(type: PageType): ContentPage[] {
  try {
    return fs
      .readdirSync(dirFor(type))
      .filter((f) => f.endsWith(".json"))
      .map((f) => JSON.parse(fs.readFileSync(path.join(dirFor(type), f), "utf8")) as ContentPage);
  } catch {
    return [];
  }
}

export function getPages(type: PageType): ContentPage[] {
  return readType(type).sort((a, b) => a.title.localeCompare(b.title));
}

export function getPageSlugs(type: PageType): string[] {
  return getPages(type).map((p) => p.slug);
}

export function getPage(type: PageType, slug: string): ContentPage | null {
  const p = path.join(dirFor(type), `${slug}.json`);
  try {
    return JSON.parse(fs.readFileSync(p, "utf8")) as ContentPage;
  } catch {
    return null;
  }
}

/** 跨类型取若干页用于内链(同类型优先) */
export function relatedAcross(excludeType: PageType, excludeSlug: string, limit = 3): { type: PageType; page: ContentPage }[] {
  const same: { type: PageType; page: ContentPage }[] = [];
  const other: { type: PageType; page: ContentPage }[] = [];
  for (const t of ALL_TYPES) {
    for (const page of getPages(t)) {
      if (t === excludeType && page.slug === excludeSlug) continue;
      (t === excludeType ? same : other).push({ type: t, page });
    }
  }
  return [...same, ...other].slice(0, limit);
}
