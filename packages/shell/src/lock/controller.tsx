/**
 * Locking the screen (⌃❖Q; later idle and the lid). The lock screen is a
 * Metal session-lock surface: while it's up, dashi-comp shows and feeds
 * nothing else (comp/src/lock.rs). It unlocks only after the password
 * checks out; if the lock screen dies first, the session stays locked and a
 * new one takes over, and a restarted shell does the same at startup.
 */

import { TextSelectionLook } from "@dashi/ui";
import { type NativeHostTransport, type NativeRoot, render } from "@mirinjs/metal";
import type { Compositor } from "../compositor.ts";
import { runPower } from "../menus/index.ts";
import { spawnShellHost } from "../shared/metal/host.ts";
import { Attempts, type Verdict } from "./attempts.ts";
import { accountPicture, checkPassword, displayName, lockedUser } from "./auth.ts";
import { LockScreen } from "./screen.tsx";

/** A lock screen that died comes back after this. */
const RESPAWN_MS = 1000;
/** After an unlock, whether it went through is checked this soon. */
const UNLOCK_CHECK_MS = 300;

export class LockController {
  private host: NativeHostTransport | null = null;
  private root: NativeRoot | null = null;
  private unlocking = false;
  private readonly user = lockedUser();
  private readonly attempts = new Attempts((password) => checkPassword(this.user, password));
  private name = this.user;

  constructor(private readonly compositor: Compositor) {
    void displayName(this.user).then((name) => {
      this.name = name;
    });
  }

  /** Startup: a session left locked (the shell restarted) gets its lock screen back. */
  async resume(): Promise<void> {
    const session = await this.compositor.session().catch(() => null);
    if (session?.locked) this.lock();
  }

  get isLocked(): boolean {
    return this.host !== null;
  }

  lock(): void {
    if (this.host) return;
    this.unlocking = false;
    const host = spawnShellHost({
      title: "Lock",
      appId: "dev.dashi.lock",
      width: 1280,
      height: 800,
      surface: { role: "lock" },
    });
    this.host = host;
    this.root = render(
      <TextSelectionLook>
        <LockScreen
          name={this.name}
          picture={accountPicture(this.user)}
          onSubmit={(password) => this.submit(password)}
          waitMs={() => this.attempts.waitMs()}
          // The Dashi menu's own path: logind on a real session, refused anywhere else.
          onPower={(what) => runPower(what)}
        />
      </TextSelectionLook>,
      host,
    );
    host.onClose(() => {
      if (this.host !== host) return;
      const unlocked = this.unlocking;
      this.root?.unmount();
      this.host = null;
      this.root = null;
      // Gone without unlocking (or dead before the unlock went through): the
      // compositor keeps the session locked, so put a lock screen back for
      // the person to get in. resume() asks first, so after an unlock this
      // does nothing.
      setTimeout(() => void this.resume(), unlocked ? UNLOCK_CHECK_MS : RESPAWN_MS);
    });
  }

  private async submit(password: string): Promise<Verdict> {
    const verdict = await this.attempts.try(password);
    if (verdict !== "right") return verdict;
    this.unlocking = true;
    // The host unlocks the session and exits; onClose cleans up.
    this.host?.unlock();
    return verdict;
  }
}
