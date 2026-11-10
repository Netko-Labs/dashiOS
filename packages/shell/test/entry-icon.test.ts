import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appsFor } from "../apps/files/open.ts";
import { entryIcon } from "../src/shared/apps/index.ts";

const pinned = [{ id: "helium", icon: "/usr/share/dashi/icons/browser.svg" }];
const theme = (name: string): string => `/icons/hicolor/scalable/apps/${name}.svg`;

test("Open With shows a pinned app as the Dock does: Helium wears the Browser's icon", () => {
  expect(entryIcon("helium", "helium", pinned, theme)).toBe("/usr/share/dashi/icons/browser.svg");
});

test("any other app wears its desktop entry's icon from the theme", () => {
  expect(entryIcon("org.gnome.Loupe", "org.gnome.Loupe", pinned, theme)).toBe("/icons/hicolor/scalable/apps/org.gnome.Loupe.svg");
});

test("Files' Open With list carries each app's own icon", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dashi-open-with-"));
  try {
    const icon = join(dir, "viewer.svg");
    writeFileSync(icon, "<svg/>");
    mkdirSync(join(dir, "applications"));
    writeFileSync(join(dir, "applications", "viewer.desktop"), `[Desktop Entry]\nType=Application\nName=Viewer\nExec=viewer %f\nIcon=${icon}\n`);
    const run = async () => ({ ok: true, code: 0, stdout: "Registered applications:\n\tviewer.desktop\n", stderr: "" });
    const apps = await appsFor("image/png", run, [dir]);
    expect(apps.map((app) => [app.name, app.icon])).toEqual([["Viewer", icon]]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
