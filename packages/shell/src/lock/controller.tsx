/**
 * Locking the screen (⌃❖Q; later idle and the lid). The lock screen is a
 * Metal session-lock surface on every screen, a host each (lib/screens.ts,
 * D554): while it's up, dashi-comp shows and feeds nothing else
 * (comp/src/session/lock.rs). It follows the screens: one plugged in while
 * locked is covered, and the whole lock moves to a screen that is left when
 * its own goes. It unlocks only after the password checks out; if a lock
 * screen dies first, the session stays locked and a new one takes over, and
 * a restarted shell does the same at startup.
 */

import { TextSelectionLook } from "@dashi/ui";
import { type NativeHostTransport, type NativeRoot, render } from "@mirinjs/metal";
import { activeScreen } from "../active-screen.ts";
import type { Compositor } from "../compositor/index.ts";
import { screensOf } from "../displays.ts";
import { spawnShellHost } from "../shared/metal/index.ts";
import { runPower } from "../shutdown.ts";
import { Attempts, type Verdict } from "./lib/attempts.ts";
import { accountPicture, checkPassword, displayName, lockedUser } from "./lib/auth.ts";
import { startDevCapture } from "./lib/dev-capture.ts";
import { LockScreen, type LockPower as PowerAction } from "./lib/screen.tsx";
import { planLock } from "./lib/screens.ts";

/** A lock screen that died comes back after this. */
const RESPAWN_MS = 1000;
/** After an unlock, whether it went through is checked this soon. */
const UNLOCK_CHECK_MS = 300;

/** One screen's lock host. */
interface Shown {
  host: NativeHostTransport;
  root: NativeRoot;
  /** The output it covers; undefined: the compositor's choice. */
  output: string | undefined;
  /** The whole lock screen (else the cover). */
  main: boolean;
}

export type LockCompositor = Pick<Compositor, "session" | "outputs" | "windows" | "on" | "capture">;

export class LockController {
  private readonly shown = new Set<Shown>();
  /** Locked from the shell's side: from `lock()` until the password checks out. */
  private wanted = false;
  private unlocking = false;
  private syncing: Promise<void> = Promise.resolve();
  private stopScreens: (() => void) | null = null;
  private readonly user = lockedUser();
  private readonly attempts = new Attempts((password) => checkPassword(this.user, password));
  private name = this.user;

  constructor(
    private readonly compositor: LockCompositor,
    private readonly spawn: typeof spawnShellHost = spawnShellHost,
  ) {
    void displayName(this.user).then((name) => {
      this.name = name;
    });
  }

  /** Startup: a session left locked (the shell restarted) gets its lock screen back. */
  async resume(): Promise<void> {
    const session = await this.compositor.session().catch(() => null);
    if (session?.locked) this.lock();
  }

  /** The VM's picture of the real lock screen, when a checkout's session asks for it (lib/dev-capture.ts); never in an installed one. */
  devCapture(env: Readonly<Record<string, string | undefined>> = process.env): (() => void) | null {
    return startDevCapture(env, {
      locked: () => this.isLocked,
      capture: (path, output) => this.compositor.capture({ path, ...(output === undefined ? {} : { output }) }),
      screens: async () => screensOf(await this.compositor.outputs()).map((screen) => screen.name),
    });
  }

  get isLocked(): boolean {
    return this.wanted;
  }

  lock(): void {
    if (this.wanted) return;
    this.wanted = true;
    this.unlocking = false;
    // Screens plugged in or out while locked are covered or let go.
    this.stopScreens = this.compositor.on((event) => {
      if (event.event === "outputs-changed") this.sync();
    });
    this.sync();
  }

  /** A host on every screen, the whole lock screen on one (lib/screens.ts); one at a time. */
  private sync(): void {
    this.syncing = this.syncing.then(() => this.place()).catch((error) => console.error("dashi-shell: lock screen:", error));
  }

  private async place(): Promise<void> {
    if (!this.wanted) return;
    const screens = await this.compositor
      .outputs()
      .then((outputs) => screensOf(outputs).map((screen) => screen.name))
      .catch(() => [] as string[]);
    const person = this.shown.size === 0 ? await activeScreen(this.compositor) : undefined;
    const main = [...this.shown].find((each) => each.main);
    const plan = planLock(screens, person, main?.output);
    if (!this.wanted) return;
    for (const each of [...this.shown]) {
      const keep = each.main ? each.output === plan.main : each.output !== undefined && plan.covers.includes(each.output);
      if (!keep) this.close(each);
    }
    // The whole lock screen first: the person's keys and pointer are there.
    if (![...this.shown].some((each) => each.main)) this.open(plan.main, true);
    for (const output of plan.covers) if (![...this.shown].some((each) => !each.main && each.output === output)) this.open(output, false);
  }

  private open(output: string | undefined, main: boolean): void {
    const host = this.spawn({
      title: "Lock",
      appId: "dev.dashi.lock",
      width: 1280,
      height: 800,
      surface: { role: "lock", ...(output === undefined ? {} : { output }) },
    });
    const root = render(
      <TextSelectionLook>
        <LockScreen
          name={this.name}
          picture={accountPicture(this.user)}
          onSubmit={(password) => this.submit(host, password)}
          waitMs={() => this.attempts.waitMs()}
          // The Dashi menu's own path: logind on a real session, refused anywhere else.
          {...(main ? { onPower: (what: PowerAction) => runPower(what) } : { cover: true })}
        />
      </TextSelectionLook>,
      host,
    );
    const shown: Shown = { host, root, output, main };
    this.shown.add(shown);
    host.onClose(() => {
      if (!this.shown.delete(shown)) return;
      root.unmount();
      // Gone without unlocking (or dead before the unlock went through): the
      // compositor keeps the session locked, so put a lock screen back for
      // the person to get in. resume() asks first, so after an unlock this
      // does nothing.
      if (this.unlocking) return;
      setTimeout(() => this.sync(), RESPAWN_MS);
    });
  }

  /** Close one host from our side (its screen left, or the session unlocked). */
  private close(shown: Shown): void {
    if (!this.shown.delete(shown)) return;
    shown.root.unmount();
    shown.host.close();
  }

  private async submit(host: NativeHostTransport, password: string): Promise<Verdict> {
    const verdict = await this.attempts.try(password);
    if (verdict !== "right") return verdict;
    this.unlocking = true;
    this.wanted = false;
    this.stopScreens?.();
    this.stopScreens = null;
    // That host unlocks the session (every screen) and exits; the others go with it.
    host.unlock();
    for (const each of [...this.shown]) if (each.host !== host) this.close(each);
    // A cover whose lock came after the unlock would hold the session locked: then the lock screen comes back.
    setTimeout(() => void this.resume(), UNLOCK_CHECK_MS);
    return verdict;
  }
}
