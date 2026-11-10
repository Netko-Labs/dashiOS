import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import net from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { relay } from "../src/agents/tokens/client.ts";
import { SandboxProxy } from "../src/agents/tokens/lib/proxy.ts";
import { issueLeaf, makeAuthority } from "../src/agents/tokens/lib/x509.ts";
import { proxyCredentials } from "../src/agents/tokens/swap.ts";
import { asked, source } from "./support/agent-tokens.ts";

const dir = mkdtempSync(join(tmpdir(), "dashi-tokens-"));

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
