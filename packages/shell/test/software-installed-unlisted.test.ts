// Pass 37: Installed listed "Fcitx5 qt Qt6gui", a library's helper whose desktop file is NoDisplay, as an app.

import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { packageRows } from "../apps/software/lib/installed-packages.tsx";
import { unlistedDesktopIds } from "../src/shared/apps/index.ts";
import type { CatalogData, CatalogEntry } from "../src/shared/software/index.ts";

const desktop = (name: string, extra = ""): string => `[Desktop Entry]\nType=Application\nName=${name}\nExec=${name.toLowerCase()}\n${extra}`;

test("the desktop files that are no app to open: NoDisplay, Hidden, not an application, another desktop's", () => {
  const user = mkdtempSync(join(tmpdir(), "dashi-unlisted-user-"));
  const system = mkdtempSync(join(tmpdir(), "dashi-unlisted-system-"));
  writeFileSync(join(system, "org.fcitx.fcitx5-qt6-gui-wrapper.desktop"), desktop("Fcitx5 Qt6 GUI Wrapper", "NoDisplay=true\n"));
  writeFileSync(join(system, "gone.desktop"), desktop("Gone", "Hidden=true\n"));
  writeFileSync(join(system, "link.desktop"), "[Desktop Entry]\nType=Link\nName=Site\nURL=https://example.com\n");
  writeFileSync(join(system, "kde-only.desktop"), desktop("KCM", "OnlyShowIn=KDE;\n"));
  writeFileSync(join(system, "firefox.desktop"), desktop("Firefox"));
  // The person's own copy comes first: shown here, though the system's is NoDisplay.
  writeFileSync(join(system, "orca.desktop"), desktop("Orca", "NoDisplay=true\n"));
  writeFileSync(join(user, "orca.desktop"), desktop("Orca"));
  mkdirSync(join(system, "wine"));
  writeFileSync(join(system, "wine", "helper.desktop"), desktop("Helper", "NoDisplay=true\n"));
  expect([...unlistedDesktopIds([user, system])].sort()).toEqual(["gone", "kde-only", "link", "org.fcitx.fcitx5-qt6-gui-wrapper", "wine-helper"]);
});

const entry = (name: string, desktopId: string | null, ref: string, extra: Partial<CatalogEntry["offers"][number]> = {}): CatalogEntry => ({
  key: `app:${ref}`,
  kind: "app",
  name,
  summary: "",
  developer: null,
  icon: null,
  categories: [],
  keywords: [],
  license: null,
  desktopId,
  offers: [
    {
      source: "fedora",
      kind: "rpm",
      ref,
      repoId: "updates",
      version: "1-1.fc44",
      arch: "x86_64",
      verified: false,
      installed: true,
      cameWithSystem: false,
      ...extra,
    },
  ],
});

test("Installed lists the package apps the person added that open; a library's helper is left out", () => {
  const data: CatalogData = {
    builtAt: 0,
    sources: [{ id: "fedora", kind: "fedora", label: "Fedora", note: "", repoIds: ["fedora", "updates"], enabled: true, switchable: false, dashi: false }],
    entries: [
      entry("Orca", "orca", "orca"),
      entry("Fcitx5 qt Qt6gui", "org.fcitx.fcitx5-qt6-gui-wrapper", "fcitx5-qt-qt6gui"),
      entry("Firefox", "firefox", "firefox"),
      entry("Geoclue", "geoclue-demo-agent", "geoclue2", { cameWithSystem: true }),
    ],
  };
  const unlisted = new Set(["org.fcitx.fcitx5-qt6-gui-wrapper", "geoclue-demo-agent"]);
  expect(packageRows(data, "", unlisted).map((row) => row.entry.name)).toEqual(["Firefox", "Orca"]);
  expect(packageRows(data, "fcitx", unlisted)).toEqual([]);
  // With nothing unlisted (no desktop files read), it is listed as before.
  expect(packageRows(data, "fcitx", new Set()).map((row) => row.offer.ref)).toEqual(["fcitx5-qt-qt6gui"]);
});
