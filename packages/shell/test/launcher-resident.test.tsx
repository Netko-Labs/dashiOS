import { expect, test } from "bun:test";
import type { NativeEvent, NativeHostOptions, NativeHostTransport, NativeWindowOptions } from "@mirinjs/metal";
import { Text } from "@mirinjs/metal";
import { useState } from "react";
import { ResidentHost } from "../src/launcher/resident.tsx";

const settle = (ms = 10): Promise<void> => new Promise((done) => setTimeout(done, ms));

/** Hosts that record what the shell asks of them, in order. */
function fakeHosts() {
  const hosts: {
    options: NativeHostOptions;
    lines: string[];
    emit(event: { type: string; nodeId: string }): void;
    die(): void;
  }[] = [];
  const spawn = (_binary: string, options: NativeHostOptions): NativeHostTransport => {
    const lines: string[] = [];
    const listeners: ((event: NativeEvent) => void)[] = [];
    const closers: (() => void)[] = [];
    hosts.push({
      options,
      lines,
      emit: (event) => {
        for (const listener of listeners) listener(event as NativeEvent);
      },
      die: () => {
        for (const closer of closers) closer();
      },
    });
    const host = {
      send: (tree: string) => lines.push(tree.startsWith('{"hide"') ? "hide" : `tree ${tree}`),
      onEvent: (listener: (event: NativeEvent) => void) => listeners.push(listener),
      onClose: (listener: () => void) => closers.push(listener),
      simulate() {},
      close: () => lines.push("close"),
      onToplevel() {},
      toplevel() {},
      unlock() {},
      setTitle() {},
      open: (window: NativeWindowOptions) => lines.push(`open ${window.title}`),
    };
    return host as NativeHostTransport;
  };
  return { hosts, spawn };
}

const OPTIONS: NativeHostOptions = { title: "Launcher", width: 620, height: 520, surface: { layer: "overlay", namespace: "dashi.launcher" } };

function Counter({ label }: { label: string }) {
  const [count] = useState(() => Math.random());
  return <Text>{`${label} ${count}`}</Text>;
}

test("one host for the session: each open draws its tree first, then opens; each close hides", async () => {
  const { hosts, spawn } = fakeHosts();
  const frames: number[] = [];
  const resident = new ResidentHost("/host", { supports: async () => true, spawn, onFrame: (ms) => frames.push(ms) });
  expect(await resident.ready()).toBe(true);
  expect(hosts).toHaveLength(1);
  expect(hosts[0]?.options.deferred).toBe(true);
  const host = hosts[0];
  if (!host) throw new Error("no host");

  let closed = 0;
  const first = resident.open(OPTIONS, <Text>first</Text>, () => (closed += 1));
  expect(first).not.toBeNull();
  // Shown already: a second open waits its turn (the overlay slot holds one).
  expect(resident.open(OPTIONS, <Text>again</Text>)).toBeNull();
  await settle();
  const opened = host.lines.indexOf("open Launcher");
  const tree = host.lines.findIndex((line) => line.includes("first"));
  expect(tree).toBeGreaterThanOrEqual(0);
  expect(opened).toBeGreaterThan(tree);

  host.emit({ type: "frame", nodeId: "root" });
  expect(frames).toHaveLength(1);
  // One first frame per open.
  host.emit({ type: "frame", nodeId: "root" });
  expect(frames).toHaveLength(1);

  first?.close();
  first?.close();
  expect(closed).toBe(1);
  expect(host.lines.filter((line) => line === "hide")).toHaveLength(1);
  expect(resident.isShown()).toBe(false);

  // A second tap right after: the same host, no new one, a fresh tree.
  const second = resident.open(OPTIONS, <Text>second</Text>);
  await settle();
  expect(hosts).toHaveLength(1);
  expect(host.lines.filter((line) => line === "open Launcher")).toHaveLength(2);
  expect(host.lines.at(-1)).toBe("open Launcher");
  second?.close();
  resident.stop();
});

test("each open starts the launcher afresh", async () => {
  const { hosts, spawn } = fakeHosts();
  const resident = new ResidentHost("/host", { supports: async () => true, spawn });
  await resident.ready();
  const host = hosts[0];
  if (!host) throw new Error("no host");
  const treeText = (): string => [...host.lines].reverse().find((line) => line.startsWith("tree") && line.includes("count")) ?? "";
  resident.open(OPTIONS, <Counter label="count" />)?.close();
  await settle();
  const handle = resident.open(OPTIONS, <Counter label="count" />);
  await settle();
  const one = treeText();
  handle?.close();
  resident.open(OPTIONS, <Counter label="count" />);
  await settle();
  expect(treeText()).not.toBe(one);
  resident.stop();
});

test("a close before the tree was drawn opens nothing", async () => {
  const { hosts, spawn } = fakeHosts();
  const resident = new ResidentHost("/host", { supports: async () => true, spawn });
  await resident.ready();
  resident.open(OPTIONS, <Text>quick</Text>)?.close();
  await settle();
  expect(hosts[0]?.lines.includes("open Launcher")).toBe(false);
  resident.stop();
});

test("a host that dies while shown is a close, and is replaced", async () => {
  const { hosts, spawn } = fakeHosts();
  const resident = new ResidentHost("/host", { supports: async () => true, spawn });
  await resident.ready();
  let closed = 0;
  resident.open(OPTIONS, <Text>shown</Text>, () => (closed += 1));
  await settle();
  hosts[0]?.die();
  expect(closed).toBe(1);
  expect(resident.isReady()).toBe(false);
  expect(resident.open(OPTIONS, <Text>meanwhile</Text>)).toBeNull();
  await settle(1600);
  expect(hosts).toHaveLength(2);
  expect(resident.isReady()).toBe(true);
  resident.stop();
});

test("an older host binary is never resident: the launcher opens as other overlays do", async () => {
  const { hosts, spawn } = fakeHosts();
  const resident = new ResidentHost("/old-host", { supports: async () => false, spawn });
  expect(await resident.ready()).toBe(false);
  expect(hosts).toHaveLength(0);
  expect(resident.open(OPTIONS, <Text>x</Text>)).toBeNull();
});
