import { expect, test } from "bun:test";
import { matchEntry } from "../src/dock/layout.ts";
import { type Entry, withDistinctNames } from "../src/entries.ts";
import { parseDesktopEntry } from "../src/shared/apps/index.ts";

const T3_HIDDEN = `[Desktop Entry]
Type=Application
Name=T3 Code (Nightly)
Exec=/usr/lib64/t3code-nightly/t3code %U
Icon=/home/me/.local/share/icons/com.t3tools.T3Code.desktop.png
NoDisplay=true
`;
const T3_VISIBLE = `[Desktop Entry]
Type=Application
Name=T3 Code (Nightly)
Exec=t3code-nightly --ozone-platform-hint=auto %U
Icon=t3code-nightly
StartupWMClass=t3code-nightly
`;

const entry = (id: string, text: string): Entry => {
  const parsed = parseDesktopEntry(id, text);
  if (!parsed) throw new Error(`${id} did not parse`);
  const { iconName, ...rest } = parsed;
  return { ...rest, icon: iconName };
};

test("a NoDisplay entry is kept, marked hidden; Hidden=true (deleted) is not", () => {
  expect(parseDesktopEntry("com.t3tools.T3Code", T3_HIDDEN)).toMatchObject({ id: "com.t3tools.T3Code", hidden: true });
  expect(parseDesktopEntry("t3code-nightly", T3_VISIBLE)).not.toHaveProperty("hidden");
  expect(parseDesktopEntry("gone", T3_VISIBLE.replace("StartupWMClass", "Hidden=true\nStartupWMClass"))).toBeNull();
});

test("a window is named by the hidden entry with its app id (T3 Code's com.t3tools.T3Code)", () => {
  const catalog = [entry("t3code-nightly", T3_VISIBLE), entry("com.t3tools.T3Code", T3_HIDDEN)];
  expect(matchEntry(catalog, "com.t3tools.T3Code")?.icon).toBe("/home/me/.local/share/icons/com.t3tools.T3Code.desktop.png");
  expect(matchEntry(catalog, "t3code-nightly")?.id).toBe("t3code-nightly");
});

test("a hidden entry neither takes nor gives a distinct name", () => {
  const named = withDistinctNames([entry("t3code-nightly", T3_VISIBLE), entry("com.t3tools.T3Code", T3_HIDDEN)]);
  expect(named.map((each) => each.name)).toEqual(["T3 Code (Nightly)", "T3 Code (Nightly)"]);
});
