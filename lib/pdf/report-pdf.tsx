import path from "node:path";
// 显式导入:此文件也会被独立脚本(classic JSX runtime)渲染,不能只依赖 Next 的自动注入
import React from "react";
import {
  Document,
  Page,
  Text,
  View,
  StyleSheet,
  Font,
  Svg,
  Path,
  Circle,
  type DocumentProps,
} from "@react-pdf/renderer";
import type {
  AuditResult,
  EngineBreakdown,
  EngineQuestionResult,
  SeoFinding,
  SeoFoundation,
  SeoModule,
  VisibilityProbe,
} from "@/lib/engine/types";

/* ============================================================
   $29 完整报告 PDF —— 站点 UI 的印刷版

   玻璃质感(backdrop-blur / 反光边)在 PDF 里不存在,站点自己的 @media print
   也是降级成白卡片。所以这里保留真正定义品牌观感的部分:纸白底、悬浮白卡、
   墨色文字层级、iris 主色、大留白、Poppins 字体;去掉无法承载的模糊与反光。
   ============================================================ */

const C = {
  ink: "#0C0E16",
  inkSoft: "#161A28",
  inkMuted: "#3A4055",
  paper: "#F6F7FB",
  paperSoft: "#EEF1F7",
  iris: "#6D5BF6",
  irisDeep: "#4B38D6",
  mint: "#16C79A",
  mintDeep: "#0E9E7B",
  coral: "#FF5A6E",
  coralDeep: "#E23A50",
  amber: "#F6A93B",
  line: "#E2E6F0",
  white: "#FFFFFF",
};

let fontsReady = false;
function registerFonts() {
  if (fontsReady) return;
  const dir = path.join(process.cwd(), "lib/pdf/fonts");
  try {
    Font.register({
      family: "Poppins",
      fonts: [
        { src: path.join(dir, "Poppins-Regular.ttf"), fontWeight: 400 },
        { src: path.join(dir, "Poppins-SemiBold.ttf"), fontWeight: 600 },
        { src: path.join(dir, "Poppins-Bold.ttf"), fontWeight: 700 },
      ],
    });
    // 长域名/长品牌名需要换行点,否则会溢出卡片
    Font.registerHyphenationCallback((w) => [w]);
    fontsReady = true;
  } catch {
    /* 字体不可用时回落到内置 Helvetica,宁可字形不同也不能不出报告 */
  }
}

const s = StyleSheet.create({
  page: {
    backgroundColor: C.paper,
    paddingTop: 42,
    paddingBottom: 54,
    paddingHorizontal: 40,
    fontFamily: "Poppins",
    fontSize: 9.5,
    color: C.inkMuted,
    lineHeight: 1.5,
  },
  // 悬浮白卡 —— 站点 .card 的印刷等价物
  card: {
    backgroundColor: C.white,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: C.line,
    padding: 18,
    marginBottom: 14,
  },
  cardTight: {
    backgroundColor: C.white,
    borderRadius: 11,
    borderWidth: 1,
    borderColor: C.line,
    padding: 13,
    marginBottom: 9,
  },
  eyebrow: { fontSize: 7.5, letterSpacing: 1.3, color: C.iris, fontWeight: 600, textTransform: "uppercase" },
  h1: { fontSize: 25, fontWeight: 700, color: C.ink, letterSpacing: -0.5, lineHeight: 1.15 },
  h2: { fontSize: 15, fontWeight: 600, color: C.ink, letterSpacing: -0.2, lineHeight: 1.2 },
  h3: { fontSize: 11.5, fontWeight: 600, color: C.ink, lineHeight: 1.3 },
  meta: { fontSize: 9, color: "#8A90A6" },
  body: { fontSize: 9.5, color: C.inkMuted, lineHeight: 1.6 },
  quote: { fontSize: 9.5, fontWeight: 600, color: C.ink },
  row: { flexDirection: "row", alignItems: "center" },
  between: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  pill: {
    fontSize: 7.5,
    fontWeight: 600,
    paddingVertical: 2.5,
    paddingHorizontal: 7,
    borderRadius: 20,
    overflow: "hidden",
  },
  sectionGap: { marginTop: 8, marginBottom: 10 },
  footer: {
    position: "absolute",
    bottom: 26,
    left: 40,
    right: 40,
    flexDirection: "row",
    justifyContent: "space-between",
    fontSize: 7.5,
    color: "#9AA0B4",
    borderTopWidth: 1,
    borderTopColor: C.line,
    paddingTop: 8,
  },
});

const LEVELS = [
  { n: 1, name: "Invisible", blurb: "You don't even appear in AI's search results." },
  { n: 2, name: "Found, not picked", blurb: "AI can reach your site — and still names other brands." },
  { n: 3, name: "Mentioned", blurb: "AI mentions you, but behind others and not every time." },
  { n: 4, name: "Top pick", blurb: "AI recommends you first — after it looks you up." },
  { n: 5, name: "In AI's memory", blurb: "AI names you without searching at all. Peak visibility." },
];

/** 与网页端同一条保守降级规则:没有记忆层证据就不判第 5 层 */
function shownLevel(v?: VisibilityProbe): number {
  if (!v) return 1;
  return v.level === 5 && v.memoryQuestions == null && v.knowledgeMentionRate == null ? 4 : v.level;
}

function gradeColor(score: number): string {
  if (score >= 80) return C.mintDeep;
  if (score >= 60) return C.amber;
  return C.coralDeep;
}

/** 半圆分数表盘 —— 与站点 ScoreGauge 同一造型 */
function Gauge({ score, grade }: { score: number; grade: string }) {
  const r = 46;
  const cx = 58;
  const cy = 58;
  const pct = Math.max(0, Math.min(100, score)) / 100;
  const angle = Math.PI * (1 - pct);
  const ex = cx + r * Math.cos(angle);
  const ey = cy - r * Math.sin(angle);
  const color = gradeColor(score);
  return (
    <View style={{ alignItems: "center", width: 116 }}>
      <Svg width={116} height={66} viewBox="0 0 116 66">
        <Path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}`} stroke={C.paperSoft} strokeWidth={9} fill="none" strokeLinecap="round" />
        {pct > 0.001 && (
          <Path d={`M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${ex} ${ey}`} stroke={color} strokeWidth={9} fill="none" strokeLinecap="round" />
        )}
      </Svg>
      {/* 显式 lineHeight —— 否则继承 page 的 1.5,文本框互相压叠 */}
      <Text style={{ fontSize: 26, fontWeight: 700, color, lineHeight: 1, marginTop: -30 }}>{score}</Text>
      <Text style={{ fontSize: 7.5, color: "#9AA0B4", lineHeight: 1, marginTop: 4 }}>out of 100</Text>
      <Text style={{ fontSize: 11, fontWeight: 700, color, lineHeight: 1, marginTop: 7 }}>Grade {grade}</Text>
    </View>
  );
}

/** 品牌标记 —— 墨色圆角块 + 虹膜环 + 定位点,与站点 logo 同构 */
function LogoMark() {
  return (
    <Svg width={22} height={22} viewBox="0 0 48 48">
      <Path d="M 8 0 L 40 0 A 8 8 0 0 1 48 8 L 48 40 A 8 8 0 0 1 40 48 L 8 48 A 8 8 0 0 1 0 40 L 0 8 A 8 8 0 0 1 8 0 Z" fill={C.ink} />
      {/* 与站点 logo 同一套几何:细轨道 + 放大的星球 + 骑在轨道线上的卫星 */}
      <Circle cx={22} cy={26} r={11.5} stroke={C.iris} strokeWidth={2.2} fill="none" />
      <Circle cx={22} cy={26} r={5} fill={C.white} />
      <Circle cx={30.13} cy={17.87} r={2.7} fill={C.white} />
    </Svg>
  );
}

function Pill({ tone, children }: { tone: "mint" | "coral" | "ink" | "iris"; children: string }) {
  const map = {
    mint: { backgroundColor: "#E4F8F1", color: C.mintDeep },
    coral: { backgroundColor: "#FFE9EC", color: C.coralDeep },
    ink: { backgroundColor: C.paperSoft, color: C.inkMuted },
    iris: { backgroundColor: "#ECE9FE", color: C.irisDeep },
  }[tone];
  return <Text style={[s.pill, map]}>{children}</Text>;
}

/** 5 段进度轨 —— 紧凑阶梯 */
function LevelTrack({ level }: { level: number }) {
  return (
    <View style={{ flexDirection: "row", marginTop: 6 }}>
      {[1, 2, 3, 4, 5].map((n) => (
        <View
          key={n}
          style={{
            flex: 1,
            height: 4,
            borderRadius: 2,
            marginRight: n < 5 ? 3 : 0,
            backgroundColor: n <= level ? C.ink : C.paperSoft,
          }}
        />
      ))}
    </View>
  );
}

/**
 * 区块标题。minPresenceAhead 要求其后至少留出这么多空间,否则整块顺延到下一页 ——
 * 不加会出现"标题孤零零留在页尾、内容跑到下一页"的空白页脚现象。
 */
function SectionHead({ title, sub, ahead = 90 }: { title: string; sub?: string; ahead?: number }) {
  return (
    <View style={s.sectionGap} minPresenceAhead={ahead}>
      <Text style={s.h2}>{title}</Text>
      {sub ? <Text style={[s.meta, { marginTop: 2 }]}>{sub}</Text> : null}
    </View>
  );
}

function QuestionRow({ m, brand }: { m: EngineQuestionResult; brand: string }) {
  return (
    <View style={s.cardTight} wrap={false}>
      <View style={[s.between, { marginBottom: m.answerExcerpt ? 6 : 0 }]}>
        <Text style={[s.quote, { flex: 1, paddingRight: 8 }]}>“{m.question}”</Text>
        <Pill tone={m.mentioned ? "mint" : "coral"}>{m.mentioned ? "Mentioned" : "Absent"}</Pill>
      </View>
      {m.answerExcerpt ? (
        <View style={{ borderLeftWidth: 2, borderLeftColor: "#D9D3FD", paddingLeft: 8 }}>
          <Text style={[s.body, { fontSize: 8.8, color: "#5B6178" }]}>{clip(m.answerExcerpt, 620)}</Text>
          {m.mentioned ? (
            <Text style={{ fontSize: 7.5, color: C.mintDeep, marginTop: 4 }}>▮ {brand} appears in this answer</Text>
          ) : null}
        </View>
      ) : null}
      {m.competitorsMentioned.length ? (
        <Text style={{ fontSize: 8, color: "#8A90A6", marginTop: 5 }}>
          {m.mentioned ? "Named alongside you: " : "AI picked: "}
          {m.competitorsMentioned.slice(0, 6).join(" · ")}
        </Text>
      ) : null}
    </View>
  );
}

function clip(t: string, n: number): string {
  const x = (t || "").replace(/\s+/g, " ").trim();
  return x.length > n ? `${x.slice(0, n - 1)}…` : x;
}

/**
 * 钉在页底的页脚。
 * 注意:这里不能用 `render` 动态页码 —— 实测在 position:absolute + fixed 的容器里,
 * 无论把 render 放在 Text 还是 View 上,整个页脚都会静默消失(不报错、直接没有)。
 * 静态内容可靠,故取"品牌 · 域名"而舍页码。
 */
function Footer({ domain }: { domain: string }) {
  return (
    <View style={s.footer} fixed>
      <Text>AEOeye · AI Visibility Report</Text>
      <Text>{domain}</Text>
    </View>
  );
}

/* ---------- 地基层 · SEO(付费报告下半) ---------- */

const SEV_TONE: Record<string, "coral" | "iris" | "ink" | "mint"> = {
  critical: "coral",
  important: "iris",
  minor: "ink",
  ok: "mint",
};

/** 徽章文案必须与网页版一字不差 —— 同一份报告的 PDF 里写 "ok"、网页写 "Solid",
 *  用户会以为是两套结论。尤其 ok→Solid 不是大小写问题,是措辞不同。 */
const SEV_LABEL: Record<string, string> = {
  critical: "Critical",
  important: "Important",
  minor: "Minor",
  ok: "Solid",
};

function FoundationPages({ foundation, domain }: { foundation: SeoFoundation; domain: string }) {
  const modules = (foundation.modules ?? []).filter(
    (m: SeoModule) => (m.findings?.length ?? 0) > 0 || m.dataGap
  );
  if (!modules.length) return null;
  // 五个模块**连续流排**,不是一模块一页 —— 每页两三张小卡就换页的话,
  // 付费报告会多出五张三分之二空白的纸。react-pdf 自己会在溢出处分页,
  // SectionHead 的 minPresenceAhead 保证标题不会孤零零落在页尾。
  return (
    <Page size="A4" style={s.page}>
      {modules.map((m: SeoModule) => (
        <View key={m.id}>
          <SectionHead title={m.label} sub={m.verdict} />
          {m.dataGap ? (
            <View style={s.card}>
              <Text style={s.body}>{m.dataGap}</Text>
            </View>
          ) : null}
          {(m.findings ?? []).map((f: SeoFinding, i: number) => (
            <View key={i} style={s.cardTight} wrap={false}>
              <View style={s.row}>
                <Text style={[s.h3, { flex: 1 }]}>{f.title}</Text>
                <Pill tone={SEV_TONE[f.severity] ?? "ink"}>{SEV_LABEL[f.severity] ?? f.severity}</Pill>
              </View>
              <Text style={[s.body, { marginTop: 4 }]}>{f.detail}</Text>
            </View>
          ))}
          {m.sources?.length ? (
            <Text style={[s.meta, { marginTop: 6 }]}>
              Analysed by {m.sources.join(" · ")}
              {m.score !== null ? `  ·  ${m.score}/100` : ""}
            </Text>
          ) : null}
        </View>
      ))}
      <Footer domain={domain} />
    </Page>
  );
}

export function ReportPdf({ result }: { result: AuditResult }) {
  registerFonts();
  const level = shownLevel(result.visibility);
  const breakdown = (result.breakdown ?? []).filter(
    (b) => !result.engines.some((e) => e.engine === b.engine && e.status === "error")
  );
  const liveEngines = result.engines.filter((e) => e.status === "ok");
  const claudeRows = result.matrix.filter((m) => m.engine === (liveEngines[0]?.engine ?? "chatgpt"));
  const generated = new Date(result.meta.generatedAt);

  return (
    <Document
      title={`${result.brand} — AI Visibility Report`}
      author="AEOeye"
      subject={`How AI assistants recommend ${result.brand}`}
      creator="AEOeye"
      producer="AEOeye"
    >
      {/* ---------- 封面 + 裁决 ---------- */}
      <Page size="A4" style={s.page}>
        <View style={[s.between, { marginBottom: 22 }]}>
          <View style={s.row}>
            <LogoMark />
            <Text style={{ fontSize: 13, fontWeight: 700, color: C.ink, marginLeft: 7 }}>
              AEO<Text style={{ color: C.iris }}>eye</Text>
            </Text>
          </View>
          <Text style={s.meta}>
            {generated.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
          </Text>
        </View>

        <View style={s.card}>
          <Text style={s.eyebrow}>AI Visibility Report</Text>
          <View style={[s.row, { marginTop: 10, alignItems: "flex-start" }]}>
            <View style={{ flex: 1, paddingRight: 16 }}>
              <Text style={s.h1}>{result.brand}</Text>
              <Text style={[s.meta, { marginTop: 3 }]}>
                {result.domain} · {result.category}
              </Text>
              <Text style={[s.body, { marginTop: 12 }]}>{result.summary}</Text>
            </View>
            <View>
              <Gauge score={result.overallScore} grade={result.grade} />
              <Text style={{ fontSize: 7, color: "#9AA0B4", textAlign: "center", marginTop: 2 }}>
                AI visibility score
              </Text>
            </View>
          </View>
        </View>

        {/* 阶梯 */}
        <SectionHead title="How far AI recommends you" sub={`Level ${level} of 5`} />
        <View style={s.card} wrap={false}>
          {[...LEVELS].reverse().map((lv) => {
            const cur = lv.n === level;
            const passed = lv.n < level;
            return (
              <View
                key={lv.n}
                style={[
                  s.row,
                  {
                    alignItems: "flex-start",
                    paddingVertical: 7,
                    paddingHorizontal: cur ? 9 : 0,
                    marginHorizontal: cur ? -9 : 0,
                    backgroundColor: cur ? C.paper : undefined,
                    borderRadius: cur ? 9 : 0,
                  },
                ]}
              >
                <View
                  style={{
                    width: 19,
                    height: 19,
                    borderRadius: 10,
                    backgroundColor: cur ? C.ink : C.white,
                    borderWidth: cur ? 0 : 1,
                    borderColor: passed ? "#C4C9DA" : C.line,
                    alignItems: "center",
                    justifyContent: "center",
                    marginRight: 9,
                  }}
                >
                  <Text
                    style={{
                      fontSize: 8.5,
                      fontWeight: 700,
                      color: cur ? C.white : passed ? C.inkMuted : "#B6BCCE",
                    }}
                  >
                    {lv.n}
                  </Text>
                </View>
                <View style={{ flex: 1 }}>
                  <View style={s.row}>
                    <Text
                      style={{
                        fontSize: 10,
                        fontWeight: 600,
                        color: cur ? C.ink : passed ? C.inkMuted : "#A2A8BC",
                      }}
                    >
                      {lv.name}
                    </Text>
                    {cur ? (
                      <View style={{ marginLeft: 6 }}>
                        <Pill tone="ink">YOU&apos;RE HERE</Pill>
                      </View>
                    ) : null}
                  </View>
                  <Text style={{ fontSize: 8.5, color: cur ? "#5B6178" : "#A2A8BC", marginTop: 1 }}>{lv.blurb}</Text>
                </View>
              </View>
            );
          })}
        </View>

        {/* 引擎总览 */}
        <SectionHead title="How each AI sees you" sub="Same buyer questions, asked to every engine." />
        <View style={s.card} wrap={false}>
          <View style={[s.row, { borderBottomWidth: 1, borderBottomColor: C.line, paddingBottom: 6 }]}>
            <Text style={{ flex: 2, fontSize: 7.5, color: "#9AA0B4", fontWeight: 600 }}>ENGINE</Text>
            <Text style={{ flex: 1, fontSize: 7.5, color: "#9AA0B4", fontWeight: 600, textAlign: "center" }}>
              MENTIONED
            </Text>
            <Text style={{ flex: 1, fontSize: 7.5, color: "#9AA0B4", fontWeight: 600, textAlign: "center" }}>
              AVG RANK
            </Text>
            <Text style={{ flex: 1, fontSize: 7.5, color: "#9AA0B4", fontWeight: 600, textAlign: "right" }}>
              VISIBILITY
            </Text>
          </View>
          {result.engines.map((e) => (
            <View
              key={e.engine}
              style={[s.row, { paddingVertical: 7, borderBottomWidth: 1, borderBottomColor: "#F1F3F8" }]}
            >
              <Text style={{ flex: 2, fontSize: 9.5, fontWeight: 600, color: C.ink }}>{e.label}</Text>
              {e.status === "ok" ? (
                <>
                  <Text style={{ flex: 1, fontSize: 9.5, textAlign: "center" }}>
                    {e.questionsMentioned}/{e.questionsAsked}
                  </Text>
                  <Text style={{ flex: 1, fontSize: 9.5, textAlign: "center" }}>{e.avgRank ?? "—"}</Text>
                  <Text style={{ flex: 1, fontSize: 9.5, fontWeight: 600, color: C.ink, textAlign: "right" }}>
                    {e.visibilityScore}
                  </Text>
                </>
              ) : (
                <Text style={{ flex: 3, fontSize: 8.5, color: "#A2A8BC", textAlign: "right" }}>
                  {e.status === "error" ? "No answer returned — not scored" : "Not connected — not scored"}
                </Text>
              )}
            </View>
          ))}
        </View>

        <Footer domain={result.domain} />
      </Page>

      {/* ---------- 逐引擎 ---------- */}
      {breakdown.length > 1
        ? breakdown.map((b) => <EnginePage key={b.engine} b={b} result={result} />)
        : (
            <Page size="A4" style={s.page}>
              <SectionHead
                title="The questions, the answers"
                sub={`Every buyer question, and what ${liveEngines[0]?.label ?? "the AI"} actually said.`}
              />
              {claudeRows.map((m) => (
                <QuestionRow key={m.questionId} m={m} brand={result.brand} />
              ))}
              <Footer domain={result.domain} />
            </Page>
          )}

      {/* ---------- 地基层 · SEO ---------- */}
      {(result.foundation?.modules.length ?? 0) > 0 && (
        <FoundationPages foundation={result.foundation!} domain={result.domain} />
      )}

      {/* ---------- 修复路线 ---------- */}
      <Page size="A4" style={s.page}>
        <SectionHead title="Your fix roadmap" sub="Ranked by impact on how AI answers about you." />
        {result.recommendations.map((r, i) => (
          <View key={i} style={s.cardTight} wrap={false}>
            <View style={s.row}>
              <View
                style={{
                  width: 17,
                  height: 17,
                  borderRadius: 9,
                  backgroundColor: "#ECE9FE",
                  alignItems: "center",
                  justifyContent: "center",
                  marginRight: 8,
                }}
              >
                <Text style={{ fontSize: 8, fontWeight: 700, color: C.irisDeep }}>{i + 1}</Text>
              </View>
              <Text style={[s.h3, { flex: 1 }]}>{r.title}</Text>
              <Pill tone={r.impact === "high" ? "iris" : "ink"}>{`${r.impact} impact`}</Pill>
            </View>
            <Text style={[s.body, { marginTop: 5, marginLeft: 25 }]}>{r.detail}</Text>
          </View>
        ))}

        {result.site?.reachable ? (
          <>
            <SectionHead title="Your AEO readiness" sub="What your site gives AI to work with." />
            <View style={s.card}>
              {result.site.signals.map((sig, i) => (
                <View
                  key={sig.id}
                  style={[
                    s.row,
                    {
                      alignItems: "flex-start",
                      paddingVertical: 6,
                      borderTopWidth: i ? 1 : 0,
                      borderTopColor: "#F1F3F8",
                    },
                  ]}
                >
                  <Text
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      width: 14,
                      color: sig.status === "pass" ? C.mint : sig.status === "warn" ? "#B6BCCE" : C.coral,
                    }}
                  >
                    {sig.status === "pass" ? "✓" : sig.status === "warn" ? "–" : "✕"}
                  </Text>
                  <View style={{ flex: 1 }}>
                    <Text style={{ fontSize: 9.5, fontWeight: 600, color: C.ink }}>{sig.label}</Text>
                    <Text style={{ fontSize: 8.5, color: "#8A90A6" }}>{sig.detail}</Text>
                  </View>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <View style={[s.card, { marginTop: 6, alignItems: "center" }]}>
          <Text style={[s.h3, { textAlign: "center" }]}>Re-run this audit any time</Text>
          <Text style={[s.meta, { textAlign: "center", marginTop: 3 }]}>
            aeoeye.com — see whether your fixes changed what AI says.
          </Text>
        </View>

        <Footer domain={result.domain} />
      </Page>
    </Document>
  );
}

/** 单引擎完整分析:阶梯 + 结论 + 每题结果 + 竞品榜 */
function EnginePage({ b, result }: { b: EngineBreakdown; result: AuditResult }) {
  const rows = result.matrix.filter((m) => m.engine === b.engine);
  const hits = rows.filter((m) => m.mentioned).length;
  const level = shownLevel(b.visibility);
  const rate = b.visibility.searchMentionRate ?? 0;

  return (
    <Page size="A4" style={s.page}>
      <View style={[s.between, { marginBottom: 12 }]}>
        <Text style={s.h2}>{b.label}</Text>
        {b.modelName ? <Text style={{ fontSize: 7.5, color: "#9AA0B4" }}>{b.modelName}</Text> : null}
      </View>

      <View style={[s.card, { flexDirection: "row" }]} wrap={false}>
        <View style={{ flex: 1, paddingRight: 14 }}>
          <Text style={{ fontSize: 7.5, letterSpacing: 1, color: "#9AA0B4", fontWeight: 600 }}>
            HOW FAR {b.label.toUpperCase()} RECOMMENDS YOU
          </Text>
          <Text style={[s.h3, { marginTop: 5 }]}>
            {LEVELS[level - 1].name} <Text style={{ color: "#9AA0B4", fontWeight: 400 }}>· Level {level}/5</Text>
          </Text>
          <LevelTrack level={level} />
        </View>
        <View style={{ width: 1, backgroundColor: C.line }} />
        <View style={{ flex: 1, paddingLeft: 14 }}>
          <Text style={{ fontSize: 7.5, letterSpacing: 1, color: "#9AA0B4", fontWeight: 600 }}>VERDICT</Text>
          <Text style={[s.h3, { marginTop: 5, color: hits ? C.mintDeep : C.coralDeep }]}>
            {hits ? `Named in ${hits} of ${rows.length}` : "Never named"}
          </Text>
          <Text style={[s.body, { fontSize: 8.8, marginTop: 4 }]}>
            {hits === rows.length
              ? `${b.label} recommended you on every question.`
              : hits > 0
                ? `Left you out of ${rows.length - hits} of ${rows.length} answers${
                    b.competitors[0] ? ` — ${b.competitors[0].name} took the most of them.` : "."
                  }`
                : `Recommended other brands on all ${rows.length} questions${
                    b.competitors[0] ? `, led by ${b.competitors[0].name}.` : "."
                  }`}
            {rate ? ` Mention rate ${rate}%.` : ""}
          </Text>
        </View>
      </View>

      {b.competitors.length ? (
        <>
          <SectionHead title="Who it recommends instead" />
          <View style={s.card} wrap={false}>
            {b.competitors.slice(0, 8).map((c, i) => (
              <View
                key={c.name}
                style={[
                  s.between,
                  { paddingVertical: 5, borderTopWidth: i ? 1 : 0, borderTopColor: "#F1F3F8" },
                ]}
              >
                <Text style={{ fontSize: 9.5, color: C.ink }}>
                  <Text style={{ color: "#B6BCCE" }}>{i + 1}  </Text>
                  {c.name}
                </Text>
                <Text style={{ fontSize: 8.5, color: "#8A90A6" }}>
                  {c.appearsInQuestions} question{c.appearsInQuestions === 1 ? "" : "s"}
                  {c.winsVsYou > 0 ? `  ·  beat you ${c.winsVsYou}×` : ""}
                </Text>
              </View>
            ))}
          </View>
        </>
      ) : null}

      <SectionHead title="Every question, word for word" />
      {rows.map((m) => (
        <QuestionRow key={m.questionId} m={m} brand={result.brand} />
      ))}

      <Footer domain={result.domain} />
    </Page>
  );
}

export type ReportPdfProps = DocumentProps;
