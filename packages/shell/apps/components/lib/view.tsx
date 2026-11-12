/**
 * Components (dev.dashi.components), the @dashi/ui gallery (docs/design.html,
 * UI-7): a page per control family and per token set in the sidebar, each
 * exhibit drawn in every state, in Light and Dark side by side. The window
 * itself follows Dark Mode (CO-8); the one control in its toolbar row says
 * which modes the exhibits are drawn in, and so does the View menu. ↑ and ↓
 * walk the pages.
 */

import { AppWindow, KeySink, Segmented, SidebarItem, SidebarSection } from "@dashi/ui";
import { ScrollView } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import { useAppMenus } from "../../kit/index.ts";
import { ButtonsPage, FieldsPage, PickersPage, SwitchesPage } from "./exhibits/controls.tsx";
import { AlertsPage, MenusPage, NoticesPage, ProgressPage } from "./exhibits/feedback.tsx";
import { ListsPage, RowsPage, ShortcutsPage } from "./exhibits/structure.tsx";
import { ColorsPage, GroundsPage, TintsPage, TypePage } from "./exhibits/tokens.tsx";
import { galleryMenus } from "./menus.ts";
import { MODES, type Mode, PAGES, type PageId, pageLabel, stepPage } from "./pages.ts";
import { ModeContext, OverlayContext } from "./specimen.tsx";

export const GALLERY_SIZE = { width: 1040, height: 700 } as const;

const PAGE_VIEWS: Readonly<Record<PageId, () => ReactNode>> = {
  buttons: () => <ButtonsPage />,
  pickers: () => <PickersPage />,
  switches: () => <SwitchesPage />,
  fields: () => <FieldsPage />,
  progress: () => <ProgressPage />,
  menus: () => <MenusPage />,
  alerts: () => <AlertsPage />,
  rows: () => <RowsPage />,
  lists: () => <ListsPage />,
  notices: () => <NoticesPage />,
  shortcuts: () => <ShortcutsPage />,
  colors: () => <ColorsPage />,
  grounds: () => <GroundsPage />,
  tints: () => <TintsPage />,
  type: () => <TypePage />,
};

export function GalleryWindow({ initialPage = "buttons" }: { initialPage?: PageId }) {
  const [page, setPage] = useState<PageId>(initialPage);
  const [mode, setMode] = useState<Mode>("both");
  const [overlay, setOverlay] = useState<ReactNode>(null);
  // Bumped when an overlay closes, so the window's keys come back to the sink.
  const [focus, setFocus] = useState(0);
  const show = (node: ReactNode): void => {
    setOverlay(node);
    if (node === null) setFocus((n) => n + 1);
  };
  const { menus, run } = galleryMenus({ mode, page, setMode, setPage });
  useAppMenus(menus, run);

  const sidebar = (["Controls", "Tokens"] as const).map((section) => (
    <SidebarSection key={section} title={section}>
      {PAGES.filter((each) => each.section === section).map((each) => (
        <SidebarItem key={each.id} testID={`page:${each.id}`} label={each.label} selected={each.id === page} compact onPress={() => setPage(each.id)} />
      ))}
    </SidebarSection>
  ));

  return (
    <OverlayContext.Provider value={show}>
      <ModeContext.Provider value={mode}>
        <AppWindow
          title={pageLabel(page)}
          sidebar={sidebar}
          toolbar={<Segmented testID="components:mode" options={MODES} value={mode} onChange={setMode} />}
          overlay={overlay}
        >
          {overlay === null && (
            <KeySink
              testID="components:keys"
              focusKey={focus}
              onKey={(key) => {
                if (key.kind === "up") setPage(stepPage(page, -1));
                else if (key.kind === "down") setPage(stepPage(page, 1));
              }}
            />
          )}
          <ScrollView key={page} testID={`components:page:${page}`} style={{ flex: 1, flexDirection: "column" }}>
            {PAGE_VIEWS[page]()}
          </ScrollView>
        </AppWindow>
      </ModeContext.Provider>
    </OverlayContext.Provider>
  );
}
