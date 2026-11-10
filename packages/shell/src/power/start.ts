/**
 * Sleep, the lid, and the power key, through systemd-logind:
 *
 *  - before the machine sleeps (the lid, the Sleep row, a sleep key,
 *    `systemctl suspend`) the screen is locked (sleep.ts);
 *  - `loginctl lock-session` locks the screen, and the screen's state is
 *    reported back as the session's lock hint (session.ts);
 *  - the power key asks before shutting down (powerkey.ts);
 *  - the Sleep row locks first, then suspends through logind.
 *
 * The lid is logind's: its default (HandleLidSwitch=suspend, and "docked"
 * with an external monitor or power: ignore) is what Dashi wants, and the
 * suspend that follows goes through the same lock. Everything here is
 * optional: with no system bus, no logind, or a shell inside a development
 * window, it says so once and the rest of the shell goes on.
 */

import type { Compositor } from "../compositor/index.ts";
import { compositorAbove, isRealSession } from "../menus/index.ts";
import type { ConnectOptions } from "../shared/dbus/index.ts";
import { type Clock, systemClock } from "./lib/clock.ts";
import { logindLocks, type TakeLock } from "./lib/inhibit.ts";
import { LockWatch } from "./lib/lockwatch.ts";
import { sayOnce } from "./lib/log.ts";
import { POWER_KEY_LOCK, PowerKey } from "./lib/powerkey.ts";
import { ScreenLock } from "./lib/screenlock.ts";
import { watchSession } from "./lib/session.ts";
import { DEFAULT_POWER_SETTINGS, type PowerSettings } from "./lib/settings.ts";
import { SLEEP_LOCK, SleepGuard } from "./lib/sleep.ts";
import { Logind } from "./logind.ts";
import { powerOffReason } from "./nested.ts";

export interface PowerOptions {
  /** For the lock state; without it nothing can be locked or waited for. */
  compositor: Pick<Compositor, "on" | "power" | "session"> | null;
  /** Raises the lock screen; null without a compositor. */
  lock: (() => void) | null;
  /** Opens the shut down sheet (the power key). */
  confirmShutdown(): void;
  /** Suspends without logind (no bus, no logind, a development window). */
  fallbackSuspend(): void;
  settings?: () => PowerSettings;
  clock?: Clock;
  /** Which bus logind is on; the system bus unless a test says otherwise. */
  bus?: ConnectOptions;
  /** Why power handling stays off, or null to run; defaults to `powerOffReason()`. */
  off?: string | null;
  /**
   * Whether this is a real session (positively under a dashi-comp that is not
   * nested); defaults to the same test Log Out uses. Suspending is refused
   * otherwise, even with `DASHI_POWER=1` and a real bus: a development run
   * never sleeps the developer's machine.
   */
  realSession?: boolean;
}

export interface Power {
  /** Resolves when logind has been reached (or given up on); for tests. */
  ready: Promise<void>;
  /** The Sleep menu row: lock, then suspend through logind. */
  suspend(): Promise<void>;
  /** The power key was pressed. */
  powerKey(): void;
  close(): void;
}

export function startPower(options: PowerOptions): Power {
  const clock = options.clock ?? systemClock;
  const settings = options.settings ?? (() => DEFAULT_POWER_SETTINGS);
  const watch = new LockWatch(clock);
  const screen = new ScreenLock({ lock: options.lock, watch, settings, clock });
  const takeLock: TakeLock = logindLocks(options.bus);
  const key = new PowerKey({ take: () => takeLock(POWER_KEY_LOCK), confirm: options.confirmShutdown, isLocked: () => watch.isLocked });
  const stops: Array<() => void> = [];
  let logind: Logind | null = null;
  let guard: SleepGuard | null = null;
  let closed = false;

  const cleanup = () => {
    for (const stop of stops.splice(0)) stop();
    guard?.close();
    key.close();
    logind?.close();
  };

  const boot = async (): Promise<void> => {
    // The lock state serves the Sleep row even when logind is not used.
    if (options.compositor) stops.push(await watch.follow(options.compositor));
    const off = options.off === undefined ? powerOffReason() : options.off;
    if (off !== null) return void sayOnce("off", `off (${off}); sleep, the lid, and the power key are left to the system`);
    try {
      logind = await Logind.connect(options.bus);
    } catch (error) {
      return void sayOnce("no-logind", "no logind on the system bus; sleep, the lid, and the power key are left to the system", error);
    }
    logind.onClose(() => {
      if (!closed) sayOnce("bus-lost", "the system bus went away; sleep no longer locks the screen");
    });
    const sleepGuard = new SleepGuard({
      take: () => takeLock(SLEEP_LOCK),
      screen,
      // After a suspend KMS state may have changed: always reset the screens, whether or not they were on.
      woke: async () => void (await options.compositor?.power({ on: true, reset: true })),
    });
    guard = sleepGuard;
    // Listen first, so a sleep that starts while the lock is being taken is not missed.
    const stopSleep = await logind.onPrepareForSleep((sleeping) => void sleepGuard.prepare(sleeping));
    stops.push(() => void stopSleep().catch(() => {}));
    await sleepGuard.acquire();
    if (options.lock) stops.push(await watchSession({ logind, lock: options.lock, watch }));
    // The key only reaches us through the compositor.
    if (options.compositor) await key.hold();
  };

  const ready = boot()
    .catch((error) => sayOnce("setup", "setting up failed; some of it may be off", error))
    .then(() => {
      if (closed) cleanup();
    });

  return {
    ready,
    async suspend() {
      if (!(options.realSession ?? isRealSession(compositorAbove()))) {
        console.error("dashi-shell: power: not suspending: this is not a Dashi session of its own, so this machine is someone's desktop");
        return;
      }
      // Without the delay lock, sleep will not wait for the lock screen, so wait here.
      if (!guard?.holding) await screen.lockAndWait().catch(() => false);
      if (logind && !logind.closed) {
        try {
          await logind.suspend();
          return;
        } catch (error) {
          console.error("dashi-shell: power: logind would not suspend:", error instanceof Error ? error.message : error);
        }
      }
      options.fallbackSuspend();
    },
    powerKey: () => key.press(),
    close() {
      closed = true;
      cleanup();
    },
  };
}
