import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { scratchDir } from "../src/agents/lib/scratch.ts";

test("an agent's pictures wait in a folder only the person can reach", () => {
  const runtime = mkdtempSync(join(tmpdir(), "dashi-scratch-"));
  try {
    const dir = scratchDir({ XDG_RUNTIME_DIR: runtime });
    expect(dir).toBe(join(runtime, "dashi-agents"));
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    // With no runtime folder: one of its own, never the fixed path another account could have made first.
    const own = scratchDir({ TMPDIR: runtime });
    expect(dirname(own)).toBe(runtime);
    expect(own).not.toBe(join(runtime, "dashi-agents"));
    expect(statSync(own).mode & 0o777).toBe(0o700);
    expect(scratchDir({ TMPDIR: runtime })).toBe(own);
  } finally {
    rmSync(runtime, { recursive: true, force: true });
  }
});
