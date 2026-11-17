/**
 * dashi-applet-run PLAN: one installed applet, in its sandbox. The shell's
 * launcher (src/applets/launcher.ts) starts this as a systemd user unit,
 * outside the shell's own processes (so the compositor never takes the
 * applet for the shell), with a plan it wrote: the xdg-dbus-proxy to start
 * first, if any, the network proxy for an extension held to its hosts
 * (src/applets/net-proxy.ts), and bubblewrap's arguments
 * (src/applets/lib/sandbox.ts). It waits for the proxies' sockets, runs
 * bubblewrap, and ends with it; the proxies go too.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { list, maybe, nullable, obj, optional, str } from "@dashi/shape";
import { startNetProxy } from "../src/applets/net-proxy.ts";

interface Plan {
  proxy: { args: string[]; sockets: string[] } | null;
  net?: { socket: string; hosts: string[] } | null;
  bwrap: string[];
}

const PLAN = obj(
  {
    proxy: nullable(obj({ args: list(str()), sockets: list(str()) }, { strict: false })),
    net: optional(nullable(obj({ socket: str(), hosts: list(str()) }, { strict: false }))),
    bwrap: list(str()),
  },
  { strict: false },
);

function parsePlan(text: string): Plan | null {
  try {
    return maybe(PLAN, JSON.parse(text));
  } catch {
    return null;
  }
}

const path = Bun.argv[2];
const plan = path && existsSync(path) ? parsePlan(readFileSync(path, "utf8")) : null;
if (!plan) {
  console.error("dashi-applet-run: give the plan the shell wrote");
  process.exit(2);
}

const bwrap = Bun.which("bwrap");
if (!bwrap) {
  console.error("dashi-applet-run: bubblewrap (bwrap) is not installed");
  process.exit(1);
}

let proxy: ReturnType<typeof Bun.spawn> | null = null;
if (plan.proxy) {
  const binary = Bun.which("xdg-dbus-proxy");
  if (!binary) {
    console.error("dashi-applet-run: xdg-dbus-proxy is not installed; the applet's bus permissions can't be given");
    process.exit(1);
  }
  proxy = Bun.spawn([binary, ...plan.proxy.args], { stdout: "inherit", stderr: "inherit" });
  const sockets = plan.proxy.sockets;
  const deadline = Date.now() + 5000;
  while (!sockets.every((socket) => existsSync(socket))) {
    if (Date.now() > deadline || proxy.exitCode !== null) {
      console.error("dashi-applet-run: the D-Bus proxy didn't start");
      proxy.kill();
      process.exit(1);
    }
    await Bun.sleep(25);
  }
}

// Held to its hosts: the proxy listens before the sandbox binds its folder (this process is outside it, with the network).
const net = plan.net ? (mkdirSync(dirname(plan.net.socket), { recursive: true, mode: 0o700 }), startNetProxy({ socket: plan.net.socket, hosts: plan.net.hosts })) : null;

const sandbox = Bun.spawn([bwrap, ...plan.bwrap], { stdout: "inherit", stderr: "inherit", stdin: "ignore" });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => sandbox.kill(signal));
const code = await sandbox.exited;
proxy?.kill();
net?.stop();
process.exit(code);
