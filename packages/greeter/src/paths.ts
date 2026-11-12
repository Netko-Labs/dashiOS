/** Where the Metal host is: DASHI_METAL_HOST (set by session/dashi-greeter), else the installed one. */

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const INSTALLED = "/usr/libexec/dashi/mirin-metal-host";
const CHECKOUT = fileURLToPath(new URL("../../../../mirin/crates/mirin-metal/target/release/mirin-metal-host", import.meta.url));

export function metalHost(env: Record<string, string | undefined> = process.env): string {
  if (env.DASHI_METAL_HOST) return env.DASHI_METAL_HOST;
  return existsSync(CHECKOUT) ? CHECKOUT : INSTALLED;
}
