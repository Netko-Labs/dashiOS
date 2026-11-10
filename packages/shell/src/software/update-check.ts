/**
 * The daily look for updates, by the shell, so they are heard about when
 * Software is closed. Once a day (on a charger or with no battery, and
 * online) it asks flatpak and PackageKit what waits, without refreshing
 * PackageKit's lists (that can ask for a password) and without installing
 * anything, then posts one quiet notification for what it found: "3 app
 * updates and a system update are ready". The same set is told once, not
 * every day. A click, or its Show button, opens Software on Updates. When it last looked, and
 * what it told, are kept in `software-check.json` in the state folder, so a
 * restarted shell doesn't look again before the day is up.
 */

import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { type NotificationStore, type NotifyInput, SHELL_SENDER } from "../notifications/index.ts";
import { iconPath } from "../shared/apps/index.ts";
import type { FlatpakUpdate } from "../shared/software/flatpak-parse.ts";
import type { Software } from "../shared/software/manager.ts";

export const DAY_MS = 24 * 3_600_000;
/** After the session starts: late enough not to slow it. */
export const FIRST_LOOK_MS = 3 * 60_000;
/** A look that couldn't run now (on battery, offline) is tried again after this. */
export const RETRY_MS = 3_600_000;

export interface CheckState {
  /** When it last looked (ms), or null. */
  checkedAt: number | null;
  /** The set it last told about, so the same updates aren't announced twice. */
  told: string | null;
}

export function checkPath(env: Readonly<Record<string, string | undefined>> = process.env, home: string = homedir()): string {
  return join(env.XDG_STATE_HOME || join(home, ".local", "state"), "dashi", "software-check.json");
}

/** The state file read; anything of the wrong shape is no state. */
export function parseCheckState(text: string): CheckState {
  try {
    const value = JSON.parse(text) as unknown;
    if (typeof value !== "object" || value === null) return { checkedAt: null, told: null };
    const fields = value as Record<string, unknown>;
    const checkedAt = typeof fields.checkedAt === "number" && Number.isFinite(fields.checkedAt) ? fields.checkedAt : null;
    const told = typeof fields.told === "string" && fields.told.length < 20_000 ? fields.told : null;
    return { checkedAt, told };
  } catch {
    return { checkedAt: null, told: null };
  }
}

/** How long until the next look is due: 0 when it is due now. A clock set back counts as due. */
export function dueIn(checkedAt: number | null, now: number): number {
  if (checkedAt === null || checkedAt > now) return 0;
  return Math.max(0, checkedAt + DAY_MS - now);
}

/** What was found, as one string to compare with what was told. */
export function updatesKey(apps: readonly Pick<FlatpakUpdate, "id" | "version">[], system: number): string {
  return JSON.stringify({ apps: apps.map((app) => `${app.id}@${app.version ?? ""}`).sort(), system });
}

/** "3 app updates and a system update"; null when there is nothing. */
export function updatesWords(apps: number, system: number): string | null {
  const appWords = apps === 0 ? null : apps === 1 ? "An app update" : `${apps} app updates`;
  if (system === 0) return appWords;
  return appWords ? `${appWords} and a system update` : "A system update";
}

export const SOFTWARE_ID = "dev.dashi.software";

/** A click on the notice. */
export const CLICK = "default";
/** Its Show button: a key of its own, since a banner draws no button for the click. */
export const SHOW = "show";

/**
 * The notice: a title short enough for a banner's one line ("Updates are
 * ready"), the counts in the body, and a Show button. Posted as the shell's
 * own, so a click in the notification center runs it too.
 */
export function updatesNotice(apps: number, system: number): NotifyInput | null {
  const words = updatesWords(apps, system);
  if (words === null) return null;
  const one = apps + (system > 0 ? 1 : 0) === 1;
  return {
    appName: "Software",
    appIcon: iconPath("software"),
    summary: one ? "An update is ready" : "Updates are ready",
    body: `${words} ${one ? "waits" : "wait"} in Software. Nothing installs on its own.`,
    actions: [
      { key: CLICK, label: "Show" },
      { key: SHOW, label: "Show" },
    ],
    urgency: "low",
    expireTimeout: -1,
    imagePath: "",
    desktopEntry: SOFTWARE_ID,
    category: "system",
    transient: false,
    resident: false,
  };
}

export interface SoftwareOpener {
  /** The windows on the desktop, by app id. */
  windows(): readonly { id: number; appId: string }[];
  /** Brings a window forward. */
  activate(id: number): void;
  /** Starts a first-party app with words for it (main.tsx `openWith`); false when it isn't there or didn't start. */
  openWith(appId: string, env: Record<string, string>): boolean;
  log?: (line: string) => void;
}

/** Show: Software's window forward when it is open, else Software started on Updates. What it did is logged. */
export function openSoftwareUpdates(opener: SoftwareOpener): void {
  const log = opener.log ?? ((line: string) => console.error(line));
  const window = opener.windows().find((each) => each.appId === SOFTWARE_ID);
  if (window) {
    log(`dashi-shell: the update notice brings Software forward (window ${window.id})`);
    opener.activate(window.id);
    return;
  }
  const started = opener.openWith(SOFTWARE_ID, { DASHI_SOFTWARE_PAGE: "updates" });
  log(started ? "dashi-shell: the update notice opens Software on Updates" : "dashi-shell: the update notice couldn't start Software");
}

export interface UpdateCheckOptions {
  software: Pick<Software, "hasFlatpak" | "hasPackageKit" | "flatpakUpdates" | "systemUpdates">;
  notifications: Pick<NotificationStore, "notify" | "onEvent">;
  /** Opens Software on its Updates page. */
  open(): void;
  /** Whether looking now is fine: on a charger (or no battery) and online. */
  canLook?: () => boolean;
  /** The state file; null keeps it in memory only. */
  statePath?: string | null;
  now?: () => number;
  setTimer?: (run: () => void, ms: number) => () => void;
}

const timeout = (run: () => void, ms: number): (() => void) => {
  const timer = setTimeout(run, ms);
  timer.unref?.();
  return () => clearTimeout(timer);
};

export class UpdateCheck {
  private state: CheckState;
  private cancel: () => void = () => {};
  private stopEvents: () => void = () => {};
  private noticeId = 0;
  private readonly now: () => number;
  private readonly setTimer: (run: () => void, ms: number) => () => void;

  constructor(private readonly options: UpdateCheckOptions) {
    this.now = options.now ?? Date.now;
    this.setTimer = options.setTimer ?? timeout;
    this.state = this.read();
  }

  start(): () => void {
    this.stopEvents = this.options.notifications.onEvent((event) => {
      if (event.type === "action" && event.id === this.noticeId && (event.key === CLICK || event.key === SHOW)) this.options.open();
    });
    this.schedule(Math.max(FIRST_LOOK_MS, dueIn(this.state.checkedAt, this.now())));
    return () => this.stop();
  }

  stop(): void {
    this.cancel();
    this.stopEvents();
  }

  /** Looks now (when it may), tells what is new, and writes it down. */
  async look(): Promise<void> {
    const { software } = this.options;
    if (this.options.canLook && !this.options.canLook()) return this.schedule(RETRY_MS);
    const [apps, system] = await Promise.allSettled([
      software.hasFlatpak ? software.flatpakUpdates() : Promise.resolve([]),
      software.hasPackageKit ? software.systemUpdates(false) : Promise.resolve({ updates: [], restartCauses: [] }),
    ]);
    // Neither answered: try again in a while rather than wait a whole day.
    if (apps.status === "rejected" && system.status === "rejected") return this.schedule(RETRY_MS);
    const appList = apps.status === "fulfilled" ? apps.value : [];
    const systemCount = system.status === "fulfilled" ? system.value.updates.length : 0;
    const key = updatesKey(appList, systemCount);
    const notice = updatesNotice(appList.length, systemCount);
    if (notice && key !== this.state.told) this.noticeId = this.options.notifications.notify(notice, 0, SHELL_SENDER);
    this.state = { checkedAt: this.now(), told: notice ? key : null };
    this.write();
    this.schedule(DAY_MS);
  }

  private schedule(ms: number): void {
    this.cancel();
    this.cancel = this.setTimer(() => void this.look(), ms);
  }

  private read(): CheckState {
    const path = this.options.statePath;
    if (!path) return { checkedAt: null, told: null };
    try {
      return parseCheckState(readFileSync(path, "utf8"));
    } catch {
      return { checkedAt: null, told: null };
    }
  }

  private write(): void {
    const path = this.options.statePath;
    if (!path) return;
    try {
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(`${path}.new`, `${JSON.stringify(this.state)}\n`);
      renameSync(`${path}.new`, path);
    } catch (error) {
      console.error("dashi-shell: the update check's state wasn't saved:", error instanceof Error ? error.message : error);
    }
  }
}
