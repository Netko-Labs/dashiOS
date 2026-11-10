/**
 * The one popover an applet connection may have open (connection.ts): placed
 * under the item that was clicked, given the layer shell while it is shown
 * (grants.ts), and closed on a click outside or when another popover or a
 * shell menu opens (popovers.ts).
 */

import type { AppletContext } from "./connection-context.ts";
import { placePopover } from "./placement.ts";
import type { AppletShellMessage } from "./protocol.ts";

interface OpenPopover {
  id: string;
  close: () => void;
}

/** What a slot needs of its connection. */
export interface PopoverHost {
  pid: number;
  context: AppletContext;
  isClosed(): boolean;
  isApplet(id: string): boolean;
  /** The layer-shell namespace of its popovers. */
  namespace(): string;
  send(message: AppletShellMessage): void;
  refuse(error: string): void;
}

export class PopoverSlot {
  /** Where each item was last clicked: the popover goes under it. */
  private readonly clicks = new Map<string, { x: number; output: string | null }>();
  private open: OpenPopover | null = null;

  constructor(private readonly host: PopoverHost) {}

  /** The applet whose popover is open, or null. */
  get id(): string | null {
    return this.open?.id ?? null;
  }

  clicked(id: string, x: number, output: string | null): void {
    this.clicks.set(id, { x, output });
  }

  async show(id: string, size: { width: number; height: number }): Promise<void> {
    const { host } = this;
    if (!host.isApplet(id)) return host.refuse(`popover: there is no applet “${id}”`);
    const click = this.clicks.get(id) ?? null;
    const screen = (await host.context.screen?.(click?.output ?? null)) ?? null;
    if (host.isClosed()) return;
    if (!screen) return host.refuse("popover: there is no screen to put it on");
    this.open?.close();
    const placement = placePopover(size, click?.x ?? null, screen);
    let removeCatcher: (() => void) | null = null;
    let release: (() => void) | null = null;
    const open: OpenPopover = {
      id,
      close: () => {
        removeCatcher?.();
        removeCatcher = null;
        release?.();
        release = null;
        void host.context.grants?.set(host.pid, false).catch(() => {});
      },
    };
    this.open = open;
    try {
      await host.context.grants?.set(host.pid, true);
    } catch (error) {
      this.open = null;
      return host.refuse(`popover: the compositor didn't grant it (${String(error)})`);
    }
    // It may have been dismissed, or the connection gone, while the grant was on its way.
    if (this.open !== open || host.isClosed()) return open.close();
    removeCatcher = host.context.catcher?.(placement, () => this.dismiss(true)) ?? null;
    // Another applet's popover, or a shell menu, closes as this one opens.
    release = host.context.popovers?.opened(() => this.dismiss(true)) ?? null;
    host.send({ type: "popover", id, namespace: host.namespace(), ...placement });
  }

  /** The popover goes; `tell` sends `dismiss` (the shell closed it, not the applet). */
  dismiss(tell: boolean): void {
    const open = this.open;
    if (!open) return;
    this.open = null;
    open.close();
    if (tell) this.host.send({ type: "dismiss", id: open.id });
  }

  /** The connection ended: the popover goes without a word. */
  close(): void {
    this.open?.close();
    this.open = null;
  }
}
