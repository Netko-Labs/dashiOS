/**
 * What the packages ship: the privileged helpers' systemd sandboxes
 * (scripts/check-units.ts), the generated license notices (spin/license-dependencies),
 * and a %license in every spec. The first two need systemd-analyze and Cargo's
 * crate sources; they skip where those are missing.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "../../..");

function run(command: string[]): { code: number; output: string } {
  const result = Bun.spawnSync(command, { cwd: ROOT, stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, output: `${result.stdout}${result.stderr}` };
}

describe("systemd units", () => {
  test.skipIf(!Bun.which("systemd-analyze"))("every system unit scores 5.0 or better (scripts/check-units.ts)", () => {
    const { code, output } = run(["bun", join(ROOT, "scripts/check-units.ts")]);
    expect(output).not.toContain("FAILED");
    expect(code).toBe(0);
  });

  test("dashi-hardware.service keeps its sandbox", () => {
    const unit = readFileSync(join(ROOT, "spin/dashi-hardware/usr/lib/systemd/system/dashi-hardware.service"), "utf8");
    for (const line of [
      "NoNewPrivileges=yes",
      "ProtectSystem=strict",
      "ProtectKernelTunables=yes",
      "ReadWritePaths=/sys/class /sys/devices /sys/firmware/acpi",
      "PrivateNetwork=yes",
      "DevicePolicy=closed",
      "DeviceAllow=char-hidraw rw",
      "CapabilityBoundingSet=CAP_SYS_RAWIO CAP_DAC_OVERRIDE",
    ]) {
      expect(unit.split("\n")).toContain(line);
    }
  });
});

describe("licenses", () => {
  test("every spec ships a %license", () => {
    const dir = join(ROOT, "spin/rpm");
    for (const file of readdirSync(dir).filter((name) => name.endsWith(".spec"))) {
      expect(readFileSync(join(dir, file), "utf8"), file).toMatch(/^%license /m);
    }
  });

  test("dashi bundles only MIT code now the AI SDKs are gone, and its License: says so", () => {
    const spec = readFileSync(join(ROOT, "spin/rpm/dashi.spec"), "utf8");
    expect(spec).toMatch(/^License:\s+MIT$/m);
    const bundled = readFileSync(join(ROOT, "spin/vendored-modules"), "utf8");
    expect(bundled).not.toMatch(/anthropic|openai/);
  });

  test.skipIf(!Bun.which("cargo") || !existsSync(join(ROOT, "../mirin/crates/mirin-metal/Cargo.toml")))(
    "LICENSE.dependencies and the specs' License: tags are current (spin/license-dependencies --check)",
    () => {
      const probe = run(["cargo", "metadata", "--format-version", "1", "--locked", "--offline", "--no-deps"]);
      if (probe.code !== 0) return; // crate sources not fetched here
      const { code, output } = run(["bun", join(ROOT, "spin/license-dependencies"), "--check"]);
      expect(output).not.toMatch(/STALE|LICENSE TAG|NOT PERMISSIVE/);
      expect(code).toBe(0);
    },
  );
});
