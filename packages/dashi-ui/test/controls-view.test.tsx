import { expect, test } from "bun:test";
import { render, View } from "@mirinjs/metal";
import { useState } from "react";
import { Button } from "../src/button.tsx";
import { ShowStates } from "../src/control-state.tsx";
import { Row } from "../src/controls.tsx";
import { ProgressBar } from "../src/progress.tsx";
import { Slider } from "../src/slider.tsx";
import { Appearance, setAppearanceSource, useColors } from "../src/theme/appearance.ts";
import { darkColors, lightColors } from "../src/theme/palette.ts";
import { fakeClockEachTest, fakeHost, settle } from "./host.ts";
import { noop } from "./support/controls-view.ts";

fakeClockEachTest();

test("a disabled button is the whole button dimmed, and a shown press deepens it", async () => {
  const host = fakeHost();
  const root = render(
    <View>
      <Button label="Save" testID="off" primary disabled onPress={noop} />
      <ShowStates pressed>
        <Button label="Save" testID="held" primary onPress={noop} />
      </ShowStates>
    </View>,
    host.transport,
  );
  await settle();
  expect(host.last()).toContain('"opacity":0.4');
  // Still ink, not gray and not kombu: a disabled primary reads as primary.
  expect(host.last()).toContain(lightColors.primary);
  expect(host.last()).toContain(lightColors.primaryPressed);
  expect(host.last()).not.toContain(lightColors.selection);
  root.unmount();
});

test("Appearance paints its part in the mode it names, whatever Dark Mode is", async () => {
  // Dark Mode off, whatever an earlier test (an applet reading this computer's switch) left.
  setAppearanceSource({ subscribe: () => () => {}, isDark: () => false });
  const host = fakeHost();
  const seen: string[] = [];
  function Probe({ name }: { name: string }) {
    seen.push(`${name}:${useColors().text}`);
    return null;
  }
  const root = render(
    <View>
      <Probe name="window" />
      <Appearance dark>
        <Probe name="dark" />
      </Appearance>
    </View>,
    host.transport,
  );
  await settle();
  expect(seen).toContain(`window:${lightColors.text}`);
  expect(seen).toContain(`dark:${darkColors.text}`);
  root.unmount();
});

test("a progress bar fills to its value; without one it slides", async () => {
  const host = fakeHost();
  const root = render(
    <View>
      <ProgressBar testID="half" value={0.5} width={200} />
      <ProgressBar testID="busy" value={null} width={200} />
    </View>,
    host.transport,
  );
  await settle();
  expect(root.nodeId("half")).toBeDefined();
  expect(host.last()).toContain(lightColors.selection);
  root.unmount();
});

test("a slider follows the drag and commits once, when the button lifts", async () => {
  const host = fakeHost();
  const moves: number[] = [];
  const commits: number[] = [];
  const root = render(
    <Slider testID="s" value={0} range={{ min: 0, max: 100, step: 1 }} width={218} onChange={(v) => moves.push(v)} onCommit={(v) => commits.push(v)} />,
    host.transport,
  );
  await settle();
  const id = root.nodeId("s") as string;
  const bounds = { x: 0, y: 0, width: 218, height: 22 };
  host.emit({ type: "pointer", nodeId: id, phase: "down", x: 9, y: 10, bounds });
  host.emit({ type: "pointer", nodeId: id, phase: "move", x: 109, y: 10, bounds });
  host.emit({ type: "pointer", nodeId: id, phase: "up", x: 209, y: 10, bounds });
  await settle();
  expect(moves).toEqual([0, 50, 100]);
  expect(commits).toEqual([100]);
  root.unmount();
});

test("the arrows step a slider, each press a move and a commit; the click that ends a drag is no step", async () => {
  const host = fakeHost();
  const commits: number[] = [];
  function Level() {
    const [level, setLevel] = useState(50);
    return (
      <Slider
        testID="s"
        value={level}
        range={{ min: 0, max: 100, step: 25 }}
        onCommit={(v) => {
          commits.push(v);
          setLevel(v);
        }}
      />
    );
  }
  const root = render(<Level />, host.transport);
  await settle();
  // The stops are 0, 25, 50, 75, 100; → from 50 presses the next.
  host.emit({ type: "press", nodeId: root.nodeId("s:key:3") as string });
  await settle();
  expect(commits).toEqual([75]);
  host.emit({ type: "press", nodeId: root.nodeId("s:key:3") as string }); // Space on the shown value's stop does nothing.
  await settle();
  expect(commits).toEqual([75]);
  // A drag, then the click it ends with lands on a stop: not a step.
  const bar = root.nodeId("s") as string;
  for (const phase of ["down", "up"] as const) host.emit({ type: "pointer", nodeId: bar, phase, x: 11, y: 10, bounds: { x: 0, y: 0, width: 220, height: 22 } });
  host.emit({ type: "press", nodeId: root.nodeId("s:key:4") as string });
  await settle();
  expect(commits).toEqual([75, 0]);
  root.unmount();
});

test("a row whose value wraps keeps its label on the first line; one line still sits on the middle", async () => {
  const host = fakeHost();
  const root = render(
    <View>
      <Row testID="plain" label="Kind">
        <View />
      </Row>
      <Row testID="long" label="Title" wraps>
        <View />
      </Row>
    </View>,
    host.transport,
  );
  await settle();
  const tree = JSON.parse(host.last()) as { props: Record<string, unknown>; children?: unknown[] };
  const find = (node: { props: Record<string, unknown>; children?: unknown[] }, id: string): Record<string, unknown> | undefined => {
    if (node.props.id === id) return node.props;
    for (const child of node.children ?? []) {
      if (typeof child === "object" && child !== null && "props" in child) {
        const found = find(child as { props: Record<string, unknown>; children?: unknown[] }, id);
        if (found) return found;
      }
    }
    return undefined;
  };
  expect(find(tree, root.nodeId("plain") ?? "")?.align).toBe("center");
  const long = find(tree, root.nodeId("long") ?? "") ?? {};
  expect(long.align).toBe("start");
  // A 21 px line of 13 px text in a 44 row: 11 over it and 12 under, the middle a one-line row has too.
  expect([long.paddingTop, long.paddingBottom, long.minHeight]).toEqual([11, 12, 44]);
  root.unmount();
});
