import { describe, expect, test } from "bun:test";
import { type PlanProfile, parsePlanProfile, sandboxArgs } from "../src/agents/sandbox.ts";

describe("a task's sandbox", () => {
  const task: PlanProfile = {
    socket: "/run/user/1000/dashi-mcp.d/dashi-mcp.sock",
    readOnly: [],
    state: ["/home/alex/.claude"],
    cwd: "/run/user/1000/dashi-task",
    task: true,
  };
  const args = sandboxArgs(["/home/alex/.local/bin/claude", "-p"], {
    env: { home: "/home/alex", runtime: "/run/user/1000", state: "/home/alex/.local/state", config: "/home/alex/.config" },
    exists: (path) => (path === "/home/alex/.claude" ? "dir" : null),
    bwrap: "bwrap",
    unit: "dashi-agent-task-ab12cd34-9.scope",
    bus: null,
    plan: task,
  });

  test("an empty home folder with only its login; Dashi's MCP socket where the bridge looks, through its folder", () => {
    expect(args).toContain("--tmpfs");
    expect(args[args.indexOf("/home/alex") - 1]).toBe("--tmpfs");
    // The folder is bound, not the socket: the socket a restarted shell makes shows inside.
    const at = args.indexOf("/run/user/1000/dashi-mcp.d");
    expect(args.slice(at - 1, at + 2)).toEqual(["--bind", "/run/user/1000/dashi-mcp.d", "/run/user/1000/dashi-mcp.d"]);
    const link = args.indexOf("/run/user/1000/dashi-mcp.sock");
    expect(args.slice(link - 2, link + 1)).toEqual(["--symlink", "dashi-mcp.d/dashi-mcp.sock", "/run/user/1000/dashi-mcp.sock"]);
    expect(args).not.toContain("/run/user/1000/dashi-plan.sock");
  });

  test("the profile's task flag survives its JSON", () => {
    expect(parsePlanProfile(JSON.stringify(task))).toEqual(task);
    expect(parsePlanProfile(JSON.stringify({ ...task, task: "yes" }))).toBeNull();
  });
});
