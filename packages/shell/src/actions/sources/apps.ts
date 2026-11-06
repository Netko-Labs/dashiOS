/**
 * Installed apps as actions: each at `dashi://app/<desktop id>`, and each of
 * its `[Desktop Action]` groups at `dashi://app/<id>/action/<action id>`
 * ("Firefox › New private window"). The entries are the shell's catalog
 * (entries.ts); what is hidden (`NoDisplay`) stays out, as it does from the
 * launcher.
 */

import type { Entry } from "../../entries.ts";
import { formatAddress, isSegment } from "../address.ts";
import type { DesktopAction } from "../desktop-actions.ts";
import { type ActionDef, type ActionSource, failed, ok, ready } from "../types.ts";

export interface AppDeps {
  entries(): readonly Entry[];
  /** Start it (entries.ts `launchEntry`); the pid, or null when it could not start. */
  launch(entry: Entry): number | null;
  /** An icon name as a file (entries.ts `resolveIcon`), for a Desktop Action's own icon. */
  icon?(name: string): string;
  /**
   * Bring the app's window forward when it has one, as a click on its Dock
   * icon does; whether it did. Opening an app (a key, a link) starts it only
   * when it isn't running.
   */
  activate?(entry: Entry): Promise<boolean>;
}

/** Desktop Action names, by language, as words: `Name[de]=Neues Fenster` finds it in German. */
function namesByLanguage(action: DesktopAction): Record<string, string[]> {
  const words: Record<string, string[]> = { en: [action.name.toLowerCase()] };
  for (const [lang, name] of Object.entries(action.names)) (words[lang.split("-")[0] ?? lang] ??= []).push(name.toLowerCase());
  return words;
}

function started(entry: Entry, deps: Pick<AppDeps, "launch">, what: string) {
  return ready(async () => (deps.launch(entry) === null ? failed(`${entry.name} could not start.`) : ok(`${what} is opening.`)));
}

/** The actions for one app: opening it, then its own actions. */
export function appActions(entry: Entry, deps: Pick<AppDeps, "launch" | "icon" | "activate">): ActionDef[] {
  if (entry.hidden || !isSegment(entry.id)) return [];
  const base = {
    description: "",
    properties: {},
    scope: "act" as const,
    readOnly: false,
    destructive: false,
    who: "person" as const,
    source: "apps",
  };
  const open: ActionDef = {
    ...base,
    address: formatAddress(["app", entry.id]),
    title: entry.name,
    keywords: { en: entry.keywords },
    kind: "open",
    icon: entry.icon,
    check: () =>
      ready(async () => {
        if (await deps.activate?.(entry).catch(() => false)) return ok(`${entry.name} is in front.`);
        return deps.launch(entry) === null ? failed(`${entry.name} could not start.`) : ok(`${entry.name} is opening.`);
      }),
  };
  const own = (entry.actions ?? []).map(
    (action): ActionDef => ({
      ...base,
      address: formatAddress(["app", entry.id, "action", action.id]),
      title: `${entry.name} › ${action.name}`,
      keywords: namesByLanguage(action),
      kind: "run",
      icon: action.iconName && deps.icon ? deps.icon(action.iconName) : entry.icon,
      check: () => started({ ...entry, exec: action.exec }, deps, `${entry.name} › ${action.name}`),
    }),
  );
  return [open, ...own];
}

/** The installed apps, read again when asked (the launcher opening, a new app found). */
export class AppSource implements ActionSource {
  readonly id = "apps";
  private current: ActionDef[] = [];
  private readonly listeners = new Set<() => void>();

  constructor(private readonly deps: AppDeps) {
    this.read();
  }

  actions = (): readonly ActionDef[] => this.current;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  private read(): void {
    this.current = this.deps.entries().flatMap((entry) => appActions(entry, this.deps));
  }

  async refresh(): Promise<void> {
    this.read();
    for (const listener of this.listeners) listener();
  }
}
