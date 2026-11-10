import { expect, test } from "bun:test";
import type { NativeEvent } from "@mirinjs/metal";
import { accessHeight, askOnScreen } from "../apps/portal/access.tsx";
import { appInfo } from "../apps/portal/apps.ts";
import { printOnScreen } from "../apps/portal/print/sheet.tsx";
import { showHere } from "./support/portal-sheets.ts";
import { fakeClockEachTest, settle } from "./support/time.ts";

fakeClockEachTest();

/** A key the window got, as Metal hands it to a KeySink (`onWindowKeyDown`). */
const windowKey = (nodeId: string, key: string): NativeEvent => ({
  type: "windowkey",
  nodeId,
  key,
  ctrl: false,
  alt: false,
  shift: false,
  meta: false,
  repeat: false,
});

test("an access sheet: Enter never grants; Esc says no; only a click on Allow allows", async () => {
  const { show, mounted } = showHere();
  const opened: string[] = [];
  const ask = askOnScreen(show, async (url) => {
    opened.push(url);
    return { ok: true, text: "" };
  });
  const request = {
    appId: "org.example.Camera",
    parent: "",
    title: "Use the camera?",
    subtitle: "",
    body: "",
    grantLabel: "Allow",
    denyLabel: "Don’t Allow",
    icon: "camera-web-symbolic",
    choices: [],
  };
  let answer: unknown = "pending";
  void ask(request, new AbortController().signal).then((value) => {
    answer = value;
  });
  await settle();
  const sheet = mounted();
  // The line under the question, and the way to where the answer can be taken back: a pane that exists.
  expect(sheet.root.lastTree()).toContain("Dashi remembers your answer");
  expect(sheet.root.lastTree()).toContain("Privacy…");
  sheet.send({ type: "press", nodeId: sheet.node("access:privacy") });
  await settle();
  expect(opened).toEqual(["dashi://settings/privacy/apps"]);
  expect(answer).toBe("pending");
  sheet.send(windowKey(sheet.node("portal:keys"), "enter"));
  await settle();
  expect(answer).toBe("pending");
  sheet.send({ type: "press", nodeId: sheet.node("access:grant") });
  await settle();
  expect(answer).toEqual({ granted: true, choices: [] });

  const again = showHere();
  let second: unknown = "pending";
  void askOnScreen(again.show)(request, new AbortController().signal).then((value) => {
    second = value;
  });
  await settle();
  again.mounted().send(windowKey(again.mounted().node("portal:keys"), "escape"));
  await settle();
  expect(second).toEqual({ granted: false, choices: [] });
});

test("an access sheet opens as tall as its alert, check boxes and all", () => {
  const request = {
    appId: "org.example.Camera",
    parent: "",
    title: "Use the camera?",
    subtitle: "",
    body: "",
    grantLabel: "Allow",
    denyLabel: "Don’t Allow",
    icon: "camera-web-symbolic",
    choices: [],
  };
  const app = appInfo(request.appId);
  // The controls' strip and 6, the 40 px tile beside the question and its line, 10 and 6, the 28 px buttons, 18.
  expect(accessHeight(request, app)).toBe(146);
  const boxes = [
    { id: "a", label: "Remember", options: [], initial: "true" },
    { id: "b", label: "Also the microphone", options: [], initial: "false" },
  ];
  // Two check boxes, 16 each and 8 apart, 6 under the line: the words outgrow the tile.
  expect(accessHeight({ ...request, choices: boxes }, app)).toBe(38 + 6 + (17 + 4 + 16 + 4 + 6 + 40) + 10 + 6 + 28 + 18);
});

test("the print sheet: Copies keeps what is typed, Enter prints from the field, Esc cancels", async () => {
  const printer = {
    name: "Office",
    label: "Office",
    location: "",
    state: "idle" as const,
    accepting: true,
    color: false,
    sides: [],
    media: [],
    mediaDefault: null,
  };
  const start = { printer: "Office", pdfPath: null, copies: 1, pages: "", twoSided: false, color: false, media: null };
  const request = { appId: "org.example.App", parent: "", title: "Lease", printers: [printer], start, pages: 3 };
  const run = async () => {
    const { show, mounted } = showHere();
    let answer: unknown = "pending";
    void printOnScreen(show, async () => null)
      .ask(request, new AbortController().signal)
      .then((value) => {
        answer = value;
      });
    await settle();
    return { sheet: mounted(), answer: () => answer };
  };

  const first = await run();
  const copies = first.sheet.node("print:copies");
  first.sheet.send({ type: "change", nodeId: copies, value: "" });
  await settle();
  // Cleared, it stays cleared (no snapping back to 1), and Print waits.
  expect(first.sheet.root.lastTree()).toContain("A number from 1 to 999");
  first.sheet.send({ type: "submit", nodeId: copies, value: "" });
  await settle();
  expect(first.answer()).toBe("pending");
  first.sheet.send({ type: "change", nodeId: copies, value: "2" });
  await settle();
  first.sheet.send({ type: "submit", nodeId: copies, value: "2" });
  await settle();
  expect(first.answer()).toMatchObject({ kind: "print", choice: { copies: 2, printer: "Office" } });

  // Enter with nothing focused prints too; Esc in a field cancels.
  const second = await run();
  second.sheet.send(windowKey(second.sheet.node("portal:keys"), "enter"));
  await settle();
  expect(second.answer()).toMatchObject({ kind: "print", choice: { copies: 1 } });
  const third = await run();
  third.sheet.send({ type: "key", nodeId: third.sheet.node("print:copies"), value: "Escape" });
  await settle();
  expect(third.answer()).toBeNull();
});
