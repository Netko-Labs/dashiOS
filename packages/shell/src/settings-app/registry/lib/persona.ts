/**
 * Settings › Your Dashi's rows (lib/panes/persona.tsx): who Dashi is, each on its knob (SE-13). Every row is the person's
 * alone: none has an agent's name, so `get_settings` and `set_setting` never see one, and the pane
 * asks whose press it was before it changes anything (lib/person-only.ts). An agent does not get
 * to say how the assistant sounds or what it is called.
 */

import { AT, DROP, GRID, HISTORY, LANGUAGE, MOTION, PERSONA, REFRESH, SLIDERS, SPARK, TEXT, USER, VOLUME, WAVE } from "../../../shared/settings/index.ts";
import type { RowDef } from "../types.ts";

export const PERSONA_ROWS = [
  {
    id: "persona/name",
    glyph: PERSONA,
    title: "Name",
    name: "Dashi's name",
    detail: "What it calls itself, and what you see on its questions.",
    keywords: ["assistant", "rename", "call it", "persona"],
    kind: "value",
  },
  {
    id: "persona/character",
    glyph: SPARK,
    title: "Character",
    name: "Dashi's character",
    keywords: ["personality", "tone", "persona", "miso", "kombu", "wasabi", "nori", "yuzu", "companion", "customize", "customise"],
    kind: "choice",
    stack: true,
  },
  {
    id: "persona/you",
    glyph: USER,
    title: "What it calls you",
    name: "What Dashi calls you",
    detail: "Leave it empty and it uses no name.",
    keywords: ["my name", "nickname"],
    kind: "value",
  },
  {
    id: "persona/talk",
    glyph: WAVE,
    title: "How much it talks",
    name: "How much Dashi talks",
    keywords: ["brief", "chatty", "short answers", "verbose"],
    kind: "choice",
  },
  {
    id: "persona/language",
    glyph: LANGUAGE,
    title: "Answers in",
    name: "Dashi answers in",
    keywords: ["language", "spanish", "english", "español"],
    kind: "choice",
  },
  {
    id: "persona/voice",
    glyph: VOLUME,
    title: "Voice",
    name: "Dashi's voice",
    detail: "The voice its answers are said in.",
    keywords: ["speaker", "accent", "text to speech"],
    kind: "choice",
    stack: true,
  },
  {
    id: "persona/colour",
    glyph: DROP,
    title: "Color",
    name: "Dashi's color",
    detail: "Of its capsule, its questions and its jobs in the bar.",
    keywords: ["color", "colour", "violet", "blue", "teal", "moss", "berry", "cocoa", "capsule", "tint"],
    kind: "choice",
  },
  {
    id: "persona/mark",
    glyph: GRID,
    title: "Mark",
    name: "Dashi's mark",
    keywords: ["spark", "bowl", "dot", "moon", "leaf", "drop", "flame", "paw", "glyph", "icon"],
    kind: "choice",
    stack: true,
  },
  {
    id: "persona/dots",
    glyph: MOTION,
    title: "Dots",
    name: "Dashi's dots",
    detail: "The five dots while it waits for you. They are its face.",
    keywords: ["face", "smile", "wave", "pearls", "steps", "hop", "shape"],
    kind: "choice",
    stack: true,
  },
  {
    id: "persona/note",
    glyph: TEXT,
    title: "In your own words",
    name: "How Dashi talks to you, in your own words",
    detail: "Anything about how to talk to you. It changes wording only.",
    keywords: ["instructions", "custom instructions", "note", "prompt"],
    kind: "value",
    stack: true,
  },
  {
    id: "persona/own",
    glyph: SLIDERS,
    title: "Your own character",
    detail: "A small file you can change and share.",
    keywords: ["make a file", "character file", "share", "json", "custom character"],
    kind: "action",
  },
  {
    id: "persona/share",
    glyph: AT,
    title: "Share it",
    name: "Export your Dashi as a file",
    detail: "One small file with its name, character, color, mark and dots. Send it; they press Add a file.",
    keywords: ["export", "share", "send", "file", "character"],
    kind: "action",
  },
  {
    id: "persona/about",
    glyph: HISTORY,
    title: "What Dashi knows about you",
    detail: "A file you can read and change.",
    keywords: ["remember", "memory", "about me", "my name", "facts", "knows"],
    kind: "action",
  },
  { id: "persona/reset", glyph: REFRESH, title: "Back to Dashi", name: "Put Dashi back as it was", keywords: ["reset", "default", "restore"], kind: "action" },
] as const satisfies readonly RowDef[];
