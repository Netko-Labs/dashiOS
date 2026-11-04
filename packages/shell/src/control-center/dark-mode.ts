/**
 * Control Center's Dark Mode switch is what @dashi/ui paints by: each process
 * that renders (the shell, every first-party app) connects it once, before
 * its first render.
 */

import { setAppearanceSource } from "@dashi/ui";
import { controlFlags } from "./flags.ts";

export function connectDarkMode(): void {
  const flags = controlFlags();
  setAppearanceSource({ subscribe: flags.subscribe, isDark: () => flags.getSnapshot().dark });
}
