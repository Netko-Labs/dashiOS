// Tokens that stay home (docs/secrets.md): the certificates, the host
// matching and the swap, the sandbox's arguments, and the proxy end to end,
// between a client that trusts the sandbox's CA and an upstream of the test's.

import { describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { issueLeaf, makeAuthority } from "../src/agents/tokens/lib/x509.ts";
import { authorized, forwardHeaders, hostListed, parseConnect, parseHeaderSpec, proxyCredentials, swapHeaders, wanted } from "../src/agents/tokens/swap.ts";

describe("certificates", () => {
  test("a sandbox's CA signs a leaf for one host, which TLS clients accept for that host only", async () => {
    const ca = await makeAuthority("dashi-agent-claude-7.scope");
    const leaf = await issueLeaf(ca, "api.github.com");
    const root = new X509Certificate(ca.cert);
    const cert = new X509Certificate(leaf.cert);
    expect(root.ca).toBe(true);
    expect(cert.ca).toBe(false);
    expect(cert.verify(root.publicKey)).toBe(true);
    expect(cert.checkHost("api.github.com")).toBe("api.github.com");
    expect(cert.checkHost("github.com")).toBeUndefined();
    expect(cert.checkIssued(root)).toBe(true);
    expect(root.subject).toContain("dashi-agent-claude-7.scope");
    // Another sandbox's CA doesn't vouch for it.
    const other = new X509Certificate((await makeAuthority("dashi-agent-codex-8.scope")).cert);
    expect(cert.verify(other.publicKey)).toBe(false);
    expect(leaf.key).toContain("BEGIN PRIVATE KEY");
  });
});

describe("host matching", () => {
  const hosts = ["api.github.com", "*.githubusercontent.com"];
  test("a token is for its hosts exactly, or under a wildcard", () => {
    expect(hostListed(hosts, "api.github.com")).toBe(true);
    expect(hostListed(hosts, "API.GitHub.com.")).toBe(true);
    expect(hostListed(hosts, "raw.githubusercontent.com")).toBe(true);
    expect(hostListed(hosts, "a.b.githubusercontent.com")).toBe(true);
  });
  test("an unlisted host gets nothing: not the parent, a look-alike, or an address", () => {
    for (const host of [
      "github.com",
      "githubusercontent.com",
      "api.github.com.evil.example",
      "evilgithubusercontent.com",
      "127.0.0.1",
      "*.githubusercontent.com",
      "",
    ]) {
      expect(hostListed(hosts, host)).toBe(false);
    }
  });
});

describe("CONNECT", () => {
  test("its target and credentials are read; anything else is refused", () => {
    const auth = proxyCredentials("k3y");
    expect(parseConnect(`CONNECT api.github.com:443 HTTP/1.1\r\nHost: api.github.com:443\r\nProxy-Authorization: ${auth}`)).toEqual({
      host: "api.github.com",
      port: 443,
      auth,
    });
    expect(parseConnect("CONNECT [::1]:8443 HTTP/1.1")).toEqual({ host: "::1", port: 8443, auth: null });
    expect(parseConnect("GET http://example.com/ HTTP/1.1")).toMatchObject({ error: 405 });
    expect(parseConnect("CONNECT example.com HTTP/1.1")).toMatchObject({ error: 400 });
    expect(parseConnect("CONNECT a@b.com:443 HTTP/1.1")).toMatchObject({ error: 400 });
    expect(authorized(auth, "k3y")).toBe(true);
    expect(authorized(auth, "other")).toBe(false);
    expect(authorized(null, "k3y")).toBe(false);
  });
});

describe("the swap", () => {
  const tokens = new Map([
    ["github", { token: "ghp_real", headers: ["Authorization: Bearer {}"] }],
    ["openai", { token: "sk-real", headers: ["Authorization: Bearer {}"] }],
  ]);
  const anthropic = new Map([["anthropic", { token: "sk-ant-real", headers: ["x-api-key: {}", "Authorization: Bearer {}"] }]]);
  test("a placeholder in the header the item names becomes the person's template with the token", () => {
    const out = swapHeaders(new Headers({ authorization: "token dashi:github" }), tokens);
    expect(out.get("authorization")).toBe("Bearer ghp_real");
  });
  test("an item with several headers is swapped in whichever the request sent, and none is added", () => {
    // Older SDKs and Claude Code: x-api-key.
    const old = swapHeaders(new Headers({ "x-api-key": "dashi:anthropic" }), anthropic);
    expect(old.get("x-api-key")).toBe("sk-ant-real");
    expect(old.has("authorization")).toBe(false);
    // @anthropic-ai/sdk 1.x: Authorization: Bearer.
    const bearer = swapHeaders(new Headers({ authorization: "Bearer dashi:anthropic" }), anthropic);
    expect(bearer.get("authorization")).toBe("Bearer sk-ant-real");
    expect(bearer.has("x-api-key")).toBe(false);
    // Both sent: both swapped.
    const both = swapHeaders(new Headers({ authorization: "Bearer dashi:anthropic", "x-api-key": "dashi:anthropic" }), anthropic);
    expect([both.get("x-api-key"), both.get("authorization")]).toEqual(["sk-ant-real", "Bearer sk-ant-real"]);
    // Another token's placeholder in one of them is left alone.
    const other = swapHeaders(new Headers({ authorization: "Bearer dashi:openai", "x-api-key": "dashi:anthropic" }), anthropic);
    expect(other.get("authorization")).toBe("Bearer dashi:openai");
    expect(
      wanted(new Headers({ authorization: "Bearer dashi:anthropic" }), [{ name: "anthropic", headers: ["x-api-key: {}", "Authorization: Bearer {}"] }]),
    ).toHaveLength(1);
  });
  test("git's Basic credentials get the token in the placeholder's place", () => {
    const basic = `Basic ${btoa("x-access-token:dashi:github")}`;
    const out = swapHeaders(new Headers({ authorization: basic }), tokens);
    expect(atob(out.get("authorization")?.slice(6) ?? "")).toBe("x-access-token:ghp_real");
  });
  test("a placeholder anywhere else, or a longer name, is left alone", () => {
    const out = swapHeaders(new Headers({ "x-other": "dashi:github", authorization: "Bearer dashi:githubber" }), tokens);
    expect(out.get("x-other")).toBe("dashi:github");
    expect(out.get("authorization")).toBe("Bearer dashi:githubber");
    expect(wanted(new Headers({ authorization: "Bearer dashi:githubber" }), [{ name: "github", headers: ["Authorization: Bearer {}"] }])).toEqual([]);
  });
  test("only the items whose placeholder is there are asked for", () => {
    const candidates = [
      { name: "github", headers: ["Authorization: Bearer {}"] },
      { name: "gist", headers: ["Authorization: Bearer {}"] },
    ];
    expect(wanted(new Headers({ authorization: "Bearer dashi:github" }), candidates).map((c) => c.name)).toEqual(["github"]);
    expect(parseHeaderSpec("x-api-key: {}")).toEqual({ name: "x-api-key", template: "{}" });
    expect(parseHeaderSpec("no colon")).toBeNull();
  });
  test("the connection's own headers and the proxy's credentials don't go upstream", () => {
    const out = forwardHeaders(new Headers({ "proxy-authorization": "Basic x", connection: "keep-alive, x-hop", "x-hop": "1", accept: "*/*" }));
    expect([...out.keys()]).toEqual(["accept"]);
  });
});
