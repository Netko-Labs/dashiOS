/**
 * Which GPU an app the shell starts may wake. On a laptop whose screens run
 * on an AMD or Intel GPU beside an NVIDIA one, an app that only lists the
 * GPUs (Vulkan's loader opening every driver, Chromium and Electron asking
 * EGL for its devices) wakes the NVIDIA card from its sleep first: measured
 * on a laptop with an RTX 5070 Ti, 2.5 to 7 s before the app could start,
 * against 0.01 s with only the screen's GPU in view. So apps start seeing
 * only the GPU the screens are on (Mesa's EGL, that GPU's Vulkan driver), as
 * mirin's Metal host already limits itself (mirin-metal's gpu.rs). An app
 * whose desktop entry asks for the other GPU (`PrefersNonDefaultGPU`, which
 * Steam sets) starts on it instead, as GNOME and KDE do, so games keep the
 * NVIDIA card. Dashi's own apps get nothing here: their Metal hosts choose
 * for themselves, and Terminal's programs must see every GPU (prime-run).
 * A variable the person set wins over both.
 */

import { existsSync } from "node:fs";
import type { Card } from "./gpu.ts";

/** Kernel drivers of NVIDIA cards. */
const NVIDIA = new Set(["nvidia", "nouveau"]);

/** The Vulkan loader's driver filter for a Mesa GPU's kernel driver (as mirin's gpu.rs maps them). */
const VULKAN_FILTER: Record<string, string> = { amdgpu: "*radeon*", radeon: "*radeon*", i915: "*intel*", xe: "*intel*" };

/** glvnd's manifest for Mesa's EGL. */
export const MESA_EGL = "/usr/share/glvnd/egl_vendor.d/50_mesa.json";

/** The variables that steer an app's GPU; one already set means the person chose. */
const STEERING = [
  "VK_LOADER_DRIVERS_SELECT",
  "VK_DRIVER_FILES",
  "VK_ICD_FILENAMES",
  "__EGL_VENDOR_LIBRARY_FILENAMES",
  "__NV_PRIME_RENDER_OFFLOAD",
  "DRI_PRIME",
] as const;

export interface GpuEnvs {
  /** For most apps: only the GPU the screens are on. */
  display: Record<string, string>;
  /** For apps that ask for the other GPU. */
  discrete: Record<string, string>;
}

/**
 * The environments for apps on this machine: empty when there is nothing to
 * steer (one GPU, the screens on NVIDIA, a GPU this doesn't know).
 */
export function gpuEnvs(display: Card | null, cards: readonly Card[], exists: (path: string) => boolean = existsSync): GpuEnvs {
  const none: GpuEnvs = { display: {}, discrete: {} };
  const nvidia = cards.find((card) => card.driver !== null && NVIDIA.has(card.driver));
  if (!display?.driver || !nvidia?.driver || NVIDIA.has(display.driver)) return none;
  const filter = VULKAN_FILTER[display.driver];
  if (!filter) return none;
  // Environment variable names, as the loaders spell them.
  const variables = (pairs: [string, string][]): Record<string, string> => Object.fromEntries(pairs);
  return {
    display: variables([["VK_LOADER_DRIVERS_SELECT", filter], ...(exists(MESA_EGL) ? [["__EGL_VENDOR_LIBRARY_FILENAMES", MESA_EGL] as [string, string]] : [])]),
    discrete:
      nvidia.driver === "nvidia"
        ? variables([
            ["__NV_PRIME_RENDER_OFFLOAD", "1"],
            ["__VK_LAYER_NV_optimus", "NVIDIA_only"],
            ["__GLX_VENDOR_LIBRARY_NAME", "nvidia"],
          ])
        : variables([["DRI_PRIME", "1"]]),
  };
}

/** What an app is, as far as its GPU goes. */
export interface GpuApp {
  id: string;
  /** Its desktop entry asks for the discrete GPU. */
  gpu?: "discrete";
}

/** The variables to add for `app`, given the environment it starts from. */
export function gpuEnvFor(app: GpuApp, envs: GpuEnvs, current: Readonly<Record<string, string | undefined>>): Record<string, string> {
  if (app.id.startsWith("dev.dashi.")) return {};
  if (STEERING.some((name) => current[name] !== undefined)) return {};
  return app.gpu === "discrete" ? envs.discrete : envs.display;
}
