export type Term = {
  slug: string;
  term: string;
  short: string; // 一句话定义
  body: string[]; // 段落
  related: string[]; // slugs
};

export const GLOSSARY: Term[] = []; // 2026-10-24 术语表随 SEO 内容一起下线

export function getTerm(slug: string): Term | undefined {
  return GLOSSARY.find((t) => t.slug === slug);
}

/** 每个术语的权威来源(均为已校验真实存在的 URL),提升被引与 E-E-A-T */
export const TERM_SOURCES: Record<string, { label: string; url: string }[]> = {};

/**
 * 每个术语的"深读"去处:术语页只给定义,完整的做法与证据在对应的主文章里。
 * 2026-10-03 清理后约 12 个词条与博客的 "what is X" 重复 —— 不再各写一遍,而是让术语页把读者送到那一篇。
 * 目标必须是现存页(scripts/verify-content-quality.mjs 会核对)。
 */
export const TERM_DEEP_DIVE: Record<string, { href: string; label: string }> = {};
