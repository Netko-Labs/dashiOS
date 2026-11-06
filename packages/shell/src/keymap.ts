/**
 * What the keys mean in Dashi (docs/design.html, Keyboard): ❖ plays ⌘. The
 * shell sends this to dashi-comp at startup; the compositor matches each
 * press against these rules on its own and replays translations, so typing
 * never waits on Bun. Change a rule here and restart the shell to remap.
 *
 * A rule's `when` is modifiers (super, ctrl, alt, shift) and a key: an xkb
 * keysym name ("q", "Left", "Tab|ISO_Left_Tab"), `letter` (a–z), or `*`.
 * Super, Ctrl, and Alt must match exactly; Shift only when named. The first
 * matching rule wins, and its action is one of:
 *
 *   bind     the key is the shell's: shortcuts.ts runs the named action; a
 *            `dashi://` address is any action of the registry (actions/,
 *            docs/actions.md), run for the person on the focused window
 *   send     the app gets this chord instead, held like the key; Shift held
 *            with it passes through ("key" means the pressed key)
 *   tap      these chords, pressed and released at once
 *   swallow  nothing happens (a reserved chord)
 *
 * Built into the compositor, whatever this says: Ctrl+Alt+F1..F12 (VTs),
 * Ctrl+Alt+Backspace (leave the session), Ctrl+Super+Esc (stop agents).
 * The full grammar is in comp/src/keys/keymap.rs.
 */

export type Rule = {
  when: string;
  /** An app class from `apps` the focused window must belong to. */
  app?: string;
  bind?: string;
  send?: string;
  tap?: string[];
  swallow?: true;
};

export type Keymap = {
  apps: Record<string, string[]>;
  tapMs: number;
  holdMs: number;
  rules: Rule[];
  /** The rules the compositor switches to by itself the moment ❖ is tapped, until the next keymap (launcher/type-ahead.ts). */
  afterTap?: Rule[];
};

/** Terminals keep plain Ctrl chords for the program inside (Ctrl+C interrupts). */
export const TERMINALS = [
  "foot",
  "footclient",
  "org.kde.konsole",
  "Alacritty",
  "kitty",
  "org.gnome.Terminal",
  "org.gnome.Console",
  "org.gnome.Ptyxis",
  "com.mitchellh.ghostty",
  "org.wezfurlong.wezterm",
  "xterm",
  "dev.dashi.terminal",
];

export const KEYMAP: Keymap = {
  apps: {
    terminal: TERMINALS,
    // Metal apps don't bind Ctrl+W yet, so the shell closes for them.
    metal: ["", "dev.dashi.*", "dev.mirin.*"],
  },
  // A ❖ tap opens the launcher; holding ❖ shows the shortcut sheet.
  tapMs: 350,
  holdMs: 800,
  rules: [
    // The hardware keys (system/keys.ts); they carry no modifiers, so their
    // place in the list does not matter.
    { when: "XF86AudioRaiseVolume", bind: "volume-up" },
    { when: "XF86AudioLowerVolume", bind: "volume-down" },
    { when: "XF86AudioMute", bind: "volume-mute" },
    { when: "XF86AudioMicMute", bind: "mic-mute" },
    { when: "XF86MonBrightnessUp", bind: "brightness-up" },
    { when: "XF86MonBrightnessDown", bind: "brightness-down" },
    { when: "XF86AudioPlay", bind: "media-play-pause" },
    { when: "XF86AudioPause", bind: "media-pause" },
    { when: "XF86AudioNext", bind: "media-next" },
    { when: "XF86AudioPrev", bind: "media-previous" },
    // The power key: the shell asks before shutting down (power/).
    { when: "XF86PowerOff", bind: "power-key" },

    // ⌃↑ is Overview (Mission Control: overview/), and so is the Mac's F3 key
    // (the keymap calls it XF86LaunchA). Shift, if held, does not matter.
    { when: "ctrl+Up", bind: "overview" },
    { when: "XF86LaunchA", bind: "overview" },
    // ⌃← ⌃→ move between Spaces and ⌃1…⌃9 jump to one (spaces/), as on a Mac.
    { when: "ctrl+Left", bind: "space-left" },
    { when: "ctrl+Right", bind: "space-right" },
    ...Array.from({ length: 9 }, (_, index) => ({ when: `ctrl+${index + 1}`, bind: `space-${index + 1}` })),

    // ⌃❖ arrows arrange the focused window: the half on that side, then a
    // quarter, its own size, or the next screen (tiling.ts). ⌃❖↩ fills,
    // ⌃❖C centers, ⌃❖R gives back its own size (arrange.ts). Like every
    // ⌃❖ rule, above the reserved super+ctrl+* below. They bind the
    // registry's addresses (actions/sources/windows.ts).
    { when: "super+ctrl+Left", bind: "dashi://window/arrange/left" },
    { when: "super+ctrl+Right", bind: "dashi://window/arrange/right" },
    { when: "super+ctrl+Up", bind: "dashi://window/arrange/up" },
    { when: "super+ctrl+Down", bind: "dashi://window/arrange/down" },
    { when: "super+ctrl+Return|KP_Enter", bind: "dashi://window/arrange/fill" },
    { when: "super+ctrl+c", bind: "dashi://window/arrange/center" },
    { when: "super+ctrl+r", bind: "dashi://window/arrange/restore" },
    // ⌃❖F: full screen (arrange.ts), for any window, as on the Mac.
    { when: "super+ctrl+f", bind: "dashi://window/full-screen" },
    // ⌃❖Q: lock the screen, as on the Mac.
    { when: "super+ctrl+q", bind: "lock-screen" },
    // ⌥❖Esc: Force Quit Applications (force-quit/). Before the reserved ⌥❖ rule below.
    { when: "super+alt+Escape", bind: "force-quit" },
    // ⌥❖D: turn Dock autohide on or off (dock/prefs.ts), as on the Mac. Before the reserved ⌥❖ rule below.
    { when: "super+alt+d", bind: "toggle-autohide" },
    // ⌥❖V: the clipboard history, in the launcher (clipboard/). Before the reserved ⌥❖ rule below.
    { when: "super+alt+v", bind: "dashi://clipboard/history" },
    // Reserved for the lock screen, emoji, and Hide Others.
    { when: "super+ctrl+*", swallow: true },
    { when: "super+alt+*", swallow: true },
    { when: "super+ctrl+alt+*", swallow: true },

    // The shell's ❖ shortcuts.
    { when: "super+q", bind: "quit-app" },
    { when: "super+m", bind: "minimize-window" },
    { when: "super+h", bind: "hide-app" },
    { when: "super+shift+Tab|ISO_Left_Tab", bind: "switch-previous" },
    { when: "super+Tab|ISO_Left_Tab", bind: "switch-next" },
    { when: "super+Escape", bind: "switch-cancel" },
    { when: "super+grave|asciitilde", bind: "next-window" },
    { when: "super+space", bind: "launcher" },
    // ❖, opens System Settings (settings-app/).
    { when: "super+comma", bind: "settings" },
    // ❖W and ⇧❖W (Shift isn't named): the app's own row for the chord first, else the window closes (shortcuts.ts).
    { when: "super+w", app: "metal", bind: "close-window" },
    // ⇧❖3 captures the screen; ⇧❖4 an area dragged out, or with Space the
    // focused window (screenshots.ts, screenshot-area.tsx); ⇧❖5 opens the
    // toolbar that also records the screen, or stops a recording (recorder/).
    { when: "super+shift+3", bind: "screenshot-screen" },
    { when: "super+shift+4", bind: "screenshot-area" },
    { when: "super+shift+5", bind: "capture-toolbar" },

    // In terminals ❖ and ⌥ move and delete in readline's keys, as Terminal
    // and iTerm do on the Mac: zsh, bash, fish, and most prompts know them,
    // where Home, End, and Ctrl+arrows are often left unbound.
    { when: "super+Left", app: "terminal", send: "ctrl+a" },
    { when: "super+Right", app: "terminal", send: "ctrl+e" },
    { when: "alt+Left", app: "terminal", send: "alt+b" },
    { when: "alt+Right", app: "terminal", send: "alt+f" },
    { when: "alt+BackSpace", app: "terminal", send: "ctrl+w" },
    { when: "alt+Delete", app: "terminal", send: "alt+d" },

    // Moving in text, Mac style; ⇧ with them selects.
    { when: "super+Left", send: "Home" },
    { when: "super+Right", send: "End" },
    { when: "super+Up", send: "ctrl+Home" },
    { when: "super+Down", send: "ctrl+End" },
    // ❖⌫ deletes to the line start: readline's Ctrl+U in terminals.
    { when: "super+BackSpace", app: "terminal", tap: ["ctrl+u"] },
    { when: "super+BackSpace", tap: ["shift+Home", "BackSpace"] },

    // In Dashi's own apps a ❖ chord is a menu shortcut first (the app's
    // menus say which, app-menus/): the shell chooses the item, and sends
    // the Ctrl chord below only when no item shows it.
    { when: "super+*", app: "metal", bind: "app-chord" },
    // Every other ❖ chord is the app's own Ctrl chord; terminals take
    // their shortcuts on Ctrl+Shift.
    { when: "super+letter", app: "terminal", send: "ctrl+shift+key" },
    { when: "super+*", send: "ctrl+key" },

    // ⌥ moves and deletes by word.
    { when: "alt+Left", send: "ctrl+Left" },
    { when: "alt+Right", send: "ctrl+Right" },
    { when: "alt+BackSpace", send: "ctrl+BackSpace" },
    { when: "alt+Delete", send: "ctrl+Delete" },
  ],
};

/**
 * `keymap` with this machine's own rules first: the laptop's keys (Fn F5,
 * Fn F4, the ROG key; laptop/hotkeys.ts), whose keysyms come from the model
 * database. They carry no modifiers, so going first only matters for a key
 * the list above also names, and then the machine's meaning wins.
 */
export function withRules(keymap: Keymap, rules: readonly Rule[]): Keymap {
  return rules.length === 0 ? keymap : { ...keymap, rules: [...rules, ...keymap.rules] };
}

/**
 * Keys bound only while the app switcher is open (switcher/), ahead of every
 * other rule: ↓ and ` into the chosen app's windows, ↑ back, ← → along the
 * row, ⌫ and the letters, digits, and Space for typing to find (Q, H, M, and
 * W act while nothing is typed). Tab, ⇧Tab, and Esc are the rules above.
 */
export const SWITCHER_RULES: Rule[] = [
  { when: "super+Down", bind: "switcher-down" },
  { when: "super+grave|asciitilde", bind: "switcher-down" },
  { when: "super+Up", bind: "switcher-up" },
  { when: "super+Left", bind: "switcher-left" },
  { when: "super+Right", bind: "switcher-right" },
  { when: "super+BackSpace", bind: "switcher-erase" },
  { when: "super+letter", bind: "switcher-key" },
  { when: "super+0|1|2|3|4|5|6|7|8|9|space", bind: "switcher-key" },
];

/** The keymap while a switcher session is open: its keys first. */
export const withSwitcher = (keymap: Keymap): Keymap => ({ ...keymap, rules: [...SWITCHER_RULES, ...keymap.rules] });
