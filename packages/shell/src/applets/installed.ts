/**
 * Installed applets (`~/.local/share/dashi/applets/<id>/`): the record format
 * is the SDK's (@dashi/applet's installed.ts), shared by the store, the CLI,
 * and the launcher here.
 */

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
} from "@dashi/applet";
