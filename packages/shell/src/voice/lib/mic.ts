/**
 * The microphone as the voice loop opens it: for a key held, and for a
 * listen that ends by itself (a tap of the Copilot key, or the one that
 * opens after Dashi's last sentence has played, for the reply). The second
 * kind is never left open: with nothing said it is given up.
 */

import type { Timers } from "../../shared/time/index.ts";
import type { Chip, ChipGo } from "../types.ts";
import { listenLanguage } from "./captions.ts";
import type { VoiceService } from "./service.ts";
import { TapListen } from "./tap-listen.ts";

/** After Dashi's last sample: this long, then the microphone opens for the reply. */
export const AGAIN_AFTER_MS = 300;
/** A listen that opened by itself is given up after this long with nothing said. */
export const AGAIN_WAIT_MS = 6000;

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export interface MicHost {
  service: VoiceService;
  timers: Timers;
  locale: string | undefined;
  /** The press this belongs to: a newer one makes it stale. */
  turn(): number;
  chip(): Chip | null;
  /** The chip while the microphone is open. */
  listening(): void;
  notice(text: string, go?: ChipGo, ms?: number): void;
  /** Nothing was said back: the chip rests, and the conversation's clock starts. */
  rest(): void;
  /** Whether a listen may open by itself now: nothing held, nothing said, Voice usable. */
  mayOpen(): boolean;
}

export class Mic {
  private readonly tapped: TapListen;
  private timer: unknown = null;
  /** The listen that runs opened by itself, after Dashi spoke. */
  private byItself = false;

  constructor(private readonly host: MicHost) {
    this.tapped = new TapListen(host.service, host.timers);
  }

  /** A listen that ends by itself runs, or is about to open. */
  get selfEnding(): boolean {
    return this.tapped.running || this.timer !== null;
  }

  /** One runs now. */
  get running(): boolean {
    return this.tapped.running;
  }

  /** One that opened by itself runs and has heard nothing yet: a key held takes its place. */
  get waiting(): boolean {
    const chip = this.host.chip();
    return this.byItself && this.tapped.running && chip?.kind === "listening" && chip.text === "";
  }

  /** The self-ending listen is over (its words came, a tap, a stop); whether one ran. */
  end(): boolean {
    if (this.timer !== null) this.host.timers.clear(this.timer);
    this.timer = null;
    this.byItself = false;
    return this.tapped.end();
  }

  cancel(): Promise<unknown> {
    return this.host.service.call("listen.cancel").catch(() => {});
  }

  /** Open the microphone; false, with the service's words in the chip, when it won't. */
  open(turn: number): Promise<boolean> {
    const language = listenLanguage(this.host.locale);
    return this.host.service.call("listen", language ? { language } : {}).then(
      () => true,
      (error) => {
        if (turn === this.host.turn()) this.host.notice(message(error), "voice");
        return false;
      },
    );
  }

  /** The open listen goes on and ends by itself once the person has talked and gone quiet; given up after `waitMs` of nothing. */
  async tap(turn: number, waitMs?: number): Promise<void> {
    const { host } = this;
    const nothing = (): void => {
      const chip = host.chip();
      if (chip?.kind === "listening" && chip.text !== "") return;
      this.tapped.end();
      void this.cancel();
      // Nothing came after Dashi spoke: no complaint, the conversation just rests.
      if (waitMs !== undefined) return host.rest();
      host.notice("I didn't hear anything.", undefined, 2500);
    };
    await this.tapped.begin(() => turn === host.turn(), nothing, waitMs).catch((error) => turn === host.turn() && host.notice(message(error), "voice"));
  }

  /** Dashi's last sentence has played: a moment later the microphone opens by itself, until the person goes quiet. */
  again(): void {
    const { host } = this;
    const turn = host.turn();
    if (this.timer !== null) host.timers.clear(this.timer);
    this.timer = host.timers.set(async () => {
      this.timer = null;
      if (turn !== host.turn() || !host.mayOpen()) return;
      host.listening();
      if (!(await this.open(turn)) || turn !== host.turn()) return;
      this.byItself = true;
      await this.tap(turn, AGAIN_WAIT_MS);
    }, AGAIN_AFTER_MS);
  }
}
