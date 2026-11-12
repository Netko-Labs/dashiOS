/**
 * `dashi-applet publish`: prepares the pull request to the catalog
 * (Netko-Labs/dashi-applets) in a local checkout of it, and says what to do
 * next. It never pushes. In the catalog it writes, on a new branch,
 *
 *   applets/<id>/applet.json              the manifest
 *   applets/<id>/source.json              {"url", "commit"}: where CI builds it from
 *   applets/<id>/author.pub               the author's key (the first time; it may not change)
 *   applets/<id>/versions/<v>.json        {"sha256", "size", "released", "bun"}: the package the author built
 *   applets/<id>/versions/<v>.minisig     the author's signature on it
 *   applets/<id>/screenshots/…            the manifest's screenshots
 *
 * and commits. The catalog's CI builds the package again from the source at
 * that commit and refuses it unless the bytes are the same, and the
 * signature is the key's.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { trustedComment } from "../../catalog.ts";
import { type Packed, pack } from "../../package.ts";
import { parsePublicKey, publicKeyLine, sign, verify } from "../../signing/minisign.ts";

const git = (cwd: string, ...args: string[]): { ok: boolean; out: string } => {
  const result = Bun.spawnSync(["git", "-C", cwd, ...args], { stdout: "pipe", stderr: "pipe" });
  return { ok: result.exitCode === 0, out: (result.exitCode === 0 ? result.stdout : result.stderr).toString().trim() };
};

/** An ssh or https remote as the https address CI fetches. */
export function httpsRemote(remote: string): string | null {
  const ssh = /^git@github\.com:(.+?)(\.git)?$/.exec(remote);
  if (ssh) return `https://github.com/${ssh[1]}`;
  const https = /^https:\/\/([^\s]+?)(\.git)?$/.exec(remote);
  return https ? `https://${https[1]}` : null;
}

function flag(args: readonly string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

/** Writes the package to dist/, signed when a key is given; returns it and its signature (or null). */
export async function packTo(dir: string, key?: string): Promise<{ packed: Packed; path: string; signature: string | null }> {
  const packed = await pack(dir);
  const dist = join(dir, "dist");
  mkdirSync(dist, { recursive: true });
  const path = join(dist, packed.name);
  writeFileSync(path, packed.bytes);
  const sigPath = `${path}.minisig`;
  if (key) writeFileSync(sigPath, sign(packed.bytes, readFileSync(key, "utf8"), trustedComment(packed.manifest, packed.sha256)));
  const signature = existsSync(sigPath) ? readFileSync(sigPath, "utf8") : null;
  return { packed, path, signature };
}

/**
 * How `pack` speaks of the .minisig beside the package: ", signed" when it
 * checks against author.pub (or there is none to check with), and a warning
 * when it is left from another build, whose bytes are gone (pack without
 * `--sign` writes the package, not its signature).
 */
export function signatureNote(dir: string, bytes: Uint8Array, signature: string | null): string {
  if (!signature) return "";
  const pub = join(dir, "author.pub");
  if (!existsSync(pub) || verify(bytes, signature, readFileSync(pub, "utf8")).ok) return ", signed";
  return "; its .minisig is from another build, so it isn't signed now (sign it again: --sign KEY)";
}

const fail = (message: string): number => {
  console.error(`dashi-applet publish: ${message}`);
  return 1;
};

interface Source {
  catalog: string;
  pub: NonNullable<ReturnType<typeof parsePublicKey>>;
  remote: string;
  commit: string;
}

/** Where the applet is published from and to, or why it can't be yet. */
function sourceOf(dir: string, args: readonly string[]): Source | string {
  const catalog = resolve(flag(args, "--catalog") ?? process.env.DASHI_APPLETS_CATALOG ?? join(dirname(dir), "dashi-applets"));
  if (!existsSync(join(catalog, "applets")) || !git(catalog, "rev-parse", "--git-dir").ok) {
    return `no catalog checkout at ${catalog} (clone Netko-Labs/dashi-applets there, or give --catalog DIR)`;
  }
  const pubPath = join(dir, "author.pub");
  const pub = existsSync(pubPath) ? parsePublicKey(readFileSync(pubPath, "utf8")) : null;
  if (!pub) {
    return "no author.pub here: make your key with `minisign -G` (or `dashi-applet keygen` for a throwaway one) and put its public half in author.pub";
  }
  if (git(dir, "status", "--porcelain").out !== "") return "commit your changes first: the catalog builds the package from a commit";
  const remote = httpsRemote(git(dir, "remote", "get-url", "origin").out);
  const commit = git(dir, "rev-parse", "HEAD").out;
  if (!remote || !/^[0-9a-f]{40}$/.test(commit)) return "the applet's folder needs a git repository with an `origin` remote (CI builds from it)";
  return { catalog, pub, remote, commit };
}

/** Why the catalog can't take this version, or null: another key's applet, or a version it has. */
function refusal(target: string, manifest: Packed["manifest"], pub: Source["pub"]): string | null {
  const catalogKey = join(target, "author.pub");
  if (existsSync(catalogKey)) {
    const listed = parsePublicKey(readFileSync(catalogKey, "utf8"));
    if (!listed || publicKeyLine(listed) !== publicKeyLine(pub)) {
      return `${manifest.id} is published with another key; an update must be signed by the same key`;
    }
  }
  if (existsSync(join(target, "versions", `${manifest.version}.json`)))
    return `${manifest.id} ${manifest.version} is in the catalog already; raise the version`;
  return null;
}

/** The applet's entry in the catalog (the files the header lists). */
function writeEntry(dir: string, target: string, source: Source, packed: Packed, signature: string): void {
  const { manifest } = packed;
  mkdirSync(join(target, "versions"), { recursive: true });
  copyFileSync(join(dir, "applet.json"), join(target, "applet.json"));
  writeFileSync(join(target, "source.json"), `${JSON.stringify({ url: source.remote, commit: source.commit }, null, 2)}\n`);
  writeFileSync(join(target, "author.pub"), `untrusted comment: ${manifest.author.name}'s key for ${manifest.id}\n${publicKeyLine(source.pub)}\n`);
  const released = new Date().toISOString().slice(0, 10);
  writeFileSync(
    join(target, "versions", `${manifest.version}.json`),
    `${JSON.stringify({ sha256: packed.sha256, size: packed.bytes.byteLength, released, bun: Bun.version }, null, 2)}\n`,
  );
  writeFileSync(join(target, "versions", `${manifest.version}.minisig`), signature);
  for (const shot of manifest.screenshots) {
    const from = join(dir, shot);
    if (!existsSync(from)) continue;
    mkdirSync(dirname(join(target, shot)), { recursive: true });
    copyFileSync(from, join(target, shot));
  }
}

export async function publish(dir: string, args: readonly string[]): Promise<number> {
  const source = sourceOf(dir, args);
  if (typeof source === "string") return fail(source);
  const { catalog, pub } = source;

  const { packed, path, signature } = await packTo(dir, flag(args, "--sign"));
  if (!signature) {
    return fail(`sign the package first:\n  minisign -S -s YOUR.key -m ${path} -t ${JSON.stringify(trustedComment(packed.manifest, packed.sha256))}`);
  }
  const checked = verify(packed.bytes, signature, pub);
  if (!checked.ok) return fail(`the signature doesn't check against author.pub: ${checked.reason}`);
  const { manifest } = packed;
  const target = join(catalog, "applets", manifest.id);
  const refused = refusal(target, manifest, pub);
  if (refused) return fail(refused);

  const branch = `publish/${manifest.id}-${manifest.version}`;
  const switched = git(catalog, "switch", "-c", branch);
  if (!switched.ok) return fail(switched.out);
  writeEntry(dir, target, source, packed, signature);
  git(catalog, "add", join("applets", manifest.id));
  const committed = git(catalog, "commit", "-m", `applet: ${manifest.id} ${manifest.version}`);
  if (!committed.ok) return fail(`the commit failed: ${committed.out}`);
  console.log(`  ✓ ${packed.name} (${Math.round(packed.bytes.byteLength / 1024)} KB, sha256 ${packed.sha256.slice(0, 8)}…), signed by ${checked.keyId}`);
  console.log(`  ✓ ${catalog}: branch ${branch}, one commit`);
  console.log("  Next: push the branch to your fork and open the pull request:");
  console.log(`    git -C ${catalog} push -u origin ${branch}`);
  console.log(`    gh pr create --repo Netko-Labs/dashi-applets --head ${branch} --title ${JSON.stringify(`${manifest.name} ${manifest.version}`)}`);
  return 0;
}
