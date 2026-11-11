/**
 * What the packages ship: the privileged helpers' systemd sandboxes
 * (scripts/check-units.ts), the generated license notices (spin/license-dependencies),
 * a %license in every spec, and Dashi's own libraries in the shell's node_modules. The first two
 * need systemd-analyze and Cargo's crate sources; they skip where those are missing.
 */

import { describe, expect, test } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

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

describe("Dashi's own libraries", () => {
  /** The `@dashi/*` packages `names` depend on, and theirs, by the packages' own package.json. */
  function needed(names: string[], dirs: Map<string, string>): Set<string> {
    const found = new Set<string>();
    const queue = [...names];
    for (let name = queue.pop(); name !== undefined; name = queue.pop()) {
      const dir = dirs.get(name);
      if (!dir) throw new Error(`no package is named ${name}`);
      const manifest: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      const dependencies = typeof manifest === "object" && manifest && "dependencies" in manifest ? manifest.dependencies : {};
      for (const each of Object.keys(dependencies ?? {}).filter((key) => key.startsWith("@dashi/"))) {
        if (!found.has(each)) queue.push(each);
        found.add(each);
      }
    }
    return found;
  }

  test("spin/build-rpms ships every @dashi/* the shell and the greeter import", () => {
    const script = readFileSync(join(ROOT, "spin/build-rpms"), "utf8");
    // The rule build-rpms names its libraries by, run as it runs it.
    const rule = /library=\$\(sed -n '([^']+)' "\$dir\/package\.json"\)/.exec(script)?.[1];
    expect(rule).toBeDefined();
    const dirs = new Map<string, string>();
    const shipped = new Set<string>();
    for (const entry of readdirSync(join(ROOT, "packages"))) {
      const dir = join(ROOT, "packages", entry);
      if (!existsSync(join(dir, "package.json"))) continue;
      const manifest: unknown = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
      if (typeof manifest === "object" && manifest && "name" in manifest && typeof manifest.name === "string") dirs.set(manifest.name, dir);
      const library = run(["sed", "-n", rule ?? "", join(dir, "package.json")]).output.trim();
      if (library && library !== "shell" && library !== "greeter") shipped.add(`@dashi/${library}`);
    }
    const wanted = needed(["@dashi/shell", "@dashi/greeter"], dirs);
    expect(wanted.has("@dashi/shape")).toBe(true);
    for (const name of wanted) expect([...shipped], name).toContain(name);
  });

  test("installed, every file: dependency of a library is a package beside it", () => {
    const script = readFileSync(join(ROOT, "spin/build-rpms"), "utf8");
    // The rewrite build-rpms makes in each library's package.json, run as it runs it.
    const rewrite = /sed -i '([^']+)' "\$modules\/@dashi\/\$library\/package\.json"/.exec(script)?.[1];
    expect(rewrite).toBeDefined();
    const modules = "/usr/share/dashi/node_modules";
    const libraries = readdirSync(join(ROOT, "packages")).filter((entry) => !["shell", "greeter"].includes(entry));
    const shipped = new Set([`${modules}/@mirinjs/metal`]);
    const names = new Map<string, string>();
    for (const entry of libraries) {
      const manifest: unknown = JSON.parse(readFileSync(join(ROOT, "packages", entry, "package.json"), "utf8"));
      const name = typeof manifest === "object" && manifest && "name" in manifest ? String(manifest.name) : entry;
      names.set(entry, name);
      shipped.add(`${modules}/${name}`);
    }
    for (const entry of libraries) {
      const text = run(["sed", rewrite ?? "", join(ROOT, "packages", entry, "package.json")]).output;
      const manifest: unknown = JSON.parse(text);
      const dependencies = typeof manifest === "object" && manifest && "dependencies" in manifest ? manifest.dependencies : {};
      for (const [dependency, spec] of Object.entries(dependencies ?? {})) {
        if (typeof spec !== "string" || !spec.startsWith("file:")) continue;
        expect([...shipped], `${entry}: ${dependency}`).toContain(resolve(`${modules}/${names.get(entry)}`, spec.slice(5)));
      }
    }
  });
});
