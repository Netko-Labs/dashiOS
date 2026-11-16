/**
 * An extension's preferences as the person set them (applet.json
 * `preferences`, @dashi/applet preferences.ts): words and switches in
 * `applet-data/<id>.prefs.json`, beside its data folder and outside its
 * sandbox (it can't write them itself), and a `secret` in the Secret Service
 * under the extension's id (`secret-tool`, libsecret's), never on disk.
 * The extension reads them as `open` gives them (protocol 6).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Manifest, PreferenceValue } from "@dashi/applet";
import { isRecord } from "@dashi/shape";

/** What keeps secrets: the Secret Service, or a stand-in in tests. */
export interface Secrets {
  get(extension: string, name: string): Promise<string | null>;
  set(extension: string, name: string, label: string, value: string): Promise<boolean>;
  clear(extension: string, name: string): Promise<void>;
}

async function run(argv: readonly string[], input?: string): Promise<{ code: number; out: string }> {
  try {
    const child = Bun.spawn([...argv], { stdin: input === undefined ? "ignore" : new TextEncoder().encode(input), stdout: "pipe", stderr: "ignore" });
    const out = await new Response(child.stdout).text();
    return { code: await child.exited, out };
  } catch {
    return { code: 127, out: "" };
  }
}

/** The Secret Service through `secret-tool`: attributes `dashi-extension` (its id) and `preference` (the name). */
export const secretTool: Secrets = {
  get: async (extension, name) => {
    const { code, out } = await run(["secret-tool", "lookup", "dashi-extension", extension, "preference", name]);
    return code === 0 && out !== "" ? out : null;
  },
  set: async (extension, name, label, value) =>
    (await run(["secret-tool", "store", `--label=${label}`, "dashi-extension", extension, "preference", name], value)).code === 0,
  clear: async (extension, name) => {
    await run(["secret-tool", "clear", "dashi-extension", extension, "preference", name]);
  },
};

export class PreferenceStore {
  constructor(
    private readonly dataRoot: string,
    private readonly secrets: Secrets = secretTool,
  ) {}

  private file(id: string): string {
    return join(this.dataRoot, `${id}.prefs.json`);
  }

  private stored(id: string): Record<string, PreferenceValue> {
    const path = this.file(id);
    if (!existsSync(path)) return {};
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8"));
      if (!isRecord(value)) return {};
      const out: Record<string, PreferenceValue> = {};
      for (const [name, each] of Object.entries(value)) if (typeof each === "string" || typeof each === "boolean") out[name] = each;
      return out;
    } catch {
      return {};
    }
  }

  /** Every preference the manifest declares, as set, else its default; a secret that isn't set is left out. */
  async read(manifest: Manifest): Promise<Record<string, PreferenceValue>> {
    const stored = this.stored(manifest.id);
    const out: Record<string, PreferenceValue> = {};
    for (const preference of manifest.preferences) {
      if (preference.type === "secret") {
        const secret = await this.secrets.get(manifest.id, preference.name);
        if (secret !== null) out[preference.name] = secret;
        continue;
      }
      const value = stored[preference.name] ?? preference.default;
      if (value !== undefined) out[preference.name] = value;
    }
    return out;
  }

  /** Keep one; an empty secret forgets it. False when it isn't one the manifest declares, or couldn't be kept. */
  async write(manifest: Manifest, name: string, value: PreferenceValue): Promise<boolean> {
    const preference = manifest.preferences.find((each) => each.name === name);
    if (!preference) return false;
    if (preference.type === "secret") {
      if (typeof value !== "string") return false;
      if (value === "") {
        await this.secrets.clear(manifest.id, name);
        return true;
      }
      return this.secrets.set(manifest.id, name, `${manifest.name}: ${preference.title}`, value);
    }
    if ((preference.type === "checkbox") !== (typeof value === "boolean")) return false;
    const path = this.file(manifest.id);
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    writeFileSync(path, JSON.stringify({ ...this.stored(manifest.id), [name]: value }), { mode: 0o600 });
    return true;
  }
}
