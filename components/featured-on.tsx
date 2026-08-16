/**
 * 目录反链条 —— 页脚最底部的一行小字。
 *
 * 为什么必须**可见**:这些免费收录的对价就是一条可见的反链。写进代码但
 * 前端不展示(display:none / 0 字号 / 同色文字)有两个问题 ——
 *   ① 对平台是欺骗,它们回查时会渲染页面,发现即撤下并拉黑域名;
 *   ② 隐藏链接是 Google 垃圾内容政策明确点名的作弊手法,会砸自己的站。
 * 所以做法是:不起眼,但真实可见、可点、可抓取。
 *
 * 硬性:正常 <a href>,**不能加 rel="nofollow"** —— 平台要的就是 dofollow。
 */

// 只填**实测可访问**的地址。产品页未上线前一律指平台首页 ——
// 指向 404 既伤 SEO 也伤信任;产品页真上线后再逐个换成具体页。
//
// 例外:少数平台(Turbo0)的免费收录要求反链**必须**指向它未来的产品页 URL,
// 且先验反链、后上架。这类链接在上架前会短暂 404,属平台流程要求。
const DIRECTORIES: { name: string; url: string }[] = [
  { name: "Startup Fame", url: "https://startupfa.me/s/aeoeye?utm_source=aeoeye.com" },
  { name: "Turbo0", url: "https://turbo0.com/item/aeoeye" },
  { name: "Uneed", url: "https://www.uneed.best" },
  { name: "Toolpilot", url: "https://toolpilot.ai" },
  // Tiny Startups 的免费提交要求嵌徽章,但它的徽章是内联 HTML+SVG(无图片 URL)。
  // 校验要的是「指向产品页的链接 + 可见的平台名」,这条纯文字链两者都满足。
  { name: "Tiny Startups", url: "https://www.tinystartups.com/startup/aeoeye" },
  { name: "PeerPush", url: "https://peerpush.com/p/aeoeye" },
  { name: "TinyLaunch", url: "https://tinylaun.ch" },
  { name: "SideProjectors", url: "https://www.sideprojectors.com" },
  { name: "Smol Launch", url: "https://smollaunch.com/products/aeoeye" },
  { name: "Shipybara", url: "https://shipybara.com" },
  { name: "Startup Fast", url: "https://startupfa.st" },
  { name: "RankInPublic", url: "https://rankinpublic.xyz" },
  { name: "Unite List", url: "https://unitelist.com/product/aeoeye" },
  { name: "ProductBurst", url: "https://productburst.com" },
  { name: "Twelve Tools", url: "https://twelve.tools" },
  { name: "Toolfio", url: "https://toolfio.com" },
  { name: "Launching Next", url: "https://www.launchingnext.com" },
  { name: "Startups.fm", url: "https://startups.fm/startups/aeoeye" },
  { name: "Wired Business", url: "https://wired.business" },
  { name: "TinyLaunchpad", url: "https://tinylaunchpad.com" },
  { name: "startuups", url: "https://startuups.com" },
  { name: "We Like Tools", url: "https://weliketools.com/tool/aeoeye" },
  { name: "Fazier", url: "https://fazier.com" },
  { name: "StartupBase", url: "https://startupbase.io" },
  { name: "SaaSHub", url: "https://www.saashub.com" },
  { name: "Pitchwall", url: "https://pitchwall.co" },
];

/**
 * 只保留**实测确认必须挂图**的徽章。
 *
 * Turbo0 是唯一验证过的:当初纯文字链验证失败,补图才通过。
 * 其余五家(Smol Launch / Startups.fm / Unite List / We Like Tools / Fazier)
 * 当初是直接挂图就过了,**从没试过只留文字链**。现已撤图改纯文字链;
 * 若哪家回查失败,再单独把它的图加回来。徽章从 6 张降到 1 张,页脚基本无感。
 */
const BADGES: { name: string; href: string; src: string; alt: string }[] = [
  {
    name: "Turbo0",
    href: "https://turbo0.com/item/aeoeye",
    src: "https://img.turbo0.com/badge-listed-light.svg",
    alt: "Listed on Turbo0",
  },
];

/** 页脚底部的一行 —— 不做区块、不做标题卡片,只是一行小灰字 */
export function FeaturedOn() {
  return (
    <div className="mt-6 border-t border-ink/[0.06] pt-5">
      <p className="text-[11px] uppercase tracking-[0.14em] text-ink/25">Listed on</p>
      <ul className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {DIRECTORIES.map((d) => (
          <li key={d.name}>
            {/* dofollow —— 平台要求可抓取反链,不得加 nofollow */}
            <a
              href={d.url}
              target="_blank"
              rel="noopener"
              className="text-[11px] text-ink/30 transition hover:text-ink/60"
            >
              {d.name}
            </a>
          </li>
        ))}
        {BADGES.map((b) => (
          <li key={b.name}>
            <a href={b.href} target="_blank" rel="noopener">
              {/* 平台校验的是这张 <img> 的 src,不能换成 next/image 或本地副本 */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={b.src}
                alt={b.alt}
                height={16}
                className="h-4 w-auto opacity-40 transition hover:opacity-80"
              />
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}
