import { type ActionDef, ok, ready } from "../../src/actions/types.ts";
import type { Entry } from "../../src/entries.ts";
import type { LauncherWindow } from "../../src/launcher/lib/items.ts";
import type { ListInput } from "../../src/launcher/lib/rows.ts";
import type { FileRow } from "../../src/launcher/row-model.ts";

export const app = (name: string, extra: Partial<Entry> = {}): Entry => ({
  id: `app.${name.toLowerCase()}`,
  name,
  icon: `/${name}.svg`,
  keywords: [],
  ...extra,
});
export const ICONS = { calculator: "/calc.svg", files: "/files.svg", software: "/software.svg", command: "/dashi.svg" };

export const file = (name: string): FileRow => ({
  url: `file:///home/alexk/${name}`,
  path: `/home/alexk/${name}`,
  name,
  folder: "~",
  mime: null,
  icon: "/f.svg",
});
export const list = (input: Partial<ListInput>): ListInput => ({ query: "", entries: [], recent: [], files: { kind: "none" }, icons: ICONS, ...input });

export function action(address: string, extra: Partial<ActionDef> = {}): ActionDef {
  return {
    address,
    title: "Thing",
    description: "",
    keywords: { en: [] },
    kind: "run",
    properties: {},
    scope: null,
    readOnly: false,
    destructive: false,
    who: "person",
    source: "dashi",
    check: () => ready(async () => ok("Done.")),
    ...extra,
  };
}

export const window = (id: number, title: string, entryId: string | null, extra: Partial<LauncherWindow> = {}): LauncherWindow => ({
  id,
  address: `dashi://window/w${id}`,
  title,
  appName: entryId ? (entryId.split(".")[1] ?? "") : "Thing",
  entryId,
  state: "normal",
  icon: "/w.svg",
  ...extra,
});

export const darkMode = (on: boolean) =>
  action("dashi://settings/appearance/dark-mode", {
    title: "Dark Mode",
    kind: "toggle",
    source: "settings",
    place: { pane: "appearance", row: "dark-mode" },
    keywords: { en: ["dark", "theme", "dark mode"] },
    state: () => on,
  });
