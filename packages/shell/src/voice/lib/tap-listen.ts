/**
 * A listen a tap began (the Copilot key, which many laptops can't hold:
 * keys.ts). The listen the key's press opened goes on after it comes up, and
 * the service ends it once the person has talked and gone quiet
 * (`listen.quiet`); with nothing heard at all it is given up on, so the
 * microphone is never left open.
 */

import type { Timers } from "../../shared/time/index.ts";
import { TAP_QUIET_MS, TAP_WAIT_MS } from "../keys.ts";
import type { VoiceService } from "./service.ts";

export class TapListen {
  private giveUp: unknown = null;
  private on = false;

  constructor(
    private readonly service: VoiceService,
    private readonly timers: Timers,
  ) {}

  /** One runs now. */
  get running(): boolean {
    return this.on;
  }

  /** The listen under way ends by itself from here; `waited` runs if nothing was heard in a while. Throws the service's refusal. */
  async begin(wanted: () => boolean, waited: () => void): Promise<void> {
    await this.service.call("listen.quiet", { quiet_ms: TAP_QUIET_MS });
    if (!wanted()) return;
    this.on = true;
    this.giveUp = this.timers.set(() => {
      this.giveUp = null;
      waited();
    }, TAP_WAIT_MS);
  }

  /** It is over (its words came, a second tap, a stop); whether one was running. */
  end(): boolean {
    const was = this.on;
    this.on = false;
    if (this.giveUp !== null) this.timers.clear(this.giveUp);
    this.giveUp = null;
    return was;
  }
}
