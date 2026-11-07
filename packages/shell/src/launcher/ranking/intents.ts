/**
 * What people mean, as data the ranking honors (betterments.html, "Ranking
 * and keys"): "settings", "preferences" and "control panel" mean System
 * Settings; the Setup Assistant, run once in a lifetime, answers to "setup",
 * "welcome" and "first run" and otherwise sits under everything it ties
 * with; a Settings pane answers the bare word "settings" only when nothing
 * else does; "snip" is Screenshot…, as Windows' Snipping Tool taught it,
 * before Snippets, whose name merely starts so. Phrases are folded like any
 * query, so "Préférences" is "preferences".
 */

import { formatAddress } from "../../actions/address.ts";
import { SETTINGS_APP_ID, SETUP_APP_ID } from "../../apps.ts";
import type { RankKind } from "./item.ts";

export interface Intent {
  /** The item these words mean. */
  id: string;
  /** Whole queries that mean it, in any language the ranking reads. */
  phrases: readonly string[];
}

export interface Intents {
  intents: readonly Intent[];
  /** Items that rank under every other match unless one of their intents was typed (the Setup Assistant). */
  demoted: readonly string[];
  /** Keywords an item of that kind answers to only when no other item matches at all. */
  fallback: Partial<Record<RankKind, readonly string[]>>;
}

/** Dashi's intents; the phrases in other languages are the ones Setup offers (words.ts has the rest). */
export const INTENTS: Intents = {
  intents: [
    {
      id: SETTINGS_APP_ID,
      phrases: [
        "settings",
        "system settings",
        "preferences",
        "system preferences",
        "control panel",
        // de, fr, es, it, pt, nl
        "einstellungen",
        "systemeinstellungen",
        "systemsteuerung",
        "parametres",
        "reglages",
        "preferences systeme",
        "panneau de configuration",
        "configuracion",
        "ajustes",
        "preferencias",
        "panel de control",
        "impostazioni",
        "preferenze",
        "pannello di controllo",
        "configuracoes",
        "definicoes",
        "painel de controle",
        "instellingen",
        "configuratiescherm",
      ],
    },
    {
      id: SETUP_APP_ID,
      phrases: [
        "setup",
        "setup assistant",
        "welcome",
        "first run",
        "einrichtung",
        "willkommen",
        "configuration initiale",
        "bienvenue",
        "asistente de configuracion",
        "bienvenido",
        "configurazione iniziale",
        "benvenuto",
        "configuracao inicial",
        "bem vindo",
        "welkom",
      ],
    },
    {
      // Screenshot…, the toolbar (actions/sources/commands.ts).
      id: formatAddress(["dashi", "capture"]),
      phrases: ["snip", "snipping tool", "print screen"],
    },
  ],
  demoted: [SETUP_APP_ID],
  fallback: {
    pane: ["settings", "einstellungen", "parametres", "reglages", "configuracion", "ajustes", "impostazioni", "configuracoes", "definicoes", "instellingen"],
  },
};
