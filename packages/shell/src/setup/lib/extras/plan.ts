/**
 * What the person picked on the Extras page, and what that asks the helper
 * and Software to do. Pure.
 */

import { RECOMMENDED_APPS, RECOMMENDED_DEFAULTS, type RecommendedApp } from "../../../shared/software/index.ts";
import type { ExtraStep } from "./events.ts";

/** What this computer has, which decides what is offered and what is on at first. */
export interface ExtrasHardware {
  /** An NVIDIA graphics card is in it. */
  nvidia: boolean;
  /** dashi-nvidia is installed already (the image carries it). */
  nvidiaInstalled: boolean;
  /** dashi-gaming is installed already. */
  gamingInstalled: boolean;
}

export interface ExtrasChoices {
  codecs: boolean;
  nvidia: boolean;
  gaming: boolean;
  /** Flathub, and the recommended apps ticked under it. */
  flathub: boolean;
  apps: ReadonlySet<string>;
}

/** The page's switches before anyone touches them. */
export function defaultChoices(hardware: ExtrasHardware): ExtrasChoices {
  return {
    codecs: true,
    nvidia: hardware.nvidia && !hardware.nvidiaInstalled,
    gaming: false,
    flathub: true,
    apps: new Set(RECOMMENDED_DEFAULTS),
  };
}

/** The helper's steps for these choices, in the order it runs them. */
export function stepsFor(choices: ExtrasChoices, hardware: ExtrasHardware): ExtraStep[] {
  const steps: ExtraStep[] = [];
  if (choices.codecs) steps.push("codecs");
  if (choices.nvidia && hardware.nvidia && !hardware.nvidiaInstalled) steps.push("nvidia");
  if (choices.gaming && !hardware.gamingInstalled) steps.push("gaming");
  if (choices.flathub) steps.push("flathub");
  return steps;
}

/** The recommended apps to install from Flathub, in the list's order (none without Flathub). */
export function appsFor(choices: ExtrasChoices): RecommendedApp[] {
  return choices.flathub ? RECOMMENDED_APPS.filter((app) => choices.apps.has(app.id)) : [];
}

/** Whether the choices install anything at all. */
export const hasWork = (choices: ExtrasChoices, hardware: ExtrasHardware): boolean => stepsFor(choices, hardware).length > 0;

/** Each step as the pages name it. */
export const STEP_LABELS: Readonly<Record<ExtraStep, string>> = {
  codecs: "Media codecs",
  nvidia: "NVIDIA driver",
  gaming: "Gaming",
  flathub: "Flathub",
};

/** The same choices with one app ticked or unticked. */
export function toggleApp(choices: ExtrasChoices, id: string): ExtrasChoices {
  const apps = new Set(choices.apps);
  if (apps.has(id)) apps.delete(id);
  else apps.add(id);
  return { ...choices, apps };
}
