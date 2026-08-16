import { ImageResponse } from "next/og";

export const runtime = "edge";

export function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const title = (searchParams.get("title") || "See your brand the way AI does").slice(0, 120);

  return new ImageResponse(
    (
      <div
        style={{
          width: "1200px",
          height: "630px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: "#0C0E16",
          padding: "72px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
          {/* 品牌标记:与站点 logo 同一星系母题(星球 + 轨道 + 骑在轨道线上的卫星)。
              Satori 不吃 SVG,故用 div 等比映射 48 单位 viewBox → 56px 图块。 */}
          <div
            style={{
              position: "relative",
              width: "56px",
              height: "56px",
              borderRadius: "14px",
              background: "linear-gradient(135deg, #242a40 0%, #0c0e16 62%)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              border: "1px solid #2a2f45",
            }}
          >
            <div
              style={{
                width: "26.8px",
                height: "26.8px",
                borderRadius: "999px",
                border: "2.6px solid #6D5BF6",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <div style={{ width: "11.7px", height: "11.7px", borderRadius: "999px", background: "#fff" }} />
            </div>
            <div
              style={{
                position: "absolute",
                left: "34.3px",
                top: "15.4px",
                width: "6.3px",
                height: "6.3px",
                borderRadius: "999px",
                background: "#fff",
              }}
            />
          </div>
          <div style={{ fontSize: "32px", fontWeight: 700, color: "#fff", display: "flex" }}>
            AEO<span style={{ color: "#8E80F8" }}>eye</span>
          </div>
        </div>

        <div
          style={{
            fontSize: "64px",
            fontWeight: 700,
            color: "#fff",
            lineHeight: 1.1,
            letterSpacing: "-0.02em",
            display: "flex",
            maxWidth: "1000px",
          }}
        >
          {title}
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "12px", fontSize: "26px", color: "#9aa0b4" }}>
          <span>Free AI visibility audit</span>
          <span style={{ color: "#6D5BF6" }}>·</span>
          <span>aeoeye.com</span>
        </div>
      </div>
    ),
    { width: 1200, height: 630 }
  );
}
