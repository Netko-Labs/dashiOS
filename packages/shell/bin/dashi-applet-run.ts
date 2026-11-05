/**
 * dashi-applet-run PLAN: one installed applet, in its sandbox. The shell's
 * launcher (src/applets/launcher.ts) starts this as a systemd user unit,
 * outside the shell's own processes (so the compositor never takes the
 * applet for the shell), with a plan it wrote: the xdg-dbus-proxy to start
 * first, if any, and bubblewrap's arguments (src/applets/sandbox.ts). It
 * waits for the proxy's sockets, runs bubblewrap, and ends with it; the
 * proxy goes too.
 */

import { existsSync, readFileSync } from "node:fs";

interface Plan {
  proxy: { args: string[]; sockets: string[] } | null;
  bwrap: string[];
}

function parsePlan(text: string): Plan | null {
  try {
    const value = JSON.parse(text) as Record<string, unknown>;
    const strings = (list: unknown): list is string[] => Array.isArray(list) && list.every((each) => typeof each === "string");
    const proxy = value.proxy as Record<string, unknown> | null;
    if (!strings(value.bwrap)) return null;
    if (proxy !== null && (!strings(proxy?.args) || !strings(proxy?.sockets))) return null;
    return { proxy: proxy === null ? null : { args: proxy.args as string[], sockets: proxy.sockets as string[] }, bwrap: value.bwrap };
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

const sandbox = Bun.spawn([bwrap, ...plan.bwrap], { stdout: "inherit", stderr: "inherit", stdin: "ignore" });
for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"] as const) process.on(signal, () => sandbox.kill(signal));
const code = await sandbox.exited;
proxy?.kill();
process.exit(code);
