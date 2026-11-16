/**
 * Where apps come from: the four kinds of source the Store installs from
 * (decisions D320, D321). Flathub (Flatpak), Fedora (its `fedora` and
 * `updates` repositories), Terra (on by default, shipped by dashi-release),
 * and any COPR the person already enabled by hand (`dnf copr enable`), which
 * is labelled with its `owner/project` and "Community build, not reviewed by
 * Fedora". Any other dnf repository that is on (RPM Fusion) counts like a
 * COPR. The Store never searches COPR at large and never adds one.
 *
 * Pure: the repository list comes from `dnf5 repo list --all --json`
 * (catalog-load.ts reads it); this file only names and orders.
 */

export type SourceKind = "flathub" | "fedora" | "terra" | "copr" | "repo";

export interface Source {
  /** `flathub`, `fedora`, `terra`, `copr:imput/helium`, `repo:rpmfusion`. */
  id: string;
  kind: SourceKind;
  /** "Flathub", "Fedora", "Terra", "imput/helium", "RPM Fusion", "Dashi". */
  label: string;
  /** One line under the name: what it is and who vouches for it. */
  note: string;
  /** The dnf repositories it stands for (none for Flathub). */
  repoIds: string[];
  enabled: boolean;
  /** Whether the Sources page offers a switch (Fedora and Dashi's own are always on). */
  switchable: boolean;
  /** Dashi's own COPR (pejedev/dashi): Dashi itself, updated as its own row. */
  dashi: boolean;
}

export interface Repo {
  id: string;
  name: string;
  enabled: boolean;
}

export const COPR_NOTE = "Community build, not reviewed by Fedora";
export const DASHI_COPR = "pejedev/dashi";

const FEDORA_REPOS = new Set(["fedora", "updates", "fedora-cisco-openh264"]);
/** Debug, source and testing repositories are never a place to install apps from. */
const SIDE_REPO = /-(debuginfo|source|debug|testing)(-|$)|-updates-testing/;

/** The COPR a repository id names (`copr:copr.fedorainfracloud.org:imput:helium` → `imput/helium`; a group's `group_x` → `@x`). */
export function coprName(repoId: string): string | null {
  const match = /^copr:copr\.fedorainfracloud\.org:([^:]+):([^:]+)$/.exec(repoId);
  if (!match) return null;
  const owner = match[1]?.startsWith("group_") ? `@${match[1].slice(6)}` : match[1];
  return `${owner}/${match[2]}`;
}

/** The source a dnf repository belongs to, or null for one the Store leaves out (debug, source, testing). */
export function sourceOfRepo(repo: Pick<Repo, "id" | "name">): Omit<Source, "repoIds" | "enabled"> | null {
  const { id } = repo;
  if (SIDE_REPO.test(id)) return null;
  if (FEDORA_REPOS.has(id)) return { id: "fedora", kind: "fedora", label: "Fedora", note: "Built and signed by Fedora", switchable: false, dashi: false };
  if (id === "terra" || /^terra-(extras|mesa|nvidia|multimedia)$/.test(id)) {
    return { id: "terra", kind: "terra", label: "Terra", note: "Packages Fedora doesn’t carry, built by Fyra Labs", switchable: true, dashi: false };
  }
  const copr = coprName(id);
  if (copr === DASHI_COPR) return { id: `copr:${copr}`, kind: "copr", label: "Dashi", note: "Dashi itself and its apps", switchable: false, dashi: true };
  if (copr !== null) return { id: `copr:${copr}`, kind: "copr", label: copr, note: COPR_NOTE, switchable: true, dashi: false };
  if (id.startsWith("rpmfusion-")) {
    return { id: "repo:rpmfusion", kind: "repo", label: "RPM Fusion", note: "Packages Fedora can’t ship", switchable: true, dashi: false };
  }
  return { id: `repo:${id}`, kind: "repo", label: repo.name.slice(0, 60) || id, note: "A repository added on this computer", switchable: true, dashi: false };
}

export const FLATHUB: Source = {
  id: "flathub",
  kind: "flathub",
  label: "Flathub",
  note: "Apps in a sandbox",
  repoIds: [],
  enabled: true,
  switchable: true,
  dashi: false,
};

/**
 * The sources on this computer, from its dnf repositories (enabled or not:
 * a source the person turned off is still listed, off) and Flathub. A
 * source is on when any of its repositories is. Testing, debug and source
 * repositories are left out. A COPR or other repository that is off and was
 * never on is still listed, so turning one back on is a switch away.
 */
export function sourcesFrom(repos: readonly Repo[], flathubEnabled: boolean): Source[] {
  const byId = new Map<string, Source>();
  for (const repo of repos) {
    const named = sourceOfRepo(repo);
    if (named === null) continue;
    const have = byId.get(named.id);
    if (have) {
      have.repoIds.push(repo.id);
      have.enabled ||= repo.enabled;
    } else {
      byId.set(named.id, { ...named, repoIds: [repo.id], enabled: repo.enabled });
    }
  }
  return sortSources([{ ...FLATHUB, enabled: flathubEnabled }, ...byId.values()]);
}

/** The default order when an app is in several sources (D321): Flathub, Fedora, Terra, then a COPR or another repository. */
export function sourceRank(source: Pick<Source, "kind" | "dashi">): number {
  if (source.dashi) return 1.5;
  return { flathub: 0, fedora: 1, terra: 2, copr: 3, repo: 3 }[source.kind];
}

export function sortSources<T extends Pick<Source, "kind" | "dashi" | "label">>(sources: readonly T[]): T[] {
  return [...sources].sort((a, b) => sourceRank(a) - sourceRank(b) || a.label.localeCompare(b.label));
}

/** The source a dnf repository id belongs to, among `sources`. */
export const sourceForRepo = (sources: readonly Source[], repoId: string): Source | undefined => sources.find((source) => source.repoIds.includes(repoId));
