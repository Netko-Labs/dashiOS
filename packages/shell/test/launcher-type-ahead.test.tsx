import { afterEach, describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeRoot, type NativeTransport, render } from "@mirinjs/metal";
import { KEYMAP } from "../src/keymap/keymap.ts";
import { idleKeymap } from "../src/keymap/keymap-state.ts";
import { LAUNCHER_RULES } from "../src/launcher/keys.ts";
import { Launcher } from "../src/launcher/launcher.tsx";
import { applyEdits, TYPE_BINDING, TypeAhead, type Typed, typedFrom, withTypeAheadOnTap, withTyping } from "../src/launcher/type-ahead.ts";
import type { Entry } from "../src/shared/app-entries/index.ts";
import { settle } from "./support/time.ts";

const text = (value: string): Typed => ({ kind: "text", text: value });
const key = (value: "BackSpace" | "Return" | "Escape" | "Up" | "Down"): Typed => ({ kind: "key", key: value });

describe("typing ahead: the keys", () => {
  test("a binding is text, one of the launcher's keys, or nothing", () => {
    expect(typedFrom({ key: "t", text: "t" })).toEqual(text("t"));
    expect(typedFrom({ key: "a", text: "A" })).toEqual(text("A"));
    expect(typedFrom({ key: "e", text: "é" })).toEqual(text("é"));
    expect(typedFrom({ key: "Return" })).toEqual(key("Return"));
    expect(typedFrom({ key: "KP_Enter" })).toEqual(key("Return"));
    expect(typedFrom({ key: "BackSpace" })).toEqual(key("BackSpace"));
    expect(typedFrom({ key: "Escape" })).toEqual(key("Escape"));
    expect(typedFrom({ key: "Down" })).toEqual(key("Down"));
    expect(typedFrom({ key: "Tab" })).toBeNull();
    expect(typedFrom({ key: "F5" })).toBeNull();
  });

  test("text and BackSpace edit in order", () => {
    expect(applyEdits("", [text("t"), text("e"), text("x"), key("BackSpace"), text("r")])).toBe("ter");
    expect(applyEdits("ab", [key("BackSpace"), key("BackSpace"), key("BackSpace")])).toBe("");
    expect(applyEdits("caf", [text("é"), key("BackSpace")])).toBe("caf");
  });

  test("the idle keymap types into the launcher from a tap; the keys of the session still come first", () => {
    const idle = withTypeAheadOnTap(KEYMAP);
    // The rules are Dashi's, the launcher's key arming the typing as a tap does.
    expect(idle.rules.map(({ armsAfterTap: _, ...rule }) => rule)).toEqual(KEYMAP.rules);
    expect(idle.rules.filter((rule) => rule.armsAfterTap).map((rule) => rule.bind)).toEqual(["launcher"]);
    expect(idle.rules.find((rule) => rule.when === "super+space")).toEqual({ when: "super+space", bind: "launcher", armsAfterTap: true });
    const after = idle.afterTap ?? [];
    expect(after.slice(0, LAUNCHER_RULES.length)).toEqual(LAUNCHER_RULES);
    expect(after.slice(LAUNCHER_RULES.length, -1)).toEqual(KEYMAP.rules);
    expect(after.at(-1)).toEqual({ when: "*", bind: TYPE_BINDING });
    expect(withTyping(KEYMAP).afterTap).toBeUndefined();
    // Only the idle keymap arms: open, its rules have no afterTap to switch to, so ❖Space just closes it.
    expect(after.some((rule) => rule.armsAfterTap)).toBe(false);
    expect(withTyping(KEYMAP).rules).toEqual(after);
    expect(idleKeymap().afterTap).toBeDefined();
  });
});

describe("typing ahead: the buffer", () => {
  test("the field takes the keyboard only once what was given is played in, and again after a late key", () => {
    const ahead = new TypeAhead();
    let settled = 0;
    ahead.onSettled(() => settled++);
    ahead.subscribe(() => {});
    ahead.begin();
    ahead.push(text("l"));
    ahead.push(text("o"));
    expect(ahead.isSettled()).toBe(false);
    ahead.ready();
    // Given, not yet played in: a key now would reach the field before them.
    expect(ahead.isSettled()).toBe(false);
    expect(settled).toBe(0);
    ahead.drained();
    expect(ahead.isSettled()).toBe(true);
    expect(settled).toBe(1);
    // A key on its way still comes through here; the field waits for it too.
    ahead.push(text("c"));
    expect(ahead.isSettled()).toBe(false);
    ahead.drained();
    expect(settled).toBe(2);
    ahead.end();
    expect(ahead.isSettled()).toBe(false);
  });

  test("nothing typed ahead: settled as soon as it is up", () => {
    const ahead = new TypeAhead();
    let settled = 0;
    ahead.onSettled(() => settled++);
    ahead.begin();
    ahead.ready();
    expect(ahead.isSettled()).toBe(true);
    expect(settled).toBe(1);
  });

  test("keys wait until the launcher is up, then go to it in order; later ones follow", () => {
    const ahead = new TypeAhead();
    const heard: Typed[][] = [];
    ahead.subscribe((keys) => heard.push([...keys]));
    ahead.begin();
    expect(ahead.push(text("t"))).toBe(true);
    expect(ahead.push(text("e"))).toBe(true);
    expect(heard).toEqual([]);
    ahead.ready();
    expect(heard).toEqual([[text("t"), text("e")]]);
    // A key already on its way when the field took the keyboard still arrives, after the others.
    ahead.push(text("r"));
    expect(heard).toEqual([[text("t"), text("e")], [text("r")]]);
    expect(ahead.isWaiting()).toBe(false);
  });

  test("a launcher that subscribes late gets what waited; nothing is lost in between", () => {
    const ahead = new TypeAhead();
    ahead.begin();
    ahead.push(text("f"));
    ahead.ready();
    ahead.push(text("i"));
    const heard: Typed[][] = [];
    ahead.subscribe((keys) => heard.push([...keys]));
    expect(heard).toEqual([[text("f"), text("i")]]);
  });

  test("closed, keys are dropped, and a new opening starts empty", () => {
    const ahead = new TypeAhead();
    const heard: Typed[][] = [];
    ahead.subscribe((keys) => heard.push([...keys]));
    expect(ahead.push(text("x"))).toBe(false);
    ahead.begin();
    ahead.push(text("a"));
    ahead.end();
    ahead.begin();
    ahead.push(text("b"));
    ahead.ready();
    expect(heard).toEqual([[text("b")]]);
    // Ready twice, or after closing, does nothing.
    ahead.ready();
    ahead.end();
    ahead.ready();
    expect(heard).toEqual([[text("b")]]);
  });

  test("unsubscribing a listener that was replaced leaves the new one", () => {
    const ahead = new TypeAhead();
    const first: Typed[][] = [];
    const second: Typed[][] = [];
    const stopFirst = ahead.subscribe((keys) => first.push([...keys]));
    ahead.subscribe((keys) => second.push([...keys]));
    stopFirst();
    ahead.begin();
    ahead.push(text("q"));
    ahead.ready();
    expect(first).toEqual([]);
    expect(second).toEqual([[text("q")]]);
  });
});

describe("typing ahead: the launcher plays the keys in", () => {
  const app = (name: string): Entry => ({ id: `app.${name.toLowerCase()}`, name, icon: "/icon.svg", keywords: [], exec: ["true"] });
  let mounted: NativeRoot | null = null;
  afterEach(() => {
    mounted?.unmount();
    mounted = null;
  });

  function mount(ahead: TypeAhead) {
    const listeners: ((event: NativeEvent) => void)[] = [];
    const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
    const opened: string[] = [];
    const closed: number[] = [];
    const root = render(
      <Launcher
        entries={[app("Terminal"), app("Text Editor"), app("Firefox")]}
        typeAhead={ahead}
        onOpen={(entry) => {
          opened.push(entry.name);
          return true;
        }}
        onClose={() => closed.push(1)}
      />,
      transport,
    );
    mounted = root;
    const field = (): string => {
      const id = root.nodeId("launcher:field");
      const find = (at: unknown): string | null => {
        if (!at || typeof at !== "object") return null;
        const node = at as Record<string, unknown>;
        if ((node.id ?? (node.props as Record<string, unknown> | undefined)?.id) === id) {
          const value = node.value ?? (node.props as Record<string, unknown> | undefined)?.value;
          return typeof value === "string" ? value : null;
        }
        for (const child of Object.values(node)) {
          const found = Array.isArray(child) ? child.map(find).find((each) => each !== null) : find(child);
          if (found) return found;
        }
        return null;
      };
      return find(JSON.parse(root.lastTree() ?? "null")) ?? "";
    };
    return { opened, closed, field };
  }

  test("once it has played the keys in, the launcher says so: the field may take the keyboard", async () => {
    const ahead = new TypeAhead();
    ahead.begin();
    for (const each of [text("l"), text("o"), text("c")]) ahead.push(each);
    const launcher = mount(ahead);
    await settle();
    ahead.ready();
    expect(ahead.isSettled()).toBe(false);
    await settle(50);
    expect(launcher.field()).toBe("loc");
    expect(ahead.isSettled()).toBe(true);
    // One more on its way: played in after the others, and settled again.
    ahead.push(text("k"));
    expect(ahead.isSettled()).toBe(false);
    await settle(50);
    expect(launcher.field()).toBe("lock");
    expect(ahead.isSettled()).toBe(true);
  });

  test("“ter” and Return typed before the field was ready open Terminal", async () => {
    const ahead = new TypeAhead();
    ahead.begin();
    for (const each of [text("t"), text("e"), text("x"), key("BackSpace"), text("r"), key("Return")]) ahead.push(each);
    const launcher = mount(ahead);
    await settle();
    expect(launcher.opened).toEqual([]);
    ahead.ready();
    await settle(50);
    expect(launcher.opened).toEqual(["Terminal"]);
  });

  test("text typed ahead lands in the field; ↓ then Return acts on the rows for that text", async () => {
    const ahead = new TypeAhead();
    const launcher = mount(ahead);
    ahead.begin();
    ahead.push(text("te"));
    ahead.ready();
    await settle(30);
    expect(launcher.field()).toBe("te");
    ahead.push(key("Down"));
    ahead.push(key("Return"));
    await settle(50);
    expect(launcher.opened).toEqual(["Text Editor"]);
  });

  test("Escape typed ahead clears the text, a second closes", async () => {
    const ahead = new TypeAhead();
    const launcher = mount(ahead);
    ahead.begin();
    for (const each of [text("f"), key("Escape"), key("Escape")]) ahead.push(each);
    ahead.ready();
    await settle(50);
    expect(launcher.field()).toBe("");
    expect(launcher.closed).toEqual([1]);
  });
});
