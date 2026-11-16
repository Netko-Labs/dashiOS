/**
 * The Store's hands for packages and sources (D322): installing and removing
 * an RPM from the source the person chose, updating Dashi's own packages
 * apart from Fedora's, and turning a source on or off. Everything goes
 * through PackageKit (`pkcon`, whose dnf5 backend is what Fedora 44 ships
 * for a session that isn't root) and `flatpak`; the backend is this one file
 * deep, so it can move to dnf5daemon later. polkit asks for the password
 * where PackageKit's rules say (a new package, a removal, a repository
 * changed); Dashi's own polkit agent shows the sheet.
 */

import type { Offer } from "./catalog-types.ts";
import type { Installation } from "./ids.ts";
import { flathubToggle, packageId, pkconInstall, pkconRemove, pkconRepo, pkconUpdateSome } from "./lib/package-cmd.ts";
import { parseSystemProgress, pkconError, pkconNothingToDo, systemFailure } from "./lib/pkcon.ts";
import { run as defaultRun, type Runner, type RunResult } from "./lib/run.ts";
import type { OnProgress, Outcome } from "./manager.ts";
import type { Source } from "./sources.ts";

const KEEP = 20_000;
const LONG = 3 * 60 * 60_000;

/** PackageKit's own words for "you said no on the password sheet". */
const REFUSED = /not authorized|authorization|authentication|dismissed|cancelled by user/i;

export class Packages {
  private readonly run: Runner;

  constructor(deps: { run?: Runner } = {}) {
    this.run = deps.run ?? defaultRun;
  }

  /** Installs a package from the repository its offer names (PackageKit's `name;version;arch;repo` id), else by name. */
  install(offer: Pick<Offer, "ref" | "version" | "repoId"> & { arch?: string | null }, onProgress: OnProgress, signal?: AbortSignal): Promise<Outcome> {
    let target = offer.ref;
    try {
      if (offer.version && offer.repoId && offer.arch) target = packageId(offer.ref, offer.version, offer.arch, offer.repoId);
      return this.pkcon(pkconInstall(target), onProgress, signal);
    } catch (error) {
      return Promise.resolve({ ok: false, message: error instanceof Error ? error.message : "That is not a package." });
    }
  }

  remove(name: string, onProgress: OnProgress, signal?: AbortSignal): Promise<Outcome> {
    try {
      return this.pkcon(pkconRemove(name), onProgress, signal);
    } catch (error) {
      return Promise.resolve({ ok: false, message: error instanceof Error ? error.message : "That is not a package." });
    }
  }

  /** Updates only these packages (Dashi's own row): no password for updates from a source already on. */
  updateSome(names: readonly string[], onProgress: OnProgress, signal?: AbortSignal): Promise<Outcome> {
    if (names.length === 0) return Promise.resolve({ ok: true, message: "" });
    return this.pkcon(pkconUpdateSome(names), onProgress, signal);
  }

  /** Turns a source on or off: each of its dnf repositories, or Flathub's remote in each installation that has it. */
  async setSource(source: Pick<Source, "kind" | "repoIds">, on: boolean, installations: readonly Installation[] = ["user", "system"]): Promise<Outcome> {
    const commands = source.kind === "flathub" ? installations.map((each) => flathubToggle(each, on)) : source.repoIds.map((id) => pkconRepo(id, on));
    let last: Outcome = { ok: true, message: "" };
    for (const command of commands) {
      const result = await this.run(command, { timeoutMs: 120_000 });
      // A Flathub remote missing from one installation is not a failure.
      if (source.kind === "flathub" && result.code !== 0 && /not found|no remote/i.test(result.output)) continue;
      last = this.outcome(result, undefined, systemFailure(result.output));
      if (!last.ok) return last;
    }
    return last;
  }

  private async pkcon(command: string[], onProgress: OnProgress, signal?: AbortSignal): Promise<Outcome> {
    onProgress({ fraction: null, label: "Starting" });
    let seen = "";
    const result = await this.run(command, {
      signal,
      timeoutMs: LONG,
      onOutput: (chunk) => {
        seen = (seen + chunk).slice(-KEEP);
        const progress = parseSystemProgress(seen);
        if (progress) onProgress(progress);
      },
    });
    if (pkconNothingToDo(result.code, result.output)) return { ok: true, message: "" };
    // pkcon can fail and still exit 0 (no PackageKit daemon).
    const failed = pkconError(result.output) !== null && result.code === 0 ? { ...result, code: 1 } : result;
    return this.outcome(failed, signal, systemFailure(result.output));
  }

  private outcome(result: RunResult, signal: AbortSignal | undefined, failure: string): Outcome {
    if (signal?.aborted) return { ok: false, cancelled: true, message: "Cancelled." };
    if (result.code === 0) return { ok: true, message: "" };
    if (REFUSED.test(result.output)) return { ok: false, cancelled: true, message: "The password was not given." };
    return { ok: false, message: failure };
  }
}
