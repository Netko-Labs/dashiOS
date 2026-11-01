/**
 * What the person can choose about power. Settings does not exist yet, so
 * these are the defaults, read through a function so the settings work can
 * hand in the saved values without changing the code that asks.
 */

export interface PowerSettings {
  /** Lock the screen before the machine sleeps (the lid, the Sleep menu row, a timeout). */
  lockOnSleep: boolean;
}

export const DEFAULT_POWER_SETTINGS: PowerSettings = { lockOnSleep: true };
