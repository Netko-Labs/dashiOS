// What other apps use of Files: its file chooser (dashi-dialog, the portal, Text Editor) and the
// machine it browses (Env). The Files app itself is main.tsx; everything else is private, in lib/.
export type { ChooserModel } from "./chooser/model.ts";
export { openChooser } from "./chooser/start.ts";
export type { ChooserViewProps } from "./chooser/types.ts";
export { AppChooser, ChooserView } from "./chooser/view.tsx";
export type { Env } from "./env.ts";
