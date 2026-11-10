import { describe, expect, test } from "bun:test";
import { Variant } from "../src/shared/dbus/variant.ts";
import { type LayoutNode, lazySubmenus, menuRows, parseLayoutReply, parseNode, parseRowId, stripMnemonic } from "../src/tray/dbusmenu.ts";

type Props = Record<string, Variant>;

/** A `(ia{sv}av)` node as GetLayout sends it: children wrapped in variants. */
function node(id: number, properties: Props = {}, children: unknown[] = []): unknown[] {
  return [id, new Map(Object.entries(properties)), children.map((child) => new Variant("(ia{sv}av)", child))];
}

const label = (text: string) => ({ label: new Variant("s", text) });

function root(...children: unknown[]): LayoutNode {
  const parsed = parseLayoutReply([7, node(0, { "children-display": new Variant("s", "submenu") }, children)]);
  if (!parsed) throw new Error("did not parse");
  return parsed;
}

describe("stripMnemonic", () => {
  test("drops the mark and keeps a doubled underscore as one", () => {
    expect(stripMnemonic("_File")).toBe("File");
    expect(stripMnemonic("Save _As…")).toBe("Save As…");
    expect(stripMnemonic("snake__case")).toBe("snake_case");
    expect(stripMnemonic("__init__")).toBe("_init_");
    expect(stripMnemonic("Plain")).toBe("Plain");
  });
});

describe("menuRows", () => {
  test("reads items, labels without mnemonics, and enabled by default", () => {
    expect(menuRows(root(node(1, label("_Open")), node(2, { ...label("_Quit"), enabled: new Variant("b", false) })))).toEqual([
      { kind: "item", id: "1", label: "Open", enabled: true },
      { kind: "item", id: "2", label: "Quit", enabled: false },
    ]);
  });

  test("leaves out invisible items, and separators that would lead, trail, or double", () => {
    const rows = menuRows(
      root(
        node(1, { type: new Variant("s", "separator") }),
        node(2, label("Show")),
        node(3, { type: new Variant("s", "separator") }),
        node(4, { ...label("Hidden"), visible: new Variant("b", false) }),
        node(5, { type: new Variant("s", "separator") }),
        node(6, label("Quit")),
        node(7, { type: new Variant("s", "separator") }),
      ),
    );
    expect(rows).toEqual([
      { kind: "item", id: "2", label: "Show", enabled: true },
      { kind: "separator" },
      { kind: "item", id: "6", label: "Quit", enabled: true },
    ]);
  });

  test("checkmarks and radio items carry their state; plain items have no check gutter", () => {
    const rows = menuRows(
      root(
        node(1, { ...label("Mute"), "toggle-type": new Variant("s", "checkmark"), "toggle-state": new Variant("i", 1) }),
        node(2, { ...label("Low"), "toggle-type": new Variant("s", "radio"), "toggle-state": new Variant("i", 0) }),
        node(3, { ...label("Odd"), "toggle-type": new Variant("s", "checkmark"), "toggle-state": new Variant("i", -1) }),
        node(4, { ...label("Plain"), "toggle-state": new Variant("i", 1) }),
      ),
    );
    expect(rows.map((row) => (row.kind === "item" ? row.checked : "separator"))).toEqual([true, false, false, undefined]);
    expect(rows[3] && "checked" in rows[3]).toBe(false);
  });

  test("flattens submenus under a heading, indented one level per submenu", () => {
    const submenu = { "children-display": new Variant("s", "submenu") };
    const rows = menuRows(
      root(
        node(1, label("Status")),
        node(2, { ...label("_Accounts"), ...submenu }, [node(3, label("Work")), node(4, { ...label("More"), ...submenu }, [node(5, label("Old"))])]),
        node(6, { ...label("Empty"), ...submenu }, [node(7, { ...label("Gone"), visible: new Variant("b", false) })]),
        node(8, label("Quit")),
      ),
    );
    expect(rows).toEqual([
      { kind: "item", id: "1", label: "Status", enabled: true },
      { kind: "item", id: "2", label: "Accounts", enabled: false, heading: true },
      { kind: "item", id: "3", label: "Work", enabled: true, depth: 1 },
      { kind: "item", id: "4", label: "More", enabled: false, heading: true, depth: 1 },
      { kind: "item", id: "5", label: "Old", enabled: true, depth: 2 },
      { kind: "item", id: "8", label: "Quit", enabled: true },
    ]);
  });

  test("cleans labels of control characters", () => {
    expect(menuRows(root(node(1, label("Line\nbreak\u0007")))).at(0)).toMatchObject({ label: "Line break" });
  });
});

describe("parsing the layout", () => {
  test("skips nodes that are not (ia{sv}av), keeping their siblings", () => {
    const parsed = parseNode([0, new Map(), [new Variant("s", "junk"), new Variant("(ia{sv}av)", node(1, label("Kept"))), [-1, new Map(), []]]]);
    expect(parsed?.children.map((child) => child.id)).toEqual([1]);
  });

  test("is null for a reply that is not a layout", () => {
    expect(parseLayoutReply([1, "nope"])).toBeNull();
    expect(parseLayoutReply([])).toBeNull();
    expect(parseNode([1, "props", []])).toBeNull();
  });

  test("finds submenus that are filled when they are about to show", () => {
    const submenu = { "children-display": new Variant("s", "submenu") };
    const tree = root(node(1, { ...label("Lazy"), ...submenu }), node(2, { ...label("Full"), ...submenu }, [node(3, label("x"))]), node(4, label("Leaf")));
    expect(lazySubmenus(tree)).toEqual([1]);
  });
});

describe("parseRowId", () => {
  test("reads the ids rows carry, and nothing else", () => {
    expect(parseRowId("42")).toBe(42);
    expect(parseRowId("0")).toBe(0);
    expect(parseRowId("-1")).toBeNull();
    expect(parseRowId("1e3")).toBeNull();
    expect(parseRowId("9999999999")).toBeNull();
    expect(parseRowId("")).toBeNull();
  });
});
