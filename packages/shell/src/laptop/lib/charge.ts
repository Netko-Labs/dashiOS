/**
 * Keeps the charge limit where battery health says (power/battery-health.ts):
 * on start, when the settings or the power source change, and every minute
 * (for the schedule). Writes only when the target differs from what the
 * knob holds; ends a one-time full charge when it is done.
 */

import { chargeTarget, fullChargeDone } from "../../power/battery-health.ts";
import type { PowerSource } from "../../power/modes/automatic.ts";
import type { PowerSection } from "../../power/modes/settings.ts";
import type { LaptopStore } from "../store.ts";

export const CHARGE_TICK_MS = 60_000;

export interface ChargeKeeperDeps {
  laptop: LaptopStore;
  settings(): PowerSection;
  /** Ends the one-time full charge in the settings. */
  endFullCharge(): void;
  now?(): Date;
}

export class ChargeKeeper {
  private source: PowerSource | null = null;
  private wasPlugged = false;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly deps: ChargeKeeperDeps) {}

  start(): () => void {
    this.timer = setInterval(() => void this.check(), CHARGE_TICK_MS);
    void this.check();
    return () => clearInterval(this.timer);
  }

  setPowerSource(source: PowerSource): void {
    this.source = source;
    void this.check();
  }

  async check(): Promise<void> {
    const knob = this.deps.laptop.knob("charge-limit");
    if (!knob) return;
    const settings = this.deps.settings();
    if (settings.fullChargeOnce && this.source) {
      if (fullChargeDone(this.source, this.wasPlugged)) {
        this.wasPlugged = false;
        this.deps.endFullCharge();
        return;
      }
      this.wasPlugged ||= this.source.plugged;
    } else {
      this.wasPlugged = false;
    }
    const target = chargeTarget(settings, this.deps.now?.() ?? new Date());
    if (target.percent === null || knob.value === target.percent) return;
    await this.deps.laptop.set("charge-limit", target.percent);
  }
}
