import { describe, expect, test } from "bun:test";
import { parseOpenArgs } from "../apps/activity-monitor/args.ts";
import { COLUMNS, DEFAULT_SORT } from "../apps/activity-monitor/columns.ts";
import { appRoots, buildLines, lineForApp } from "../apps/activity-monitor/lines.ts";
import { monitorMenus } from "../apps/activity-monitor/menus.ts";
import { quitRefusal } from "../apps/activity-monitor/policy.ts";
import { lineRefusal, sendQuit } from "../apps/activity-monitor/quit.ts";
import type { ProcessRow } from "../apps/activity-monitor/sample.ts";
import type { CompositorWindow } from "../src/compositor.ts";
import { energyArgs, openActivityMonitor } from "../src/menus/activity-monitor.ts";
import { isOpenArgs, parseShellMessage } from "../src/shared/app-menus/protocol.ts";
import { energyImpact, gpuPercent, parseDrmFdinfo, parseWakeups, sumGpu } from "../src/shared/processes/energy-proc.ts";
import { type AppIdentity, catalogFrom, flatpakId, identify, ownerOf, parseCmdline, programOf } from "../src/shared/processes/index.ts";

const FIREFOX = { id: "org.mozilla.firefox", name: "Firefox", icon: "/icons/firefox.png", exec: ["/usr/bin/firefox", "%u"] };
const CODE = {
  id: "code",
  name: "Visual Studio Code",
  icon: "/icons/code.png",
  exec: ["env", "ELECTRON=1", "/usr/share/code/code", "--unity-launch"],
  wmClass: "Code",
};
const SCRIPT = { id: "org.example.Tool", name: "Tool", icon: "/icons/tool.png", exec: ["python3", "-u", "/usr/bin/example-tool"] };
const OWN = { id: "dev.dashi.files", name: "Files", icon: "/icons/files.svg", exec: ["/usr/bin/bun", "/usr/share/dashi/shell/apps/files/main.tsx"] };
const catalog = catalogFrom([FIREFOX, CODE, SCRIPT, OWN], [{ id: "dev.dashi.files", name: "Files", icon: "files", dir: "files", keywords: [] }]);

const facts = (argv: string[], comm = "x", cgroup = "") => ({ argv, comm, cgroup });

describe("which app a process is", () => {
  test("command lines: past env and interpreters, never a launcher's", () => {
    expect(parseCmdline("/usr/bin/firefox\0-P\0")).toEqual(["/usr/bin/firefox", "-P"]);
    expect(parseCmdline(null)).toEqual([]);
    expect(programOf(["env", "A=1", "/opt/app/bin/tool"])).toBe("tool");
    expect(programOf(["python3", "-u", "/usr/bin/example-tool"])).toBe("example-tool");
    expect(programOf(["bun", "/x/apps/files/main.tsx"])).toBeNull();
    expect(programOf(["flatpak", "run", "org.gnome.Maps"])).toBeNull();
    expect(programOf(["sh", "-c", "tool"])).toBeNull();
  });

  test("Dashi's apps by their folder, Dashi itself, Flatpaks by their scope, others by their entry", () => {
    expect(identify(facts(["/usr/bin/bun", "/usr/share/dashi/shell/apps/files/main.tsx"], "Files"), catalog)?.name).toBe("Files");
    // A Bun program of Dashi's that isn't an app (the dialog) works for whoever started it.
    expect(identify(facts(["/usr/bin/bun", "/usr/share/dashi/shell/apps/dialog/main.tsx"], "bun"), catalog)).toBeNull();
    expect(identify(facts([], "dashi-comp"), catalog)?.key).toBe("dev.dashi.shell");
    // Drawn with Dashi's bowl, not the blank generic tile.
    expect(identify(facts([], "dashi-comp"), catalog)?.icon).toEndWith("/icons/setup.svg");
    expect(identify(facts(["bun", "/home/alexk/dashiOS/packages/shell/src/main.tsx"], "bun"), catalog)?.name).toBe("Dashi");
    const scope = "0::/user.slice/user-1000.slice/user@1000.service/app.slice/app-flatpak-org.mozilla.firefox-4242.scope\n";
    expect(flatpakId(scope)).toBe("org.mozilla.firefox");
    expect(identify(facts(["/app/lib/firefox/firefox"], "firefox", scope), catalog)).toEqual({
      key: "org.mozilla.firefox",
      name: "Firefox",
      icon: "/icons/firefox.png",
    });
    expect(identify(facts(["/app/bin/maps"], "maps", scope.replace("org.mozilla.firefox", "org.gnome.Maps")), catalog)?.name).toBe("Maps");
    expect(identify(facts(["/usr/lib64/firefox/firefox", "-contentproc"], "Isolated Web Co"), catalog)?.name).toBe("Firefox");
    expect(identify(facts(["/usr/share/code/code", "--type=renderer"], "code"), catalog)?.key).toBe("code");
    expect(identify(facts(["python3", "/usr/bin/example-tool"], "python3"), catalog)?.key).toBe("org.example.Tool");
    // Chromium's helpers rewrite their command line: the kernel's name still says it.
    expect(identify(facts(["helper --type=gpu"], "firefox"), catalog)?.key).toBe("org.mozilla.firefox");
    expect(identify(facts(["/usr/bin/zsh"], "zsh"), catalog)).toBeNull();
  });

  test("a hidden entry names its program only when it runs it bare, not a command-line tool's handler", () => {
    const handler = {
      id: "claude-code-url-handler",
      name: "Claude Code URL Handler",
      icon: "",
      exec: ["/home/alexk/.local/bin/claude", "--handle-uri"],
      hidden: true as const,
    };
    const app = { id: "com.t3tools.T3Code", name: "T3 Code", icon: "", exec: ["/usr/lib64/t3code/t3code"], hidden: true as const };
    const withHidden = catalogFrom([handler, app], []);
    expect(identify(facts(["/home/alexk/.local/bin/claude"], "claude"), withHidden)).toBeNull();
    expect(identify(facts(["/usr/lib64/t3code/t3code", "--type=zygote"], "t3code"), withHidden)?.name).toBe("T3 Code");
  });

  test("a helper belongs to its nearest ancestor that is an app; a daemon to none", () => {
    const files: AppIdentity = { key: "dev.dashi.files", name: "Files", icon: "" };
    const processes = new Map(
      [
        { pid: 100, ppid: 1, app: null },
        { pid: 200, ppid: 100, app: files },
        { pid: 201, ppid: 200, app: null },
        { pid: 202, ppid: 201, app: null },
        { pid: 300, ppid: 1, app: null },
      ].map((each) => [each.pid, each]),
    );
    const owner = ownerOf(processes, (each) => each.app);
    expect(owner(202)?.name).toBe("Files");
    expect(owner(200)?.name).toBe("Files");
    expect(owner(100)).toBeNull();
    expect(owner(300)).toBeNull();
    expect(owner(999)).toBeNull();
  });
});

const files: AppIdentity = { key: "dev.dashi.files", name: "Files", icon: "/icons/files.svg" };
const row = (pid: number, fields: Partial<ProcessRow> = {}): ProcessRow => ({
  pid,
  ppid: 1,
  starttime: 100,
  name: `p${pid}`,
  command: "",
  state: "S",
  app: null,
  user: "alexk",
  uid: 1000,
  cpu: 0,
  cpuTime: 0,
  threads: 1,
  memory: 0,
  read: null,
  written: null,
  readRate: null,
  writeRate: null,
  sockets: null,
  wakeups: null,
  gpu: null,
  impact: 0,
  kernel: false,
  own: true,
  ...fields,
});

describe("lines", () => {
  const rows = [
    row(10, { name: "Files", app: files, cpu: 5, impact: 5, memory: 100 }),
    row(11, { name: "mirin-metal-host", ppid: 10, app: files, cpu: 20, impact: 25, gpu: 5, memory: 300 }),
    row(20, { name: "pipewire", cpu: 10, impact: 10, memory: 50 }),
  ];
  const columns = COLUMNS.cpu;

  test("by app: an app is one line, its numbers added up; its processes show once it is opened", () => {
    const closed = buildLines(rows, { grouped: true, expanded: new Set(), query: "", columns, sort: DEFAULT_SORT.cpu });
    expect(closed.map((line) => [line.key, line.name, line.cpu])).toEqual([
      ["app:dev.dashi.files", "Files", 25],
      ["pid:20", "pipewire", 10],
    ]);
    expect(closed[0]).toMatchObject({ memory: 400, gpu: 5, expandable: true, expanded: false, pid: null, icon: "/icons/files.svg" });
    const open = buildLines(rows, { grouped: true, expanded: new Set(["dev.dashi.files"]), query: "", columns, sort: DEFAULT_SORT.cpu });
    expect(open.map((line) => `${line.depth}:${line.name}`)).toEqual(["0:Files", "1:mirin-metal-host", "1:Files", "0:pipewire"]);
  });

  test("every process on its own line, with its app's icon; a search by process opens its app", () => {
    const flat = buildLines(rows, { grouped: false, expanded: new Set(), query: "", columns, sort: DEFAULT_SORT.cpu });
    expect(flat.map((line) => line.key)).toEqual(["pid:11", "pid:20", "pid:10"]);
    expect(flat[0]?.icon).toBe("/icons/files.svg");
    const found = buildLines([rows[1] as ProcessRow], { grouped: true, expanded: new Set(), query: "metal", columns, sort: DEFAULT_SORT.cpu });
    expect(found.map((line) => line.name)).toEqual(["Files"]);
    expect(found[0]?.members).toHaveLength(1);
  });

  test("the battery menu's app is found by its key, else by its name", () => {
    const lines = buildLines(rows, { grouped: true, expanded: new Set(), query: "", columns, sort: DEFAULT_SORT.energy });
    expect(lineForApp(lines, { key: "dev.dashi.files" })).toBe("app:dev.dashi.files");
    expect(lineForApp(lines, { key: "window:3", name: "pipewire" })).toBe("pid:20");
    expect(lineForApp(lines, { key: "gone", name: "Gone" })).toBeNull();
  });
});

describe("quitting", () => {
  const guard = { protectedPids: new Set([0, 1, 5, 7]), self: 7 };
  const rows = [row(10, { app: files }), row(11, { ppid: 10, app: files }), row(12, { ppid: 11, app: files })];

  test("an app quits as the processes it was started as; its helpers follow", () => {
    expect(appRoots(rows).map((each) => each.pid)).toEqual([10]);
    const [line] = buildLines([rows[2] as ProcessRow], { grouped: true, expanded: new Set(), query: "", columns: COLUMNS.cpu, sort: null });
    const sent: number[] = [];
    const outcome = sendQuit(line as never, rows, "SIGTERM", {
      guard,
      alive: () => true,
      signal: (target) => {
        sent.push(target.pid);
        return "sent";
      },
    });
    // Even when the search shows only a helper, the app's root is what is asked to quit.
    expect(sent).toEqual([10]);
    expect(outcome.kind).toBe("sent");
  });

  test("refusals: Activity Monitor itself, the session, someone else's; a gone process is not success", () => {
    expect(quitRefusal({ pid: 7, own: true, kernel: false }, guard)).toBe("Use ❖Q to quit Activity Monitor.");
    expect(quitRefusal({ pid: 5, own: true, kernel: false }, guard)).toContain("session");
    expect(quitRefusal({ pid: 9, own: false, kernel: false }, guard)).toBe("It belongs to another user.");
    expect(quitRefusal({ pid: 9, own: true, kernel: false }, guard)).toBeNull();
    const [line] = buildLines([row(30)], { grouped: true, expanded: new Set(), query: "", columns: COLUMNS.cpu, sort: null });
    expect(lineRefusal(line as never, [row(30)], guard)).toBeNull();
    expect(sendQuit(line as never, [row(30)], "SIGTERM", { guard, alive: () => false, signal: () => "gone" }).kind).toBe("gone");
    expect(sendQuit(line as never, [row(30)], "SIGTERM", { guard, alive: () => false, signal: () => "denied" }).kind).toBe("refused");
  });
});

describe("energy", () => {
  test("wakeups and GPU counters as the kernel writes them", () => {
    expect(parseWakeups("Name:\tbun\nvoluntary_ctxt_switches:\t1234\nnonvoluntary_ctxt_switches:\t5\n")).toBe(1234);
    expect(parseWakeups("")).toBeNull();
    const amd = parseDrmFdinfo("drm-driver:\tamdgpu\ndrm-client-id:\t7\ndrm-engine-gfx:\t2000000000 ns\ndrm-engine-compute:\t0 ns\n");
    expect(amd).toEqual({ client: "7", engines: { gfx: { used: 2e9, total: null }, compute: { used: 0, total: null } } });
    const intel = parseDrmFdinfo("drm-client-id: 3\ndrm-engine-render: 100 ns\ndrm-engine-capacity-render: 1\n");
    expect(Object.keys(intel?.engines ?? {})).toEqual(["render"]);
    const xe = parseDrmFdinfo("drm-client-id: 4\ndrm-cycles-rcs: 50\ndrm-total-cycles-rcs: 1000\n");
    expect(xe?.engines.rcs).toEqual({ used: 50, total: 1000 });
    expect(parseDrmFdinfo("pos: 0\nflags: 02\n")).toBeNull();
    // Two descriptors of one client count once.
    expect(sumGpu([amd as never, amd as never])?.gfx?.used).toBe(2e9);
  });

  test("% GPU is the busiest engine's share; impact adds CPU, GPU and wakeups", () => {
    const before = { gfx: { used: 0, total: null }, video: { used: 0, total: null } };
    const after = { gfx: { used: 1e9, total: null }, video: { used: 3e8, total: null } };
    expect(gpuPercent(before, after, 2)).toBeCloseTo(50, 5);
    expect(gpuPercent({ rcs: { used: 0, total: 0 } }, { rcs: { used: 250, total: 1000 } }, 2)).toBeCloseTo(25, 5);
    expect(gpuPercent(null, after, 2)).toBeNull();
    expect(energyImpact(10, 5, 40)).toBe(17);
    expect(energyImpact(10, null, null)).toBe(10);
  });
});

describe("the battery menu's way in", () => {
  test("arguments: the Energy tab and the app, read the same from a start and from the shell", () => {
    const args = energyArgs({ key: "org.mozilla.firefox", name: "Firefox" });
    expect(parseOpenArgs(args)).toEqual({ tab: "energy", app: { key: "org.mozilla.firefox", name: "Firefox" } });
    expect(parseOpenArgs(["/usr/libexec/dashi/mirin-metal-host"])).toEqual({});
    expect(parseOpenArgs(["--tab", "nonsense", "--app"])).toEqual({});
    expect(isOpenArgs(args)).toBeTrue();
    expect(isOpenArgs(Array.from({ length: 17 }, () => "x"))).toBeFalse();
    expect(parseShellMessage(JSON.stringify({ type: "open", args }))).toEqual({ type: "open", args });
    expect(parseShellMessage(JSON.stringify({ type: "open", args: [1] }))).toBeNull();
  });

  test("a running Activity Monitor is handed the arguments and comes forward; else it starts with them", async () => {
    const window = { id: 4, appId: "dev.dashi.activity-monitor", pid: 900, focused: false, state: "minimized" } as unknown as CompositorWindow;
    const calls: string[] = [];
    const deps = {
      windows: async () => [window],
      focus: async (id: number) => calls.push(`focus ${id}`),
      handOver: (pid: number, args: readonly string[]) => {
        calls.push(`hand ${pid} ${args.join(" ")}`);
        return true;
      },
      launch: (args: readonly string[]) => {
        calls.push(`launch ${args.join(" ")}`);
        return true;
      },
    };
    await openActivityMonitor(energyArgs(), deps);
    expect(calls).toEqual(["hand 900 --tab energy", "focus 4"]);
    calls.length = 0;
    await openActivityMonitor(energyArgs(), { ...deps, windows: async () => [] });
    expect(calls).toEqual(["launch --tab energy"]);
  });
});

describe("menus", () => {
  test("Energy is a tab, and Inspect and Quit need a selection", () => {
    const noop = () => {};
    const { menus } = monitorMenus({
      tab: "energy",
      view: { grouped: true, mine: false, kernel: false, summary: true, interval: 2000 },
      hasSelection: false,
      blocked: false,
      actions: { find: noop, copy: noop, setView: noop, chooseTab: noop, inspect: noop, quitProcess: noop },
    });
    const items = menus.flatMap((menu) => menu.items).filter((item) => item.type !== "separator");
    expect(items.find((item) => "id" in item && item.id === "tab:energy")).toMatchObject({ checked: true, shortcut: "❖3" });
    expect(items.find((item) => "id" in item && item.id === "inspect")).toMatchObject({ enabled: false });
    expect(items.find((item) => "id" in item && item.id === "every:2")).toMatchObject({ checked: true });
  });
});
