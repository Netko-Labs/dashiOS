// @dashi/applet: the applet SDK (docs/applets.md). The client and defineApplet for an applet's
// code; the manifest, permissions, packages, signatures, and the catalog for the store and the shell.
export { type Appearance, appearance, appearancePath, darkFrom } from "./appearance.ts";
export {
  type CatalogIndex,
  INDEX_FORMAT,
  type IndexApplet,
  type IndexVersion,
  installable,
  isPulled,
  parseIndex,
  trustedComment,
  verifyIndex,
  verifyPackage,
} from "./catalog.ts";
export {
  type AppletHandlers,
  type AppletSpec,
  AppletsClient,
  type AppletsClientOptions,
  type ClientSocket,
  type PopoverPlacement,
  type SocketHandlers,
} from "./client.ts";
export { type AppletDefinition, type AppletHandle, defineApplet, findManifest, type PopoverProps } from "./define.ts";
export {
  appletDataRoot,
  appletsRoot,
  type InstalledApplet,
  type InstallRecord,
  installFiles,
  isAllowed,
  parseRecord,
  readInstalled,
  removeInstalled,
  shouldRun,
  writeRecord,
} from "./installed.ts";
export {
  type Author,
  CATEGORIES,
  type Category,
  compareVersions,
  dashiSatisfies,
  isInsidePath,
  type Manifest,
  manifestJson,
  parseManifest,
  readManifest,
} from "./manifest.ts";
export { type AppletMenuRow, choosable, MENU_LIMITS, type MenuRowSpec, parseMenu } from "./menu.ts";
export { PACKAGE_EXTENSION, type Packed, pack, packageName, SDK_VERSION, sha256, type Unpacked, unpack } from "./package.ts";
export { isRefusal, type Refusal } from "./parse.ts";
export {
  asksForPassword,
  cannotDo,
  consentLines,
  describePermission,
  FOLDERS,
  type Folder,
  HARDWARE,
  type HardwareScope,
  type Permission,
  parsePermission,
  permissionName,
  widens,
} from "./permissions.ts";
export { metalHost, type OpenPopover, openPopoverWindow, popoverSurface } from "./popover.tsx";
export {
  APPLET_LIMITS,
  APPLETS_SOCKET,
  type Applet,
  type AppletMessage,
  type AppletShellMessage,
  appletsSocketPath,
  fileStat,
  type Placement,
  PROTOCOL,
  parseApplet,
  parseAppletMessage,
  parseAppletShellMessage,
  type Stat,
} from "./protocol.ts";
export { generateKeys, type KeyPair, parsePublicKey, publicKeyLine, sign, verify } from "./signing/index.ts";
export { readTar, writeTar } from "./tar.ts";
export { describeWhen, fits, type Machine, parseWhen, type When } from "./when.ts";
