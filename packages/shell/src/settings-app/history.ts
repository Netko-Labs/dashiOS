/**
 * Undo in System Settings, for a change that is one value (a switch, a
 * choice, a slider; design.html PA-2): SettingsStore records each such patch
 * on its undo stack, named here for Edit › Undo ("Undo Text Size"). Changing
 * the same setting again soon after (a slider's drag) is the same step.
 * Changes that are more than one value (a keyboard layout list, a screen's
 * arrangement) and the panes' own services (Wi-Fi, Bluetooth, passwords)
 * aren't on it.
 */

const NAMES: Readonly<Record<string, string>> = {
  "appearance.textSize": "Text Size",
  "appearance.reduceMotion": "Reduce Motion",
  "appearance.cornerRadius": "Corners",
  "appearance.pointerSize": "Pointer Size",
  "appearance.highlightActiveWindow": "Highlight Active Window",
  "appearance.auto": "Automatic Appearance",
  "appearance.x11Apps": "X11 Apps",
  "clock.hour24": "24-Hour Time",
  "clock.showDate": "Show Date",
  "menuBar.batteryPercent": "Battery Percentage",
  "menuBar.sound": "Sound in Menu Bar",
  "idle.blankAfterSeconds": "Turn Display Off",
  "idle.sleepAfterSeconds": "Sleep After",
  "touchpad.tap": "Tap to Click",
  "touchpad.naturalScroll": "Natural Scrolling",
  "touchpad.accelSpeed": "Pointer Speed",
  "touchpad.scrollSpeed": "Scroll Speed",
  "touchpad.disableWhileTyping": "Ignore While Typing",
  "touchpad.clickMethod": "Click Method",
  "mouse.naturalScroll": "Natural Scrolling",
  "mouse.accelSpeed": "Pointer Speed",
  "mouse.accelProfile": "Acceleration",
  "mouse.scrollSpeed": "Scroll Speed",
  "keyboard.repeatRate": "Key Repeat",
  "keyboard.repeatDelay": "Delay Until Repeat",
};

/** What Edit › Undo calls a change to `section.key`: its name, or "Setting Change". */
export function settingName(section: string, key: string): string {
  return NAMES[`${section}.${key}`] ?? "Setting Change";
}

/** Whether two values a setting held are the same (JSON's values: lists compare by their items). */
export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}
