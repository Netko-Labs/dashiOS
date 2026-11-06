/**
 * Components' menus in the menu bar: View, with the modes the exhibits are
 * drawn in (the toolbar's Light, Dark, Both) and the next and previous page.
 */

import type { MenuSpec } from "../kit/index.ts";
import { MODES, type Mode, PAGES, type PageId, stepPage } from "./pages.ts";

export interface GalleryMenuContext {
  mode: Mode;
  page: PageId;
  setMode(mode: Mode): void;
  setPage(page: PageId): void;
}

export function galleryMenus(context: GalleryMenuContext): { menus: MenuSpec[]; run: (id: string) => void } {
  const first = PAGES[0]?.id;
  const last = PAGES.at(-1)?.id;
  const menus: MenuSpec[] = [
    {
      id: "view",
      items: [
        ...MODES.map((mode) => ({ id: `mode:${mode.value}`, label: mode.label, checked: context.mode === mode.value })),
        { type: "separator" as const },
        { id: "page:previous", label: "Previous Page", enabled: context.page !== first },
        { id: "page:next", label: "Next Page", enabled: context.page !== last },
      ],
    },
  ];
  const run = (id: string): void => {
    const mode = MODES.find((each) => `mode:${each.value}` === id);
    if (mode) context.setMode(mode.value);
    else if (id === "page:previous") context.setPage(stepPage(context.page, -1));
    else if (id === "page:next") context.setPage(stepPage(context.page, 1));
  };
  return { menus, run };
}
