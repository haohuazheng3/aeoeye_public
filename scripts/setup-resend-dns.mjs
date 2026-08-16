/**
 * 一次性配置:把 Resend 要求的 DNS 记录写进 Cloudflare,然后触发域名验证。
 *
 * 为什么用脚本而不是手工复制:DKIM 是一长串公钥,手抄极易出错,而错了会静默
 * 发不出信。这里让密钥材料直接从 Resend 流到 Cloudflare —— 脚本**不打印**记录内容。
 *
 * 安全边界(硬性):
 *   - 绝不新增/修改根域 MX。站长的根域 MX 是 Cloudflare Email Routing(收信),
 *     覆盖它会让 @aeoeye.com 收不到邮件。Resend 发信只需要 send.* 子域。
 *   - 绝不修改已存在的根域 SPF。Resend 的 SPF 挂在 send.* 上,不冲突。
 *   - 同名同类型记录已存在且内容一致 → 跳过;内容不同 → 只报告,不擅自覆盖。
 *
 * 用法:  node scripts/setup-resend-dns.mjs [--apply]
 *         不带 --apply 只做演练(dry-run),打印将要做什么。
 */
import fs from "node:fs";

const APPLY = process.argv.includes("--apply");
const DOMAIN = "aeoeye.com";

function loadEnv() {
  const out = { ...process.env };
  try {
    for (const line of fs.readFileSync(".env.local", "utf8").split("\n")) {
      if (!line.includes("=") || line.trim().startsWith("#")) continue;
      const i = line.indexOf("=");
      out[line.slice(0, i).trim()] ??= line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
      // .env.local 优先于进程环境(本地开发以文件为准)
      out[line.slice(0, i).trim()] = line.slice(i + 1).trim().replace(/^["']|["']$/g, "");
    }
  } catch {
    /* 没有 .env.local 就只用进程环境 */
  }
  return out;
}

const env = loadEnv();
const RESEND = env.RESEND_API_KEY;
const CF_TOKEN = env.CLOUDFLARE_API_TOKEN;
const ZONE = env.CLOUDFLARE_ZONE_ID;

if (!RESEND) {
  console.error("✗ 缺少 RESEND_API_KEY —— 请先写入 .env.local");
  process.exit(1);
}
if (!CF_TOKEN || !ZONE) {
  console.error("✗ 缺少 CLOUDFLARE_API_TOKEN / CLOUDFLARE_ZONE_ID");
  process.exit(1);
}

const rh = { Authorization: `Bearer ${RESEND}`, "Content-Type": "application/json" };
const ch = { Authorization: `Bearer ${CF_TOKEN}`, "Content-Type": "application/json" };

/** 记录名归一化成 Cloudflare 的完整名 */
const fqdn = (name) => {
  const n = (name || "").replace(/\.$/, "");
  if (!n || n === "@" || n === DOMAIN) return DOMAIN;
  return n.endsWith(`.${DOMAIN}`) ? n : `${n}.${DOMAIN}`;
};

async function main() {
  // 1) 找到 Resend 里的域名
  const list = await (await fetch("https://api.resend.com/domains", { headers: rh })).json();
  const domains = list?.data ?? list ?? [];
  const found = (Array.isArray(domains) ? domains : []).find((d) => d.name === DOMAIN);
  if (!found) {
    console.error(`✗ Resend 账号里没有 ${DOMAIN}(先在面板添加域名)`);
    process.exit(1);
  }
  console.log(`Resend 域名: ${DOMAIN}  状态=${found.status}  region=${found.region}`);

  // 2) 取该域名要求的 DNS 记录
  const detail = await (await fetch(`https://api.resend.com/domains/${found.id}`, { headers: rh })).json();
  const records = detail?.records ?? [];
  if (!records.length) {
    console.error("✗ Resend 未返回任何 DNS 记录(检查 API key 权限是否为 Full access)");
    process.exit(1);
  }

  // 3) 读现有 Cloudflare 记录
  const cfList = await (
    await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records?per_page=200`, { headers: ch })
  ).json();
  if (!cfList.success) {
    console.error("✗ 读取 Cloudflare 记录失败:", cfList.errors?.[0]?.message);
    process.exit(1);
  }
  const existing = cfList.result ?? [];

  console.log(`\n共 ${records.length} 条待处理记录${APPLY ? "" : "(演练模式,未写入)"}\n`);
  let created = 0;
  let skipped = 0;
  const conflicts = [];

  for (const rec of records) {
    const type = (rec.type || "").toUpperCase();
    const name = fqdn(rec.name);
    const content = rec.value ?? rec.content ?? "";
    const isRoot = name === DOMAIN;

    // 硬性保护:根域 MX 属于 Cloudflare Email Routing(收信),绝不触碰
    if (type === "MX" && isRoot) {
      console.log(`⏭  跳过 根域 MX —— 会破坏 Cloudflare Email Routing 收信(Resend 发信不需要它)`);
      skipped++;
      continue;
    }
    // 硬性保护:不改已存在的根域 SPF
    if (type === "TXT" && isRoot && /v=spf1/i.test(content)) {
      const rootSpf = existing.find((e) => e.type === "TXT" && e.name === DOMAIN && /v=spf1/i.test(e.content));
      if (rootSpf) {
        console.log(`⏭  跳过 根域 SPF —— 已存在(不擅自覆盖,以免影响现有收发信)`);
        skipped++;
        continue;
      }
    }

    const same = existing.find(
      (e) => e.type === type && e.name === name && e.content.replace(/^"|"$/g, "") === content.replace(/^"|"$/g, "")
    );
    if (same) {
      console.log(`✓  已存在且一致  ${type.padEnd(4)} ${name}`);
      skipped++;
      continue;
    }
    const clash = existing.find((e) => e.type === type && e.name === name);
    if (clash) {
      conflicts.push(`${type} ${name}`);
      console.log(`⚠  同名同类型已存在但内容不同  ${type.padEnd(4)} ${name}  —— 未改动,需人工确认`);
      continue;
    }

    if (!APPLY) {
      console.log(`+  将创建  ${type.padEnd(4)} ${name}${rec.priority ? `  priority=${rec.priority}` : ""}`);
      created++;
      continue;
    }
    const body = { type, name, content, ttl: 1 };
    if (type === "MX") body.priority = Number(rec.priority ?? 10);
    const res = await (
      await fetch(`https://api.cloudflare.com/client/v4/zones/${ZONE}/dns_records`, {
        method: "POST",
        headers: ch,
        body: JSON.stringify(body),
      })
    ).json();
    if (res.success) {
      console.log(`+  已创建  ${type.padEnd(4)} ${name}`);
      created++;
    } else {
      console.log(`✗  创建失败  ${type.padEnd(4)} ${name}  —— ${res.errors?.[0]?.message}`);
    }
  }

  console.log(`\n小结:新建 ${created} 条,跳过 ${skipped} 条${conflicts.length ? `,冲突 ${conflicts.length} 条` : ""}`);
  if (!APPLY) {
    console.log("\n演练完成。确认无误后加 --apply 真正写入。");
    return;
  }

  // 4) 触发验证
  console.log("\n触发 Resend 域名验证…");
  const v = await (
    await fetch(`https://api.resend.com/domains/${found.id}/verify`, { method: "POST", headers: rh })
  ).json();
  console.log("验证请求:", v?.object === "domain" || v?.id ? "已提交" : JSON.stringify(v).slice(0, 200));

  // 5) 轮询状态(DNS 传播通常几分钟内)
  for (let i = 1; i <= 12; i++) {
    await new Promise((r) => setTimeout(r, 15000));
    const d = await (await fetch(`https://api.resend.com/domains/${found.id}`, { headers: rh })).json();
    const perRecord = (d.records ?? []).map((r) => `${r.type}/${r.name || "@"}=${r.status}`).join(" ");
    console.log(`  [${i * 15}s] 域名状态=${d.status}  ${perRecord}`);
    if (d.status === "verified") {
      console.log("\n✅ 域名已验证 —— 现在可以从 reports@aeoeye.com 发信了");
      return;
    }
    if (d.status === "failure") {
      console.log("\n✗ 验证失败,请检查上面各条记录状态");
      return;
    }
  }
  console.log("\n⏳ 尚未验证(DNS 传播可能需要更久)。稍后重跑本脚本即可继续查看。");
}

main().catch((e) => {
  console.error("✗ 执行出错:", e?.message ?? e);
  process.exit(1);
});
