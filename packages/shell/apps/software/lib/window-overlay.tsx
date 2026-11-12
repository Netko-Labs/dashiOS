/**
 * The sheet Software shows over its page, if any, in order: the screenshot,
 * the catalogs, the question or consent sheet at the head of the queue, then
 * the failure of a change. One at a time; the page is under it.
 */

import type { ReactNode } from "react";
import { AppletConsentSheet, type StoreImages } from "../../../src/shared/applet-store/index.ts";
import { CatalogsSheet } from "./applets/catalogs-sheet.tsx";
import type { AppletStore } from "./applets/store.ts";
import { PictureView } from "./gallery.tsx";
import { FailureSheet, Question } from "./sheets.tsx";
import type { SoftwareState } from "./store.ts";
import type { WindowSheets } from "./use-window-sheets.ts";

export interface WindowOverlayInput {
  sheets: WindowSheets;
  failure: SoftwareState["failure"];
  applets: AppletStore;
  appletImages: StoreImages;
}

/** A plain function, not a component: the overlay is the sheet's element or nothing. */
export function windowOverlay({ sheets, failure, applets, appletImages }: WindowOverlayInput): ReactNode {
  const ask = sheets.asks[0];
  if (sheets.picture) return <PictureView file={sheets.picture} onClose={() => sheets.setPicture(null)} />;
  if (sheets.catalogs) return <CatalogsSheet onClose={sheets.closeCatalogs} />;
  if (ask?.kind === "consent") {
    return (
      <AppletConsentSheet
        manifest={ask.entry.manifest}
        kind={ask.update ? "update" : "get"}
        reviewed={ask.entry.reviewed}
        signed
        granted={applets.granted(ask.entry.manifest.id)}
        icon={appletImages.cached(ask.entry.icon ?? null)}
        onAnswer={(yes) => sheets.answer({ yes })}
      />
    );
  }
  if (ask) return <Question ask={ask} onAnswer={sheets.answer} />;
  if (failure) return <FailureSheet failure={failure} onClose={sheets.closeFailure} />;
  return undefined;
}
