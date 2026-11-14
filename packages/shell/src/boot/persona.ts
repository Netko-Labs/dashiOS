/**
 * Who Dashi is (main.tsx; persona/; docs/night-0.9-contract.md, "persona"): settings.json's
 * `persona` and the characters folder, kept current in the hub's `persona` cell, which the capsule,
 * the bar and the voice loop read, and in the assistant's prompt style (agents/ask). A change in
 * Settings › Your Dashi shows at once, with no logging out.
 */

import { promptStyle } from "../agents/index.ts";
import { type PersonaSource, startPersona } from "../persona/index.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";

export function startPersonaPiece({
  settingsStore,
  services,
  late,
}: {
  settingsStore: SettingsStore;
  services: Services;
  late: Late<LateParts>;
}): PersonaSource {
  const hub = late.get("pill");
  const source = startPersona({ settings: settingsStore, set: (persona) => hub.persona.set(persona), style: (style) => promptStyle.set(style) });
  services.add("persona", () => source.stop());
  return late.set("persona", source);
}
