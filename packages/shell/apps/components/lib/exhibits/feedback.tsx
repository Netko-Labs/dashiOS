/** The gallery's feedback pages: progress, menus, alerts, and notices with empty states. */

import {
  Alert,
  AlertSheet,
  Appearance,
  Button,
  ConfirmSheet,
  EmptyState,
  glyphs,
  Loading,
  MENU_SEPARATOR,
  type MenuEntry,
  MenuList,
  Notice,
  PopupMenu,
  ProgressBar,
  Spinner,
  useDark,
} from "@dashi/ui";
import { type Bounds, View } from "@mirinjs/metal";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Caption, Exhibit, PageBody, useOverlay } from "../specimen.tsx";

const noop = (): void => {};

/** A fraction that fills over a few seconds and starts again, so the bar is seen moving. */
function useFilling(): number {
  const [value, setValue] = useState(0.15);
  useEffect(() => {
    const timer = setInterval(() => setValue((now) => (now >= 1 ? 0 : Math.min(1, now + 0.05))), 250);
    return () => clearInterval(timer);
  }, []);
  return value;
}

export function ProgressPage() {
  const filling = useFilling();
  return (
    <PageBody>
      <Exhibit title="Progress bar" note="Fills to how much is done; small in a row, regular on its own.">
        <Caption>Small, 40%</Caption>
        <ProgressBar testID="progress:small" value={0.4} width={240} />
        <Caption>Regular, filling</Caption>
        <ProgressBar testID="progress:regular" value={filling} size="regular" width={240} />
      </Exhibit>
      <Exhibit title="Indeterminate" note="When how much is done isn't known, a segment slides across and back.">
        <ProgressBar testID="progress:indeterminate" value={null} width={240} />
        <ProgressBar testID="progress:indeterminate-regular" value={null} size="regular" width={240} />
      </Exhibit>
      <Exhibit title="Spinner" note="A wait with nothing to measure: 16 beside a word, 24 or 32 on its own.">
        <View style={{ flexDirection: "row", alignItems: "center", gap: 16 }}>
          <Spinner size={16} testID="spinner:16" />
          <Spinner size={24} testID="spinner:24" />
          <Spinner size={32} testID="spinner:32" />
        </View>
      </Exhibit>
      <Exhibit title="Loading" note="Content on its way. Nothing shows for 200 ms, so a quick load never flashes.">
        <View style={{ height: 60, flexDirection: "column" }}>
          <Loading testID="loading:demo" label="Loading the catalog…" />
        </View>
      </Exhibit>
    </PageBody>
  );
}

const MENU_ITEMS: readonly MenuEntry[] = [
  { label: "Open", keys: "❖O", onPress: noop },
  { label: "Open With…", onPress: noop },
  MENU_SEPARATOR,
  { label: "Show Hidden Files", keys: "⇧❖.", checked: true, onPress: noop },
  { label: "View as List", checked: false, onPress: noop },
  MENU_SEPARATOR,
  { label: "Paste", keys: "❖V", disabled: true, onPress: noop },
  { label: "Move to Trash", keys: "❖⌫", onPress: noop },
];

/** A button that opens the menu under itself, as a right-click or a toolbar's menu would. */
function OpenMenu() {
  const show = useOverlay();
  const dark = useDark();
  const laid = useRef<Bounds | null>(null);
  const open = (): void => {
    const at = laid.current;
    show(
      <Appearance dark={dark}>
        <PopupMenu testID="menu:live" x={at?.x ?? 0} y={(at?.y ?? 0) + (at?.height ?? 0) + 4} items={MENU_ITEMS} onClose={() => show(null)} />
      </Appearance>,
    );
  };
  return (
    <View
      style={{ flexDirection: "row" }}
      onLayout={(bounds) => {
        laid.current = bounds;
      }}
    >
      <Button testID={`menu:open:${dark ? "dark" : "light"}`} label="Open the menu" onPress={open} />
    </View>
  );
}

export function MenusPage() {
  return (
    <PageBody>
      <Exhibit
        title="Menu"
        note="Rows in groups with separators, a tick for an option that is on, the shortcut drawn after. It opens at the point and stays inside the window."
      >
        <MenuList testID="menu:still" items={MENU_ITEMS} />
        <OpenMenu />
      </Exhibit>
    </PageBody>
  );
}

function OpenAlerts() {
  const show = useOverlay();
  const dark = useDark();
  const close = (): void => show(null);
  const wrap = (node: ReactNode): void => show(<Appearance dark={dark}>{node}</Appearance>);
  const id = dark ? "dark" : "light";
  return (
    <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 8 }}>
      <Button
        testID={`alert:open:confirm:${id}`}
        label="Ask"
        onPress={() =>
          wrap(<ConfirmSheet title="Save the changes?" message="They are kept until you close." confirmLabel="Save" onConfirm={close} onCancel={close} />)
        }
      />
      <Button
        testID={`alert:open:danger:${id}`}
        label="Ask to delete"
        onPress={() =>
          wrap(<ConfirmSheet title="Delete “Groceries”?" message="You can’t undo this." confirmLabel="Delete" danger onConfirm={close} onCancel={close} />)
        }
      />
      <Button
        testID={`alert:open:inform:${id}`}
        label="Tell"
        onPress={() =>
          wrap(
            <AlertSheet
              question="That didn’t work"
              message="The file was moved while it was being copied."
              glyph={glyphs.WARNING}
              tone="warning"
              buttons={[{ label: "OK", testID: "alert:ok", onPress: close, kind: "primary" }]}
            />,
          )
        }
      />
    </View>
  );
}

export function AlertsPage() {
  return (
    <PageBody>
      <Exhibit
        title="Alert"
        note="The one frame for sheets, portal dialogs, and dashi-dialog: the glyph's tile, the question as the first line, what it means, the buttons. Esc presses the cancel button, Enter the default one."
      >
        <Alert
          question="Delete “Groceries”?"
          message="You can’t undo this."
          glyph={glyphs.WARNING}
          tone="danger"
          buttons={[
            { label: "Cancel", testID: "alert:still:cancel", onPress: noop, cancel: true, isDefault: true },
            { label: "Delete", testID: "alert:still:delete", onPress: noop, kind: "danger" },
          ]}
        />
      </Exhibit>
      <Exhibit title="A message that only informs" note="One button, which Esc and Enter press too.">
        <Alert
          question="“Terminal” can’t be quit from here."
          message="It is part of the session."
          glyph={glyphs.INFO}
          tone="accent"
          buttons={[{ label: "OK", testID: "alert:still:ok", onPress: noop, kind: "primary" }]}
        />
      </Exhibit>
      <Exhibit title="As sheets" note="Each opens over the window, in the mode of the column it was opened from.">
        <OpenAlerts />
      </Exhibit>
    </PageBody>
  );
}

export function NoticesPage() {
  return (
    <PageBody>
      <Exhibit title="Notice" note="Something happening, floating over the foot of the content: a job, an error with what to do, an Undo.">
        <Notice
          testID="notice:info"
          text="Moved “Groceries” to the Trash."
          action={<Button testID="notice:undo" label="Undo" onPress={noop} />}
          onDismiss={noop}
        />
        <Notice testID="notice:error" tone="error" text="Couldn’t save “Groceries”. The disk is full." />
      </Exhibit>
      <Exhibit title="Empty state" note="What goes here and how to add it.">
        <View style={{ height: 180, flexDirection: "column" }}>
          <EmptyState
            testID="empty:demo"
            glyph={glyphs.SEARCH}
            title="No results"
            message="Try another word, or search everywhere."
            action={<Button testID="empty:action" label="Search Everywhere" onPress={noop} />}
          />
        </View>
      </Exhibit>
    </PageBody>
  );
}
