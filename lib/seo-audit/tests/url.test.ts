import { test } from "node:test";
import assert from "node:assert/strict";
import {
  SeoAuditError,
  assertPublicHost,
  dedupeKey,
  isBlockedHostname,
  isPrivateIp,
  isSameSite,
  normalizeInput,
  normalizeUrl,
  registrableDomain,
  type LookupFn,
} from "../url";

const expectCode = (fn: () => unknown, code: SeoAuditError["code"]) => {
  assert.throws(fn, (e: unknown) => e instanceof SeoAuditError && e.code === code, `expected SeoAuditError(${code})`);
};

test("normalizeInput adds https, lowercases host, drops fragment, keeps path+query", () => {
  assert.deepEqual(normalizeInput("example.com"), {
    entryUrl: "https://example.com/",
    origin: "https://example.com",
    host: "example.com",
    domain: "example.com",
  });
  const r = normalizeInput("  WWW.Example.COM/Blog?x=1#frag ");
  assert.equal(r.entryUrl, "https://www.example.com/Blog?x=1");
  assert.equal(r.origin, "https://www.example.com");
  assert.equal(r.host, "www.example.com");
  assert.equal(r.domain, "example.com");
  assert.equal(normalizeInput("http://example.com").entryUrl, "http://example.com/");
  assert.equal(normalizeInput("https://example.com:443/x").entryUrl, "https://example.com/x");
  assert.equal(normalizeInput("//example.com/y").entryUrl, "https://example.com/y");
});

test("normalizeInput rejects garbage, other schemes, credentials, non-default ports", () => {
  expectCode(() => normalizeInput(""), "invalid");
  expectCode(() => normalizeInput("ab"), "invalid");
  expectCode(() => normalizeInput("x".repeat(201)), "invalid");
  expectCode(() => normalizeInput("ftp://example.com"), "invalid");
  expectCode(() => normalizeInput("https://user:pw@example.com"), "invalid");
  expectCode(() => normalizeInput("https://example.com:8080"), "invalid");
  expectCode(() => normalizeInput("example.com:8080"), "invalid");
  expectCode(() => normalizeInput("not a url"), "invalid");
  expectCode(() => normalizeInput("foo"), "invalid");
  expectCode(() => normalizeInput("-bad-.com"), "invalid");
});

test("localhost passes syntax so that assertPublicHost can report it as blocked", async () => {
  assert.equal(normalizeInput("localhost/x").host, "localhost");
  await assert.rejects(assertPublicHost("localhost"), (e: unknown) => e instanceof SeoAuditError && e.code === "blocked");
});

test("registrableDomain strips www., trailing dot and case", () => {
  assert.equal(registrableDomain("WWW.Example.com."), "example.com");
  assert.equal(registrableDomain("blog.example.com"), "blog.example.com");
});

test("isSameSite treats www and apex as the same site, subdomains as different", () => {
  assert.equal(isSameSite("https://www.example.com/a", "example.com"), true);
  assert.equal(isSameSite("http://example.com/a", "www.example.com"), true);
  assert.equal(isSameSite("https://blog.example.com/", "example.com"), false);
  assert.equal(isSameSite("https://other.org/", "example.com"), false);
  assert.equal(isSameSite("mailto:a@example.com", "example.com"), false);
});

test("isPrivateIp covers every non-public IPv4 range", () => {
  for (const ip of [
    "10.1.2.3",
    "172.16.0.1",
    "172.31.255.255",
    "192.168.1.1",
    "127.0.0.1",
    "127.255.255.255",
    "169.254.169.254",
    "0.0.0.0",
    "0.1.2.3",
    "100.64.0.1",
    "100.127.255.255",
    "192.0.0.1",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "255.255.255.255",
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  for (const ip of ["8.8.8.8", "1.1.1.1", "172.32.0.1", "172.15.255.255", "100.128.0.1", "100.63.255.255", "93.184.216.34"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
});

test("isPrivateIp covers IPv6 loopback/ULA/link-local/multicast and embedded IPv4 forms", () => {
  for (const ip of [
    "::1",
    "::",
    "fc00::1",
    "fd12:3456::1",
    "fe80::1",
    "fec0::1",
    "ff02::1",
    "::ffff:127.0.0.1",
    "::ffff:10.0.0.1",
    "::ffff:7f00:1",
    "::ffff:a9fe:a9fe",
    "::10.0.0.1",
    "64:ff9b::a00:1",
    "2002:0a00:0001::",
    "2001:db8::1",
    "2001::1",
    "100::1",
    "[::1]",
    "fe80::1%eth0",
  ]) {
    assert.equal(isPrivateIp(ip), true, `${ip} should be private`);
  }
  for (const ip of ["2606:4700::1111", "2a00:1450:4001:80b::200e", "::ffff:8.8.8.8", "::ffff:808:808", "2002:0808:0808::", "64:ff9b::808:808"]) {
    assert.equal(isPrivateIp(ip), false, `${ip} should be public`);
  }
  assert.equal(isPrivateIp("not-an-ip"), true);
});

test("isBlockedHostname rejects localhost, *.local, *.internal, *.localhost, *.home.arpa", () => {
  for (const h of ["localhost", "LOCALHOST", "foo.localhost", "printer.local", "db.internal", "metadata.google.internal", "nas.home.arpa", ""]) {
    assert.equal(isBlockedHostname(h), true, `${h} should be blocked`);
  }
  assert.equal(isBlockedHostname("example.com"), false);
  assert.equal(isBlockedHostname("internal.example.com"), false);
});

test("assertPublicHost checks every resolved address and never resolves IP literals", async () => {
  const calls: string[] = [];
  const lookup =
    (answers: { address: string; family: number }[] | Error): LookupFn =>
    async (host) => {
      calls.push(host);
      if (answers instanceof Error) throw answers;
      return answers;
    };

  await assertPublicHost("example.com", lookup([{ address: "93.184.216.34", family: 4 }]));
  await assert.rejects(
    assertPublicHost("example.com", lookup([{ address: "1.2.3.4", family: 4 }, { address: "10.0.0.1", family: 4 }])),
    (e: unknown) => e instanceof SeoAuditError && e.code === "blocked"
  );
  await assert.rejects(
    assertPublicHost("example.com", lookup([{ address: "::ffff:192.168.0.1", family: 6 }])),
    (e: unknown) => e instanceof SeoAuditError && e.code === "blocked"
  );
  await assert.rejects(assertPublicHost("nope.example", lookup(new Error("ENOTFOUND"))), (e: unknown) => e instanceof SeoAuditError && e.code === "unreachable");
  await assert.rejects(assertPublicHost("nope.example", lookup([])), (e: unknown) => e instanceof SeoAuditError && e.code === "unreachable");

  calls.length = 0;
  await assert.rejects(assertPublicHost("127.0.0.1", lookup([])), (e: unknown) => e instanceof SeoAuditError && e.code === "blocked");
  await assert.rejects(assertPublicHost("[::1]", lookup([])), (e: unknown) => e instanceof SeoAuditError && e.code === "blocked");
  await assertPublicHost("8.8.8.8", lookup([]));
  assert.deepEqual(calls, [], "IP literals must be judged without DNS");
  await assert.rejects(assertPublicHost("metadata.google.internal", lookup([])), (e: unknown) => e instanceof SeoAuditError && e.code === "blocked");
  assert.deepEqual(calls, [], "blocked hostnames must be judged without DNS");
});

test("normalizeUrl strips fragment and tracking params, keeps meaningful params, resolves relative", () => {
  assert.equal(normalizeUrl("https://Example.com/a?utm_source=x&id=5&gclid=1#top"), "https://example.com/a?id=5");
  assert.equal(normalizeUrl("https://example.com/a?utm_source=x"), "https://example.com/a");
  assert.equal(normalizeUrl("/b?fbclid=1", "https://example.com/dir/"), "https://example.com/b");
  assert.equal(normalizeUrl("../c", "https://example.com/dir/sub/"), "https://example.com/dir/c");
  assert.equal(normalizeUrl("mailto:a@b.c"), null);
  assert.equal(normalizeUrl("javascript:void(0)"), null);
  assert.equal(normalizeUrl("https://u:p@example.com/"), null);
  assert.equal(normalizeUrl("https://example.com:443/x"), "https://example.com/x");
});

test("dedupeKey ignores protocol, www and trailing slash but keeps query", () => {
  assert.equal(dedupeKey("https://www.example.com/about/"), dedupeKey("http://example.com/about"));
  assert.equal(dedupeKey("https://example.com/"), "example.com/");
  assert.notEqual(dedupeKey("https://example.com/a?p=1"), dedupeKey("https://example.com/a?p=2"));
  assert.notEqual(dedupeKey("https://example.com/About"), dedupeKey("https://example.com/about"));
});
