/* ============================================================
   checkTls —— 注入假的 tls.connect,不联网。
   最后一条真实握手只在 SEO_LIVE_TESTS=1 时跑(免费,但默认离线)。
   ============================================================ */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { ConnectionOptions, TLSSocket } from "node:tls";
import { certCovers, checkTls, describeTlsError, type TlsConnectFn } from "../tls";

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);

type FakeCert = { valid_to?: string; issuer?: Record<string, string>; subject?: Record<string, string>; subjectaltname?: string };

interface Behaviour {
  cert: FakeCert;
  /** rejectUnauthorized=true 时抛的错误码(第二次宽松握手不抛) */
  strictError?: string;
  /** 永不回应(测超时) */
  hang?: boolean;
  /** connect() 本身同步抛 */
  throwSync?: boolean;
}

/** 单个行为,或按 servername 给不同行为(测 apex / www 各自一张证书) */
function fakeConnect(behaviour: Behaviour | ((host: string) => Behaviour), log: ConnectionOptions[] = []): TlsConnectFn {
  return (options: ConnectionOptions) => {
    log.push(options);
    const b = typeof behaviour === "function" ? behaviour(String(options.servername)) : behaviour;
    if (b.throwSync) throw Object.assign(new Error("EAI_AGAIN boom"), { code: "EAI_AGAIN" });
    const s = new EventEmitter() as unknown as TLSSocket & { authorized: boolean; authorizationError: unknown };
    Object.assign(s, {
      getPeerCertificate: () => b.cert,
      authorized: !b.strictError,
      authorizationError: b.strictError ? Object.assign(new Error(b.strictError), { code: b.strictError }) : null,
      destroy: () => undefined,
      setTimeout: () => s,
    });
    if (!b.hang) {
      setImmediate(() => {
        if (b.strictError && options.rejectUnauthorized) s.emit("error", Object.assign(new Error(`cert failed: ${b.strictError}`), { code: b.strictError }));
        else s.emit("secureConnect");
      });
    }
    return s;
  };
}

const validCert = (days: number, sans = "DNS:example.com, DNS:www.example.com"): FakeCert => ({
  valid_to: new Date(NOW + days * DAY).toUTCString(),
  issuer: { O: "Let's Encrypt", CN: "R11" },
  subject: { CN: "example.com" },
  subjectaltname: sans,
});

test("valid certificate: validTo, daysLeft, issuer, coversWww (apex host)", async () => {
  const log: ConnectionOptions[] = [];
  const r = await checkTls("example.com", { connect: fakeConnect({ cert: validCert(42) }, log), now: () => NOW, timeoutMs: 500 });
  assert.equal(r.error, null);
  assert.equal(r.daysLeft, 42);
  assert.equal(r.validTo, new Date(NOW + 42 * DAY).toISOString());
  assert.equal(r.issuer, "Let's Encrypt");
  assert.equal(r.coversWww, true);
  assert.equal(log.length, 1, "one handshake when the cert verifies");
  assert.equal(log[0].servername, "example.com");
  assert.equal(log[0].rejectUnauthorized, true);
  assert.equal(log[0].port, 443);
});

test("coversWww: SAN covers the other host → true without a second handshake; wildcard covers www", async () => {
  const log: ConnectionOptions[] = [];
  const c = (sans: string, host: string) => checkTls(host, { connect: fakeConnect({ cert: validCert(10, sans) }, log), now: () => NOW, timeoutMs: 500 });
  assert.equal((await c("DNS:example.com, DNS:www.example.com", "www.example.com")).coversWww, true);
  assert.equal((await c("DNS:example.com, DNS:*.example.com", "example.com")).coversWww, true, "wildcard covers www");
  assert.equal(log.length, 2, "one handshake each");
  assert.equal(certCovers(["*.example.com"], "a.b.example.com"), false, "wildcard covers exactly one label");
});

test("coversWww: SAN does not cover the other host → verify the other host's own certificate (Vercel/Cloudflare issue one per host)", async () => {
  // apex 证书只有 apex;www 自己有一张有效证书 → 覆盖
  const log: ConnectionOptions[] = [];
  const perHost = (www: Behaviour) => (host: string): Behaviour => (host === "www.example.com" ? www : { cert: validCert(10, "DNS:example.com") });
  const ok = await checkTls("example.com", { connect: fakeConnect(perHost({ cert: validCert(10, "DNS:www.example.com") }), log), now: () => NOW, timeoutMs: 500 });
  assert.equal(ok.coversWww, true);
  assert.deepEqual(log.map((o) => [o.servername, o.rejectUnauthorized]), [["example.com", true], ["www.example.com", true]], "second handshake targets www with verification on");

  // www 握手失败(没有证书 / 主机名不符)→ 不覆盖
  const bad = await checkTls("example.com", { connect: fakeConnect(perHost({ cert: validCert(10, "DNS:example.com"), strictError: "ERR_TLS_CERT_ALTNAME_INVALID" })), now: () => NOW, timeoutMs: 500 });
  assert.equal(bad.coversWww, false);
  assert.equal(bad.error, null, "the primary host itself is fine");
  // www 在 DNS 里根本不存在(EAI_AGAIN / ENOTFOUND)→ 不适用(null),不是"证书不覆盖"(复审 C21)
  const missing = await checkTls("example.com", { connect: fakeConnect(perHost({ cert: validCert(10), throwSync: true })), now: () => NOW, timeoutMs: 500 });
  assert.equal(missing.coversWww, null);

  // www 主机看裸域
  const fromWww = await checkTls("www.example.com", { connect: fakeConnect((host) => ({ cert: validCert(10, host === "example.com" ? "DNS:example.com" : "DNS:www.example.com") })), now: () => NOW, timeoutMs: 500 });
  assert.equal(fromWww.coversWww, true);

  // 完全没有 SAN 的老证书且另一主机也握不上 → null(说不清)
  const noSan = await checkTls("example.com", { connect: fakeConnect((host) => (host === "example.com" ? { cert: { valid_to: new Date(NOW + DAY).toUTCString(), issuer: {}, subject: {} } } : { cert: validCert(1), throwSync: true })), now: () => NOW, timeoutMs: 500 });
  assert.equal(noSan.coversWww, null);
  assert.equal(noSan.issuer, null);
});

test("expired certificate: error is described AND details come from a second, lenient handshake", async () => {
  const log: ConnectionOptions[] = [];
  const r = await checkTls("example.com", { connect: fakeConnect({ cert: validCert(-12), strictError: "CERT_HAS_EXPIRED" }, log), now: () => NOW, timeoutMs: 500 });
  assert.match(r.error ?? "", /^expired:/);
  assert.equal(r.daysLeft, -12);
  assert.equal(r.issuer, "Let's Encrypt");
  assert.equal(log.length, 2);
  assert.equal(log[1].rejectUnauthorized, false);
});

test("hostname mismatch / self-signed / incomplete chain are mapped; network errors do not retry", async () => {
  const mismatch = await checkTls("example.com", { connect: fakeConnect({ cert: validCert(5), strictError: "ERR_TLS_CERT_ALTNAME_INVALID" }), now: () => NOW, timeoutMs: 500 });
  assert.match(mismatch.error ?? "", /^hostname mismatch:/);
  assert.equal(mismatch.daysLeft, 5, "details still read");
  const self = await checkTls("example.com", { connect: fakeConnect({ cert: validCert(5), strictError: "DEPTH_ZERO_SELF_SIGNED_CERT" }), now: () => NOW, timeoutMs: 500 });
  assert.match(self.error ?? "", /^self-signed:/);
  const chain = await checkTls("example.com", { connect: fakeConnect({ cert: validCert(5), strictError: "UNABLE_TO_VERIFY_LEAF_SIGNATURE" }), now: () => NOW, timeoutMs: 500 });
  assert.match(chain.error ?? "", /^incomplete chain:/);

  const log: ConnectionOptions[] = [];
  const net = await checkTls("example.com", { connect: fakeConnect({ cert: validCert(5), throwSync: true }, log), timeoutMs: 500 });
  assert.match(net.error ?? "", /DNS lookup failed/);
  assert.equal(net.validTo, null);
  assert.equal(log.length, 1, "no lenient retry for non-certificate errors");
  assert.equal(describeTlsError("ECONNREFUSED", "x"), "connection refused on port 443 (no HTTPS service)");
});

test("handshake timeout and blocked hosts", async () => {
  const r = await checkTls("example.com", { connect: fakeConnect({ cert: validCert(5), hang: true }), timeoutMs: 40 });
  assert.equal(r.error, "handshake timed out");
  assert.equal(r.validTo, null);
  assert.match((await checkTls("localhost")).error ?? "", /^blocked/);
  assert.match((await checkTls("10.0.0.1")).error ?? "", /^blocked/);
});

test("C21: a subdomain whose www.<sub> host does not resolve → coversWww null; www that resolves but refuses HTTPS → false", async () => {
  const alt = (failCode: string | null) => (options: ConnectionOptions): TLSSocket => {
    if (String(options.servername).startsWith("www.") && failCode) throw Object.assign(new Error(`${failCode} ${String(options.servername)}`), { code: failCode });
    return fakeConnect({ cert: validCert(30, "DNS:blog.example.com, DNS:*.example.com") })(options);
  };
  for (const code of ["ENOTFOUND", "EAI_AGAIN", "ENODATA"]) {
    const r = await checkTls("blog.example.com", { connect: alt(code), now: () => NOW, timeoutMs: 500 });
    assert.equal(r.error, null);
    assert.equal(r.coversWww, null, `${code}: a host that does not resolve cannot show a certificate warning`);
  }
  const refused = await checkTls("blog.example.com", { connect: alt("ECONNREFUSED"), now: () => NOW, timeoutMs: 500 });
  assert.equal(refused.coversWww, false, "www exists but serves no valid HTTPS");
});

test("live handshake against aeoeye.com (only with SEO_LIVE_TESTS=1)", { skip: process.env.SEO_LIVE_TESTS !== "1" }, async () => {
  const r = await checkTls("aeoeye.com");
  assert.equal(r.error, null);
  assert.ok((r.daysLeft ?? 0) > 0);
});
