import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { type CatalogIndex, generateKeys, type IndexApplet, type KeyPair, sha256, sign, trustedComment, writeTar } from "@dashi/applet";
import type { CatalogSource } from "../../src/shared/applet-store/catalogs.ts";

// Throwaway keys for this run only.
export const dashiKey = generateKeys();
export const teamKey = generateKeys();
export const author = generateKeys();
export const line = (key: KeyPair): string => key.publicKey.split("\n")[1] ?? "";

export const DASHI = "https://raw.githubusercontent.com/Netko-Labs/dashi-applets/index/index.json";
export const TEAM = "https://applets.example.com/team/index.json";
export const dashiSource: CatalogSource = { name: "Dashi", url: DASHI, key: line(dashiKey), builtIn: true };
export const teamSource: CatalogSource = { name: "Team", url: TEAM, key: line(teamKey), builtIn: false };

export const manifest = (id: string, version = "0.1.0") => ({
  id,
  name: id.split(".").at(-1) ?? id,
  version,
  dashi: ">=0.4",
  entry: "src/main.tsx",
  summary: "A test applet.",
  author: { name: "Alex Kim" },
  categories: [],
  permissions: [],
  commands: [],
  screenshots: [],
});

export const packageOf = (id: string, version: string): Uint8Array =>
  writeTar(
    new Map([
      ["applet.json", new TextEncoder().encode(JSON.stringify(manifest(id, version)))],
      ["main.js", new TextEncoder().encode(`console.log(${JSON.stringify(version)})`)],
    ]),
  );

/** An index entry (parsed shape) with packages on `host`, or on disk under `dir`. */
export function entry(
  id: string,
  options: { host?: string; dir?: string; versions?: string[]; pulled?: string[]; icon?: string; reviewed?: boolean } = {},
): IndexApplet {
  const versions = (options.versions ?? ["0.1.0"]).map((version) => {
    const bytes = packageOf(id, version);
    let url = `https://${options.host ?? "github.com"}/releases/${id}-${version}.dashi-applet`;
    if (options.dir) {
      url = `file://${join(options.dir, `${id}-${version}.dashi-applet`)}`;
      writeFileSync(new URL(url), bytes);
    }
    return {
      version,
      dashi: ">=0.4",
      url,
      sha256: sha256(bytes),
      size: bytes.byteLength,
      signature: sign(bytes, author.secretKey, trustedComment({ id, version }, sha256(bytes))),
      released: "2026-11-04",
    };
  });
  return {
    manifest: { ...manifest(id, versions[0]?.version), when: undefined } as unknown as IndexApplet["manifest"],
    authorKey: line(author),
    reviewed: options.reviewed ?? true,
    source: { url: "https://github.com/alexk/applet", commit: "0123456" },
    ...(options.icon ? { icon: options.icon } : {}),
    screenshots: [],
    versions: [...versions].reverse(),
    pulled: (options.pulled ?? []).map((version) => ({ version, reason: "breaks things" })),
  };
}

export const indexOf = (applets: IndexApplet[]): CatalogIndex => ({ format: 1, generated: "2026-11-05T00:00:00Z", applets, skipped: [] });
