import { describe, expect, test } from "bun:test";
import { submitSelection } from "../apps/activity-monitor/lines.ts";
import { Monitor } from "../apps/activity-monitor/monitor.ts";
import { isVirtualInterface, parseIo, parseNetDev, parseStatus } from "../apps/activity-monitor/proc.ts";
import type { ProcessSample, Snapshot } from "../apps/activity-monitor/read.ts";
import { cpuSplit, filterRows, type ProcessRow, processRows, scopeTotals } from "../apps/activity-monitor/sample.ts";
import { Sampler } from "../apps/activity-monitor/sampling.ts";
import { flush } from "./support/time.ts";

const CONTEXT = { users: new Map([[1000, "alexk"]]), ownUid: 1000, clockTicks: 100 };

const proc = (pid: number, fields: Partial<ProcessSample> = {}): ProcessSample => ({
  pid,
  ppid: 1,
  name: `p${pid}`,
  uid: 1000,
  state: "S",
  cpuTicks: 0,
  threads: 1,
  starttime: 100,
  memory: 0,
  kernel: false,
  io: null,
  sockets: null,
  command: "",
  app: null,
  wakeups: null,
  gpu: null,
  ...fields,
});

const look = (seconds: number, processes: ProcessSample[]): Snapshot => ({
  at: seconds * 1000,
  processes: new Map(processes.map((each) => [each.pid, each])),
  cpu: null,
  memory: null,
  disk: { readOps: 0, writeOps: 0, readBytes: 0, writeBytes: 0 },
  net: { packetsIn: 0, packetsOut: 0, bytesIn: 0, bytesOut: 0 },
});

const row = (pid: number, fields: Partial<ProcessRow> = {}): ProcessRow => ({
  pid,
  ppid: 1,
  starttime: 100,
  name: `p${pid}`,
  command: "",
  state: "S",
  app: null,
  wakeups: null,
  gpu: null,
  impact: 0,
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
  kernel: false,
  own: true,
  ...fields,
});

describe("memory", () => {
  test("a process's memory is its own pages (RssAnon + RssShmem), not the files it maps", () => {
    const status = "Name:\tbun\nUid:\t1000\t1000\t1000\t1000\nVmRSS:\t  204800 kB\nRssAnon:\t   51200 kB\nRssFile:\t  148480 kB\nRssShmem:\t    5120 kB\n";
    expect(parseStatus(status)).toEqual({ uid: 1000, rss: (51200 + 5120) * 1024 });
  });

  test("VmRSS when the kernel doesn't split it; nothing for a kernel thread", () => {
    expect(parseStatus("Uid:\t0\t0\t0\t0\nVmRSS:\t100 kB\n")).toEqual({ uid: 0, rss: 100 * 1024 });
    expect(parseStatus("Uid:\t0\t0\t0\t0\n")).toEqual({ uid: 0, rss: null });
  });
});

describe("disk", () => {
  test("bytes written leave out what was truncated before it reached the disk", () => {
    expect(parseIo("rchar: 1\nread_bytes: 4096\nwrite_bytes: 81920\ncancelled_write_bytes: 16384\n")).toEqual({ read: 4096, written: 65536 });
    expect(parseIo("read_bytes: 0\nwrite_bytes: 10\ncancelled_write_bytes: 99\n")).toEqual({ read: 0, written: 0 });
    expect(parseIo("")).toBeNull();
  });

  test("rows carry bytes per second over the last interval, not since the process started", () => {
    const before = look(0, [proc(10, { io: { read: 1_000_000, written: 50_000_000 } })]);
    const after = look(2, [proc(10, { io: { read: 1_400_000, written: 50_000_000 } })]);
    const [first] = processRows([before], after, CONTEXT);
    expect(first).toMatchObject({ read: 1_400_000, readRate: 200_000, written: 50_000_000, writeRate: 0 });
  });

  test("no rate on the first look, for a pid reused by a new process, or without io", () => {
    const after = look(2, [proc(10, { io: { read: 5, written: 5 } })]);
    expect(processRows([], after, CONTEXT)[0]).toMatchObject({ readRate: null, writeRate: null });
    const reused = look(0, [proc(10, { starttime: 1, io: { read: 0, written: 0 } })]);
    expect(processRows([reused], after, CONTEXT)[0]).toMatchObject({ readRate: null });
    expect(processRows([look(0, [proc(10)])], look(2, [proc(10)]), CONTEXT)[0]).toMatchObject({ readRate: null, writeRate: null });
  });
});

describe("cpu", () => {
  test("% CPU is averaged over the last three intervals, so one tick is not a jump", () => {
    // 100 ticks a second; one tick in the last 2 s alone would read 0.5%.
    const looks = [0, 2, 4, 6].map((at, index) => look(at, [proc(1, { cpuTicks: index === 3 ? 1 : 0 })]));
    const [now] = processRows(looks.slice(0, 3), looks[3] as Snapshot, CONTEXT);
    expect(now?.cpu).toBeCloseTo(100 / 600, 5);
  });

  test("only the last three looks count, and a process younger than them counts from its first", () => {
    const looks = [0, 2, 4, 6, 8].map((at) => look(at, [proc(1, { cpuTicks: at * 100 })]));
    // Busy all the time: 100%, whatever the window.
    expect(processRows(looks.slice(0, 4), looks[4] as Snapshot, CONTEXT)[0]?.cpu).toBeCloseTo(100, 5);
    const young = [look(0, []), look(2, []), look(4, [proc(2, { cpuTicks: 0 })])];
    expect(processRows(young, look(6, [proc(2, { cpuTicks: 100 })]), CONTEXT)[0]?.cpu).toBeCloseTo(50, 5);
  });

  test("a pid reused by another process starts from nothing", () => {
    const before = look(0, [proc(1, { starttime: 1, cpuTicks: 5000 })]);
    expect(processRows([before], look(2, [proc(1, { starttime: 2, cpuTicks: 10 })]), CONTEXT)[0]?.cpu).toBe(0);
  });

  test("steal time (another guest's) is neither system nor idle", () => {
    const zero = { user: 0, nice: 0, system: 0, idle: 0, iowait: 0, irq: 0, softirq: 0, steal: 0 };
    const split = cpuSplit(zero, { ...zero, user: 10, system: 10, idle: 80, steal: 100 });
    expect(split).toEqual({ user: 10, system: 10, idle: 80 });
  });
});

describe("totals", () => {
  const rows = [row(1, { threads: 4 }), row(2, { threads: 2, own: false }), row(3, { threads: 1, kernel: true, own: false })];

  test("hidden kernel threads count neither as processes nor as threads", () => {
    expect(scopeTotals(rows, { mine: false, kernel: false })).toEqual({ processes: 2, threads: 6 });
    expect(scopeTotals(rows, { mine: false, kernel: true })).toEqual({ processes: 3, threads: 7 });
  });

  test("My Processes counts only one's own", () => {
    expect(scopeTotals(rows, { mine: true, kernel: false })).toEqual({ processes: 1, threads: 4 });
  });
});

describe("network", () => {
  test("totals leave out interfaces whose traffic another one already carries", () => {
    for (const name of ["lo", "veth1a2b", "docker0", "br-4f2a", "virbr0", "vnet3", "tun0", "wg0", "tap1"]) expect(isVirtualInterface(name)).toBeTrue();
    for (const name of ["eth0", "enp3s0", "wlan0", "wlp2s0"]) expect(isVirtualInterface(name)).toBeFalse();
    const line = (name: string, bytes: number) => `${name}: ${bytes} 1 0 0 0 0 0 0 ${bytes} 1 0 0 0 0 0 0`;
    const text = ["Inter-|   Receive", " face |bytes", line("lo", 999), line("enp3s0", 100), line("wg0", 90), line("veth9", 50)].join("\n");
    expect(parseNetDev(text)).toEqual({ bytesIn: 100, packetsIn: 1, bytesOut: 100, packetsOut: 1 });
  });
});

describe("search", () => {
  test("Return selects: the selection while it is shown, else the first match, never a quit", () => {
    expect(submitSelection(["pid:4", "pid:5", "pid:6"], "pid:5")).toBe("pid:5");
    expect(submitSelection(["pid:4", "pid:5", "pid:6"], "pid:9")).toBe("pid:4");
    expect(submitSelection(["pid:4", "pid:5", "pid:6"], null)).toBe("pid:4");
    expect(submitSelection([], "pid:5")).toBeNull();
  });

  test("a search matches the name, the app, the command line, or the pid; a user name only when nothing else does", () => {
    const files = { key: "dev.dashi.files", name: "Files", icon: "" };
    const rows = [
      row(10, { name: "dashi-comp", user: "dashi" }),
      row(11, { name: "bun", app: files, user: "dashi", command: "bun /usr/share/dashi/shell/apps/files/main.tsx" }),
      row(12, { name: "zsh", user: "dashi" }),
    ];
    const scope = { mine: false, kernel: false };
    expect(filterRows(rows, "comp", scope).map((each) => each.pid)).toEqual([10]);
    expect(filterRows(rows, "files", scope).map((each) => each.pid)).toEqual([11]);
    expect(filterRows(rows, "12", scope).map((each) => each.pid)).toEqual([12]);
    // "dashi" is in two names and a command line: the user's other processes stay out.
    expect(filterRows(rows, "dashi", scope).map((each) => each.pid)).toEqual([10, 11]);
    expect(filterRows(rows, "da", scope)).toHaveLength(2);
    expect(filterRows([row(12, { name: "zsh", user: "alexk" })], "ale", scope)).toHaveLength(1);
  });
});

describe("monitor", () => {
  test("looks are asynchronous, one at a time, and what to read follows the window", async () => {
    const asked: Array<{ io: boolean; sockets: boolean; kernel?: boolean; energy?: boolean }> = [];
    let release: (() => void) | null = null;
    let at = 0;
    const monitor = new Monitor(CONTEXT, (options) => {
      asked.push(options);
      at += 2;
      const snapshot = look(at, [proc(1, { cpuTicks: at * 100 })]);
      return new Promise((resolve) => {
        release = () => resolve(snapshot);
      });
    });
    const first = monitor.refresh();
    void monitor.refresh(); // in flight: waits its turn
    expect(asked).toHaveLength(1);
    (release as unknown as () => void)();
    await first;
    expect(monitor.getSnapshot().rows).toHaveLength(1);
    // The queued one starts once the first lands.
    await flush();
    expect(asked).toHaveLength(2);
    (release as unknown as () => void)();
    await flush();
    expect(monitor.getSnapshot().rows[0]?.cpu).toBeCloseTo(100, 5);
    monitor.setTab("disk");
    monitor.setKernel(true);
    (release as unknown as () => void)();
    await flush();
    (release as unknown as () => void)();
    await flush();
    expect(asked.at(-1)).toEqual({ io: true, sockets: false, kernel: true, energy: false });
  });

  test("pause stops the timer; resume looks again at once", async () => {
    let looks = 0;
    const monitor = new Monitor(
      CONTEXT,
      () => {
        looks++;
        return Promise.resolve(look(looks, []));
      },
      10_000,
    );
    const stop = monitor.start();
    await flush();
    expect(looks).toBe(1);
    stop();
    monitor.resume();
    await flush();
    expect(looks).toBe(2);
    monitor.pause();
  });
});

describe("sampler", () => {
  test("the worker reads /proc and hands back a whole look", async () => {
    const sampler = new Sampler();
    try {
      const snapshot = await sampler.look({ io: false, sockets: false, kernel: false });
      expect(snapshot.processes).toBeInstanceOf(Map);
      expect(snapshot.processes.get(process.pid)?.pid).toBe(process.pid);
      expect([...snapshot.processes.values()].some((sample) => sample.kernel)).toBeFalse();
    } finally {
      sampler.close();
    }
  });
});
