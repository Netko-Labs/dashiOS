/**
 * A tile's page by the keyboard (control-center/page-keys.ts, page-parts.tsx
 * `usePageKeys`): ↑ ↓ move between the page's rows top to bottom as drawn,
 * the header's switch first; Space and Return press the row the ring is on;
 * the ring is the tiles' own.
 */

import { describe, expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render, View } from "@mirinjs/metal";
import { useState } from "react";
import { pageOrder, stepRow } from "../src/control-center/page-keys.ts";
import { PageBody, PageHeader, PageKeysContext, PageRow, usePageKeys } from "../src/control-center/page-parts.tsx";
import { settle } from "./support/time.ts";

describe("pageOrder", () => {
  test("top to bottom as drawn; rows not laid out yet last, in their order", () => {
    expect(
      pageOrder([
        { id: "b", y: 120 },
        { id: "late", y: null },
        { id: "a", y: 60 },
        { id: "later", y: null },
        { id: "switch", y: 10 },
      ]),
    ).toEqual(["switch", "a", "b", "late", "later"]);
  });
});

describe("stepRow", () => {
  const order = ["switch", "home", "cafe", "settings"];
  test("↓ from none is the first row, ↑ the last", () => {
    expect(stepRow(order, null, "down")).toBe("switch");
    expect(stepRow(order, null, "up")).toBe("settings");
  });
  test("one row at a time, stopping at the ends", () => {
    expect(stepRow(order, "home", "down")).toBe("cafe");
    expect(stepRow(order, "home", "up")).toBe("switch");
    expect(stepRow(order, "settings", "down")).toBe("settings");
    expect(stepRow(order, "switch", "up")).toBe("switch");
  });
  test("a row that went: from the start again", () => {
    expect(stepRow(order, "gone", "down")).toBe("switch");
  });
  test("no rows: none", () => {
    expect(stepRow([], null, "down")).toBeNull();
  });
});

describe("a page's rows by the keyboard", () => {
  test("↓ reaches the switch, then each row; Space and Return press; the ring follows", async () => {
    let last = "";
    const listeners: ((event: NativeEvent) => void)[] = [];
    const transport: NativeTransport = {
      send: (frame) => void (last = frame),
      onEvent: (listener) => listeners.push(listener),
      onClose() {},
      simulate() {},
      close() {},
    };
    const pressed: string[] = [];
    function Page() {
      const { pageKeys, pageKey } = usePageKeys("wifi");
      const [radio, setRadio] = useState(true);
      return (
        <View testID="page" onWindowKeyDown={(event) => pageKey(event.key)}>
          <PageKeysContext.Provider value={pageKeys}>
            <PageHeader
              testID="wifi-header"
              title="Wi-Fi"
              on={radio}
              onBack={() => {}}
              toggle={{
                on: radio,
                onChange: (on) => {
                  pressed.push(`radio:${on}`);
                  setRadio(on);
                },
              }}
            />
            <PageBody>
              <PageRow testID="wifi:Home" label="Home" checked />
              <PageRow testID="wifi:Cafe" label="Cafe" onPress={() => pressed.push("Cafe")} />
              <PageRow testID="wifi-settings" label="Wi-Fi Settings…" onPress={() => pressed.push("Settings")} />
            </PageBody>
          </PageKeysContext.Provider>
        </View>
      );
    }
    const root = render(<Page />, transport);
    await settle();
    const emit = (event: NativeEvent) => {
      for (const listener of listeners) listener(event);
    };
    // Laid out top to bottom, the header first (the host reports each row's bounds).
    const rows = ["wifi-header-switch", "wifi:Home", "wifi:Cafe", "wifi-settings"];
    rows.forEach((id, index) => {
      emit({ type: "resize", nodeId: root.nodeId(id) ?? "", bounds: { x: 0, y: 10 + 54 * index, width: 300, height: 48 } });
    });
    await settle();
    const page = root.nodeId("page") ?? "";
    const key = async (name: string) => {
      emit({ type: "windowkey", nodeId: page, key: name, ctrl: false, alt: false, shift: false, meta: false, repeat: false });
      await settle();
    };
    interface Node {
      props?: Record<string, unknown>;
      children?: Node[];
    }
    const holds = (node: Node, id: string): boolean => node.props?.id === id || (node.children ?? []).some((child) => holds(child, id));
    const byId = (node: Node, id: string): Node | null =>
      node.props?.id === id ? node : ((node.children ?? []).map((child) => byId(child, id)).find(Boolean) ?? null);
    /** The row whose view holds the ring. */
    const ringOn = (): string | undefined => {
      const ring = root.nodeId("cc-page-focus-ring");
      if (!ring) return undefined;
      const tree = JSON.parse(last) as Node;
      return rows.find((id) => {
        const row = byId(tree, root.nodeId(id) ?? "");
        return row !== null && holds(row, ring);
      });
    };
    expect(root.nodeId("cc-page-focus-ring")).toBeUndefined();
    await key("down");
    expect(ringOn()).toBe("wifi-header-switch");
    await key("space");
    expect(pressed).toEqual(["radio:false"]);
    await key("down");
    // The network joined: no press of its own, but the ring stands on it.
    expect(ringOn()).toBe("wifi:Home");
    await key("enter");
    expect(pressed).toEqual(["radio:false"]);
    await key("down");
    await key("enter");
    await key("down");
    await key("down");
    await key("space");
    expect(ringOn()).toBe("wifi-settings");
    expect(pressed).toEqual(["radio:false", "Cafe", "Settings"]);
    await key("up");
    expect(ringOn()).toBe("wifi:Cafe");
    root.unmount();
  });
});
