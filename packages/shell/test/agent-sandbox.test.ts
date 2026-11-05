import { describe, expect, test } from "bun:test";
import { inAgentScope, proxyArgs, type SandboxEnv, sandboxArgs, unitName } from "../src/agents/sandbox.ts";

const env: SandboxEnv = { home: "/home/alex", runtime: "/run/user/1000", state: "/home/alex/.local/state", config: "/home/alex/.config" };
const present = new Map<string, "dir" | "file">([
  ["/run/dashi-secretd", "dir"],
  ["/home/alex/.config/op", "dir"],
  ["/home/alex/.local/state/dashi", "dir"],
  ["/home/alex/.config/dashi", "dir"],
  ["/home/alex/.zshrc", "file"],
  ["/run/user/1000/dashi-mcp.sock", "file"],
]);
const exists = (path: string) => present.get(path) ?? null;
const args = sandboxArgs(["claude", "--resume"], {
  env,
  exists,
  bwrap: "/usr/bin/bwrap",
  unit: "dashi-agent-claude-7.scope",
  bus: "/run/user/1000/dashi-agent/u/bus",
});

/** The value after each occurrence of `flag`. */
function after(flag: string): string[] {
  return args.flatMap((arg, i) => (arg === flag ? [args[i + 1] ?? ""] : []));
}

describe("the agent sandbox", () => {
  test("scopes are named so dashi-secretd knows them", () => {
    expect(unitName("claude", 42)).toBe("dashi-agent-claude-42.scope");
    expect(unitName("../evil name;rm", 1)).toBe("dashi-agent-___evil_name_rm-1.scope");
    expect(unitName("", 1)).toBe("dashi-agent-agent-1.scope");
    expect(inAgentScope("0::/user.slice/user-1000.slice/user@1000.service/app.slice/dashi-agent-claude-7.scope\n")).toBe(true);
    expect(inAgentScope("0::/user.slice/user-1000.slice/session-2.scope\n")).toBe(false);
    expect(inAgentScope("1:name=systemd:/dashi-agent-x.scope\n")).toBe(false);
  });

  test("it can't leave its scope, see other processes, or reach the display or the compositor", () => {
    expect(args.slice(0, 3)).toEqual(["/usr/bin/bwrap", "--die-with-parent", "--unshare-pid"]);
    expect(after("--proc")).toEqual(["/proc"]);
    expect(after("--ro-bind")).toContain("/sys/fs/cgroup");
    // The runtime directory is replaced; only the MCP socket and the filtered bus come back.
    expect(after("--tmpfs")).toContain("/run/user/1000");
    expect(after("--bind")).toEqual(["/run/user/1000/dashi-mcp.sock", "/run/user/1000/dashi-agent/u/bus"]);
    expect(after("--unsetenv")).toEqual(expect.arrayContaining(["WAYLAND_DISPLAY", "DISPLAY", "DASHI_COMP_SOCKET", "SSH_AUTH_SOCK"]));
    expect(after("--tmpfs")).toContain("/tmp/.X11-unix");
  });

  test("the vault's socket and 1Password are hidden; Dashi's settings and start-up files are read-only", () => {
    expect(after("--tmpfs")).toEqual(expect.arrayContaining(["/run/dashi-secretd", "/home/alex/.config/op"]));
    expect(after("--ro-bind")).toEqual(expect.arrayContaining(["/home/alex/.local/state/dashi", "/home/alex/.config/dashi", "/home/alex/.zshrc"]));
    // What doesn't exist isn't mentioned (bwrap would fail on it).
    expect(args).not.toContain("/home/alex/.1password");
  });

  test("the agent's command comes last, untouched", () => {
    expect(args.slice(-3)).toEqual(["--", "claude", "--resume"]);
    expect(after("--setenv")).toContain("DASHI_AGENT");
  });

  test("the bus filter lets through notifications and portals only", () => {
    const proxy = proxyArgs("/usr/bin/xdg-dbus-proxy", "unix:path=/run/user/1000/bus", "/tmp/b");
    expect(proxy).toEqual([
      "/usr/bin/xdg-dbus-proxy",
      "unix:path=/run/user/1000/bus",
      "/tmp/b",
      "--filter",
      "--talk=org.freedesktop.Notifications",
      "--talk=org.freedesktop.portal.*",
    ]);
    expect(proxy.join(" ")).not.toContain("secrets");
    expect(proxy.join(" ")).not.toContain("systemd1");
  });
});
