/** An app as the Dock, the launcher and the apps that open others see it (its id, name, icon and how to start it), and the Metal host every app runs on. */

export interface App {
  /** The app id its windows report (xdg-toplevel app_id). */
  id: string;
  name: string;
  /** Full-color SVG or PNG path. */
  icon: string;
  /** Command line; absent for running apps the Dock cannot relaunch. */
  exec?: readonly string[];
  env?: Readonly<Record<string, string>>;
  /** Working directory; Bun apps read their tsconfig and bunfig from it. */
  cwd?: string;
  /** Its desktop entry asks for the discrete GPU (`PrefersNonDefaultGPU`; gpu-env.ts). */
  gpu?: "discrete";
}

const icons = new URL("../../../icons/", import.meta.url).pathname;
const mirin = new URL("../../../../../../mirin/", import.meta.url).pathname;

export function iconPath(name: string): string {
  return `${icons}${name}.svg`;
}

/** The Metal host binary every Metal app (and the shell) runs on. */
export const METAL_HOST = process.env.DASHI_METAL_HOST ?? `${mirin}crates/mirin-metal/target/release/mirin-metal-host`;
