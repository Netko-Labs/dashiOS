/**
 * One applet process's connection (protocol.ts): its applets become menu bar
 * extras and go when it closes. Version 1 is as it always was. A `hello`
 * first makes it version 2: its manifest is checked against the installed
 * one (a sandboxed applet must say hello, and say what it was installed
 * as), and it may ask for popovers, which the shell places under the item,
 * grants the layer shell for (grants.ts), and closes on a click outside or
 * when another popover or a shell menu opens (popovers.ts).
 * Version 4 adds Dashi's power mode for an applet that asks for
 * `power.mode` (power.ts); version 5, its controls in Control Center
 * (controls.ts).
 *
 * A line too long, a flood of messages, or too many refused ones ends the
 * connection; a refused message otherwise leaves its applets as they were.
 */

import { type Manifest, permissionName } from "@dashi/applet";
import { nameApplet } from "../apps.ts";
import type { ExtraActions, ExtraMenuRow, ExtrasStore, MenuBarExtra } from "../extras/index.ts";
import { LineBuffer } from "../lines.ts";
import type { AppletCommands, CommandMessage } from "./commands.ts";
import type { AppletControls } from "./controls.ts";
import type { AppletGrants } from "./grants.ts";
import { type PopoverScreen, placePopover } from "./placement.ts";
import type { AppletPopovers } from "./popovers.ts";
import { type AppletPower, attachPower, mayChoosePower } from "./power.ts";
import { APPLET_LIMITS, type Applet, type AppletShellMessage, flattenRows, type Placement, PROTOCOL, parseAppletMessage, wireMessage } from "./protocol.ts";

/** Messages a connection may send in one second before it is cut off (a clock ticking once a second is far fewer). */
export const MAX_RATE = 30;
/** Refused messages a connection may send before it is cut off. */
export const MAX_REFUSED = 8;
/** Bytes waiting for an applet that does not read before it is cut off. */
const MAX_OUTBOX = 64 * 1024;

/** What a Bun socket offers a connection. */
export interface Wire {
  write(data: Uint8Array): number;
  terminate(): void;
}

/** What a connection needs of the shell beyond the extras. */
export interface AppletContext {
  extras: ExtrasStore;
  grants?: AppletGrants;
  /** The screen a popover goes on: the one clicked on (by output name), else the primary; null when none is known. */
  screen?(output: string | null): PopoverScreen | null | Promise<PopoverScreen | null>;
  /** One popover at a time, across applets and the shell's own menus (popovers.ts). */
  popovers?: AppletPopovers;
  /** The shell's sheet under an open popover that hears a click outside it; returns what takes it away. */
  catcher?(placement: Placement, onOutside: () => void): () => void;
  /** The installed applet this connection must be (its own socket in the sandbox). */
  installed?: Manifest;
  /** The launcher's commands (commands.ts): a version 3 connection answers its applet's. */
  commands?: Pick<AppletCommands, "attach">;
  /** Dashi's power mode (power.ts): a version 4 connection with `power.mode` hears it and may ask for a choice. */
  power?: AppletPower;
  /** Control Center's applet controls (controls.ts): a version 5 connection whose manifest declares them says their state. */
  controls?: Pick<AppletControls, "attach">;
  now?: () => number;
  parse?: typeof parseAppletMessage;
}

/** What the bar draws for an applet. */
export function appletExtra(key: string, applet: Applet, dev = false): MenuBarExtra {
  const icon =
    applet.glyph !== undefined
      ? { kind: "glyph" as const, markup: applet.glyph }
      : applet.icon !== undefined
        ? { kind: "image" as const, path: applet.icon }
        : null;
  return {
    key,
    source: "applet",
    title: applet.title,
    icon,
    ...(applet.label === undefined ? {} : { label: applet.label }),
    tooltip: applet.tooltip ?? applet.title,
    attention: applet.attention,
    menuOnClick: applet.click === "menu",
    hasMenu: applet.menu.length > 0,
    ...(dev ? { dev: true } : {}),
  };
}

/** An applet's menu rows as the bar's menus take them (submenus flattened under headings). */
export function appletRows(applet: Applet): ExtraMenuRow[] {
  return flattenRows(applet.menu);
}

/** Whether a hello's manifest is the installed one: same id, version, and permissions. */
export function sameManifest(hello: Manifest, installed: Manifest): boolean {
  const names = (manifest: Manifest): string => manifest.permissions.map(permissionName).sort().join("\n");
  return (
    hello.id === installed.id &&
    hello.version === installed.version &&
    names(hello) === names(installed) &&
    JSON.stringify(hello.commands) === JSON.stringify(installed.commands) &&
    JSON.stringify(hello.controls) === JSON.stringify(installed.controls)
  );
}

interface OpenPopover {
  id: string;
  close: () => void;
}

let serial = 0;

export class AppletConnection implements ExtraActions {
  private readonly lines = new LineBuffer();
  private readonly applets = new Map<string, Applet>();
  /** Keys in the extras store start with this; the applet's id follows. */
  private readonly prefix = `applet:${++serial}/`;
  private outbox: Uint8Array[] = [];
  private queued = 0;
  private refused = 0;
  private recent: number[] = [];
  private closed = false;
  private version = 1;
  private dev = false;
  private manifest: Manifest | null = null;
  /** Where each item was last clicked: the popover goes under it. */
  private readonly clicks = new Map<string, { x: number; output: string | null }>();
  private popover: OpenPopover | null = null;
  /** Its side of the launcher's commands, from a version 3 hello on. */
  private commands: ReturnType<AppletCommands["attach"]> | null = null;
  /** Stops telling it the power mode; set from a version 4 hello with `power.mode` on. */
  private stopPower: (() => void) | null = null;
  /** Its controls in Control Center, from a version 5 hello with `controls` on. */
  private controls: ReturnType<AppletControls["attach"]> | null = null;
  private readonly extras: ExtrasStore;
  private readonly now: () => number;
  private readonly parse: typeof parseAppletMessage;

  constructor(
    readonly pid: number,
    private readonly wire: Wire,
    context: ExtrasStore | AppletContext,
  ) {
    this.context = "put" in context ? { extras: context } : context;
    this.extras = this.context.extras;
    this.now = this.context.now ?? Date.now;
    this.parse = this.context.parse ?? parseAppletMessage;
  }

  private readonly context: AppletContext;

  /** The manifest it said hello with (version 2), or null. */
  get identity(): Manifest | null {
    return this.manifest;
  }

  receive(chunk: Uint8Array): void {
    if (this.closed) return;
    const lines = this.lines.push(chunk);
    if (this.lines.pending > APPLET_LIMITS.line) return this.end();
    for (const line of lines) {
      if (this.closed) return;
      if (line.trim()) this.handle(line);
    }
  }

  /** The socket can take more. */
  drain(): void {
    while (!this.closed && this.outbox.length > 0) {
      const next = this.outbox[0] as Uint8Array;
      const written = Math.max(this.wire.write(next), 0);
      this.queued -= Math.min(written, next.byteLength);
      if (written < next.byteLength) {
        this.outbox[0] = next.subarray(written);
        return;
      }
      this.outbox.shift();
    }
  }

  /** The socket closed, from either side: the applets go, and so do the popover and the grant. */
  closedBySocket(): void {
    if (this.closed) return;
    this.closed = true;
    this.popover?.close();
    this.popover = null;
    this.commands?.detach();
    this.commands = null;
    this.stopPower?.();
    this.stopPower = null;
    this.controls?.detach();
    this.controls = null;
    if (this.version >= 2) void this.context.grants?.forget(this.pid).catch(() => {});
    this.extras.dropWhere((extra) => extra.key.startsWith(this.prefix));
    this.applets.clear();
  }

  activate(key: string, x: number, y: number, output?: string): void {
    const applet = this.appletOf(key);
    if (!applet) return;
    // The item again while its popover is open closes it.
    if (this.popover?.id === applet.id) return this.dismissPopover(true);
    this.clicks.set(applet.id, { x, output: output ?? null });
    this.send({ type: "activate", id: applet.id, x: Math.round(x), y: Math.round(y) });
  }

  /** A middle click is a primary one for an applet. */
  secondaryActivate(key: string, x: number, y: number): void {
    this.activate(key, x, y);
  }

  menu(key: string): Promise<readonly ExtraMenuRow[]> {
    const applet = this.appletOf(key);
    return Promise.resolve(applet ? appletRows(applet) : []);
  }

  choose(key: string, item: string): void {
    const applet = this.appletOf(key);
    if (applet && chosen(applet, item)) this.send({ type: "select", id: applet.id, item });
  }

  private appletOf(key: string): Applet | undefined {
    return key.startsWith(this.prefix) ? this.applets.get(key.slice(this.prefix.length)) : undefined;
  }

  private send(message: AppletShellMessage): void {
    if (this.closed) return;
    const bytes = new TextEncoder().encode(`${JSON.stringify(wireMessage(message))}\n`);
    this.outbox.push(bytes);
    this.queued += bytes.byteLength;
    if (this.queued > MAX_OUTBOX) return this.end();
    this.drain();
  }

  private handle(line: string): void {
    const now = this.now();
    this.recent = [...this.recent.filter((at) => now - at < 1000), now];
    if (this.recent.length > MAX_RATE) return this.end();
    const message = this.parse(line, undefined, this.version);
    if ("error" in message) {
      // A sandboxed applet that doesn't say who it is first is not let in.
      if (this.context.installed && this.manifest === null) return this.end();
      return this.refuse(message.error);
    }
    if (message.type !== "hello" && this.context.installed && this.manifest === null) return this.end();
    switch (message.type) {
      case "hello":
        return this.hello(message.manifest, message.dev, message.protocol);
      case "result":
      case "items":
      case "view":
      case "dismiss-view":
        return this.command(message);
      case "power":
        return this.askPower(message.choice);
      case "control": {
        if (!this.controls) return this.refuse("control: declare it in applet.json’s controls, with the “controls” permission");
        const { type: _type, ...update } = message;
        const refused = this.controls.receive(update);
        return refused === null ? undefined : this.refuse(refused);
      }
      case "remove":
        if (this.popover?.id === message.id) this.dismissPopover(true);
        if (this.applets.delete(message.id)) this.extras.drop(this.prefix + message.id);
        return;
      case "applet": {
        const { applet } = message;
        if (!this.applets.has(applet.id) && this.applets.size >= APPLET_LIMITS.perConnection) {
          return this.refuse(`more than ${APPLET_LIMITS.perConnection} applets on one connection`);
        }
        this.applets.set(applet.id, applet);
        this.extras.put(appletExtra(this.prefix + applet.id, applet, this.dev), this);
        return;
      }
      case "popover":
        return void this.openPopover(message.id, message);
      case "dismiss":
        if (this.popover?.id === message.id) this.dismissPopover(false);
        return;
    }
  }

  private command(message: CommandMessage): void {
    if (!this.commands) return this.refuse(`${message.type === "dismiss-view" ? "dismiss" : message.type}: this applet has no commands`);
    this.commands.receive(message);
  }

  /** An ask for Automatic or a mode: a pick, as in Control Center, when its manifest says `power.mode`. */
  private askPower(choice: Parameters<AppletPower["choose"]>[0]): void {
    if (!mayChoosePower(this.context.installed ?? this.manifest)) return this.refuse("power: add “power.mode” to applet.json’s permissions");
    const power = this.context.power;
    if (!power) return this.refuse("power: this machine has no power modes");
    const refused = power.choose(choice);
    if (refused !== null) this.refuse(refused);
  }

  private hello(manifest: Manifest, dev: boolean, protocol: number): void {
    if (this.manifest !== null || this.applets.size > 0) return this.refuse("hello comes first, once");
    const installed = this.context.installed;
    if (installed && !sameManifest(manifest, installed)) {
      this.send({
        type: "error",
        message: `hello: this is not ${installed.id} ${installed.version} as installed (its id, version, permissions, commands, or controls differ)`,
      });
      return this.end();
    }
    this.manifest = manifest;
    nameApplet(manifest.id, manifest.name);
    // The older of what it speaks and what the shell does.
    this.version = Math.min(protocol, PROTOCOL);
    // A sandboxed applet is never a developer's.
    this.dev = dev && !installed;
    void this.context.grants?.register(this.pid).catch((error) => console.error("dashi-shell: applet grants:", error));
    this.send({ type: "welcome", protocol: this.version });
    // Its commands are carried out on this connection (commands.ts); an installed one's are as installed.
    if (this.version >= 3 && manifest.commands.length > 0 && this.context.commands) {
      this.commands = this.context.commands.attach({
        manifest: installed ?? manifest,
        dev: this.dev,
        send: (message) => this.send(message),
        grant: (on) => this.context.grants?.set(this.pid, on) ?? Promise.resolve(),
      });
    }
    // The power mode now, and on every change, for an applet that asked for it (an installed one as installed).
    if (this.version >= 4 && this.context.power && mayChoosePower(installed ?? manifest)) {
      this.stopPower = attachPower(this.context.power, (state) => this.send({ type: "power", ...state }));
    }
    // Its controls (an installed one's as installed): their state comes in, presses go out.
    const declared = installed ?? manifest;
    if (this.version >= 5 && this.context.controls && declared.controls.length > 0 && declared.permissions.some((each) => each.kind === "controls")) {
      this.controls = this.context.controls.attach({ manifest: declared, send: (message) => this.send(message) });
    }
  }

  private async openPopover(id: string, size: { width: number; height: number }): Promise<void> {
    if (!this.applets.has(id)) return this.refuse(`popover: there is no applet “${id}”`);
    const click = this.clicks.get(id) ?? null;
    const screen = (await this.context.screen?.(click?.output ?? null)) ?? null;
    if (this.closed) return;
    if (!screen) return this.refuse("popover: there is no screen to put it on");
    this.popover?.close();
    const placement = placePopover(size, click?.x ?? null, screen);
    const namespace = `dashi.applet.${this.manifest?.id ?? "dev"}`;
    let removeCatcher: (() => void) | null = null;
    let release: (() => void) | null = null;
    const open: OpenPopover = {
      id,
      close: () => {
        removeCatcher?.();
        removeCatcher = null;
        release?.();
        release = null;
        void this.context.grants?.set(this.pid, false).catch(() => {});
      },
    };
    this.popover = open;
    try {
      await this.context.grants?.set(this.pid, true);
    } catch (error) {
      this.popover = null;
      return this.refuse(`popover: the compositor didn't grant it (${String(error)})`);
    }
    // It may have been dismissed, or the connection gone, while the grant was on its way.
    if (this.popover !== open || this.closed) return open.close();
    removeCatcher = this.context.catcher?.(placement, () => this.dismissPopover(true)) ?? null;
    // Another applet's popover, or a shell menu, closes as this one opens.
    release = this.context.popovers?.opened(() => this.dismissPopover(true)) ?? null;
    this.send({ type: "popover", id, namespace, ...placement });
  }

  /** The popover goes; `tell` sends `dismiss` (the shell closed it, not the applet). */
  private dismissPopover(tell: boolean): void {
    const open = this.popover;
    if (!open) return;
    this.popover = null;
    open.close();
    if (tell) this.send({ type: "dismiss", id: open.id });
  }

  private refuse(error: string): void {
    if (++this.refused > MAX_REFUSED) return this.end();
    this.send({ type: "error", message: error });
  }

  private end(): void {
    if (this.closed) return;
    this.closedBySocket();
    this.wire.terminate();
  }
}

/** Whether `item` is a row of the applet's menu that can be chosen now. */
function chosen(applet: Applet, item: string): boolean {
  return appletRows(applet).some((row) => row.kind === "item" && !row.heading && row.id === item && row.enabled);
}
