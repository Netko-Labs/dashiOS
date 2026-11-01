/**
 * The overlays the shell opens on demand (launcher, shortcut sheet, switcher):
 * at most one of each kind. A host can die by itself, or be closed and the
 * kind opened again before the first one's close is reported; that late
 * report must not remove the new overlay, so a slot is only cleared by the
 * handle that holds it.
 *
 * `showOn` first asks which screen to open on, which takes a moment; the kind
 * counts as open meanwhile (a second press toggles it off, a second request
 * does nothing), and closing it in that moment cancels the opening.
 */

import type { OverlayHandle } from "./overlay.tsx";

export class OverlaySlots<Kind extends string> {
  private readonly slots = new Map<Kind, OverlayHandle>();
  /** Kinds waiting for their screen, each with a token that closing the kind retires. */
  private readonly pending = new Map<Kind, symbol>();

  /** Whether `kind` is up or about to be. */
  has(kind: Kind): boolean {
    return this.slots.has(kind) || this.pending.has(kind);
  }

  /**
   * Opens `kind` on the screen `screen` names (undefined: the compositor's choice). A screen that
   * can't be found is the compositor's choice too.
   */
  async showOn(
    kind: Kind,
    screen: () => Promise<string | undefined>,
    open: (onClosed: () => void, output: string | undefined) => OverlayHandle,
  ): Promise<void> {
    if (this.has(kind)) return;
    const token = Symbol(kind);
    this.pending.set(kind, token);
    const output = await screen().catch(() => undefined);
    if (this.pending.get(kind) !== token) return;
    this.pending.delete(kind);
    this.show(kind, (onClosed) => open(onClosed, output));
  }

  /** Opens `kind`; `open` gets the callback to run when the overlay is gone, however it went. */
  show(kind: Kind, open: (onClosed: () => void) => OverlayHandle): void {
    // The handle is not known until `open` returns, and a host can die before that.
    let handle: OverlayHandle | null = null;
    let diedEarly = false;
    handle = open(() => {
      if (handle === null) diedEarly = true;
      else if (this.slots.get(kind) === handle) this.slots.delete(kind);
    });
    if (!diedEarly) this.slots.set(kind, handle);
  }

  close(kind: Kind): void {
    this.pending.delete(kind);
    const handle = this.slots.get(kind);
    this.slots.delete(kind);
    handle?.close();
  }

  closeAll(): void {
    for (const kind of [...this.slots.keys(), ...this.pending.keys()]) this.close(kind);
  }
}
