/**
 * `network:HOST` for real (src/applets/net-proxy.ts, lib/sandbox.ts,
 * bin/dashi-net-bridge.ts): bubblewrap with the plan an extension held to
 * api.example.test gets, and the proxy outside it. Inside, a CONNECT to that
 * host goes through (to a stand-in upstream that echoes); a CONNECT to any
 * other host is refused with 403; Bun's own `fetch` finds the bridge by
 * HTTPS_PROXY and is refused for another host; and a connection that skips
 * the bridge finds no network at all (neither the host's loopback nor an
 * address outside). Skipped where bubblewrap can't make a
 * sandbox.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { type Manifest, parseManifest } from "@dashi/applet";
import { userFolders } from "../src/applets/launcher.ts";
import { type SandboxPaths, sandboxPlan } from "../src/applets/lib/sandbox.ts";
import { connectVerdict, dialer, type NetProxy, startNetProxy } from "../src/applets/net-proxy.ts";

const bwrap = Bun.which("bwrap");
const works =
  bwrap !== null &&
  Bun.spawnSync([bwrap, "--unshare-all", "--ro-bind", "/usr", "/usr", "--symlink", "usr/lib64", "/lib64", "--", "/usr/bin/true"]).exitCode === 0;

const ID = "dev.example.held";

function manifest(): Manifest {
  const parsed = parseManifest({
    id: ID,
    name: "Held",
    version: "0.1.0",
    dashi: ">=0.9",
    entry: "main.ts",
    summary: "Talks to one host.",
    author: { name: "Alex Kim" },
    shows: ["launcher"],
    permissions: ["network:api.example.test"],
  });
  if ("error" in parsed) throw new Error(parsed.error);
  return parsed;
}

/** Inside: CONNECTs through the bridge, `fetch` by HTTPS_PROXY, and a connection around it; what each came to. */
const SCRIPT = `
function connect(host, say) {
  return new Promise((done) => {
    let text = "";
    let open = false;
    Bun.connect({ hostname: "127.0.0.1", port: 3128, socket: {
      open: (s) => s.write("CONNECT " + host + ":443 HTTP/1.1\\r\\nHost: " + host + ":443\\r\\n\\r\\n"),
      data: (s, chunk) => {
        text += new TextDecoder().decode(chunk);
        const status = text.split("\\r\\n")[0];
        if (!open && text.includes("\\r\\n\\r\\n") && status.includes(" 200 ") && say) { open = true; s.write(say); return; }
        if (open && text.endsWith(say + "!")) { done(status + ", then " + say + "!"); s.end(); }
      },
      close: () => done(text.split("\\r\\n")[0] || "closed"),
      error: () => done("error"),
    } }).catch((e) => done("error " + e.code));
  });
}
const out = {};
out.allowed = await connect("api.example.test", "ping");
out.refused = await connect("evil.example.com");
out.fetch = await fetch("https://evil.example.com/").then((r) => "fetched " + r.status, (e) => "refused " + (e.code ?? e.name));
const dial = (hostname, port) => Bun.connect({ hostname, port, socket: { data() {} } }).then(() => "reached", (e) => "no network " + (e.code ?? ""));
out.loopback = await dial(process.argv[2], Number(process.argv[3]));
out.outside = await dial("192.0.2.1", 443);
console.log(JSON.stringify(out));
process.exit(0);
`;

let stops: Array<{ stop(): void }> = [];
afterEach(() => {
  for (const each of stops) each.stop();
  stops = [];
});

function world(): SandboxPaths {
  const root = mkdtempSync(join(tmpdir(), "dashi-net-"));
  const home = join(root, "home");
  const runtime = join(root, "run");
  const appletDir = join(home, "applets", ID);
  const dataDir = join(home, "applet-data", ID);
  const socketDir = join(runtime, "dashi-applets", ID);
  for (const dir of [appletDir, dataDir, socketDir]) mkdirSync(dir, { recursive: true });
  writeFileSync(join(runtime, "wayland-0"), "");
  writeFileSync(join(appletDir, "main.js"), SCRIPT);
  return {
    appletDir,
    dataDir,
    home,
    uid: process.getuid?.() ?? 1000,
    runtimeDir: runtime,
    socketDir,
    wayland: "wayland-0",
    bun: process.execPath,
    metalHost: process.execPath,
    netBridge: fileURLToPath(new URL("../bin/dashi-net-bridge.ts", import.meta.url)),
    appearance: join(home, "control-center.json"),
    sessionBus: null,
    systemBus: "unix:path=/run/dbus/system_bus_socket",
    proxyDir: join(runtime, "proxy"),
    folders: userFolders(home, null),
  };
}

/** A stand-in upstream on the host's loopback: it answers "ping" with "ping!". */
function upstream(): { port: number; stop(): void } {
  const server = Bun.listen({ hostname: "127.0.0.1", port: 0, socket: { data: (socket, chunk) => void socket.write(`${new TextDecoder().decode(chunk)}!`) } });
  return { port: server.port, stop: () => server.stop(true) };
}

describe("the proxy's verdict", () => {
  test("only CONNECT, only port 443, only the hosts named (in any case, a trailing dot ignored)", () => {
    const hosts = ["api.github.com"];
    expect(connectVerdict("CONNECT api.github.com:443 HTTP/1.1\r\n\r\n", hosts)).toEqual({ host: "api.github.com", port: 443 });
    expect(connectVerdict("CONNECT API.GitHub.com.:443 HTTP/1.1\r\n\r\n", hosts)).toEqual({ host: "api.github.com", port: 443 });
    expect(connectVerdict("CONNECT github.com:443 HTTP/1.1\r\n\r\n", hosts)).toMatchObject({ status: 403 });
    expect(connectVerdict("CONNECT api.github.com.evil.example:443 HTTP/1.1\r\n\r\n", hosts)).toMatchObject({ status: 403 });
    expect(connectVerdict("CONNECT api.github.com:22 HTTP/1.1\r\n\r\n", hosts)).toMatchObject({ status: 403 });
    expect(connectVerdict("GET http://api.github.com/ HTTP/1.1\r\n\r\n", hosts)).toMatchObject({ status: 405 });
  });
});

describe.skipIf(!works)("an extension held to its host, in its sandbox", () => {
  test("reaches its host through the proxy; another host is refused; around the bridge there is no network", async () => {
    const paths = world();
    const plan = sandboxPlan(manifest(), paths);
    if (!plan.net) throw new Error("no proxy in the plan");
    const echo = upstream();
    const refused: string[] = [];
    mkdirSync(dirname(plan.net.socket), { recursive: true });
    const proxy: NetProxy = startNetProxy({
      socket: plan.net.socket,
      hosts: plan.net.hosts,
      // The host it asked for, sent to the stand-in: nothing here touches the real network.
      dial: dialer(() => ({ hostname: "127.0.0.1", port: echo.port })),
      log: (line) => refused.push(line),
    });
    stops = [proxy, echo];
    const child = Bun.spawn([bwrap ?? "bwrap", ...plan.bwrap, "127.0.0.1", String(echo.port)], { stdout: "pipe", stderr: "pipe" });
    const [text, errors] = await Promise.all([new Response(child.stdout).text(), new Response(child.stderr).text(), child.exited]);
    if (!text.trim()) throw new Error(`the sandbox didn't run: ${errors}`);
    const seen: unknown = JSON.parse(text.trim());
    expect(seen).toEqual({
      allowed: "HTTP/1.1 200 Connection Established, then ping!",
      refused: "HTTP/1.1 403 Forbidden",
      fetch: expect.stringMatching(/^refused/),
      // The host's own loopback isn't there (the stand-in upstream listens on it), and nothing outside is.
      loopback: expect.stringMatching(/^no network/),
      outside: expect.stringMatching(/^no network/),
    });
    expect(refused.some((line) => line.includes("evil.example.com"))).toBe(true);
  });
});
