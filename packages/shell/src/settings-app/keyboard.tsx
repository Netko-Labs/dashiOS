/**
 * Keyboard: how fast keys repeat, and the layout. The layout list is every
 * layout xkb knows (searchable), with the chosen layout's variants beside it,
 * the kit's pick rows in the selection look (SE-10), and the layout has one
 * name in the row and the picker (layouts.ts `layoutName`).
 * Choices go to settings.json `keyboard`, which the shell sends to dashi-comp.
 * The input method (settings.json `inputMethod.engine`) is what the session
 * runs to type other scripts (input-method.ts).
 * Clipboard history and snippets are here too (clipboard-parts.tsx).
 */

import { PickList, PickRow, RADIUS, SEARCH_FIELD, SearchField, SPACE } from "@dashi/ui";
import { ScrollView, View } from "@mirinjs/metal";
import { type ReactNode, useState } from "react";
import type { Laptop } from "../laptop/start.ts";
import { Caption, Group, Note, useSurface } from "../shared/cards/index.ts";
import { KEYBOARD as KEYBOARD_KNOB, REPEAT } from "../shared/settings/index.ts";
import { useSettings } from "./hooks.ts";
import { layoutName, primaryLayout, searchLayouts, variantsOf, type XkbLayouts } from "./layouts.ts";
import { DEFAULTS, describeDelay, describeRate, REPEAT_DELAY, REPEAT_RATE } from "./lib/controls.ts";
import { ClipboardSection, type HistoryControl, type InstalledApp } from "./lib/panes/clipboard-parts.tsx";
import { KeyboardLightSection } from "./lib/panes/laptop-parts.tsx";
import { Setting } from "./lib/setting.tsx";
import { Spot } from "./spot.tsx";
import type { SettingsStore } from "./store.ts";
import { Page, Slider } from "./ui.tsx";

/** The two lists sunk in the field's ground, side by side, each scrolling on its own. */
const LIST = { height: 196, padding: SPACE.xs, gap: SPACE.gap } as const;

function List({ children, testID }: { children: ReactNode; testID: string }) {
  const surface = useSurface();
  return (
    <ScrollView
      testID={`${testID}:scroll`}
      style={{ flex: 1, height: LIST.height, flexDirection: "column", padding: LIST.padding, borderRadius: RADIUS.control, backgroundColor: surface.field }}
    >
      <PickList testID={testID}>{children}</PickList>
    </ScrollView>
  );
}

/** The search over the layouts, as wide as its row. */
function LayoutSearch({ query, onQuery }: { query: string; onQuery: (query: string) => void }) {
  const [width, setWidth] = useState<number>(SEARCH_FIELD.width);
  return (
    <View style={{ alignSelf: "stretch" }} onLayout={(laid) => setWidth((was) => (Math.abs(was - laid.width) < 0.5 ? was : laid.width))}>
      <SearchField look="panel" testID="keyboard-search" value={query} placeholder="Search layouts" width={width} onChangeText={onQuery} />
    </View>
  );
}

export function LayoutPicker({ layouts, settings }: { layouts: XkbLayouts; settings: SettingsStore }) {
  const [query, setQuery] = useState("");
  const { keyboard } = useSettings(settings).data;
  const current = primaryLayout(keyboard.layout);
  // A value with several layouts ("us,de") was set by hand; picking one here replaces it.
  const several = (keyboard.layout ?? "").includes(",");
  const shown = searchLayouts(layouts.layouts, query);
  const variants = variantsOf(layouts.variants, current);
  // One name everywhere: the row says it, the variants' first row is the layout's own name, and the chosen one is lit.
  const name = layoutName(layouts, keyboard.layout, keyboard.variant);
  const plain = layouts.layouts.find((layout) => layout.id === current)?.name ?? current;
  return (
    <Setting id="keyboard/layout" detail={`${name}${several ? " (and other layouts; picking one here replaces them)" : ""}`}>
      <LayoutSearch query={query} onQuery={setQuery} />
      <View style={{ alignSelf: "stretch", flexDirection: "row", gap: LIST.gap }}>
        <List testID="keyboard-layouts">
          {shown.length === 0 && <Note>No layouts found.</Note>}
          {shown.map((layout) => (
            <PickRow
              key={layout.id}
              testID={`keyboard-layout:${layout.id}`}
              label={layout.name}
              chosen={layout.id === current && !several}
              // A new layout drops the old one's variant, which belonged to it.
              onPress={() => settings.patch("keyboard", { layout: layout.id, variant: undefined })}
            />
          ))}
        </List>
        <List testID="keyboard-variants">
          {variants.length === 0 ? (
            <Note>No variants.</Note>
          ) : (
            <>
              <PickRow
                testID="keyboard-variant:default"
                label={plain}
                chosen={!keyboard.variant}
                onPress={() => settings.patch("keyboard", { variant: undefined })}
              />
              {variants.map((variant) => (
                <PickRow
                  key={variant.id}
                  testID={`keyboard-variant:${variant.id}`}
                  label={variant.name}
                  chosen={keyboard.variant === variant.id}
                  onPress={() => settings.patch("keyboard", { layout: current, variant: variant.id })}
                />
              ))}
            </>
          )}
        </List>
      </View>
    </Setting>
  );
}

/** Fcitx 5 is installed (the only input method offered: input-method.ts). */
const HAS_FCITX = Bun.which("fcitx5") !== null;

/** The input method the session runs, or how to get one. */
function InputMethodRow({ installed }: { installed: boolean }) {
  if (!installed)
    return (
      <Spot id="keyboard/input-method">
        <Note testID="keyboard-no-input-method">To type Chinese, Japanese, Korean and other scripts, install Fcitx 5 from the Store.</Note>
      </Spot>
    );
  return <Setting id="keyboard/input-method" control="keyboard-input-method" />;
}

export function KeyboardPane({
  settings,
  layouts,
  laptop,
  clipboard,
  installed,
}: {
  settings: SettingsStore;
  layouts: XkbLayouts;
  laptop?: Laptop | null;
  clipboard?: HistoryControl | null;
  /** The installed app an id stands for: the clipboard's left-out list draws its name and icon. */
  installed?: InstalledApp;
}) {
  const { keyboard } = useSettings(settings).data;
  const rate = keyboard.repeatRate ?? DEFAULTS.repeatRate;
  const delay = keyboard.repeatDelay ?? DEFAULTS.repeatDelay;
  return (
    <Page title="Keyboard">
      <Group>
        <Setting id="keyboard/key-repeat" detail="Off at the left, fast at the right.">
          <Slider
            testID="keyboard-rate"
            value={rate}
            range={REPEAT_RATE}
            glyph={REPEAT}
            format={describeRate}
            onCommit={(value) => settings.patch("keyboard", { repeatRate: value })}
          />
        </Setting>
        <Setting id="keyboard/repeat-delay" detail="Short at the left, long at the right.">
          <Slider
            testID="keyboard-delay"
            value={delay}
            range={REPEAT_DELAY}
            glyph={KEYBOARD_KNOB}
            format={describeDelay}
            onCommit={(value) => settings.patch("keyboard", { repeatDelay: value })}
          />
        </Setting>
      </Group>
      <Group>
        {layouts.layouts.length === 0 ? (
          <Note testID="keyboard-no-layouts">No keyboard layouts found on this computer.</Note>
        ) : (
          <LayoutPicker layouts={layouts} settings={settings} />
        )}
      </Group>
      <Caption>A new layout applies in a moment, to every app.</Caption>
      <Group>
        <InputMethodRow installed={HAS_FCITX} />
      </Group>
      <KeyboardLightSection laptop={laptop ?? null} />
      <ClipboardSection settings={settings} history={clipboard ?? null} {...(installed ? { installed } : {})} />
    </Page>
  );
}
