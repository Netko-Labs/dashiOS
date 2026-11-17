// @dashi/applet: the applet SDK (docs/applets.md). The client and defineApplet for an applet's
// code; the manifest, permissions, packages, signatures, and the catalog for the store and the shell.

export { isRefusal, type Refusal } from "@dashi/shape";
export { isInsidePath } from "@dashi/shape/kit";
export { type AccountWanted, accountsOf, parseAccounts } from "./accounts.ts";
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
export { AppletsClient } from "./client.ts";
export {
  type AppletHandlers,
  type AppletSpec,
  type AppletsClientOptions,
  type ClientSocket,
  CONTROL_SPACING_MS,
  type CommandHandlers,
  type CommandRun,
  type ControlHandlers,
  type PopoverPlacement,
  type SocketHandlers,
} from "./client-types.ts";
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
  isTreeMode,
  parseCommands,
  parseResult,
  parseRows,
  TREE_MODES,
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
export { defineApplet } from "./define.ts";
export type { AppletDefinition, AppletHandle, CommandAnswer, CommandDefinition, PopoverProps, ViewProps } from "./define-types.ts";
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
export { findManifest, manifestPath } from "./manifest-file.ts";
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
  proxiedHosts,
  REACH,
  refusedProvider,
  usesNetwork,
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
  launcherOnly,
  PREFERENCE_TYPES,
  type Preference,
  type PreferenceType,
  parsePreferences,
  parseShows,
  SHOWS,
  type Shows,
  showsOf,
} from "./preferences.ts";
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
export {
  ACTION_KINDS,
  type AccountGiven,
  type ActionKind,
  applyPatch,
  diffTrees,
  ELEMENTS,
  type ElementType,
  FIELDS,
  type FieldType,
  type FieldValue,
  fieldValueOf,
  findNode,
  isViewType,
  nodeAt,
  type PatchOp,
  type PreferenceValue,
  parseTree,
  parseViewMessage,
  parseWidgetTree,
  ROOTS,
  TOAST_STYLES,
  TONES,
  type ToastStyle,
  type Tone,
  TREE_LIMITS,
  textProp,
  toWire,
  VIEW_PROTOCOL,
  type ViewEvent,
  type ViewMessage,
  type ViewNode,
  type ViewShellMessage,
  WIDGET_ROOTS,
} from "./view/index.ts";
export { describeWhen, fits, type Machine, parseWhen, type When } from "./when.ts";
export { type AppletWidget, type AppletWidgetSize, parseWidgets, WIDGET_PRIVACY, WIDGET_SIZES } from "./widgets.ts";
