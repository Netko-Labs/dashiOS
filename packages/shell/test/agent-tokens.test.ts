// Tokens that stay home (docs/secrets.md): the certificates, the host
// matching and the swap, the sandbox's arguments, and the proxy end to end,
// between a client that trusts the sandbox's CA and an upstream of the test's.

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { X509Certificate } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CA_BUNDLE_VARS, type SandboxEnv, tokenProxyArgs } from "../src/agents/sandbox.ts";
import type { TokenSummary } from "../src/agents/secrets/vault.ts";
import { relay, requestProxy } from "../src/agents/tokens/client.ts";
import { token } from "../src/agents/tokens/model-keys.ts";
import { SandboxProxy, type TokenSource } from "../src/agents/tokens/proxy.ts";
import { parseOpen, serveTokens } from "../src/agents/tokens/server.ts";
import { authorized, forwardHeaders, hostListed, parseConnect, parseHeaderSpec, proxyCredentials, swapHeaders, wanted } from "../src/agents/tokens/swap.ts";
import { issueLeaf, makeAuthority } from "../src/agents/tokens/x509.ts";
import { until } from "./support/time.ts";

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

describe("the sandbox's arguments", () => {
  const env: SandboxEnv = { home: "/home/alex", runtime: "/run/user/1000", state: "/home/alex/.local/state", config: "/home/alex/.config" };
  const args = tokenProxyArgs(
    env,
    { socket: "/run/user/1000/dashi-tokens/ab/proxy.sock", ca: "/r/ca.pem", bundle: "/r/bundle.pem", key: "k3y", port: 41234 },
    "corp.example",
  );
  const setenv = new Map(args.flatMap((arg, i) => (arg === "--setenv" ? [[args[i + 1], args[i + 2]] as const] : [])));
  test("HTTPS_PROXY is the relay with the sandbox's credentials; local hosts go direct", () => {
    expect(setenv.get("HTTPS_PROXY")).toBe("http://dashi:k3y@127.0.0.1:41234");
    expect(setenv.get("https_proxy")).toBe("http://dashi:k3y@127.0.0.1:41234");
    expect(setenv.get("NO_PROXY")).toBe("localhost,127.0.0.1,::1,corp.example");
  });
  test("the CA is trusted inside the sandbox only, from files bound into its own runtime directory", () => {
    for (const name of CA_BUNDLE_VARS) expect(setenv.get(name)).toBe("/run/user/1000/dashi-tokens/bundle.pem");
    expect(setenv.get("NODE_EXTRA_CA_CERTS")).toBe("/run/user/1000/dashi-tokens/ca.pem");
    expect(args).toEqual(expect.arrayContaining(["--bind", "/run/user/1000/dashi-tokens/ab/proxy.sock", "/run/user/1000/dashi-tokens/proxy.sock"]));
    expect(args).toEqual(expect.arrayContaining(["--ro-bind", "/r/bundle.pem", "/run/user/1000/dashi-tokens/bundle.pem"]));
  });
});

describe("model keys", () => {
  const items: TokenSummary[] = [
    { id: 1, name: "anthropic", hosts: ["api.anthropic.com"], headers: ["x-api-key: {}", "Authorization: Bearer {}"], lastUsed: null },
  ];
  test("token(name) gives the placeholder and the environment, never the key", async () => {
    const ref = await token("anthropic", { list: async () => items });
    expect(ref).toEqual({
      name: "anthropic",
      placeholder: "dashi:anthropic",
      hosts: ["api.anthropic.com"],
      headers: ["x-api-key: {}", "Authorization: Bearer {}"],
      env: { ANTHROPIC_API_KEY: "dashi:anthropic" },
    });
  });
  test("it is null when the vault hasn't the token or doesn't answer", async () => {
    expect(await token("openai", { list: async () => items })).toBeNull();
    expect(
      await token("anthropic", {
        list: async () => {
          throw new Error("locked");
        },
      }),
    ).toBeNull();
  });
});

// --- End to end -------------------------------------------------------------

const dir = mkdtempSync(join(tmpdir(), "dashi-tokens-"));
const asked: Array<[string, string]> = [];
const ANTHROPIC_HEADERS = ["x-api-key: {}", "Authorization: Bearer {}"];
const items: TokenSummary[] = [
  { id: 1, name: "github", hosts: ["api.github.test"], headers: ["Authorization: Bearer {}"], lastUsed: null },
  { id: 2, name: "anthropic", hosts: ["api.anthropic.com"], headers: ANTHROPIC_HEADERS, lastUsed: null },
];
const source: TokenSource = {
  list: async () => items,
  forHost: async (name, host) => {
    asked.push([name, host]);
    if (name === "github" && host === "api.github.test") return { token: new TextEncoder().encode("ghp_real"), headers: ["Authorization: Bearer {}"] };
    if (name === "anthropic" && host === "api.anthropic.com") return { token: new TextEncoder().encode("sk-ant-real"), headers: ANTHROPIC_HEADERS };
    throw new Error(`${name} isn't for that host`);
  },
};
let upstreamCa: Awaited<ReturnType<typeof makeAuthority>>;
let sandboxCa: Awaited<ReturnType<typeof makeAuthority>>;
let upstream: ReturnType<typeof Bun.serve>;
let proxy: SandboxProxy;
let stopRelay: () => void = () => {};
let proxyUrl = "";
const used: string[] = [];

beforeAll(async () => {
  upstreamCa = await makeAuthority("upstream");
  const leaf = await issueLeaf(upstreamCa, "localhost");
  // The test's stand-in for api.github.com: it says what it was sent.
  upstream = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    tls: { key: leaf.key, cert: leaf.cert },
    async fetch(request) {
      const url = new URL(request.url);
      if (url.pathname === "/moved") return new Response(null, { status: 302, headers: { location: "https://elsewhere.test/" } });
      return Response.json({
        path: `${url.pathname}${url.search}`,
        authorization: request.headers.get("authorization"),
        ...(request.headers.has("x-api-key") ? { apiKey: request.headers.get("x-api-key") } : {}),
        body: await request.text(),
      });
    },
  });
  sandboxCa = await makeAuthority("dashi-agent-test-1.scope");
  proxy = new SandboxProxy({
    unit: "dashi-agent-test-1.scope",
    dir,
    key: "k3y",
    ca: sandboxCa,
    tokens: source,
    upstream: () => `https://localhost:${upstream.port}`,
    fetch: (url, init) => fetch(url, { ...init, tls: { ca: upstreamCa.cert } } as RequestInit),
    used: (name, host) => used.push(`${name} → ${host}`),
  });
  await proxy.listen(join(dir, "proxy.sock"));
  const relayed = await relay(join(dir, "proxy.sock"));
  stopRelay = relayed.close;
  proxyUrl = `http://dashi:k3y@127.0.0.1:${relayed.port}`;
});

afterAll(() => {
  stopRelay();
  proxy.close();
  upstream.stop(true);
  rmSync(dir, { recursive: true, force: true });
});

/** A request as an agent's program sends it: through HTTPS_PROXY, trusting the sandbox's CA (or the upstream's). */
function viaProxy(url: string, init: RequestInit & { ca?: string } = {}): Promise<Response> {
  const { ca = sandboxCa.cert, ...rest } = init;
  return fetch(url, { ...rest, proxy: proxyUrl, tls: { ca } } as RequestInit);
}

/** A raw CONNECT and the first line that comes back. */
function connectLine(head: string): Promise<string> {
  return new Promise((resolve) => {
    const socket = net.connect(join(dir, "proxy.sock"), () => socket.write(head));
    socket.once("data", (chunk) => {
      resolve(chunk.toString().split("\r\n")[0] ?? "");
      socket.destroy();
    });
  });
}

describe("the proxy", () => {
  test("a listed host's request gets the token in its header, upstream only", async () => {
    asked.length = 0;
    const response = await viaProxy("https://api.github.test/user?x=1", { method: "POST", body: "hello", headers: { authorization: "Bearer dashi:github" } });
    expect(await response.json()).toEqual({ path: "/user?x=1", authorization: "Bearer ghp_real", body: "hello" });
    expect(asked).toEqual([["github", "api.github.test"]]);
    expect(used).toEqual(["github → api.github.test"]);
  });

  test("api.anthropic.com gets the key in x-api-key or in Authorization: Bearer, whichever was sent", async () => {
    asked.length = 0;
    const old = await viaProxy("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}", headers: { "x-api-key": "dashi:anthropic" } });
    expect(await old.json()).toEqual({ path: "/v1/messages", authorization: null, apiKey: "sk-ant-real", body: "{}" });
    const sdk = await viaProxy("https://api.anthropic.com/v1/messages", { method: "POST", body: "{}", headers: { authorization: "Bearer dashi:anthropic" } });
    expect(await sdk.json()).toEqual({ path: "/v1/messages", authorization: "Bearer sk-ant-real", body: "{}" });
    expect(asked).toEqual([
      ["anthropic", "api.anthropic.com"],
      ["anthropic", "api.anthropic.com"],
    ]);
  });

  test("an unlisted host gets nothing in either header: both placeholders arrive as sent", async () => {
    asked.length = 0;
    const response = await viaProxy(`https://localhost:${upstream.port}/v1/messages`, {
      headers: { authorization: "Bearer dashi:anthropic", "x-api-key": "dashi:anthropic" },
      ca: upstreamCa.cert,
    });
    expect(await response.json()).toMatchObject({ authorization: "Bearer dashi:anthropic", apiKey: "dashi:anthropic" });
    expect(asked).toEqual([]);
  });

  test("a request without the placeholder asks the vault for nothing", async () => {
    asked.length = 0;
    const response = await viaProxy("https://api.github.test/zen", { headers: { authorization: "Bearer mine" } });
    expect(await response.json()).toMatchObject({ authorization: "Bearer mine" });
    expect(asked).toEqual([]);
  });

  test("a redirect goes back to the client, never followed with the token", async () => {
    const response = await viaProxy("https://api.github.test/moved", { headers: { authorization: "Bearer dashi:github" }, redirect: "manual" });
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe("https://elsewhere.test/");
  });

  test("an unlisted host is tunneled untouched: the placeholder arrives as it was sent", async () => {
    asked.length = 0;
    const response = await viaProxy(`https://localhost:${upstream.port}/direct`, { headers: { authorization: "Bearer dashi:github" }, ca: upstreamCa.cert });
    expect(await response.json()).toMatchObject({ path: "/direct", authorization: "Bearer dashi:github" });
    expect(asked).toEqual([]);
  });

  test("a client without the sandbox's credentials, or not CONNECTing, is turned away", async () => {
    expect(await connectLine("CONNECT api.github.test:443 HTTP/1.1\r\n\r\n")).toBe("HTTP/1.1 407 Proxy Authentication Required");
    expect(await connectLine(`CONNECT api.github.test:443 HTTP/1.1\r\nProxy-Authorization: ${proxyCredentials("wrong")}\r\n\r\n`)).toBe(
      "HTTP/1.1 407 Proxy Authentication Required",
    );
    expect(await connectLine("GET http://api.github.test/ HTTP/1.1\r\n\r\n")).toBe("HTTP/1.1 405 Only CONNECT (HTTPS) goes through this proxy");
  });
});

describe("the shell's socket for dashi-agent", () => {
  test("it takes one sandbox's scope name and nothing else", () => {
    expect(parseOpen('{"open":"dashi-agent-claude-7.scope"}')).toEqual({ unit: "dashi-agent-claude-7.scope" });
    expect(parseOpen('{"open":"../../etc"}')).toHaveProperty("error");
    expect(parseOpen('{"open":"dashi-agent-claude-7.scope","x":1}')).toHaveProperty("error");
    expect(parseOpen("nope")).toHaveProperty("error");
  });

  test("dashi-agent gets a proxy for its sandbox, which goes when it lets go", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "dashi-run-"));
    const path = join(runtime, "dashi-tokens.sock");
    const stop = serveTokens({ path, tokens: source, peer: () => 4242, cgroup: () => "0::/user.slice/session-2.scope\n" });
    try {
      const answer = await requestProxy(path, "dashi-agent-claude-7.scope");
      if ("error" in answer) throw new Error(answer.error);
      const { grant, close } = answer;
      expect(existsSync(grant.socket)).toBe(true);
      expect(readFileSync(grant.ca, "utf8")).toContain("BEGIN CERTIFICATE");
      expect(readFileSync(grant.bundle, "utf8").endsWith(readFileSync(grant.ca, "utf8"))).toBe(true);
      expect(grant.key.length).toBeGreaterThan(20);
      close();
      await until(() => !existsSync(grant.socket), "the grant's socket to go");
    } finally {
      stop();
      rmSync(runtime, { recursive: true, force: true });
    }
  });

  test("a dashi-agent started inside a sandbox is turned away", async () => {
    const runtime = mkdtempSync(join(tmpdir(), "dashi-run-"));
    const path = join(runtime, "dashi-tokens.sock");
    const stop = serveTokens({ path, tokens: source, peer: () => 4242, cgroup: () => "0::/user.slice/app.slice/dashi-agent-claude-1.scope\n" });
    try {
      expect(await requestProxy(path, "dashi-agent-claude-7.scope")).toHaveProperty("error");
    } finally {
      stop();
      rmSync(runtime, { recursive: true, force: true });
    }
  });
});
