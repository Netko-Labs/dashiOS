/**
 * One popover at a time, the applets' and the shell's together, as the
 * menu bar's own menus are (menus/controller.ts): an applet's popover
 * opening closes the one another applet had open and the shell's menu or
 * panel; a shell menu opening closes the applet's popover. Each connection
 * (connection.ts) says when its popover opens and how to close it; the
 * shell says when one of its own opens (main.tsx). While one is open Esc
 * is the shell's (`onOpenChange`, boot/keys.ts): it closes the popover from
 * wherever the keyboard is.
 */

export class AppletPopovers {
  private open: { dismiss: () => void } | null = null;
  private shellMenus: () => void = () => {};
  private readonly listeners = new Set<(open: boolean) => void>();

  /** What closes the shell's own menus and panels when an applet's popover opens. */
  closeShellMenusWith(close: () => void): void {
    this.shellMenus = close;
  }

  /**
   * An applet's popover opened; `dismiss` closes it. The popover open
   * before it closes, and so do the shell's menus. Returns what the
   * connection calls when it closes by itself (idempotent).
   */
  opened(dismiss: () => void): () => void {
    const before = this.open;
    const entry = { dismiss };
    this.open = entry;
    before?.dismiss();
    this.shellMenus();
    if (!before) this.tell();
    return () => {
      if (this.open !== entry) return;
      this.open = null;
      this.tell();
    };
  }

  /** A shell menu or panel opened, or Esc was pressed: the applet's popover closes. */
  dismiss(): void {
    const open = this.open;
    if (!open) return;
    this.open = null;
    open.dismiss();
    this.tell();
  }

  /** Hears when a popover opens (true) and when none is open any more (false). Returns what stops it. */
  onOpenChange(listener: (open: boolean) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }

  private tell(): void {
    for (const listener of this.listeners) listener(this.open !== null);
  }

  isOpen(): boolean {
    return this.open !== null;
  }
}

/** What the shell's menus offer (menus/controller.ts's MenuController). */
export interface ShellMenus {
  subscribe(listener: () => void): () => void;
  getSnapshot(): { popover: unknown; bar?: string };
  close(): void;
}

/**
 * Joins the applets' popovers to the shell's menus: a menu or panel opening
 * (or the keyboard going to the bar, ⌃F2) closes an applet's popover, and an
 * applet's popover opening closes the menus. Returns what undoes it.
 */
export function joinShellMenus(popovers: AppletPopovers, menus: ShellMenus): () => void {
  const up = (): boolean => {
    const { popover, bar } = menus.getSnapshot();
    return popover !== null || bar !== undefined;
  };
  popovers.closeShellMenusWith(() => {
    if (up()) menus.close();
  });
  const stop = menus.subscribe(() => {
    if (up()) popovers.dismiss();
  });
  return () => {
    stop();
    popovers.closeShellMenusWith(() => {});
  };
}
