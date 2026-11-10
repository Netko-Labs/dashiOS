// @dashi/applet: the applet SDK (docs/applets.md). The client and defineApplet for an applet's
// code; the manifest, permissions, packages, signatures, and the catalog for the store and the shell.

export { isRefusal, type Refusal } from "@dashi/shape";
export { isInsidePath } from "@dashi/shape/kit";
export { type Appearance, appearance, appearancePath, darkFrom } from "./appearance.ts";
export {
  type CatalogIndex,
  INDEX_FORMAT,
  type IndexApplet,
  type IndexVersion,
  installable,
  isPulled,
  type PulledVersion,
  parseIndex,
  type SkippedApplet,
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
  CONTROL_SPACING_MS,
  type CommandHandlers,
  type CommandRun,
  type ControlHandlers,
  type PopoverPlacement,
  type SocketHandlers,
} from "./client.ts";
export {
  type AppletCommand,
  ARG_TYPES,
  argSchema,
  COMMAND_LIMITS,
  COMMAND_MODES,
  type CommandArg,
  type CommandArgType,
  type CommandMode,
  type CommandResult,
  type CommandRow,
  checkArgs,
  parseCommands,
  parseResult,
  parseRows,
} from "./commands.ts";
export {
  type AppletControl,
  CONTROL_KINDS,
  CONTROL_LIMITS,
  CONTROL_SIZES,
  CONTROLS_PROTOCOL,
  type ControlAction,
  type ControlKind,
  type ControlSize,
  type ControlUpdate,
  checkUpdate,
  KIND_SIZES,
  parseControlAction,
  parseControls,
  parseControlUpdate,
  parseShown,
} from "./controls.ts";
export { type ControlsApi, controlsApi } from "./controls-api.ts";
export {
  type AppletDefinition,
  type AppletHandle,
  type CommandAnswer,
  type CommandDefinition,
  defineApplet,
  findManifest,
  manifestPath,
  type PopoverProps,
  type ViewProps,
} from "./define.ts";
export {
  appletDataRoot,
  appletsRoot,
  COMMANDS_CONSENT,
  consentNames,
  type InstalledApplet,
  type InstallRecord,
  installFiles,
  isAllowed,
  isCatalogAddress,
  parseRecord,
  readInstalled,
  removeInstalled,
  scanInstalled,
  shouldRun,
  type UnreadableApplet,
  writeRecord,
} from "./installed.ts";
export {
  type Author,
  CATEGORIES,
  type Category,
  compareVersions,
  dashiSatisfies,
  type Manifest,
  manifestJson,
  parseManifest,
  readManifest,
} from "./manifest.ts";
export { type AppletMenuRow, choosable, MENU_LIMITS, type MenuRowSpec, parseMenu } from "./menu.ts";
export { PACKAGE_EXTENSION, type Packed, pack, packageName, SDK_VERSION, sha256, type Unpacked, unpack } from "./package.ts";
export {
  asksForPassword,
  CONTROLS_PERMISSION,
  cannotDo,
  consentLines,
  describePermission,
  FOLDERS,
  type Folder,
  folderLine,
  HARDWARE,
  type HardwareScope,
  type Permission,
  POWER_MODE_PERMISSION,
  parsePermission,
  permissionName,
  REACH,
  widens,
} from "./permissions.ts";
export { metalHost, type OpenPopover, openPopoverWindow, POPOVER_RADIUS, PopoverGround, type PopoverKeyboard, popoverSurface } from "./popover.tsx";
export {
  isPowerChoice,
  isPowerMode,
  POWER_MODES,
  POWER_PROTOCOL,
  type PowerChoice,
  type PowerMode,
  type PowerState,
  parsePowerAsk,
  parsePowerState,
} from "./power.ts";
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
  parseGlyph,
  type Stat,
  wireMessage,
} from "./protocol.ts";
export { generateKeys, type KeyPair, parsePublicKey, publicKeyLine, sign, verify } from "./signing/index.ts";
export { readTar, writeTar } from "./tar.ts";
export { describeWhen, fits, type Machine, parseWhen, type When } from "./when.ts";
