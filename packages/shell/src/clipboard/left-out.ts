/**
 * The apps clipboard history leaves out (password managers), as the person edits the list in
 * Settings › Keyboard: the defaults, their names, and whether a copy's app is on the list
 * (lib/privacy.ts has the rest of the privacy rules).
 */

/** Password managers left out by default (KeePassXC, Bitwarden, 1Password, Seahorse), as app ids or programs. */
export const DEFAULT_LEFT_OUT: readonly string[] = [
  "org.keepassxc.KeePassXC",
  "keepassxc",
  "Bitwarden",
  "bitwarden",
  "com.bitwarden.desktop",
  "1Password",
  "1password",
  "org.gnome.seahorse.Application",
  "seahorse",
];

/** What a left-out entry is called in Settings (ids of one app share a name: they are one row). */
export const LEFT_OUT_NAMES: Readonly<Record<string, string>> = {
  "org.keepassxc.KeePassXC": "KeePassXC",
  keepassxc: "KeePassXC",
  Bitwarden: "Bitwarden",
  bitwarden: "Bitwarden",
  "com.bitwarden.desktop": "Bitwarden",
  "1Password": "1Password",
  "1password": "1Password",
  "org.gnome.seahorse.Application": "Passwords and Keys",
  seahorse: "Passwords and Keys",
};

const NAMES_FOLDED = new Map(Object.entries(LEFT_OUT_NAMES).map(([id, name]) => [id.toLowerCase(), name]));

/** One app of the left-out list as Settings shows it: its name, and every id the list keeps for it. */
export interface LeftOutApp {
  name: string;
  /** In the list's order; removing the app removes them all. */
  ids: string[];
}

/**
 * The left-out list as Settings shows it: one row per app, in the order the
 * list first names it. Ids of the same app (KeePassXC's app id and its
 * program) are one row: by the names Dashi knows for password managers, else
 * by the installed app an id stands for (`installed`), else each id (in any
 * case) is its own.
 */
export function leftOutApps(list: readonly string[], installed: (id: string) => { name: string } | undefined = () => undefined): LeftOutApp[] {
  const apps = new Map<string, LeftOutApp>();
  for (const id of list) {
    const name = NAMES_FOLDED.get(id.toLowerCase()) ?? installed(id)?.name ?? id;
    const app = apps.get(name.toLowerCase());
    if (!app) apps.set(name.toLowerCase(), { name, ids: [id] });
    else if (!app.ids.includes(id)) app.ids.push(id);
  }
  return [...apps.values()];
}

/** The left-out list without every id of `app`. */
export function withoutApp(list: readonly string[], app: Pick<LeftOutApp, "ids">): string[] {
  return list.filter((id) => !app.ids.includes(id));
}

/** Whether the app a copy came from is one the history leaves out (app ids and program names, any case). */
export function isLeftOut(app: { appId: string; program?: string | null }, list: readonly string[]): boolean {
  const names = new Set(list.map((name) => name.toLowerCase()));
  const candidates = [app.appId, app.program ?? ""].map((name) => name.toLowerCase()).filter(Boolean);
  return candidates.some((name) => names.has(name));
}
