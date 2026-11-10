/**
 * The keyboard (main.tsx): the keymap's shortcuts, ❖ taps and holds (keymap.ts,
 * shortcuts.ts), dashi:// links shown in the launcher, and the launcher's own
 * keyboard.
 *
 * The launcher's own keys come and go with it
 * (launcher/keys.ts), as the switcher's do; every ❖ chord is its own while Set
 * shortcut… records. From the tap until its field has the keyboard every plain
 * key is typed ahead (launcher/type-ahead.ts): the compositor switches to those
 * rules itself at the tap, and `typing` says so for an open without one
 * (Search…); `begin` hands the keys to the field once its surface has drawn.
 */

import type { Actions } from "../actions/index.ts";
import type { PressedChord } from "../app-menus/shortcut.ts";
import type { Compositor } from "../compositor.ts";
import { currentKeymap, idleKeymap, setPersonRules } from "../keymap-state.ts";
import { type LauncherKeys, type LauncherPrefs, TYPE_BINDING, TypeAhead, typedFrom, withLauncher, withTyping } from "../launcher/index.ts";
import type { Menus } from "../menus/index.ts";
import type { OverlaySlots } from "../overlay-slots.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { startShortcuts } from "../shortcuts.ts";
import { SwitcherController } from "../switcher/index.ts";
import type { Programs } from "./apps.ts";
import type { Desktops } from "./desktop.ts";
import type { LauncherParts } from "./launcher.tsx";
import type { OverlayKind, Switcher } from "./overlays.tsx";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Screens, Stores } from "./session.ts";
import type { SettingsApps, SettingsWindows } from "./settings.ts";
import type { Guards, SystemStores } from "./system.ts";

/** Longer than this without word that the launcher drew, its field is given the keys anyway. */
export const TYPE_AHEAD_LIMIT_MS = 3000;
/** How long the typed-ahead keys must be quiet and played in before the field takes the keyboard. */
const HANDOFF_MS = 60;

export class LauncherKeyboard {
  readonly typeAhead = new TypeAhead();
  /** Whether the open launcher's field has the keyboard yet (it waits for what was typed ahead). */
  private handedOff = false;
  private handoff: ReturnType<typeof setTimeout> | null = null;
  private personKeys = "";

  constructor(
    private readonly compositor: Compositor | null,
    readonly keys: LauncherKeys,
    private readonly overlays: OverlaySlots<OverlayKind>,
  ) {
    keys.onRecording = () => {
      if (overlays.has("launcher")) this.again();
    };
    // ← and → are the launcher's while a row's windows can show (launcher/pictures.ts); they wait for the field like every key.
    // The agents' keys (⌥1–9, ❖⌫, ⌫ on a chip, ❖,) are the launcher's only while they mean something there.
    keys.onExtras = () => {
      if (overlays.has("launcher") && this.handedOff) this.fieldKeys();
    };
    keys.onArrows = () => {
      if (overlays.has("launcher") && this.handedOff) this.fieldKeys();
    };
  }

  /** Plain keys type ahead, until the field has the keyboard. */
  private typingKeys(): void {
    void this.compositor?.keymap(withTyping(currentKeymap())).catch((error) => console.error("dashi-shell: the launcher's keys:", error));
  }

  /** The field's keys: the launcher's own, with what it wants now (recording, arrows, the agents' keys). */
  private fieldKeys(): void {
    void this.compositor
      ?.keymap(withLauncher(currentKeymap(), this.keys.recording, this.keys.arrowsWanted, this.keys.extrasWanted))
      .catch((error) => console.error("dashi-shell: the launcher's keys:", error));
  }

  /** The keymap of no launcher. */
  private idleKeys(): void {
    void this.compositor?.keymap(idleKeymap()).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error));
  }

  /** The open launcher's keys again (a key set, recording a shortcut): the field's, or still typing ahead. */
  private again(): void {
    if (this.handedOff) this.fieldKeys();
    else this.typingKeys();
  }

  /**
   * The person's aliases and keys (settings.json `launcher`; launcher/person-keys.ts): a key they set
   * reaches the compositor at once, and an edit of the file by hand too.
   */
  followPersonKeys(prefs: LauncherPrefs, settingsStore: SettingsStore, services: Services): void {
    const follow = () => {
      const rules = prefs.rules();
      const text = JSON.stringify(rules);
      if (text === this.personKeys) return;
      this.personKeys = text;
      setPersonRules(rules);
      if (this.overlays.has("launcher")) this.again();
      else if (!this.overlays.has("switcher")) this.idleKeys();
    };
    follow();
    services.add("person keys", settingsStore.subscribe(follow));
  }

  /**
   * The field takes the keyboard once what was typed ahead is in it, and no key came for a moment:
   * a key typed while it was still playing them in would reach it first (launcher/type-ahead.ts).
   */
  followTypeAhead(): void {
    this.typeAhead.onSettled(() => {
      if (this.handedOff) return;
      if (this.handoff) clearTimeout(this.handoff);
      this.handoff = setTimeout(() => {
        this.handoff = null;
        if (this.handedOff || !this.typeAhead.isSettled()) return;
        this.handedOff = true;
        this.fieldKeys();
      }, HANDOFF_MS);
    });
  }

  /** A launcher opens: keys typed from the tap on wait for the field (launcher/type-ahead.ts). */
  opening(): void {
    this.typeAhead.begin();
    this.handedOff = false;
    this.typingKeys();
  }

  /** The launcher's surface has drawn: what was typed ahead goes to it, and the keyboard follows once it is in. */
  ready = (): void => {
    if (!this.typeAhead.isWaiting()) return;
    this.typeAhead.ready();
  };

  /** The launcher closed: no more typing ahead, and the idle keymap. */
  closed(): void {
    if (this.handoff) clearTimeout(this.handoff);
    this.handoff = null;
    this.typeAhead.end();
    this.idleKeys();
  }

  /** The open launcher's bindings: a key typed ahead (`launcher-type`), or one of its keys (launcher/keys.ts). */
  binding = (name: string, chord?: PressedChord, text?: string): boolean => {
    if (name !== TYPE_BINDING) return this.keys.binding(name, chord);
    this.typeInto({ key: chord?.key ?? "", ...(text === undefined ? {} : { text }) });
    return true;
  };

  /** A key typed ahead, from the compositor's `launcher-type` binding. */
  private typeInto(typed: { key: string; text?: string } | undefined): void {
    const key = typed ? typedFrom(typed) : null;
    if (key) this.typeAhead.push(key);
  }
}

interface KeysNeeds {
  compositor: Compositor | null;
  screens: Screens;
  stores: Stores;
  desktops: Desktops;
  system: SystemStores;
  guards: Guards;
  settingsApps: SettingsApps;
  settingsWindows: SettingsWindows;
  programs: Programs;
  menus: Menus;
  actions: Actions;
  launcher: LauncherParts;
  switcher: Switcher;
  overview: { toggle(): unknown } | null;
  openSheet: (pinned?: boolean, appName?: string) => void;
  appShortcut: (window: number, shortcut: string) => Promise<boolean>;
  appQuitting: (pid: number | null) => void;
  services: Services;
  late: Late<LateParts>;
}

/** dashi:// links that must not run by themselves, shown in the launcher; and the keymap's shortcuts, ❖ taps and holds (keymap.ts). */
export function startKeys(needs: KeysNeeds): void {
  const { compositor, actions, launcher, services, late } = needs;
  const { opener, keyboard } = launcher;
  const overlays = late.get("overlays");
  // A dashi:// link that must not run by itself (destructive, an agent's tool) opens in the launcher, filled in, for Return.
  if (compositor) {
    actions.setPresenter((action, args) => {
      if (overlays.has("launcher")) overlays.close("launcher");
      opener.open({ action, args });
      return true;
    });
  }
  const stopShortcuts = compositor
    ? startShortcuts(compositor, {
        appShortcut: needs.appShortcut,
        appQuitting: needs.appQuitting,
        toggleLauncher: opener.toggle,
        // While the launcher is open, holding ❖ shows the digits ❖1–9 pick instead (launcher/keys.ts).
        showSheet: () => {
          if (overlays.has("launcher") && keyboard.keys.digits(true)) return;
          if (!overlays.has("sheet")) needs.openSheet();
        },
        hideSheet: () => {
          keyboard.keys.digits(false);
          overlays.close("sheet");
        },
        forceQuit: () => needs.settingsApps.forceQuit.open(),
        settings: () => needs.settingsWindows.settingsApp.open(),
        toggleAutohide: () => needs.stores.dockPrefs.toggleAutohide(),
        overview: { toggle: () => needs.overview?.toggle() },
        // The bar of the screen the person is on (the primary's with one screen).
        menuBar: () =>
          void needs.screens.whereIsPerson().then((output) => needs.menus.controller.focusBar(output ?? late.get("menuBars").primaryName ?? undefined)),
        ...(needs.desktops.spaces ? { spaces: needs.desktops.spaces.controller } : {}),
        switcher: needs.switcher.controller ?? new SwitcherController(compositor, { show: needs.switcher.show, hide: () => overlays.close("switcher") }),
        runAddress: async (address, window) => {
          const outcome = await actions.runAddress(address, window);
          if (!outcome.ok) console.error(`dashi-shell: the keymap binds ${address}: ${outcome.error}`);
        },
        hardware: needs.system.system.hardware,
        lock: () => needs.guards.lockScreen?.lock(),
        powerKey: () => needs.guards.power.powerKey(),
        launcher: { binding: keyboard.binding },
        isLocked: needs.guards.screenLocked,
      })
    : () => {};
  services.add("shortcuts", stopShortcuts);
}
