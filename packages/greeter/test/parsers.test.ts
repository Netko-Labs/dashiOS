import { describe, expect, test } from "bun:test";
import { formatTime } from "../src/clock.ts";
import { memoryPath, parseLast } from "../src/memory.ts";
import { commandFor, orderSessions, parseSession, splitExec } from "../src/sessions.ts";
import { parseUsers, uidRange } from "../src/users.ts";
import { hintFor } from "../src/view.tsx";

describe("users", () => {
  const passwd = [
    "root:x:0:0:root:/root:/bin/bash",
    "sddm:x:985:985:SDDM Greeter Account:/var/lib/sddm:/usr/sbin/nologin",
    "dashi:x:1000:1000:Dashi Tester,,,:/home/dashi:/bin/bash",
    "ana:x:1001:1001::/home/ana:/bin/zsh",
    "svc:x:1002:1002::/:/sbin/nologin",
    "nobody:x:65534:65534:Kernel Overflow User:/:/usr/sbin/nologin",
  ].join("\n");

  test("regular accounts that can log in, by display name", () => {
    expect(parseUsers(passwd, uidRange(""))).toEqual([
      { name: "ana", displayName: "ana", uid: 1001 },
      { name: "dashi", displayName: "Dashi Tester", uid: 1000 },
    ]);
  });

  test("login.defs sets the range", () => {
    expect(uidRange("UID_MIN 1001\n#UID_MAX 2\nUID_MAX   5000\n")).toEqual({ min: 1001, max: 5000 });
  });
});

describe("sessions", () => {
  test("Exec splits like a desktop entry's", () => {
    expect(splitExec('/usr/bin/dashi-session --flag "a b" %U')).toEqual(["/usr/bin/dashi-session", "--flag", "a b"]);
  });

  test("hidden entries and entries without Exec are not sessions", () => {
    expect(parseSession("x", "[Desktop Entry]\nName=X\nExec=x\nHidden=true\n")).toBeNull();
    expect(parseSession("y", "[Desktop Entry]\nName=Y\n")).toBeNull();
  });

  test("Dashi's first; its command runs as a Dashi Wayland session", () => {
    const dashi = parseSession("dashi", "[Desktop Entry]\nName=Dashi\nExec=/usr/bin/dashi-session\nDesktopNames=Dashi\n");
    const other = parseSession("a", "[Desktop Entry]\nName=Another\nExec=another\n");
    if (!dashi || !other) throw new Error("expected sessions");
    expect(orderSessions([other, dashi]).map((s) => s.id)).toEqual(["dashi", "a"]);
    expect(commandFor(dashi)).toEqual({
      cmd: ["/usr/bin/dashi-session"],
      env: ["XDG_SESSION_TYPE=wayland", "XDG_SESSION_DESKTOP=Dashi", "XDG_CURRENT_DESKTOP=Dashi"],
    });
  });
});

describe("memory", () => {
  test("anything unreadable is forgotten", () => {
    expect(parseLast('{"user":"dashi","session":"dashi"}')).toEqual({ user: "dashi", session: "dashi" });
    expect(parseLast('{"user":3}')).toEqual({ user: null, session: null });
    expect(parseLast("{")).toEqual({ user: null, session: null });
  });

  test("kept in the greeter's state folder", () => {
    expect(memoryPath({ HOME: "/var/lib/dashi-greeter" })).toBe("/var/lib/dashi-greeter/.local/state/dashi-greeter/last.json");
  });
});

describe("what the screen says", () => {
  const session = { id: "dashi", name: "Dashi", cmd: ["x"], desktopNames: ["Dashi"] };
  test("each moment has its line", () => {
    expect(hintFor({ kind: "prompt", message: "Password", secret: true, notice: null, wrong: false }, session)).toEqual({ hint: "Enter your password", error: false });
    expect(hintFor({ kind: "prompt", message: "Password", secret: true, notice: null, wrong: true }, session).error).toBe(true);
    expect(hintFor({ kind: "started" }, session).hint).toBe("Starting Dashi…");
  });

  test("the clock leaves out AM/PM", () => {
    expect(formatTime(new Date(2026, 10, 1, 17, 4), "en-US")).toBe("5:04");
  });
});
