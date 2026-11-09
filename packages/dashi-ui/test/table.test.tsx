import { describe, expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { useState } from "react";
import { STEADY_MS, Table } from "../src/table.tsx";
import { holdOrder } from "../src/table-sort.ts";
import { fakeHost, settle } from "./host.ts";

describe("holding a table's order", () => {
  const key = (row: { pid: number }): number => row.pid;
  const rows = (...pids: number[]) => pids.map((pid) => ({ pid }));

  test("rows keep the places they were drawn in, whatever the new sort says", () => {
    expect(holdOrder([1, 2, 3], rows(3, 1, 2), key).map(key)).toEqual([1, 2, 3]);
  });

  test("a row that is gone drops out, and a new one goes after the row it follows in the new order", () => {
    expect(holdOrder([1, 2, 3], rows(4, 3, 1, 5), key).map(key)).toEqual([4, 1, 5, 3]);
    expect(holdOrder([], rows(2, 1), key).map(key)).toEqual([2, 1]);
  });

  test("an app expanded while the order is held shows its processes under it, not at the end", () => {
    // Apps 10, 20, 30 held as drawn (30 first); 20 expands into 21 and 22, and the sort now says 10, 20, 21, 22, 30.
    expect(holdOrder([30, 10, 20], rows(10, 20, 21, 22, 30), key).map(key)).toEqual([30, 10, 20, 21, 22]);
    expect(holdOrder([30, 20, 10], rows(10, 20, 21, 22, 30), key).map(key)).toEqual([30, 20, 21, 22, 10]);
  });
});

interface Proc {
  pid: number;
  cpu: number;
}

const COLUMNS = [{ key: "cpu", title: "% CPU", text: (row: Proc) => String(row.cpu) }];

test("a steady table holds its rows while the pointer aims and while a row is held, then re-sorts", async () => {
  const host = fakeHost();
  let setRows: (rows: Proc[]) => void = () => {};
  function Live() {
    const [rows, set] = useState<Proc[]>([
      { pid: 10, cpu: 9 },
      { pid: 20, cpu: 5 },
      { pid: 30, cpu: 1 },
    ]);
    setRows = set;
    return (
      <Table testID="t" columns={COLUMNS} rows={rows} rowKey={(row) => row.pid} selected={null} onSelect={() => {}} sort={null} onSort={() => {}} steady />
    );
  }
  const root = render(<Live />, host.transport);
  await settle();
  const node = (testID: string): string => root.nodeId(testID) ?? "";
  /** The pids in the order the rows were last drawn. */
  const order = (): number[] => {
    const tree = host.last();
    return [10, 20, 30]
      .map((pid) => ({ pid, at: tree.indexOf(`"id":"${node(`t:row:${pid}`)}"`) }))
      .sort((a, b) => a.at - b.at)
      .map(({ pid }) => pid);
  };
  expect(order()).toEqual([10, 20, 30]);

  // The pointer crosses onto 20; the next sample re-sorts, but nothing moves under it.
  host.emit({ type: "hover", nodeId: node("t:row:20"), hovered: true });
  setRows([
    { pid: 30, cpu: 9 },
    { pid: 10, cpu: 5 },
    { pid: 20, cpu: 1 },
  ]);
  await settle();
  expect(order()).toEqual([10, 20, 30]);

  // Held down past the wait, still put; let go, and the sort shows once the wait is over.
  host.emit({ type: "pointer", nodeId: node("t:row:20"), phase: "down", x: 5, y: 5 });
  await settle(STEADY_MS + 50);
  expect(order()).toEqual([10, 20, 30]);
  host.emit({ type: "pointer", nodeId: node("t:row:20"), phase: "up", x: 5, y: 5 });
  await settle(STEADY_MS + 50);
  expect(order()).toEqual([30, 10, 20]);
  root.unmount();
});

test("a table that isn't steady follows its rows at once", async () => {
  const host = fakeHost();
  let setRows: (rows: Proc[]) => void = () => {};
  function Live() {
    const [rows, set] = useState<Proc[]>([
      { pid: 1, cpu: 2 },
      { pid: 2, cpu: 1 },
    ]);
    setRows = set;
    return <Table testID="t" columns={COLUMNS} rows={rows} rowKey={(row) => row.pid} selected={null} onSelect={() => {}} sort={null} onSort={() => {}} />;
  }
  const root = render(<Live />, host.transport);
  await settle();
  const id = (pid: number): string => `"id":"${root.nodeId(`t:row:${pid}`)}"`;
  host.emit({ type: "hover", nodeId: root.nodeId("t:row:1") ?? "", hovered: true });
  setRows([
    { pid: 2, cpu: 2 },
    { pid: 1, cpu: 1 },
  ]);
  await settle();
  expect(host.last().indexOf(id(2))).toBeLessThan(host.last().indexOf(id(1)));
  root.unmount();
});

test("a steady table holds still while the pointer is over the list and just after a row is chosen; a sort shows at once", async () => {
  const host = fakeHost();
  let setRows: (rows: Proc[]) => void = () => {};
  let choose: (pid: number | null) => void = () => {};
  let sorted = 0;
  function Live() {
    const [rows, set] = useState<Proc[]>([
      { pid: 10, cpu: 9 },
      { pid: 20, cpu: 5 },
      { pid: 30, cpu: 1 },
    ]);
    const [selected, setSelected] = useState<number | null>(null);
    setRows = set;
    choose = setSelected;
    return (
      <Table
        testID="t"
        columns={COLUMNS}
        rows={rows}
        rowKey={(row) => row.pid}
        selected={selected}
        onSelect={() => {}}
        sort={null}
        onSort={() => sorted++}
        steady
      />
    );
  }
  const root = render(<Live />, host.transport);
  await settle();
  const node = (testID: string): string => root.nodeId(testID) ?? "";
  const order = (): number[] => {
    const tree = host.last();
    return [10, 20, 30]
      .map((pid) => ({ pid, at: tree.indexOf(`"id":"${node(`t:row:${pid}`)}"`) }))
      .sort((a, b) => a.at - b.at)
      .map(({ pid }) => pid);
  };

  // Over the list, longer than a crossing's wait: still put.
  host.emit({ type: "hover", nodeId: node("t:rows"), hovered: true });
  setRows([
    { pid: 30, cpu: 9 },
    { pid: 10, cpu: 5 },
    { pid: 20, cpu: 1 },
  ]);
  await settle(STEADY_MS + 50);
  expect(order()).toEqual([10, 20, 30]);
  // Off the list: the sort shows once the wait is over.
  host.emit({ type: "hover", nodeId: node("t:rows"), hovered: false });
  await settle(STEADY_MS + 50);
  expect(order()).toEqual([30, 10, 20]);

  // A row chosen (by the keyboard, say): the next sample doesn't move it.
  choose(10);
  await settle();
  setRows([
    { pid: 20, cpu: 9 },
    { pid: 30, cpu: 5 },
    { pid: 10, cpu: 1 },
  ]);
  await settle(STEADY_MS + 50);
  expect(order()).toEqual([30, 10, 20]);

  // A click on a column's title sorts now.
  host.emit({ type: "press", nodeId: node("t:sort:cpu") });
  await settle();
  expect(sorted).toBe(1);
  expect(order()).toEqual([20, 30, 10]);
  root.unmount();
});

test("a steady table shows a sort the app asks for at once, though the pointer is over the list", async () => {
  // Activity Monitor's tabs: ❖2 changes the sort from % CPU to Memory while the pointer rests on the rows.
  const host = fakeHost();
  let switchTab: () => void = () => {};
  const byCpu = [
    { pid: 10, cpu: 9 },
    { pid: 20, cpu: 5 },
    { pid: 30, cpu: 1 },
  ];
  const byMemory = [byCpu[2], byCpu[0], byCpu[1]] as Proc[];
  function Live() {
    const [memory, setMemory] = useState(false);
    switchTab = () => setMemory(true);
    return (
      <Table
        testID="t"
        columns={COLUMNS}
        rows={memory ? byMemory : byCpu}
        rowKey={(row) => row.pid}
        selected={null}
        onSelect={() => {}}
        sort={{ key: memory ? "memory" : "cpu", ascending: false }}
        onSort={() => {}}
        steady
      />
    );
  }
  const root = render(<Live />, host.transport);
  await settle();
  const node = (testID: string): string => root.nodeId(testID) ?? "";
  const order = (): number[] => {
    const tree = host.last();
    return [10, 20, 30]
      .map((pid) => ({ pid, at: tree.indexOf(`"id":"${node(`t:row:${pid}`)}"`) }))
      .sort((a, b) => a.at - b.at)
      .map(({ pid }) => pid);
  };
  host.emit({ type: "hover", nodeId: node("t:rows"), hovered: true });
  await settle();
  switchTab();
  await settle();
  expect(order()).toEqual([30, 10, 20]);
  root.unmount();
});

interface Drawn {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}
const isDrawn = (child: unknown): child is Drawn => typeof child === "object" && child !== null && "props" in child;
function findDrawn(node: Drawn, id: string): Drawn | undefined {
  if (node.props.id === id) return node;
  return (node.children ?? []).map((child) => (isDrawn(child) ? findDrawn(child, id) : undefined)).find(Boolean);
}

test("a right-aligned column's title ends on its figures' edge, its sort arrow before it; the list ends with an inset", async () => {
  const host = fakeHost();
  const columns = [
    { key: "name", title: "Name", text: (row: Proc) => String(row.pid) },
    { key: "cpu", title: "Size", width: 88, align: "right" as const, text: (row: Proc) => String(row.cpu) },
  ];
  const root = render(
    <Table
      testID="t"
      columns={columns}
      rows={[{ pid: 1, cpu: 2 }]}
      rowKey={(row) => row.pid}
      selected={null}
      onSelect={() => {}}
      sort={{ key: "cpu", ascending: true }}
      onSort={() => {}}
    />,
    host.transport,
  );
  await settle();
  const tree = JSON.parse(host.last()) as Drawn;
  const header = findDrawn(tree, root.nodeId("t:sort:cpu") ?? "");
  const kids = (header?.children ?? []).filter(isDrawn);
  expect(kids.map((kid) => kid.type)).toEqual(["svg", "text"]);
  // A bare title: not one that fills the cell (which would sit at its left).
  expect(kids[1]?.props.truncate).toBeUndefined();
  expect(header?.props.justify).toBe("end");
  const name = findDrawn(tree, root.nodeId("t:sort:name") ?? "");
  expect((name?.children ?? []).filter(isDrawn).map((kid) => kid.type)).toEqual(["text"]);
  expect(findDrawn(tree, root.nodeId("t:rows") ?? "")?.props.paddingBottom).toBe(8);
  root.unmount();
});

test("a header title starts on its values' edge: a divider takes its 1 from the cell's padding", async () => {
  const host = fakeHost();
  const columns = [
    { key: "name", title: "Name", text: (row: Proc) => String(row.pid) },
    { key: "when", title: "Date Modified", width: 150, text: (row: Proc) => String(row.cpu) },
  ];
  const root = render(
    <Table
      testID="t"
      columns={columns}
      rows={[{ pid: 1, cpu: 2 }]}
      rowKey={(row) => row.pid}
      selected={null}
      onSelect={() => {}}
      sort={null}
      onSort={() => {}}
    />,
    host.transport,
  );
  await settle();
  const tree = JSON.parse(host.last()) as Drawn;
  const inset = (id: string): number => {
    const props = findDrawn(tree, root.nodeId(id) ?? "")?.props ?? {};
    return Number(props.paddingLeft ?? props.paddingX ?? 0) + Number(props.borderLeft ?? 0);
  };
  // The body's cells are inset PAD / 2 (5); so is every title, the divider included.
  expect(inset("t:sort:name")).toBe(5);
  expect(inset("t:sort:when")).toBe(5);
  root.unmount();
});
