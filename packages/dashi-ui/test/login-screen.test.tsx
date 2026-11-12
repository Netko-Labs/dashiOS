import { expect, test } from "bun:test";
import { render } from "@mirinjs/metal";
import { LoginScreen, type PowerAction } from "../src/login-screen.tsx";
import { fakeHost, settle } from "./host.ts";

interface Node {
  type: string;
  props: Record<string, unknown>;
  children?: unknown[];
}

const isNode = (child: unknown): child is Node => typeof child === "object" && child !== null && "props" in child;

/** The keyboard's stops in a sent tree, in Tab's order: fields and focusable views. */
function stops(tree: Node, out: Node[] = []): Node[] {
  if (tree.type === "input" || tree.props.focusable === true) out.push(tree);
  for (const child of tree.children ?? []) if (isNode(child)) stops(child, out);
  return out;
}

test("Tab reaches Sleep, Restart and Shut Down after the password field, and the keyboard presses them as a click does", async () => {
  const host = fakeHost();
  const asked: PowerAction[] = [];
  const root = render(
    <LoginScreen
      day="Sunday, November 1"
      time="5:04"
      name="Alex Kim"
      value=""
      onChangeText={() => {}}
      onSubmit={() => {}}
      hint=""
      onPower={(what) => asked.push(what)}
    />,
    host.transport,
  );
  await settle();
  const order = stops(JSON.parse(host.last()) as Node);
  expect(order.map((node) => node.type)).toEqual(["input", "view", "view", "view"]);
  expect(order.slice(1).map((node) => node.props.id)).toEqual([root.nodeId("login-sleep"), root.nodeId("login-restart"), root.nodeId("login-shutdown")]);

  // Space or Return on a focused view is a press (Metal sends one): the first arms it, the second does it.
  const shutDown = root.nodeId("login-shutdown") as string;
  host.emit({ type: "press", nodeId: shutDown });
  await settle();
  expect(asked).toEqual([]);
  expect(host.last()).toContain("Click to Shut Down");
  host.emit({ type: "press", nodeId: shutDown });
  await settle();
  expect(asked).toEqual(["shutdown"]);
  root.unmount();
});
