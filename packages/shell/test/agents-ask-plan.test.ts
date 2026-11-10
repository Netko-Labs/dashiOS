import { expect, test } from "bun:test";
import { describeStep, MAX_STEPS, oneLine, planActions, planTools, resultFor, runnable, settingWords, spokenWords, stepsFrom } from "../src/agents/ask/plan.ts";
import { TOOL_ACTIONS } from "../src/agents/index.ts";

const call = (name: string, input: unknown, id = name) => ({ id, name, input });

test("a plan offers only the tools a person and agents both use: no pictures, pointer, sign-in, or paying", () => {
  const names = planTools(TOOL_ACTIONS).map((tool) => tool.name);
  expect(names).toContain("set_setting");
  expect(names).toContain("create_note");
  for (const agentsOnly of ["screenshot", "click", "type_text", "press_keys", "list_windows"]) expect(names).not.toContain(agentsOnly);
  expect(planActions(TOOL_ACTIONS).every((action) => action.who === "both")).toBe(true);
  const setting = planTools(TOOL_ACTIONS).find((tool) => tool.name === "set_setting");
  expect(setting?.schema).toMatchObject({ type: "object", additionalProperties: false, required: ["name", "value"] });
});

test("steps say what they will do in Dashi's words, from the action and its arguments", () => {
  const steps = stepsFrom(
    [
      call("set_setting", { name: "dark_mode", value: true }),
      call("set_setting", { name: "dock_autohide", value: true }),
      call("create_note", { title: "night setup", body: "", folder: "" }),
      call("set_volume", { target: "output", muted: true }),
    ],
    TOOL_ACTIONS,
  );
  expect(steps.map((step) => step.title)).toEqual(["Turn Dark Mode on", "Hide the Dock automatically", "Add a note “night setup”", "Mute the sound"]);
  expect(steps.map((step) => step.state.kind)).toEqual(["ready", "ready", "ready", "ready"]);
  expect(steps[0]?.scope).toBe("Change settings");
  expect(steps[2]?.scope).toBe("Add to your notes");
});

test("a call with arguments that don't fit, or a tool no plan may use, never runs", () => {
  const steps = stepsFrom([call("set_setting", { name: "dark_mode", value: "very" }), call("screenshot", {}), call("nonsense", { a: 1 })], TOOL_ACTIONS);
  expect(steps.map((step) => step.state.kind)).toEqual(["invalid", "invalid", "invalid"]);
  expect(steps[0]?.state).toEqual({ kind: "invalid", error: "`value` must be true or false." });
  expect(steps[1]?.action).toBeNull();
  expect(runnable(steps)).toEqual([]);
});

test("a step that asks every time says so", () => {
  const [step] = stepsFrom([call("trash_file", { path: "/home/alexk/old.txt" })], TOOL_ACTIONS);
  expect(step?.asks).toBe(true);
  expect(step?.state.kind).toBe("ready");
});

test("a long plan is cut, and a model's words are one short line", () => {
  const calls = Array.from({ length: MAX_STEPS + 5 }, (_, at) => call("lock_screen", {}, `c${at}`));
  expect(stepsFrom(calls, TOOL_ACTIONS)).toHaveLength(MAX_STEPS);
  expect(oneLine("a\nb\u0007c   d")).toBe("a b c d");
  expect(oneLine("x".repeat(100), 10)).toBe(`${"x".repeat(9)}…`);
  const [step] = stepsFrom([call("create_note", { title: `evil\n${"y".repeat(200)}`, body: "", folder: "" })], TOOL_ACTIONS);
  expect(step?.title.includes("\n")).toBe(false);
  expect((step?.title.length ?? 0) < 70).toBe(true);
});

test("settings words for a toggle and a pick, and a fallback for other tools", () => {
  expect(settingWords("night_shift", false)).toBe("Turn Night Shift off");
  expect(settingWords("dock_style", "taskbar")).toBe("Set Dock style to taskbar");
  expect(settingWords("dock_autohide", true)).toBe("Hide the Dock automatically");
  // A name the model made up that is an Object member is no toggle's.
  expect(settingWords("constructor", true)).toBe("Turn constructor on");
  const action = TOOL_ACTIONS.find((each) => each.tool === "set_display_scale");
  if (!action) throw new Error("no set_display_scale");
  expect(describeStep(action, { display: "eDP-1", scale: 1.5 })).toBe("Scale a screen: display “eDP-1”, scale 1.5");
});

test("how each step went, for the model's next turn", () => {
  const [ready, invalid] = stepsFrom([call("lock_screen", {}, "a"), call("set_setting", { name: "x", value: 1 }, "b")], TOOL_ACTIONS);
  if (!ready || !invalid) throw new Error("no steps");
  expect(resultFor(ready)).toEqual({ id: "a", text: "Not run.", error: true });
  expect(resultFor({ ...ready, state: { kind: "done", text: "Locked." } })).toEqual({ id: "a", text: "Locked.", error: false });
  expect(resultFor({ ...ready, state: { kind: "not-allowed" } }).error).toBe(true);
  expect(resultFor(invalid).text.startsWith("Not run: ")).toBe(true);
});

test("under a plan only what the answerer says to the person: its last words on one line, never its tools' chatter", () => {
  // The VM run: a harness's raw output under the plan.
  expect(spokenWords("OpenCode: 29 tools | ok: Planned as step 1; nothing runs until the person presses Return. | ok: Planned as step 2")).toBe("");
  expect(spokenWords("Not planned: `value` must be true or false. Fix the arguments and call it again.")).toBe("");
  expect(spokenWords("Planned as step 1; nothing runs until the person presses Return.\n\nDark Mode goes on, then Notes opens.")).toBe(
    "Dark Mode goes on, then Notes opens.",
  );
  expect(spokenWords("I'll turn Dark Mode on\nand open Notes.")).toBe("I'll turn Dark Mode on and open Notes.");
  expect(spokenWords("I can't do that here.")).toBe("I can't do that here.");
  expect(spokenWords("")).toBe("");
  expect(spokenWords("x".repeat(200))).toHaveLength(140);
  // Words a person would say about tools are not chatter.
  expect(spokenWords("No tool here can book a table.")).toBe("No tool here can book a table.");
});
