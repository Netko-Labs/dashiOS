// Dashi's app kit: the runtime a first-party Metal app runs on (README "First-party apps").
// Its components are @dashi/ui's.

export { type AppletHandlers, type AppletSpec, AppletsClient } from "@dashi/applet";
export type { MenuItemSpec, MenuSpec } from "../../src/shared/app-menus/index.ts";
export { type Clipboard, systemClipboard } from "../../src/shared/clipboard/index.ts";
export { onWindowTyping, typingOf } from "../../src/shared/metal/index.ts";
export { followDarkMode } from "./appearance.ts";
export { appletsClient } from "./applet.ts";
export { type CloseAnswer, type CloseReason, CloseRequests, closeRequests, useCloseRequest, useCloseWithdrawn } from "./close.ts";
export { enabledIds, MenusClient, menusClient, useAppMenus } from "./menus.ts";
export { setProcessName } from "./name.ts";
export { type AppOptions, hostBinary, type RunningApp, runApp, type Size } from "./run.tsx";
export { onWindowVisibility } from "./visibility.ts";
