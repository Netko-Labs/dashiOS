import { expect, test } from "bun:test";
import { type NativeEvent, type NativeTransport, render } from "@mirinjs/metal";
import { Field } from "../src/launcher/lib/field.tsx";
import { fitWords, leastRoom, PLACEHOLDER_SLACK, unmeasured } from "../src/launcher/lib/fit-words.ts";
import { settle } from "./support/time.ts";

const CHOICES = ["Reply to Claude Code", "Follow up…"];

test("the fullest placeholder that fits whole, measured; the short one until both sides are known", () => {
  const widths = new Map([["Reply to Claude Code", 160]]);
  const widthOf = (text: string) => widths.get(text);
  expect(fitWords(CHOICES, null, widthOf)).toBe("Follow up…");
  expect(fitWords(CHOICES, 160 + PLACEHOLDER_SLACK, widthOf)).toBe("Reply to Claude Code");
  // A pixel short: never "Reply to Claude Co…", the short words instead.
  expect(fitWords(CHOICES, 160 + PLACEHOLDER_SLACK - 1, widthOf)).toBe("Follow up…");
  expect(fitWords(CHOICES, 500, () => undefined)).toBe("Follow up…");
  expect(fitWords(["Only"], null, widthOf)).toBe("Only");
  expect(unmeasured(CHOICES, widthOf)).toEqual(["Follow up…"]);
  expect(leastRoom(CHOICES, widthOf)).toBe(0);
  expect(leastRoom(CHOICES, (text) => (text === "Follow up…" ? 80.4 : undefined))).toBe(89);
  expect(unmeasured(CHOICES, () => undefined)).toEqual(CHOICES);
});

test("the field measures its room and the words where they are drawn, then shows the fullest that fits", async () => {
  const listeners: ((event: NativeEvent) => void)[] = [];
  const transport: NativeTransport = { send() {}, onEvent: (listener) => listeners.push(listener), onClose() {}, simulate() {}, close() {} };
  const root = render(
    <Field
      value=""
      placeholder={["Reply to Alex Kim's long-named helper", "Follow up…"]}
      hints={[]}
      onChangeText={() => {}}
      onSubmit={() => {}}
      onKey={() => {}}
    />,
    transport,
  );
  const placeholder = (): unknown => {
    const tree = JSON.parse(root.lastTree() ?? "null");
    let found: unknown;
    const walk = (at: unknown): void => {
      if (!at || typeof at !== "object") return;
      const props = (at as { props?: Record<string, unknown> }).props;
      if (props && "placeholder" in props) found = props.placeholder;
      for (const value of Object.values(at)) if (value && typeof value === "object") walk(value);
    };
    walk(tree);
    return found;
  };
  const resize = async (testID: string, width: number): Promise<void> => {
    const nodeId = root.nodeId(testID);
    if (!nodeId) throw new Error(`no node ${testID}`);
    for (const listener of listeners) listener({ type: "resize", nodeId, bounds: { x: 0, y: 0, width, height: 20 } });
    await settle();
  };
  await settle();
  // Nothing measured yet: the short words, which fit at every size.
  expect(placeholder()).toBe("Follow up…");
  await resize("launcher:field-room", 200);
  await resize("launcher:measure:Reply to Alex Kim's long-named helper", 290);
  // Too wide for the room: still the short words, never cut.
  expect(placeholder()).toBe("Follow up…");
  // Measured once, the measuring text goes.
  expect(root.nodeId("launcher:measure:Reply to Alex Kim's long-named helper")).toBeUndefined();
  await resize("launcher:field-room", 400);
  expect(placeholder()).toBe("Reply to Alex Kim's long-named helper");
  root.unmount();
});
