/**
 * The agent sandbox (docs/secrets.md, "The agent sandbox"): what
 * `dashi-agent` runs an agent in, so it can use the person's secrets through
 * Dashi but never read them. A systemd scope, `dashi-agent-<name>-<n>.scope`,
 * that dashi-secretd and the Secret Service refuse, and inside it bubblewrap:
 *
 * - the person's files as they are, but Dashi's settings, the agents' grants,
 *   and the places that run things later outside the sandbox (autostart,
 *   systemd units, shell start-up files) read-only;
 * - the cgroup tree read-only, so it can't leave its scope;
 * - its own process namespace: no other process to see, signal or read;
 * - of $XDG_RUNTIME_DIR, only Dashi's MCP socket and a filtered session bus
 *   (notifications and portals): no compositor socket, no Wayland or X11
 *   display, no systemd, Secret Service, Flatpak or 1Password sockets;
 * - no 1Password CLI configuration or app data;
 * - API tokens only through the shell's token proxy (tokenProxyArgs), with
 *   a CA trusted inside this sandbox alone.
 *
 * Pure: the paths that exist come in, the arguments go out (tested).
 */

import { join } from "node:path";

export interface SandboxEnv {
  home: string;
  runtime: string;
  state: string;
  config: string;
}

export type Exists = (path: string) => "dir" | "file" | null;

/** What the filtered bus lets an agent reach: notifications and the portals. */
export const BUS_TALK = ["org.freedesktop.Notifications", "org.freedesktop.portal.*"] as const;

/** A scope's name from what the agent is called: letters, digits, '-' and '_'. */
export function unitName(name: string, n: number): string {
  const safe = (name.replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 32) || "agent").replace(/^-/, "_");
  return `dashi-agent-${safe}-${n}.scope`;
}

/** Whether a cgroup path (from /proc/<pid>/cgroup) is in an agent's sandbox. */
export function inAgentScope(cgroupFile: string): boolean {
  const line = cgroupFile.split("\n").find((entry) => entry.startsWith("0::"));
  const parts = line?.slice(3).split("/") ?? [];
  return parts.some((part) => part.startsWith("dashi-agent-"));
}

/**
 * Whether an SSH connection (`SSH_CONNECTION`: client address, port, server
 * address, port) comes from another machine. From this one (loopback, or its
 * own address) an agent could reach Dashi over SSH to look remote.
 */
export function fromAnotherMachine(sshConnection: string | null): boolean {
  const [client, , server] = (sshConnection ?? "").trim().split(/\s+/);
  if (!client || !server) return false;
  const loopback = client === "::1" || client.startsWith("127.") || client === "::ffff:127.0.0.1";
  return !loopback && client !== server;
}

/** Whether the agent behind `pid` (the process on the MCP socket) can't read secrets any other way. */
export function isConfined(read: (path: string) => string | null, pid: number, remote: boolean): boolean {
  if (remote) {
    const environ = read(`/proc/${pid}/environ`) ?? "";
    const ssh = environ.split("\0").find((entry) => entry.startsWith("SSH_CONNECTION="));
    return fromAnotherMachine(ssh?.slice("SSH_CONNECTION=".length) ?? null);
  }
  return inAgentScope(read(`/proc/${pid}/cgroup`) ?? "");
}

/** Directories hidden from agents (tmpfs over them). */
function hidden(env: SandboxEnv): string[] {
  return ["/run/dashi-secretd", join(env.config, "op"), join(env.home, ".op"), join(env.home, ".1password"), join(env.config, "1Password")];
}

/** What agents may read but not change. */
function readOnly(env: SandboxEnv): string[] {
  return [
    join(env.state, "dashi"),
    join(env.config, "dashi"),
    join(env.config, "autostart"),
    join(env.config, "systemd"),
    join(env.config, "environment.d"),
    join(env.config, "fish/config.fish"),
    join(env.home, ".local/share/applications"),
    ...[".bashrc", ".bash_profile", ".profile", ".zshrc", ".zprofile", ".zshenv"].map((file) => join(env.home, file)),
  ];
}

/** The xdg-dbus-proxy command for the agent's filtered session bus. */
export function proxyArgs(proxy: string, busAddress: string, socket: string): string[] {
  return [proxy, busAddress, socket, "--filter", ...BUS_TALK.map((name) => `--talk=${name}`)];
}

export interface SandboxOptions {
  env: SandboxEnv;
  exists: Exists;
  bwrap: string;
  unit: string;
  /** The filtered bus's socket, when there is one. */
  bus: string | null;
  /** More arguments for bubblewrap before the command (the token proxy's). */
  extra?: readonly string[];
}

/** The token proxy as dashi-agent got it from the shell, and the loopback port it relays to it. */
export interface TokenProxy {
  socket: string;
  ca: string;
  bundle: string;
  key: string;
  port: number;
}

/** Where the token proxy's files appear inside the sandbox (its runtime directory is its own). */
export function tokenProxyPaths(runtime: string): { socket: string; ca: string; bundle: string } {
  const dir = join(runtime, "dashi-tokens");
  return { socket: join(dir, "proxy.sock"), ca: join(dir, "ca.pem"), bundle: join(dir, "bundle.pem") };
}

/** Variables TLS clients read for their trusted CAs: the system's plus the sandbox's. */
export const CA_BUNDLE_VARS = ["SSL_CERT_FILE", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "GIT_SSL_CAINFO"] as const;
/** Hosts reached directly, never through the proxy (a local model, say). */
export const DIRECT = "localhost,127.0.0.1,::1";

/**
 * bubblewrap's arguments for the token proxy (docs/secrets.md, "Tokens that
 * stay home"): its socket and CA files bound in, HTTPS_PROXY at the relay
 * with the sandbox's credentials, and the CA trusted inside the sandbox only.
 */
export function tokenProxyArgs(env: SandboxEnv, proxy: TokenProxy, noProxy?: string): string[] {
  const inside = tokenProxyPaths(env.runtime);
  const url = `http://dashi:${proxy.key}@127.0.0.1:${proxy.port}`;
  const direct = [DIRECT, ...(noProxy ? [noProxy] : [])].join(",");
  return [
    "--bind",
    proxy.socket,
    inside.socket,
    "--ro-bind",
    proxy.ca,
    inside.ca,
    "--ro-bind",
    proxy.bundle,
    inside.bundle,
    ...["HTTPS_PROXY", "https_proxy"].flatMap((name) => ["--setenv", name, url]),
    ...["NO_PROXY", "no_proxy"].flatMap((name) => ["--setenv", name, direct]),
    ...CA_BUNDLE_VARS.flatMap((name) => ["--setenv", name, inside.bundle]),
    "--setenv",
    "NODE_EXTRA_CA_CERTS",
    inside.ca,
    "--setenv",
    "DASHI_TOKEN_PROXY",
    inside.socket,
  ];
}

/** bubblewrap's command line for `command`. */
export function sandboxArgs(command: readonly string[], options: SandboxOptions): string[] {
  const { env, exists, bwrap, unit, bus } = options;
  const args = [
    bwrap,
    "--die-with-parent",
    "--unshare-pid",
    "--dev-bind",
    "/",
    "/",
    // Its own /proc: with the pid namespace, no other process is there.
    "--proc",
    "/proc",
    "--ro-bind",
    "/sys/fs/cgroup",
    "/sys/fs/cgroup",
    "--tmpfs",
    "/tmp/.X11-unix",
    // The whole runtime directory goes; what agents may reach comes back below.
    "--tmpfs",
    env.runtime,
  ];
  for (const dir of hidden(env)) if (exists(dir) === "dir") args.push("--tmpfs", dir);
  for (const path of readOnly(env)) if (exists(path)) args.push("--ro-bind", path, path);
  const mcp = join(env.runtime, "dashi-mcp.sock");
  if (exists(mcp)) args.push("--bind", mcp, mcp);
  if (bus) {
    const inside = join(env.runtime, "bus");
    args.push("--bind", bus, inside, "--setenv", "DBUS_SESSION_BUS_ADDRESS", `unix:path=${inside}`);
  } else {
    args.push("--unsetenv", "DBUS_SESSION_BUS_ADDRESS");
  }
  args.push(
    "--unsetenv",
    "WAYLAND_DISPLAY",
    "--unsetenv",
    "DISPLAY",
    "--unsetenv",
    "DASHI_COMP_SOCKET",
    "--unsetenv",
    "SSH_AUTH_SOCK",
    "--setenv",
    "DASHI_AGENT",
    unit,
    ...(options.extra ?? []),
    "--",
    ...command,
  );
  return args;
}
