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

  test("a row that is gone drops out, and a new one follows in its own order", () => {
    expect(holdOrder([1, 2, 3], rows(4, 3, 1, 5), key).map(key)).toEqual([1, 3, 4, 5]);
    expect(holdOrder([], rows(2, 1), key).map(key)).toEqual([2, 1]);
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
