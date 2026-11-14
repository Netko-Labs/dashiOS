/**
 * Settings › Your Dashi's rows (lib/panes/persona.tsx): who Dashi is. Every row is the person's
 * alone: none has an agent's name, so `get_settings` and `set_setting` never see one, and the pane
 * asks whose press it was before it changes anything (lib/person-only.ts). An agent does not get
 * to say how the assistant sounds or what it is called.
 */

import type { RowDef } from "../types.ts";

export const PERSONA_ROWS = [
  {
    id: "persona/name",
    title: "Name",
    name: "Dashi's name",
    detail: "What it calls itself, and what you see on its questions.",
    keywords: ["assistant", "rename", "call it", "persona"],
    kind: "value",
  },
  {
    id: "persona/character",
    title: "Character",
    name: "Dashi's character",
    keywords: ["personality", "tone", "persona", "miso", "kombu", "wasabi", "nori", "yuzu", "companion", "customize", "customise"],
    kind: "choice",
    stack: true,
  },
  {
    id: "persona/you",
    title: "What it calls you",
    name: "What Dashi calls you",
    detail: "Leave it empty and it uses no name.",
    keywords: ["my name", "nickname"],
    kind: "value",
  },
  { id: "persona/talk", title: "How much it talks", name: "How much Dashi talks", keywords: ["brief", "chatty", "short answers", "verbose"], kind: "choice" },
  { id: "persona/language", title: "Answers in", name: "Dashi answers in", keywords: ["language", "spanish", "english", "español"], kind: "choice" },
  {
    id: "persona/voice",
    title: "Voice",
    name: "Dashi's voice",
    detail: "The voice its answers are said in.",
    keywords: ["speaker", "accent", "text to speech"],
    kind: "choice",
    stack: true,
  },
  {
    id: "persona/colour",
    title: "Colour",
    name: "Dashi's colour",
    detail: "Of its capsule, its questions and its jobs in the bar.",
    keywords: ["color", "violet", "blue", "teal", "moss", "berry", "cocoa", "capsule", "tint"],
    kind: "choice",
  },
  {
    id: "persona/mark",
    title: "Mark",
    name: "Dashi's mark",
    keywords: ["spark", "bowl", "dot", "moon", "leaf", "drop", "flame", "paw", "glyph", "icon"],
    kind: "choice",
    stack: true,
  },
  {
    id: "persona/dots",
    title: "Dots",
    name: "Dashi's dots",
    detail: "The five dots while it waits for you. They are its face.",
    keywords: ["face", "smile", "wave", "pearls", "steps", "hop", "shape"],
    kind: "choice",
    stack: true,
  },
  {
    id: "persona/note",
    title: "In your own words",
    name: "How Dashi talks to you, in your own words",
    detail: "Anything about how to talk to you. It changes wording only.",
    keywords: ["instructions", "custom instructions", "note", "prompt"],
    kind: "value",
    stack: true,
  },
  {
    id: "persona/own",
    title: "Your own character",
    detail: "A small file you can change and share.",
    keywords: ["make a file", "character file", "share", "json", "custom character"],
    kind: "action",
  },
  { id: "persona/reset", title: "Back to Dashi", name: "Put Dashi back as it was", keywords: ["reset", "default", "restore"], kind: "action" },
] as const satisfies readonly RowDef[];
