export { defaultHandlers, mergeDefaults, removeDefaults } from "./default-handlers.ts";
export {
  type DesktopAction,
  type DesktopEntry,
  desktopActions,
  desktopFields,
  desktopFiles,
  parseDesktopEntry,
  parseExec,
  splitList,
} from "./desktop-entry.ts";
export {
  EDITOR_MIME_TYPES,
  FIRST_PARTY,
  type FirstPartySpec,
  firstPartyApp,
  firstPartyApps,
  firstPartyKeywords,
  installedSpecs,
  PREVIEW_MIME_TYPES,
  shellDir,
} from "./first-party.ts";
export { cachedIcon, dataDirs, entryIcon, fileIcon, iconRoots, resolveIcon, themeIcon } from "./icons.ts";
export { type App, dockDefaults, iconPath, inTerminal, METAL_HOST, resolvePinned, spawnDetached } from "./list.ts";
