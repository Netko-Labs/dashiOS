/**
 * A desktop entry's own actions (the Desktop Entry specification's
 * `Actions=` key and its `[Desktop Action <id>]` groups): Firefox's "New
 * Private Window", Files' "New Window". The launcher shows them as commands
 * of their app ("Firefox › New private window"); entries.ts reads them with
 * the entry.
 *
 * An action without a name or a command is left out (the specification lets
 * D-Bus activated apps leave Exec out; Dashi doesn't activate them).
 * Localized names (`Name[de]`) are kept by language, as words it is found by.
 */

export interface DesktopAction {
  /** Its id in `Actions=`: letters, digits, and `-`. */
  id: string;
  name: string;
  /** `Name[lang]`, by language. */
  names: Readonly<Record<string, string>>;
  exec: string[];
  /** The group's `Icon`, as written (resolve it like the entry's). */
  iconName?: string;
}

const ID = /^[A-Za-z0-9-]{1,64}$/;
/** More than any app offers; a file with more is not trusted with them. */
const MAX_ACTIONS = 16;

/** The groups of a .desktop file: header to its keys, first of a repeated key wins. */
function groups(text: string): Map<string, Map<string, string>> {
  const found = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.startsWith("[") && line.endsWith("]")) {
      const header = line.slice(1, -1);
      current = found.has(header) ? null : new Map();
      if (current) found.set(header, current);
      continue;
    }
    if (!current || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq <= 0) continue;
    const key = line.slice(0, eq).trim();
    if (!current.has(key)) current.set(key, line.slice(eq + 1).trim());
  }
  return found;
}

const LOCALIZED = /^Name\[([A-Za-z]{2,3}(?:[_-][A-Za-z0-9]{2,8})?(?:@[A-Za-z]+)?)\]$/;

/** The actions `text` declares, in its order; `parseExec` turns an Exec line into argv (entries.ts). */
export function desktopActions(text: string, parseExec: (exec: string) => string[]): DesktopAction[] {
  const all = groups(text);
  const ids = (all.get("Desktop Entry")?.get("Actions") ?? "")
    .split(";")
    .map((id) => id.trim())
    .filter((id) => ID.test(id));
  const actions: DesktopAction[] = [];
  for (const id of [...new Set(ids)].slice(0, MAX_ACTIONS)) {
    const group = all.get(`Desktop Action ${id}`);
    const name = group?.get("Name");
    const exec = group?.get("Exec");
    if (!group || !name || !exec) continue;
    const argv = parseExec(exec);
    if (argv.length === 0) continue;
    const names: Record<string, string> = {};
    for (const [key, value] of group) {
      const lang = LOCALIZED.exec(key)?.[1];
      if (lang && value) names[lang.replace("_", "-")] = value;
    }
    const iconName = group.get("Icon");
    actions.push({ id, name, names, exec: argv, ...(iconName ? { iconName } : {}) });
  }
  return actions;
}
