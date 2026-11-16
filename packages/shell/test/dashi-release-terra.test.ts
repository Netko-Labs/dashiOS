// dashi-release's Terra (decisions.md D329): a dnf5 vendor file, named as terra-release's own so that one replaces it,
// pointing at keys the package ships; and the COPR plugin's setting (D331).
import { expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const release = join(import.meta.dir, "../../../spin/dashi-release");
const repo = readFileSync(join(release, "usr/share/dnf5/repos.d/terra.repo"), "utf8");
const spec = readFileSync(join(import.meta.dir, "../../../spin/rpm/dashi-release.spec"), "utf8");

test("Terra's vendor file has one [terra], on, signed, with a key dashi-release ships", () => {
  expect(repo.match(/^\[[^\]]+\]$/gm)).toEqual(["[terra]"]);
  expect(repo).toMatch(/^enabled=1$/m);
  expect(repo).toMatch(/^gpgcheck=1$/m);
  const key = /^gpgkey=file:\/\/(\S+)$/m.exec(repo)?.[1] ?? "";
  expect(key).toBe("/usr/share/dashi/pki/RPM-GPG-KEY-terra$releasever");
  for (const release44 of ["44", "45"]) {
    const file = join(release, key.replace("/usr/", "usr/").replace("$releasever", release44));
    expect(existsSync(file)).toBe(true);
    expect(readFileSync(file, "utf8")).toContain("BEGIN PGP PUBLIC KEY BLOCK");
  }
  expect(spec).toContain("%{_datadir}/dnf5/repos.d/terra.repo");
  expect(spec).toContain("%{_datadir}/dashi/pki/RPM-GPG-KEY-terra44");
});

test("the vendor file is named as terra-release's, so terra-release's own replaces it and there is never a second [terra]", () => {
  // terra-release owns /etc/yum.repos.d/terra.repo; dnf5 reads /etc/yum.repos.d before /usr/share/dnf5/repos.d.
  expect(existsSync(join(release, "usr/share/dnf5/repos.d/terra.repo"))).toBe(true);
  expect(existsSync(join(release, "etc/yum.repos.d/terra.repo"))).toBe(false);
  expect(spec).toMatch(/^Recommends:\s+terra-release$/m);
});

test("dnf copr enable asks for Fedora's chroot on Dashi", () => {
  expect(readFileSync(join(release, "etc/dnf/plugins/copr.d/dashi.conf"), "utf8")).toMatch(/\[main\]\s*\ndistribution = fedora/);
  expect(spec).toContain("%config(noreplace) %{_sysconfdir}/dnf/plugins/copr.d/dashi.conf");
});
