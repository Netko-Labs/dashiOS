/** What an applet connection (connection.ts) is given: its socket and the shell's side. */

import type { Manifest, Placement, parseAppletMessage } from "@dashi/applet";
import type { ExtrasStore } from "../../extras/index.ts";
import type { AppletCommands } from "../commands.ts";
import type { AppletControls } from "../controls.ts";
import type { AppletPopovers } from "../popovers.ts";
import type { AppletPower } from "../power.ts";
import type { AppletGrants } from "./grants.ts";
import type { PopoverScreen } from "./placement.ts";

/** What a Bun socket offers a connection. */
export interface Wire {
  write(data: Uint8Array): number;
  terminate(): void;
}

/** What a connection needs of the shell beyond the extras. */
export interface AppletContext {
  extras: ExtrasStore;
  grants?: AppletGrants;
  /** The screen a popover goes on: the one clicked on (by output name), else the primary; null when none is known. */
  screen?(output: string | null): PopoverScreen | null | Promise<PopoverScreen | null>;
  /** One popover at a time, across applets and the shell's own menus (popovers.ts). */
  popovers?: AppletPopovers;
  /** The shell's sheet under an open popover that hears a click outside it; returns what takes it away. */
  catcher?(placement: Placement, onOutside: () => void): () => void;
  /** The installed applet this connection must be (its own socket in the sandbox). */
  installed?: Manifest;
  /** The launcher's commands (commands.ts): a version 3 connection answers its applet's. */
  commands?: Pick<AppletCommands, "attach">;
  /** Dashi's power mode (power.ts): a version 4 connection with `power.mode` hears it and may ask for a choice. */
  power?: AppletPower;
  /** Control Center's applet controls (controls.ts): a version 5 connection whose manifest declares them says their state. */
  controls?: Pick<AppletControls, "attach">;
  now?: () => number;
  parse?: typeof parseAppletMessage;
}
