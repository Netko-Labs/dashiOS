/**
 * The stand-in's dnf (`DASHI_SOFTWARE_FAKE=1`): a small computer with
 * Fedora, Terra, Dashi's COPR and one COPR enabled by hand, a few apps and
 * tools in each, and PackageKit installs, removals and repository switches
 * that only change this list. Nothing on the machine is read or touched.
 */

import { FIELD, RECORD } from "./rpm-query.ts";
import type { RunOptions, RunResult } from "./run.ts";

/** The stand-in's pretend work (ms). */
const TIMERS = { stand: 40 } as const;

const REPOS = [
  { id: "fedora", name: "Fedora 44 - x86_64", is_enabled: true },
  { id: "updates", name: "Fedora 44 - x86_64 - Updates", is_enabled: true },
  { id: "terra", name: "Terra 44", is_enabled: true },
  { id: "copr:copr.fedorainfracloud.org:pejedev:dashi", name: "Dashi (COPR pejedev/dashi)", is_enabled: true },
  { id: "copr:copr.fedorainfracloud.org:alexk:tiny-tools", name: "Copr repo for tiny-tools owned by alexk", is_enabled: true },
];

/** name, repo, version, summary, desktop id (an app) or "" (a tool). */
const PACKAGES: Array<[string, string, string, string, string]> = [
  ["obs-studio", "fedora", "32.0.2-1.fc44", "Open source software for live streaming and recording", "com.obsproject.Studio"],
  ["ripgrep", "fedora", "15.1.0-1.fc44", "Line-oriented search tool", ""],
  ["htop", "fedora", "3.4.1-1.fc44", "Interactive process viewer", "htop"],
  ["neohtop", "terra", "1.2.0-1.fc44", "Htop on steroids", "NeoHtop"],
  ["helium-browser-bin", "terra", "0.6.4-1.fc44", "Private, fast, and honest web browser", "net.imput.helium"],
  ["ripgrep", "terra", "15.1.0-2.fc44", "Line-oriented search tool", ""],
  ["dashi", "copr:copr.fedorainfracloud.org:pejedev:dashi", "0.9.0-1.fc44", "Dashi's shell and apps", ""],
  ["cowsay-plus", "copr:copr.fedorainfracloud.org:alexk:tiny-tools", "1.0-1.fc44", "A cow that says more", ""],
  ["fcitx5-qt-qt6gui", "fedora", "5.1.16-1.fc44", "Fcitx5 Qt6 GUI Wrapper", "org.fcitx.fcitx5-qt6-gui-wrapper"],
];

/** Installed only because another package needed it (dnf's reason): never listed as an app the person added. */
const DEPENDENCIES = new Set(["fcitx5-qt-qt6gui"]);

const state = {
  installed: new Map<string, string>([
    ["dashi", "copr:copr.fedorainfracloud.org:pejedev:dashi"],
    ["fcitx5-qt-qt6gui", "fedora"],
  ]),
  off: new Set<string>(),
};

const rows = (fields: string[][]): string => fields.map((each) => `${each.join(FIELD)}${RECORD}\n`).join("");
const on = (repo: string): boolean => !state.off.has(repo);

function query(command: readonly string[]): string {
  // Dashi came with the computer (an old time); what the stand-in installs is installed now.
  if (command.includes("--installed"))
    return rows(
      [...state.installed].map(([name, repo]) => [
        name,
        repo,
        name === "dashi" ? "1000" : String(Math.floor(Date.now() / 1000)),
        DEPENDENCIES.has(name) ? "Dependency" : "User",
      ]),
    );
  const live = PACKAGES.filter(([, repo]) => on(repo));
  if (command.some((arg) => arg.startsWith("--whatprovides"))) {
    return rows(
      live.filter(([, , , , desktop]) => desktop !== "").map(([name, repo, , , desktop]) => [name, repo, `application()\napplication(${desktop}.desktop)`]),
    );
  }
  return rows(live.map(([name, repo, evr, summary]) => [name, repo, evr, "x86_64", summary]));
}

const steps = async (options: RunOptions): Promise<void> => {
  for (let percent = 0; percent <= 100 && !options.signal?.aborted; percent += 25) {
    options.onOutput?.(`Status: \tInstalling\nPercentage:\t${percent}\n`);
    await new Promise((resolve) => setTimeout(resolve, TIMERS.stand));
  }
};

/** The stand-in's answer for a dnf5 or a PackageKit package command; null for anything else. */
export async function standInPackages(command: readonly string[], options: RunOptions = {}): Promise<RunResult | null> {
  const [program, verb, target = ""] = command[0] === "pkcon" ? [command[0], command[3] ?? command[1], command[4] ?? command[2]] : command;
  if (program === "dnf5" && verb === "repo") return { code: 0, output: JSON.stringify(REPOS.map((repo) => ({ ...repo, is_enabled: on(repo.id) }))) };
  if (program === "dnf5" && verb === "repoquery") return { code: 0, output: query(command) };
  // The image's transaction: Dashi came with the computer.
  if (program === "dnf5" && verb === "history") return { code: 0, output: '[{"packages":[{"nevra":"dashi-0:0.9.0-1.fc44.noarch","action":"Install"}]}]' };
  if (program !== "pkcon") return null;
  if (command[1] === "repo-enable" || command[1] === "repo-disable") {
    if (command[1] === "repo-enable") state.off.delete(command[2] ?? "");
    else state.off.add(command[2] ?? "");
    return { code: 0, output: "" };
  }
  if (verb === "install") {
    const [name = "", , , repo = "fedora"] = target.split(";");
    await steps(options);
    if (!options.signal?.aborted) state.installed.set(name, repo);
    return { code: options.signal?.aborted ? 143 : 0, output: "" };
  }
  if (verb === "remove") {
    await steps(options);
    state.installed.delete(target);
    return { code: 0, output: "" };
  }
  return null;
}
