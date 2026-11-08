import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { CLAUDE_CODE_GLYPH, CODEX_GLYPH, harnessGlyph, harnessIconName, OPENCODE_GLYPH } from "../src/agents/handoff/harness-icons.ts";
import { endedNotice } from "../src/agents/handoff/notices.ts";
import { AgentRuns } from "../src/agents/handoff/store.ts";
import { markState, mergeAgents } from "../src/agents/mark.ts";
import { iconPath } from "../src/apps.ts";
import { handoffRow, runRow } from "../src/launcher/agents/handoff-rows.ts";
import { SPARKLE } from "../src/settings-app/glyphs.ts";

describe("each harness's own mark", () => {
  test("Claude Code, Codex and OpenCode each have theirs; anything else is the agents' sparkle", () => {
    expect(harnessGlyph("claude-code")).toBe(CLAUDE_CODE_GLYPH);
    expect(harnessGlyph("codex")).toBe(CODEX_GLYPH);
    expect(harnessGlyph("opencode")).toBe(OPENCODE_GLYPH);
    expect(new Set([CLAUDE_CODE_GLYPH, CODEX_GLYPH, OPENCODE_GLYPH, SPARKLE]).size).toBe(4);
    for (const unknown of ["gemini", "", null, undefined, "constructor", "__proto__"]) expect(harnessGlyph(unknown)).toBe(SPARKLE);
  });

  test("one color, tinted like every glyph: drawn in black on the 16 grid, no other color", () => {
    for (const glyph of [CLAUDE_CODE_GLYPH, CODEX_GLYPH, OPENCODE_GLYPH]) {
      expect(glyph).toContain('viewBox="0 0 16 16"');
      const colors = new Set(glyph.match(/#[0-9a-fA-F]{3,8}\b/g));
      expect([...colors]).toEqual(["#000"]);
    }
  });

  test("the notification's icon: the mark on a shiso tile in shell/icons/, else the agents' tile", () => {
    expect(harnessIconName("claude-code")).toBe("claude-code");
    expect(harnessIconName("codex")).toBe("codex");
    expect(harnessIconName("opencode")).toBe("opencode");
    expect(harnessIconName("gemini")).toBe("agents");
    for (const name of ["claude-code", "codex", "opencode", "agents"]) {
      expect(existsSync(iconPath(name))).toBe(true);
      expect(readFileSync(iconPath(name), "utf8")).toContain('rx="10.5"');
    }
  });

  test("the rows, the mark and the done notification show the run's harness", () => {
    const runs = new AgentRuns();
    runs.start({ id: "run1", request: "Book a class", harness: "codex", harnessName: "Codex" });
    const run = runs.get("run1");
    if (!run) throw new Error("no run");
    expect(runRow(run).icon).toEqual({ glyph: CODEX_GLYPH });
    expect(handoffRow({ id: "opencode", name: "OpenCode", uses: "", signedIn: true }, 0, "book a class").icon).toEqual({ glyph: OPENCODE_GLYPH });
    expect(markState(mergeAgents([], runs.getSnapshot()))).toMatchObject({ discs: ["codex"] });
    runs.event("run1", { kind: "done", text: "Booked it" });
    expect(endedNotice(runs.get("run1") ?? run)?.appIcon).toBe(iconPath("codex"));
  });
});
