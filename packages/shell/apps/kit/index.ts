// Dashi's app kit: the runtime a first-party Metal app runs on (README "First-party apps").
// Its components are @dashi/ui's.
export { followDarkMode } from "./appearance.ts";
export { type AppletHandlers, type AppletSpec, AppletsClient, appletsClient } from "./applet.ts";
export { type Clipboard, systemClipboard } from "./clipboard.ts";
export { enabledIds, type MenuItemSpec, type MenuSpec, MenusClient, menusClient, useAppMenus } from "./menus.ts";
export { type AppOptions, hostBinary, type RunningApp, runApp, type Size } from "./run.tsx";
export { onWindowVisibility } from "./visibility.ts";
