/**
 * A program's own items in Dashi's menu bar: the client lives in
 * @dashi/applet now (packages/applet/src/client.ts, docs/applets.md), with
 * popovers, submenus, and the manifest; the kit's index names it for
 * apps. `appletsClient()` is the process's one connection, version 1
 * (no manifest), as it always was.
 */

import { AppletsClient, appletsSocketPath } from "@dashi/applet";

let shared: AppletsClient | null = null;

/** The process's applets connection. */
export function appletsClient(): AppletsClient {
  shared ??= new AppletsClient({ path: appletsSocketPath() });
  return shared;
}
