/**
 * Saved tuning (power limits, the Curve Optimizer, the card's limits) comes
 * back at login and after waking: the SMU forgets the offset at reboot and
 * sometimes on resume. dashi-hardware applies it only after a clean boot
 * (`ApplySavedTuning`); when two failed boots in a row cleared it, the boot
 * guard says `reset`, and Dashi says so once, the first login of that boot.
 */

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import type { GraphicsController } from "../graphics/controller.ts";
import type { HardwareApi } from "../hardware/client.ts";
import type { NotificationStore } from "../notifications/index.ts";
import { Logind } from "../power/logind.ts";
import type { ModeStore } from "../power/modes/store.ts";
import { writeJsonAtomic } from "../settings-app/store.ts";

export const RESET_NOTICE = {
  summary: "Tuning was reset",
  body: "The computer didn't start properly twice in a row, so the power limits and undervolt went back to their defaults.",
} as const;

const statePath = (): string => join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "dashi", "boot-guard.json");

const bootId = (): string | null => {
  try {
    return readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
  } catch {
    return null;
  }
};

/** Whether the reset was already said for `boot` (the file names the last boot it was said in). */
export function resetSaidFor(raw: string | null, boot: string): boolean {
  if (raw === null) return false;
  try {
    const parsed: unknown = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && (parsed as Record<string, unknown>).resetNoticeBoot === boot;
  } catch {
    return false;
  }
}

export interface TuningDeps {
  hardware: HardwareApi;
  notifications: NotificationStore;
  path?: string;
  boot?: () => string | null;
}

/** Applies the saved tuning, and says once if the boot guard reset it. */
export async function applyTuning(deps: TuningDeps, atLogin: boolean): Promise<void> {
  const result = await deps.hardware.applySavedTuning();
  if (result && !result.applied && result.reason) console.error(`dashi-shell: saved tuning not applied: ${result.reason}`);
  if (!atLogin) return;
  const guard = await deps.hardware.bootGuard();
  if (!guard?.reset) return;
  const boot = (deps.boot ?? bootId)();
  const path = deps.path ?? statePath();
  let raw: string | null = null;
  try {
    raw = readFileSync(path, "utf8");
  } catch {
    raw = null;
  }
  if (boot === null || resetSaidFor(raw, boot)) return;
  try {
    writeJsonAtomic(path, { resetNoticeBoot: boot });
  } catch {
    // Not remembered: said again at the next login of this boot, at worst.
  }
  deps.notifications.notify({
    appName: "Power",
    appIcon: "",
    summary: RESET_NOTICE.summary,
    body: RESET_NOTICE.body,
    actions: [],
    urgency: "normal",
    expireTimeout: -1,
    imagePath: "",
    desktopEntry: "",
    category: "device",
    transient: false,
    resident: false,
  });
}

/**
 * Saved tuning at login and after waking, and the recipe again after waking
 * (firmware forgets). Returns the way to stop listening.
 */
export function followWake(
  options: { realSession: boolean; developmentRun: boolean },
  parts: { hardware: HardwareApi; notifications: NotificationStore; modes: ModeStore; graphics: GraphicsController },
): () => void {
  const { hardware, notifications, modes, graphics } = parts;
  let logind: Logind | null = null;
  if (options.realSession && !options.developmentRun) {
    void applyTuning({ hardware, notifications }, true).catch(() => {});
    void Logind.connect()
      .then(async (connected) => {
        logind = connected;
        await connected.onPrepareForSleep((sleeping) => {
          if (sleeping) return;
          void applyTuning({ hardware, notifications }, false).catch(() => {});
          void modes.reapply();
          void graphics.refresh();
        });
      })
      .catch(() => {});
  }
  return () => logind?.close();
}
