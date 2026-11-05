/**
 * A program's own items in Dashi's menu bar: the client lives in
 * @dashi/applet now (packages/applet/src/client.ts, docs/applets.md), with
 * popovers, submenus, and the manifest; this keeps the app kit's names
 * working. `appletsClient()` is the process's one connection, version 1
 * (no manifest), as it always was.
 */

import { AppletsClient, appletsSocketPath } from "@dashi/applet";

export { type AppletHandlers, type AppletSpec, AppletsClient, type AppletsClientOptions } from "@dashi/applet";

let shared: AppletsClient | null = null;

/** The process's applets connection. */
export function appletsClient(): AppletsClient {
  shared ??= new AppletsClient({ path: appletsSocketPath() });
  return shared;
}
