import type { OutputKind } from "./types.ts";

export interface KindHints {
  /** PipeWire's node.name, such as `bluez_output.…` (`bluez_input.…` for a microphone) or `alsa_output.….hdmi-stereo`. */
  name?: string;
  /** PipeWire's device.form-factor, when the node says what it is. */
  formFactor?: string;
  /** The label, which is all `wpctl status` gives. */
  label: string;
}

const HEADPHONE_FORMS = new Set(["headphone", "headphones", "headset", "hands-free"]);
const DISPLAY_FORMS = new Set(["tv", "monitor"]);

/**
 * The output's glyph. Bluetooth is told by its node name (`bluez_output.`),
 * a display by HDMI or DisplayPort, headphones by form factor or label; the
 * rest are speakers.
 */
export function outputKind(hints: KindHints): OutputKind {
  const name = hints.name ?? "";
  const form = hints.formFactor ?? "";
  if (name.startsWith("bluez_output.") || name.startsWith("bluez_input.") || /bluetooth/i.test(hints.label)) return "bluetooth";
  if (/hdmi/i.test(name) || DISPLAY_FORMS.has(form) || /hdmi|displayport/i.test(hints.label)) return "display";
  if (HEADPHONE_FORMS.has(form) || /headphone|headset/i.test(hints.label)) return "headphones";
  return "speaker";
}
