/**
 * The applet's end of the channel (protocol.ts, docs/applets.md): one
 * connection per process, each applet sent whole whenever it changes, the
 * shell's clicks, chosen rows, and popover placements handed back. With a
 * manifest it speaks version 2 (hello first, then popovers and submenus);
 * without one, version 1, as the app kit's client always has. When the shell
 * restarts, the client connects again, says hello again, and sends every
 * applet again; an open popover is dismissed (the shell that placed it is gone).
 *
 *   const applets = new AppletsClient({ path: appletsSocketPath(), manifest });
 *   applets.show({ id: "timer", title: "Timer", glyph: TIMER_SVG, label: "4:59" }, {
 *     onActivate: () => applets.requestPopover("timer", { width: 280, height: 190 }),
 *     onPopover: (placement) => openMyWindowThere(placement),
 *     onDismiss: () => closeMyWindow(),
 *   });
 */

import { ControlSender } from "./client-controls.ts";
import type { AppletHandlers, AppletSpec, AppletsClientOptions, CommandHandlers, ControlHandlers } from "./client-types.ts";
import { Wire } from "./client-wire.ts";
import type { CommandResult, CommandRow } from "./commands.ts";
import { CONTROLS_PROTOCOL, type ControlUpdate } from "./controls.ts";
import { manifestJson } from "./manifest.ts";
import { POWER_PROTOCOL, type PowerChoice, type PowerState } from "./power.ts";
import { type AppletShellMessage, PROTOCOL, parseApplet, parseAppletShellMessage } from "./protocol.ts";

export class AppletsClient {
  private readonly lines = new Map<string, string>();
  private readonly handlers = new Map<string, AppletHandlers>();
  /** Popovers asked for or open, by applet id. */
  private readonly popovers = new Set<string>();
  private commands: CommandHandlers | null = null;
  /** The protocol the shell answered with; 0 before its welcome. */
  private shellProtocol = 0;
  /** Views asked for or open, by run. */
  private readonly views = new Set<number>();
  /** Dashi's power mode as the shell last said it (protocol 4, `power.mode`); null when it doesn't. */
  private power: PowerState | null = null;
  private readonly powerListeners = new Set<(state: PowerState | null) => void>();
  private readonly controls: ControlSender;
  private controlHandlers: ControlHandlers | null = null;
  private shown: readonly string[] = [];
  private readonly wire: Wire;

  constructor(private readonly options: AppletsClientOptions) {
    this.wire = new Wire(options, {
      wanted: () => this.lines.size > 0,
      opened: () => this.opened(),
      line: (line) => this.receive(line),
      lost: () => this.lost(),
    });
    const now = options.now ?? Date.now;
    this.controls = new ControlSender({
      ready: () => this.wire.connected && this.drawsControls,
      write: (line) => this.wire.write(line),
      later: (fn, ms) => this.wire.later(fn, ms),
      now,
    });
  }

  /** Whether the shell is listening (a Dashi session). */
  get available(): boolean {
    return this.wire.available;
  }

  /** Whether this client speaks version 2 (it has a manifest). */
  get version(): number {
    return this.options.manifest ? PROTOCOL : 1;
  }

  /** Show or update an applet; `handlers` replace the ones it had when given. Invalid applets are refused here, with the reason on stderr. */
  show(spec: AppletSpec, handlers?: AppletHandlers): boolean {
    const parsed = parseApplet(spec, undefined, this.version >= 2);
    if ("error" in parsed) {
      console.error(`dashi applets: “${spec.id}” not shown: ${parsed.error}`);
      return false;
    }
    if (handlers) this.handlers.set(spec.id, handlers);
    const line = `${JSON.stringify({ type: "applet", applet: spec })}\n`;
    if (this.lines.get(spec.id) === line) return true;
    this.lines.set(spec.id, line);
    if (this.wire.connected) this.wire.write(line);
    else this.wire.start();
    return true;
  }

  remove(id: string): void {
    if (this.popovers.has(id)) this.dismiss(id);
    this.handlers.delete(id);
    if (!this.lines.delete(id)) return;
    if (this.wire.connected) this.wire.write(`${JSON.stringify({ type: "remove", id })}\n`);
  }

  /** Ask for a popover under the item `id`; the placement comes to `onPopover`. Needs a manifest (version 2). */
  requestPopover(id: string, size: { width: number; height: number }): boolean {
    if (this.version < 2 || !this.lines.has(id) || !this.wire.connected) return false;
    this.popovers.add(id);
    this.wire.write(`${JSON.stringify({ type: "popover", id, width: Math.round(size.width), height: Math.round(size.height) })}\n`);
    return true;
  }

  /** The applet closed its popover (Esc, a choice made in it). */
  dismiss(id: string): void {
    if (!this.popovers.delete(id)) return;
    if (this.wire.connected) this.wire.write(`${JSON.stringify({ type: "dismiss", id })}\n`);
  }

  isPopoverOpen(id: string): boolean {
    return this.popovers.has(id);
  }

  /** Answer the launcher's commands (the manifest's `commands`; protocol 3). */
  onCommands(handlers: CommandHandlers | null): void {
    this.commands = handlers;
  }

  /** Whether the shell speaks protocol 3 (it runs commands). */
  get runsCommands(): boolean {
    return this.shellProtocol >= 3;
  }

  /** What run `seq` came to: a line, text to copy, something to open, or why not. */
  result(seq: number, result: CommandResult): void {
    this.answer({ type: "result", seq, ...result });
  }

  /** A pick command's rows for run `seq` (its query). */
  items(seq: number, rows: readonly CommandRow[]): void {
    this.answer({ type: "items", seq, rows });
  }

  /** Run `seq` draws its answer itself, `height` points tall, where the launcher's rows were; the place comes to `onView`. */
  requestView(seq: number, height: number): void {
    this.views.add(seq);
    this.answer({ type: "view", seq, height: Math.round(height) });
  }

  /** The applet closed the view of run `seq` itself. */
  dismissView(seq: number): void {
    if (this.views.delete(seq)) this.answer({ type: "dismiss", seq });
  }

  /**
   * Dashi's power mode (protocol 4, with `power.mode` in applet.json): the
   * choice, the mode in effect and why. Null while not connected, on an older
   * Dashi, or without the permission: feature-detect with it.
   */
  get powerMode(): PowerState | null {
    return this.power;
  }

  /** Hear the power mode change (and go null when the shell is gone); returns what stops it. */
  onPowerMode(listener: (state: PowerState | null) => void): () => void {
    this.powerListeners.add(listener);
    return () => this.powerListeners.delete(listener);
  }

  /** Ask Dashi for Automatic or a mode, as a pick in Control Center; false when Dashi doesn't offer it here (`powerMode` is null) or lacks that mode. */
  choosePowerMode(choice: PowerChoice): boolean {
    const power = this.power;
    if (!this.wire.connected || this.shellProtocol < POWER_PROTOCOL || !power) return false;
    if (choice !== "automatic" && !power.available.includes(choice)) return false;
    this.wire.write(`${JSON.stringify({ type: "power", choice })}\n`);
    return true;
  }

  /**
   * A control's state (protocol 5, the manifest's `controls`): what is given
   * replaces those parts, the rest stays. Sent at most 4 times a second per
   * control (a newer one waiting replaces the one before), and again
   * whenever the shell says welcome. False for a control the manifest
   * doesn't declare.
   */
  updateControl(update: ControlUpdate): boolean {
    const declared = this.options.manifest?.controls.some((control) => control.id === update.id) ?? false;
    if (!declared) {
      console.error(`dashi applets: there is no control “${update.id}” in applet.json`);
      return false;
    }
    this.controls.update(update);
    return true;
  }

  /** Hear Control Center's presses (protocol 5). */
  onControls(handlers: ControlHandlers | null): void {
    this.controlHandlers = handlers;
  }

  /** Whether the shell speaks protocol 5 (it draws controls). */
  get drawsControls(): boolean {
    return this.shellProtocol >= CONTROLS_PROTOCOL;
  }

  /** Which of its controls are in the person's Control Center, as the shell last said. */
  get shownControls(): readonly string[] {
    return this.shown;
  }

  private setPower(state: PowerState | null): void {
    if (state === this.power || JSON.stringify(state) === JSON.stringify(this.power)) return;
    this.power = state;
    for (const listener of [...this.powerListeners]) listener(state);
  }

  private answer(message: Record<string, unknown>): void {
    if (this.wire.connected && this.runsCommands) this.wire.write(`${JSON.stringify(message)}\n`);
  }

  close(): void {
    this.wire.close();
  }

  /** Connected: say hello (with a manifest), then send every applet again. */
  private opened(): void {
    const { manifest, dev } = this.options;
    if (manifest)
      this.wire.write(`${JSON.stringify({ type: "hello", protocol: PROTOCOL, manifest: manifestJson(manifest), ...(dev ? { dev: true } : {}) })}\n`);
    for (const line of this.lines.values()) this.wire.write(line);
  }

  /** The shell is gone: what it placed is dismissed. */
  private lost(): void {
    this.shellProtocol = 0;
    this.setPower(null);
    this.controls.drop();
    // The shell that placed them is gone.
    for (const id of [...this.popovers]) {
      this.popovers.delete(id);
      this.handlers.get(id)?.onDismiss?.();
    }
    for (const seq of [...this.views]) {
      this.views.delete(seq);
      this.commands?.onViewDismiss?.(seq);
    }
  }

  private receive(line: string): void {
    this.options.onMessage?.("in", line);
    const message = parseAppletShellMessage(line);
    if (message) this.handle(message);
  }

  private handle(message: AppletShellMessage): void {
    switch (message.type) {
      case "welcome":
        this.shellProtocol = message.protocol;
        this.controls.sendAll();
        return;
      case "controls":
        if (!this.drawsControls) return;
        this.shown = message.shown;
        this.controlHandlers?.onShown?.(message.shown);
        return;
      case "control-action": {
        if (!this.drawsControls) return;
        const { type: _type, ...action } = message;
        this.controlHandlers?.onAction(action);
        return;
      }
      case "power": {
        if (this.shellProtocol < POWER_PROTOCOL) return;
        const { type: _type, ...state } = message;
        this.setPower(state);
        return;
      }
      case "run": {
        const { type: _type, ...run } = message;
        this.commands?.onRun(run);
        return;
      }
      case "view": {
        if (!this.views.has(message.seq)) return;
        const { type: _type, seq, ...placement } = message;
        this.commands?.onView?.(seq, placement);
        return;
      }
      case "dismiss-view":
        if (this.views.delete(message.seq)) this.commands?.onViewDismiss?.(message.seq);
        return;
      case "error":
        console.error(`dashi applets: the shell refused: ${message.message}`);
        return;
      case "activate":
        this.handlers.get(message.id)?.onActivate?.(message.x, message.y);
        return;
      case "select":
        this.handlers.get(message.id)?.onSelect?.(message.item);
        return;
      case "popover": {
        if (!this.popovers.has(message.id)) return;
        const { type: _type, id, ...placement } = message;
        this.handlers.get(id)?.onPopover?.(placement);
        return;
      }
      case "dismiss":
        if (this.popovers.delete(message.id)) this.handlers.get(message.id)?.onDismiss?.();
        return;
    }
  }
}
