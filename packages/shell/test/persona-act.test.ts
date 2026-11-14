/** When Dashi drops the act (src/persona/lib/act.ts): the one rule, what plain is, and that it never widens what a character may do. */

import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PromptStyle } from "../src/agents/index.ts";
import {
  AT_EASE,
  afterFailure,
  type Circumstances,
  charactersDir,
  DASHI,
  dropsAct,
  inCircumstances,
  type PersonaSection,
  plain,
  presetCharacter,
  resolvePersona,
  startPersona,
} from "../src/persona/index.ts";
import { SettingsStore } from "../src/settings-app/index.ts";
import { DEFAULT_PERSONA, type Persona } from "../src/shared/pill/index.ts";

const view = (persona: PersonaSection) => resolvePersona({ persona, voice: {} }, []);
const YUZU: PersonaSection = { name: "Yuzu", character: "yuzu", colour: "#9f2a5f", mark: "drop", dots: "hop", talk: "more", you: "Alex" };

test("the one rule: shared, recorded, a call, full screen, or the first answer after a failure", () => {
  expect(dropsAct(AT_EASE)).toBeNull();
  for (const reason of ["shared", "recording", "call", "fullScreen", "afterFailure"] as const) {
    expect(dropsAct({ ...AT_EASE, [reason]: true })).toBe(reason);
  }
  expect(dropsAct({ ...AT_EASE, fullScreen: true, shared: true })).toBe("shared");
});

test("plain is Dashi's own words, brief, with still dots; the name and the look stay", () => {
  const yuzu = view(YUZU);
  expect(inCircumstances(yuzu, AT_EASE)).toBe(yuzu);
  const worn = inCircumstances(yuzu, { ...AT_EASE, shared: true });
  expect(worn).toEqual(plain(yuzu));
  expect(worn.character.prompt).toEqual(DASHI.prompt);
  expect(worn.talk).toBe("less");
  expect(worn.motion).toBe("still");
  expect([worn.name, worn.hex, worn.mark, worn.dots, worn.you, worn.language]).toEqual([yuzu.name, yuzu.hex, yuzu.mark, yuzu.dots, yuzu.you, yuzu.language]);
  // Its voice by language stays the character's.
  expect(worn.character.voice).toEqual(presetCharacter("yuzu")?.voice ?? DASHI.voice);
});

test("after a failure: plain until a later ask is done", () => {
  const phases = (...list: string[]) => list.map((phase) => ({ phase }));
  expect(afterFailure([])).toBe(false);
  expect(afterFailure(phases("done", "failed"))).toBe(true);
  // The next ask is being answered: this is the first answer after the failure.
  expect(afterFailure(phases("failed", "asking"))).toBe(true);
  expect(afterFailure(phases("failed", "planned"))).toBe(true);
  expect(afterFailure(phases("failed", "running"))).toBe(true);
  expect(afterFailure(phases("failed", "done"))).toBe(false);
  // Stopping is the person's doing, not a failure.
  expect(afterFailure(phases("done", "stopped"))).toBe(false);
});

function running(first: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "dashi-act-"));
  const file = join(home, "settings.json");
  writeFileSync(file, JSON.stringify(first));
  const told: { persona: Persona; style: PromptStyle } = { persona: DEFAULT_PERSONA, style: { full: "", small: "" } };
  const source = startPersona({
    settings: new SettingsStore(file),
    set: (persona) => {
      told.persona = persona;
    },
    style: (style) => {
      told.style = style;
    },
    dir: charactersDir(file),
    lang: "en_US.UTF-8",
    watch: false,
  });
  return { source, told };
}

test("the capsule and the prompt follow the circumstances; the pane still shows what was chosen", () => {
  const { source, told } = running({ persona: YUZU });
  expect(told.persona).toMatchObject({ name: "Yuzu", motion: "bright", talk: "more", dots: "hop" });
  expect(told.style.full).toContain("bright, playful and quick");
  const closing = told.style.full.slice(-40);
  const sharing: Circumstances = { ...AT_EASE, shared: true };
  source.circumstances(sharing);
  expect(told.persona).toMatchObject({ name: "Yuzu", colour: "#9f2a5f", mark: "drop", dots: "hop", motion: "still", talk: "less" });
  expect(told.style.full).not.toContain("playful");
  expect(told.style.full).toContain(DASHI.prompt.en);
  expect(told.style.full).toContain("Say as little as you can");
  expect(told.style.full).toContain("Your name is Yuzu.");
  // Plain changes the middle only: the block ends as it always does.
  expect(told.style.full.slice(-40)).toBe(closing);
  expect(source.view()).toMatchObject({ talk: "more", motion: "bright" });
  expect(source.view().character.id).toBe("yuzu");
  source.circumstances(AT_EASE);
  expect(told.persona).toMatchObject({ motion: "bright", talk: "more" });
  expect(told.style.full).toContain("bright, playful and quick");
  source.stop();
});

test("with nothing chosen there is no act to drop: the prompt stays empty, and only the dots hold still", () => {
  const { source, told } = running({});
  expect(told.persona).toBe(DEFAULT_PERSONA);
  source.circumstances({ ...AT_EASE, recording: true });
  expect(told.persona).toEqual({ ...DEFAULT_PERSONA, motion: "still" });
  expect(told.style).toEqual({ full: "", small: "" });
  source.circumstances(AT_EASE);
  expect(told.persona).toBe(DEFAULT_PERSONA);
  source.stop();
});
