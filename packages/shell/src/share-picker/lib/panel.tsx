/**
 * The share picker (Mac-like "Share with…" sheet, spec card G): each screen
 * and each window as a live picture (the compositor draws them in the
 * frames here), a click chooses one, a double-click shares it at once;
 * "Hide notifications while sharing", then Cancel and Share. Esc cancels
 * and Return shares the chosen one.
 */

import { Button, Checkbox, isBuiltIn, RADIUS, SHADOW, TYPE, useColors, useSurface, WEIGHT } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useRef, useSyncExternalStore } from "react";
import type { Rect } from "../../layout.ts";
import { KeyCatcher } from "../../overlay.tsx";
import type { ShareChoice } from "../protocol.ts";
import { captionOf, type PickerLayout } from "./layout.ts";

export interface PickerScreen {
  output: string;
}

export interface PickerWindow {
  toplevel: string;
  title: string;
  app: string;
}

export interface PickerState {
  chosen: ShareChoice | null;
  quiet: boolean;
}

export class PickerStore {
  private state: PickerState = { chosen: null, quiet: true };
  private readonly listeners = new Set<() => void>();

  getSnapshot = (): PickerState => this.state;

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  set(change: Partial<PickerState>): void {
    this.state = { ...this.state, ...change };
    for (const listener of this.listeners) listener();
  }
}

export interface PickerProps {
  store: PickerStore;
  layout: PickerLayout;
  screens: readonly PickerScreen[];
  windows: readonly PickerWindow[];
  onDone(choice: ShareChoice | null): void;
}

const at = (rect: Rect) => ({ position: "absolute" as const, left: rect.x, top: rect.y, width: rect.width, height: rect.height });
const RING = 3;
const DOUBLE_CLICK_MS = 350;

/** What a screen is called in the picker: the built-in one by that, others by their connector. */
export const screenLabel = (output: string): string => (isBuiltIn(output) ? "Built-in screen" : output);

const same = (a: ShareChoice | null, b: ShareChoice): boolean => {
  if (a?.kind === "screen" && b.kind === "screen") return a.output === b.output;
  return a?.kind === "window" && b.kind === "window" && a.toplevel === b.toplevel;
};

/** A screen or a window to share: its frame (ringed when chosen) and its caption. */
function Picture({ testID, rect, chosen, caption, onPress }: { testID: string; rect: Rect; chosen: boolean; caption: string; onPress: () => void }) {
  const colors = useColors();
  return (
    <View>
      <View
        testID={testID}
        accessibilityRole="option"
        accessibilityLabel={caption}
        accessibilityState={{ selected: chosen }}
        onPress={onPress}
        style={{
          ...at({ x: rect.x - RING, y: rect.y - RING, width: rect.width + 2 * RING, height: rect.height + 2 * RING }),
          borderRadius: RADIUS.control,
          borderWidth: RING,
          borderColor: chosen ? colors.selection : colors.separator,
        }}
      />
      <View style={{ ...at(captionOf(rect)), alignItems: "center", justifyContent: "center" }}>
        <Text numberOfLines={1} style={{ fontSize: TYPE.caption.size, color: chosen ? colors.text : colors.textMuted }}>
          {caption}
        </Text>
      </View>
    </View>
  );
}

/** "Hide notifications while sharing", ticked or not: the kit's check box (UI-10). */
function QuietOption({ rect, quiet, onToggle }: { rect: Rect; quiet: boolean; onToggle: () => void }) {
  return (
    <View style={{ ...at(rect), justifyContent: "center" }}>
      <Checkbox testID="share-quiet" label="Hide notifications while sharing" checked={quiet} onChange={onToggle} />
    </View>
  );
}

export function SharePicker({ store, layout, screens, windows, onDone }: PickerProps) {
  const colors = useColors();
  const surface = useSurface();
  const { chosen, quiet } = useSyncExternalStore(store.subscribe, store.getSnapshot);
  const lastPress = useRef<{ choice: ShareChoice; at: number } | null>(null);
  const press = (choice: ShareChoice) => {
    const last = lastPress.current;
    if (last && same(last.choice, choice) && Date.now() - last.at < DOUBLE_CLICK_MS) {
      onDone(choice);
      return;
    }
    lastPress.current = { choice, at: Date.now() };
    store.set({ chosen: choice });
  };
  const picture = (key: string, rect: Rect, choice: ShareChoice, caption: string) => (
    <Picture key={key} testID={key} rect={rect} chosen={same(chosen, choice)} caption={caption} onPress={() => press(choice)} />
  );
  return (
    <View
      style={{
        width: layout.size.width,
        height: layout.size.height,
        borderRadius: RADIUS.sheet,
        backgroundColor: surface.card,
        borderWidth: 1,
        borderColor: colors.separator,
        shadow: SHADOW.xl,
      }}
    >
      <KeyCatcher onKey={(key) => key === "Escape" && onDone(null)} onSubmit={() => onDone(chosen)} />
      <View style={{ ...at(layout.title), justifyContent: "center" }}>
        <Text style={{ fontSize: TYPE.body.size, fontWeight: WEIGHT.bold, color: colors.text }}>Choose what to share</Text>
      </View>
      <View style={{ ...at(layout.screensHeading), justifyContent: "center" }}>
        <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>Screens</Text>
      </View>
      {screens.map((screen, index) => {
        const rect = layout.screens[index];
        return rect ? picture(`share-screen-${index}`, rect, { kind: "screen", output: screen.output }, screenLabel(screen.output)) : null;
      })}
      {layout.windowsHeading ? (
        <View style={{ ...at(layout.windowsHeading), justifyContent: "center" }}>
          <Text style={{ fontSize: TYPE.caption.size, fontWeight: WEIGHT.semibold, color: colors.textMuted }}>Windows</Text>
        </View>
      ) : null}
      {windows.map((window, index) => {
        const rect = layout.windows[index];
        return rect ? picture(`share-window-${index}`, rect, { kind: "window", toplevel: window.toplevel }, window.title || window.app) : null;
      })}
      <QuietOption rect={layout.option} quiet={quiet} onToggle={() => store.set({ quiet: !quiet })} />
      <View style={at(layout.cancel)}>
        <Button label="Cancel" testID="share-cancel" onPress={() => onDone(null)} />
      </View>
      <View style={at(layout.share)}>
        <Button label="Share" testID="share-share" primary disabled={chosen === null} onPress={() => chosen && onDone(chosen)} />
      </View>
    </View>
  );
}
