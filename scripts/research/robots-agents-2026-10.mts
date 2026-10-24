/* 补充:同 391 域名只抓 robots.txt,判定 Amazonbot / Amzn-SearchBot / Meta-WebIndexer / meta-externalagent 能否抓 "/"(零成本) */
import fs from "node:fs";
import { parseRobots, isPathAllowedFor, emptyRobots, looksLikeHtml, type RobotsRules } from "../../lib/seo-audit/robots";
const UA = "Mozilla/5.0 (compatible; AEOeyeResearch/1.0; +https://aeoeye.com/bot)";
const AGENTS = ["Amazonbot", "Amzn-SearchBot", "Meta-WebIndexer", "meta-externalagent", "GPTBot"];
const groups = JSON.parse(fs.readFileSync("scripts/research/ai-crawler-study-domains.json", "utf8")) as Record<string, string[] | string>;
const list: { domain: string; group: string }[] = [];
for (const [g, ds] of Object.entries(groups)) if (Array.isArray(ds)) for (const d of ds) list.push({ domain: d, group: g });
async function get(url: string) {
  const c = new AbortController(); const t = setTimeout(() => c.abort(), 12000);
  try { const r = await fetch(url, { headers: { "user-agent": UA }, signal: c.signal, redirect: "follow" }); return { status: r.status, text: (await r.text()).slice(0, 600_000) }; }
  catch { return { status: null as number | null, text: "" }; } finally { clearTimeout(t); }
}
const rows: Record<string, unknown>[] = [];
let i = 0;
const keep = setInterval(() => {}, 1000);
await Promise.all(Array.from({ length: 8 }, async () => {
  while (i < list.length) {
    const it = list[i++];
    // 单域名硬上限 30 秒:曾有响应体挂起导致整个进程卡住
    const cap = <T,>(p: Promise<T>, fb: T) => Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fb), 15000))]);
    let r = await cap(get(`https://${it.domain}/robots.txt`), { status: null, text: "" });
    if (r.status === null) r = await cap(get(`https://www.${it.domain}/robots.txt`), { status: null, text: "" });
    if (rows.length % 50 === 0) console.error(`${rows.length}/${list.length}`);
    let rules: RobotsRules; let state: string;
    if (r.status === null) { rules = emptyRobots(null); state = "unreachable"; }
    else if (r.status >= 500) { rules = emptyRobots(r.status); state = "server-error"; }
    else if (r.status >= 400 || looksLikeHtml(r.text)) { rules = emptyRobots(r.status); state = "none"; }
    else { rules = { ...parseRobots(r.text), found: true, status: r.status, bytes: r.text.length } as RobotsRules; state = "ok"; }
    const row: Record<string, unknown> = { domain: it.domain, group: it.group, state };
    for (const a of AGENTS) { row[`blocks_${a}`] = state === "ok" || state === "none" ? !isPathAllowedFor(rules, "/", a) : null; row[`names_${a}`] = state === "ok" ? new RegExp(`^\\s*user-agent\\s*:\\s*${a}\\s*$`, "im").test(r.text) : null; }
    rows.push(row);
  }
}));
clearInterval(keep);
const usable = rows.filter((r) => r.state === "ok" || r.state === "none");
const pct = (n: number, d: number) => Math.round((1000 * n) / d) / 10;
const summary: Record<string, unknown> = { run: new Date().toISOString(), domains: rows.length, usable: usable.length };
for (const g of ["all", ...new Set(rows.map((r) => String(r.group)))]) {
  const rs = usable.filter((r) => g === "all" || r.group === g);
  summary[g] = Object.fromEntries(AGENTS.flatMap((a) => [[`blocks_${a}`, pct(rs.filter((r) => r[`blocks_${a}`]).length, rs.length)], [`names_${a}`, pct(rs.filter((r) => r[`names_${a}`]).length, rs.length)]]));
}
fs.writeFileSync("public/resources/robots-agents-2026-10.json", JSON.stringify({ study: "AEOeye robots.txt check for Amazon and Meta crawlers (Oct 2026)", sample: "Same 391 domains as the AEOeye AI Crawler Access Study", method: "GET https://<domain>/robots.txt (www retried if unreachable), parsed with AEOeye's audit parser; 'blocks' = the agent's effective rules disallow '/'. 4xx or HTML robots.txt = no restrictions; 5xx/unreachable excluded.", summary, rows }, null, 1));
console.log(JSON.stringify(summary, null, 1));
process.exit(0);
