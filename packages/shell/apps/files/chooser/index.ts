// The file chooser: Files' browser with Open or Save at its foot, for the portal, dashi-dialog, and Dashi's own apps.
// What is asked (re-exported here: the chooser takes it), its filters and what is accepted are src/shared/files/chooser/.
export { type ChooserRequest, chooserRequest } from "../../../src/shared/files/chooser/request.ts";
export { ChooserModel, type ChooserOptions, type ChooserState, chooserShows, folderName, folderTrail, useChooser } from "./model.ts";
export { openChooser } from "./start.ts";
export { AppChooser, CHOOSER_SHEET, ChooserSheet, ChooserView, type ChooserViewProps } from "./view.tsx";
