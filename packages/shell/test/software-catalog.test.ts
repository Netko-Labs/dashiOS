import { expect, test } from "bun:test";
import { flathubEnabled } from "../src/shared/software/catalog.ts";
import { parseAppStream, plain } from "../src/shared/software/lib/appstream.ts";
import { type MergeInput, mergeCatalog, nameFromPackage } from "../src/shared/software/lib/catalog-merge.ts";
import { searchCatalog } from "../src/shared/software/lib/catalog-search.ts";
import { FIELD, parseApps, parseInstalled, parsePackages, parseRepoList, RECORD } from "../src/shared/software/lib/rpm-query.ts";
import { COPR_NOTE, coprName, type Repo, sourceOfRepo, sourceRank, sourcesFrom } from "../src/shared/software/sources.ts";

const REPOS: Repo[] = [
  { id: "fedora", name: "Fedora 44", enabled: true },
  { id: "updates", name: "Fedora 44 Updates", enabled: true },
  { id: "updates-testing", name: "Fedora 44 Testing", enabled: false },
  { id: "fedora-debuginfo", name: "Fedora 44 Debug", enabled: false },
  { id: "terra", name: "Terra 44", enabled: true },
  { id: "copr:copr.fedorainfracloud.org:pejedev:dashi", name: "Dashi", enabled: true },
  { id: "copr:copr.fedorainfracloud.org:imput:helium", name: "Helium", enabled: true },
  { id: "copr:copr.fedorainfracloud.org:group_kdesig:plasma", name: "KDE", enabled: false },
  { id: "rpmfusion-free", name: "RPM Fusion free", enabled: true },
  { id: "rpmfusion-nonfree-updates", name: "RPM Fusion nonfree", enabled: true },
];

test("a COPR is named by owner/project and labelled as a community build; Dashi's own is Dashi", () => {
  expect(coprName("copr:copr.fedorainfracloud.org:imput:helium")).toBe("imput/helium");
  expect(coprName("copr:copr.fedorainfracloud.org:group_kdesig:plasma")).toBe("@kdesig/plasma");
  expect(coprName("fedora")).toBeNull();
  const helium = sourceOfRepo({ id: "copr:copr.fedorainfracloud.org:imput:helium", name: "x" });
  expect(helium).toMatchObject({ id: "copr:imput/helium", kind: "copr", label: "imput/helium", note: COPR_NOTE, switchable: true });
  expect(sourceOfRepo({ id: "copr:copr.fedorainfracloud.org:pejedev:dashi", name: "x" })).toMatchObject({ label: "Dashi", dashi: true, switchable: false });
});

test("repositories fold into sources: Fedora's three, RPM Fusion's four; testing, debug and source ones are left out", () => {
  const sources = sourcesFrom(REPOS, true);
  expect(sources.map((source) => source.id)).toEqual([
    "flathub",
    "fedora",
    "copr:pejedev/dashi",
    "terra",
    "copr:@kdesig/plasma",
    "copr:imput/helium",
    "repo:rpmfusion",
  ]);
  expect(sources.find((source) => source.id === "fedora")?.repoIds).toEqual(["fedora", "updates"]);
  expect(sources.find((source) => source.id === "repo:rpmfusion")?.repoIds).toEqual(["rpmfusion-free", "rpmfusion-nonfree-updates"]);
  expect(sources.find((source) => source.id === "copr:@kdesig/plasma")?.enabled).toBe(false);
  expect(sources.find((source) => source.id === "fedora")?.switchable).toBe(false);
  expect(sources.find((source) => source.id === "terra")?.switchable).toBe(true);
  expect(sourcesFrom(REPOS, false)[0]).toMatchObject({ id: "flathub", enabled: false });
});

test("the default source order is Flathub, Fedora, Terra, then a COPR or another repository", () => {
  const order = (["copr", "terra", "repo", "fedora", "flathub"] as const).map((kind) => sourceRank({ kind, dashi: false }));
  expect(order).toEqual([3, 2, 3, 1, 0]);
});

test("Flathub is off only when every installation that has it says disabled", () => {
  expect(flathubEnabled("fedora\tsystem,oci\nflathub\tsystem\nflathub\tuser\n")).toBe(true);
  expect(flathubEnabled("flathub\tsystem,disabled\nflathub\tuser\n")).toBe(true);
  expect(flathubEnabled("flathub\tsystem,disabled\nflathub\tuser,disabled\n")).toBe(false);
  expect(flathubEnabled("")).toBe(true);
});

const FLATHUB_XML = `<components origin="flatpak">
<component type="desktop-application"><id>org.gimp.GIMP</id><name>GNU Image Manipulation Program</name><name xml:lang="de">GIMP de</name>
<summary xml:lang="pl">Polski</summary><summary>High-end image creation &amp; manipulation</summary>
<developer id="org.gimp"><name>The GIMP team</name></developer><project_license>GPL-3.0+</project_license>
<icon type="remote" width="64" height="64">https://dl.flathub.org/media/gimp-64.png</icon><icon type="remote" width="128" height="128">https://dl.flathub.org/media/gimp-128.png</icon>
<categories><category>Graphics</category></categories><launchable type="desktop-id">org.gimp.GIMP.desktop</launchable>
<bundle type="flatpak" runtime="x">app/org.gimp.GIMP/x86_64/stable</bundle>
<custom><value key="flathub::verification::verified">true</value></custom></component>
<component type="runtime"><id>org.gnome.Platform</id><name>GNOME</name></component>
<component type="desktop-application"><id>com.spotify.Client</id><name>Spotify</name><summary>Music</summary>
<bundle type="flatpak">app/com.spotify.Client/x86_64/stable</bundle><icon type="remote" width="128">http://insecure/x.png</icon></component>
</components>`;

const FEDORA_XML = `<components origin="fedora">
<component type="desktop"><id>org.gimp.GIMP</id><pkgname>gimp</pkgname><name>GNU Image Manipulation Program</name><summary>Images</summary>
<icon type="cached" width="128" height="128">org.gimp.GIMP.png</icon><launchable type="desktop-id">gimp.desktop</launchable></component>
<component type="desktop"><id>htop.desktop</id><pkgname>htop</pkgname><name>Htop</name><summary>Interactive process viewer</summary></component>
</components>`;

test("AppStream is read into apps only, untranslated, entities decoded, https icons only", () => {
  const apps = parseAppStream(FLATHUB_XML);
  expect(apps.map((app) => app.id)).toEqual(["org.gimp.GIMP", "com.spotify.Client"]);
  expect(apps[0]).toMatchObject({
    name: "GNU Image Manipulation Program",
    summary: "High-end image creation & manipulation",
    developer: "The GIMP team",
    flatpak: "org.gimp.GIMP",
    desktopId: "org.gimp.GIMP",
    verified: true,
    icon: { kind: "remote", value: "https://dl.flathub.org/media/gimp-128.png" },
  });
  expect(apps[1]?.icon).toBeNull();
  expect(apps[1]?.verified).toBe(false);
  const fedora = parseAppStream(FEDORA_XML);
  expect(fedora[1]).toMatchObject({ id: "htop", pkgname: "htop", desktopId: "htop" });
  expect(plain("  a\n  &lt;b&gt;  ")).toBe("a <b>");
});

const rows = (lines: string[][]): string => lines.map((fields) => `${fields.join(FIELD)}${RECORD}\n`).join("");

test("dnf's output is read strictly: other arches, side packages and bad names are left out", () => {
  const packages = parsePackages(
    rows([
      ["ripgrep", "fedora", "14.1.1-1.fc44", "x86_64", "Line-oriented search tool"],
      ["ripgrep", "updates", "15.1.0-1.fc44", "x86_64", "Line-oriented search tool"],
      ["ripgrep", "updates", "15.1.0-1.fc44", "aarch64", "Line-oriented search tool"],
      ["ripgrep-debuginfo", "fedora", "1-1", "x86_64", "Debug"],
      ["-rf", "fedora", "1-1", "x86_64", "evil"],
      ["fonts", "terra", "1-1", "noarch", "  Some\n fonts "],
    ]),
    "x86_64",
  );
  expect(packages.map((pkg) => `${pkg.name}@${pkg.repoId}`)).toEqual(["ripgrep@fedora", "ripgrep@updates", "fonts@terra"]);
  expect(packages[2]?.summary).toBe("Some fonts");
  const apps = parseApps(rows([["gimp", "fedora", "metainfo()\napplication()\napplication(gimp.desktop)\nmimehandler(image/png)"]]));
  expect(apps).toEqual([{ name: "gimp", repoId: "fedora", desktopIds: ["gimp"] }]);
  expect(
    parseInstalled(
      rows([
        ["htop", "fedora"],
        ["dashi", "@commandline"],
        ["x", ""],
      ]),
    ).get("x"),
  ).toBe("@System");
  expect(parseRepoList('[{"id":"fedora","name":"Fedora","is_enabled":true},{"id":"bad id","is_enabled":true},{"id":"x"}]')).toEqual([
    { id: "fedora", name: "Fedora", enabled: true },
  ]);
  expect(parseRepoList("not json")).toEqual([]);
});

function input(patch: Partial<MergeInput> = {}): MergeInput {
  const pkg = (name: string, repoId: string, summary = "") => ({ name, repoId, evr: "1-1", arch: "x86_64", summary });
  return {
    sources: sourcesFrom(REPOS, true),
    flathub: parseAppStream(FLATHUB_XML),
    rpmAppStream: parseAppStream(FEDORA_XML),
    packages: [
      pkg("gimp", "fedora"),
      pkg("gimp", "updates"),
      pkg("htop", "fedora", "Interactive process viewer"),
      pkg("helium-bin", "copr:copr.fedorainfracloud.org:imput:helium", "Helium browser"),
      pkg("helium-browser-bin", "terra", "Helium browser"),
      pkg("neohtop", "terra", "Htop on steroids"),
      pkg("ripgrep", "fedora", "Line-oriented search tool"),
      pkg("ripgrep", "terra", "Line-oriented search tool"),
      pkg("hidden", "copr:copr.fedorainfracloud.org:group_kdesig:plasma"),
    ],
    rpmApps: [
      { name: "gimp", repoId: "fedora", desktopIds: ["gimp"] },
      { name: "htop", repoId: "fedora", desktopIds: ["htop"] },
      { name: "helium-bin", repoId: "copr:copr.fedorainfracloud.org:imput:helium", desktopIds: ["net.imput.helium"] },
      { name: "helium-browser-bin", repoId: "terra", desktopIds: ["net.imput.helium"] },
      { name: "neohtop", repoId: "terra", desktopIds: ["NeoHtop"] },
    ],
    installedRpms: new Map(),
    installedFlatpaks: new Set(),
    ...patch,
  };
}

test("one row per app with every source that has it, in Flathub, Fedora, Terra, COPR order", () => {
  const entries = mergeCatalog(input());
  const gimp = entries.find((entry) => entry.key === "app:org.gimp.gimp");
  expect(gimp?.offers.map((offer) => `${offer.source}:${offer.ref}:${offer.repoId ?? ""}`)).toEqual(["flathub:org.gimp.GIMP:", "fedora:gimp:updates"]);
  const helium = entries.find((entry) => entry.key === "app:net.imput.helium");
  expect(helium?.name).toBe("Helium");
  expect(helium?.offers.map((offer) => offer.source)).toEqual(["terra", "copr:imput/helium"]);
  expect(entries.find((entry) => entry.key === "app:neohtop")?.offers.map((offer) => offer.source)).toEqual(["terra"]);
  expect(entries.find((entry) => entry.key === "tool:ripgrep")?.offers.map((offer) => offer.source)).toEqual(["fedora", "terra"]);
  // A COPR that is off offers nothing.
  expect(entries.some((entry) => entry.key === "tool:hidden")).toBe(false);
  expect(nameFromPackage("helium-browser-bin")).toBe("Helium Browser");
});

test("what is installed comes first, from the source it came from; Flathub off leaves its apps out", () => {
  const installed = mergeCatalog(input({ installedRpms: new Map([["helium-bin", "copr:copr.fedorainfracloud.org:imput:helium"]]) }));
  const helium = installed.find((entry) => entry.key === "app:net.imput.helium");
  expect(helium?.offers.map((offer) => `${offer.source}${offer.installed ? "*" : ""}`)).toEqual(["copr:imput/helium*", "terra"]);
  const file = mergeCatalog(input({ installedRpms: new Map([["gimp", "@commandline"]]) }));
  expect(file.find((entry) => entry.key === "app:org.gimp.gimp")?.offers[0]).toMatchObject({ source: "fedora", installed: true });
  const off = mergeCatalog(input({ sources: sourcesFrom(REPOS, false) }));
  expect(off.find((entry) => entry.key === "app:org.gimp.gimp")?.offers.map((offer) => offer.source)).toEqual(["fedora"]);
  expect(off.some((entry) => entry.key === "app:com.spotify.client")).toBe(false);
});

test("search: apps by any word; tools only by their package name; exact names first", () => {
  const entries = mergeCatalog(input());
  const htop = searchCatalog(entries, "htop");
  expect(htop.apps.map((entry) => entry.name)).toEqual(["Htop", "Neohtop"]);
  const ripgrep = searchCatalog(entries, "ripgrep");
  expect(ripgrep.tools.map((entry) => entry.name)).toEqual(["ripgrep"]);
  expect(searchCatalog(entries, "search tool").tools).toEqual([]);
  expect(searchCatalog(entries, "image manipulation").apps[0]?.name).toBe("GNU Image Manipulation Program");
  expect(searchCatalog(entries, "   ")).toEqual({ apps: [], tools: [] });
});
