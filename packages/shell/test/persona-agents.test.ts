/**
 * Only the person changes who Dashi is (docs/decisions.md D57). No agent tool writes settings.json's
 * `persona` or the characters folder, and an agent's sandbox has Dashi's folder read-only (it holds
 * both) or not at all.
 */

import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { TOOL_ACTIONS } from "../src/agents/index.ts";
import { sandboxArgs } from "../src/agents/sandbox.ts";
import type { Exists, SandboxEnv } from "../src/agents/sandbox-types.ts";
import { charactersDir, startPersona } from "../src/persona/index.ts";
import { AGENT_ROWS, agentRow, SETTINGS_ROWS } from "../src/settings-app/registry/index.ts";
import { SettingsStore } from "../src/settings-app/store.ts";
import { OFF_LIMITS, resolveForAgent } from "../src/shared/files/agent.ts";
import { DEFAULT_PERSONA, type Persona } from "../src/shared/pill/index.ts";

const env: SandboxEnv = { home: "/home/alexk", runtime: "/run/user/1000", state: "/home/alexk/.local/state", config: "/home/alexk/.config" };

test("every row of Your Dashi is the person's alone: get_settings and set_setting know none of them", () => {
  const rows = SETTINGS_ROWS.filter((row) => row.id.startsWith("persona/"));
  expect(rows.map((row) => row.id)).toEqual([
    "persona/name",
    "persona/character",
    "persona/you",
    "persona/talk",
    "persona/language",
    "persona/voice",
    "persona/colour",
    "persona/mark",
    "persona/note",
    "persona/own",
    "persona/reset",
  ]);
  for (const row of rows) {
    expect(row.agent).toBeUndefined();
    expect(row.value).toBeUndefined();
  }
  expect(AGENT_ROWS.some((row) => row.id.startsWith("persona/") || row.value?.key.startsWith("persona.") || row.value?.key === "voice.voice")).toBe(false);
  const setting = TOOL_ACTIONS.find((action) => action.tool === "set_setting");
  for (const name of ["persona_name", "dashis_name", "name", "character", "persona/name", "persona.character", "dashis_colour", "persona_note"]) {
    expect(agentRow(name)).toBeUndefined();
    expect(setting?.check({ name, value: "Claude" })).toMatchObject({ ok: false });
  }
});

test("no agent tool takes a character's text, a prompt or a file's content to write", () => {
  // The tools that write anything take a note, an event, a setting by name, typed keys or a path to move to the Trash: none names the persona.
  for (const action of TOOL_ACTIONS) {
    const told = JSON.stringify([action.tool, action.title]).toLowerCase();
    expect(told.includes("persona") || told.includes("character file") || told.includes("system prompt")).toBe(false);
  }
});

test("an agent's sandbox has Dashi's folder read-only: settings.json and the characters folder are inside it", () => {
  const characters = charactersDir(join(env.config, "dashi", "settings.json"));
  expect(dirname(characters)).toBe(join(env.config, "dashi"));
  const exists: Exists = (path) => (path.endsWith(".sock") ? "file" : "dir");
  const args = sandboxArgs(["claude"], { env, exists, bwrap: "/usr/bin/bwrap", unit: "dashi-agent-x-1.scope", bus: null });
  const at = args.findIndex((arg, index) => arg === "--ro-bind" && args[index + 1] === join(env.config, "dashi"));
  expect(at).toBeGreaterThan(-1);
  // Nothing after it binds the folder, or anything inside it, back for writing.
  for (let index = 0; index < args.length; index++) {
    if (args[index] === "--bind" || args[index] === "--dev-bind") expect(String(args[index + 1]).startsWith(join(env.config, "dashi"))).toBe(false);
  }
  // A harness in plan mode, and a task, get an empty home folder: Dashi's folder is not there at all.
  const plan = sandboxArgs(["claude"], {
    env,
    exists,
    bwrap: "/usr/bin/bwrap",
    unit: "dashi-agent-plan-1.scope",
    bus: null,
    plan: { socket: "/run/user/1000/dashi-plan/x.sock", readOnly: [], state: ["/home/alexk/.claude"], cwd: "/run/user/1000/dashi-launcher" },
  });
  expect(plan.some((arg, index) => arg === "--tmpfs" && plan[index + 1] === env.home)).toBe(true);
  expect(plan.some((arg) => arg.startsWith(join(env.config, "dashi")))).toBe(false);
});

test("the files tools never reach Dashi's folder, and the shell makes it at start so the sandbox always finds it", async () => {
  expect(OFF_LIMITS).toContain(".config/dashi");
  const home = mkdtempSync(join(tmpdir(), "dashi-persona-home-"));
  const settingsFile = join(home, ".config", "dashi", "settings.json");
  const hub: Persona[] = [];
  const source = startPersona({
    settings: new SettingsStore(settingsFile),
    set: (persona) => hub.push(persona),
    style: () => {},
    dir: charactersDir(settingsFile),
    watch: false,
  });
  expect(hub).toEqual([DEFAULT_PERSONA]);
  const refused = await resolveForAgent(join(home, ".config", "dashi"), { home, user: "alexk", userDirs: [] });
  expect(refused).toMatchObject({ ok: false });
  expect(await resolveForAgent(join(home, ".config", "dashi", "characters", "x.json"), { home, user: "alexk", userDirs: [] })).toMatchObject({ ok: false });
  source.stop();
});
