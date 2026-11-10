import { afterAll, beforeAll, expect, test } from "bun:test";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startEngine } from "../apps/terminal/engine.ts";
import type { EngineMessage } from "../apps/terminal/screen.ts";
import { fakeClock, until } from "./support/time.ts";

// A stand-in for dashi-term: it answers `running` with what it is told to,
// stays silent when told "mute", and echoes `colors` back as a title.
const FAKE = `#!/usr/bin/env bun
let answer = null;
let mute = false;
for await (const line of console) {
  if (!line) continue;
  const input = JSON.parse(line);
  if (input.t === "paste") {
    if (input.text === "mute") mute = true;
    else answer = input.text === "" ? null : input.text;
  } else if (input.t === "running" && !mute) console.log(JSON.stringify({ t: "running", program: answer }));
  else if (input.t === "colors") console.log(JSON.stringify({ t: "title", title: input.palette.length + " " + input.bg }));
}
`;

let dir = "";
let binary = "";
beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "dashi-term-fake-"));
  binary = join(dir, "dashi-term");
  writeFileSync(binary, FAKE);
  chmodSync(binary, 0o755);
});
afterAll(() => rmSync(dir, { recursive: true, force: true }));

test("running answers in order: null at the prompt, the program's name past it; colors go to the engine", async () => {
  const heard: EngineMessage[] = [];
  const engine = startEngine(binary, { cols: 80, rows: 24 }, (message) => heard.push(message));
  engine.send({ t: "colors", fg: "#1d1d1f", bg: "#fbfaf7", palette: Array.from({ length: 16 }, () => "#000000") });
  expect(await engine.running()).toBeNull();
  engine.send({ t: "paste", text: "sleep" });
  const [first, second] = await Promise.all([engine.running(), engine.running()]);
  expect([first, second]).toEqual(["sleep", "sleep"]);
  // The answers are the engine's business; they never reach the view.
  expect(heard).toEqual([{ t: "title", title: "16 #fbfaf7" }]);
  engine.stop();
  expect(await engine.running()).toBeNull();
});

test("an engine that does not answer in time counts as nothing running", async () => {
  const heard: EngineMessage[] = [];
  const engine = startEngine(binary, { cols: 80, rows: 24 }, (message) => heard.push(message));
  engine.send({ t: "colors", fg: "#1d1d1f", bg: "#fbfaf7", palette: [] });
  await until(() => heard.length > 0, "the engine to start");
  engine.send({ t: "paste", text: "vim" });
  engine.send({ t: "paste", text: "mute" });
  const clock = fakeClock();
  const asked = engine.running();
  // The engine never answers: the wait ends on its own, with the clock moved past it.
  await clock.advance(1000);
  expect(await asked).toBeNull();
  clock.restore();
  engine.stop();
});
