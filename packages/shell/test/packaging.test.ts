/**
 * What the packages ship: the privileged helpers' systemd sandboxes
 * (scripts/check-units.ts), a %license in every spec, and Dashi's own libraries in the shell's
 * node_modules. The first needs systemd-analyze and skips where it is missing. The generated
 * license notices (spin/license-dependencies --check) are a step of `bun run check`, not a test:
 * it reads five crates' trees, which no test's 2 s can promise.
 */

import { describe, expect, test } from "bun:test";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";

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

describe("dashi-release", () => {
  const files = ["usr/lib/os-release", "usr/lib/dashi-release"];

  /** fill-version run on a copy of the package's files, as the spec runs it; the files filled. */
  function filled(snapshot: string): Record<string, string> {
    const root = mkdtempSync(join(tmpdir(), "dashi-release-"));
    try {
      for (const file of files) {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        copyFileSync(join(ROOT, "spin/dashi-release", file), join(root, file));
      }
      const { code, output } = run([join(ROOT, "spin/dashi-release/fill-version"), snapshot, root]);
      expect(output).toBe("");
      expect(code).toBe(0);
      return Object.fromEntries(files.map((file) => [file, readFileSync(join(root, file), "utf8")]));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }

  test("the files hold no version of their own (0.7's package said 0.4)", () => {
    for (const file of files) expect(readFileSync(join(ROOT, "spin/dashi-release", file), "utf8")).not.toMatch(/\b\d+\.\d+ (beta|\(beta\))/);
    expect(readFileSync(join(ROOT, "spin/rpm/dashi-release.spec"), "utf8")).toContain("./fill-version '%{dashi_snapshot}' %{buildroot}");
  });

  test("a beta build names its version and stage", () => {
    const out = filled("0.7.0~beta.20261111.015155.6c1d6fa");
    const osRelease = out["usr/lib/os-release"] ?? "";
    expect(osRelease).toContain('VERSION="0.7 beta"\n');
    expect(osRelease).toContain('PRETTY_NAME="Dashi 0.7 beta"\n');
    expect(osRelease).toContain('DASHI_BUILD="0.7.0~beta.20261111.015155.6c1d6fa"\n');
    expect(out["usr/lib/dashi-release"]).toBe("Dashi release 0.7 (beta)\n");
    for (const text of Object.values(out)) expect(text).not.toContain("@DASHI_");
  });

  test("a release build names its version alone", () => {
    const out = filled("0.9.0");
    expect(out["usr/lib/os-release"]).toContain('VERSION="0.9"\n');
    expect(out["usr/lib/dashi-release"]).toBe("Dashi release 0.9\n");
  });
});
