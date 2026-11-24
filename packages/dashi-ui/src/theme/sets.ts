/**
 * The fixed colour sets modules used to keep to themselves (CO-5): Terminal's
 * ground, ink and ANSI colours, the file icons' pages and folders, the
 * persona's six colours, and the capsule's own inks. They live here, in the
 * theme, so no hex is written outside it (H21) and contrast.test.ts measures
 * them all. Each module still decides how to use its set.
 */

import { TRUE_BLACK } from "./palette.ts";
import { LIGHT_SURFACE } from "./surface.ts";
import { TINTS } from "./tints.ts";

/** A terminal's colours: its ground and ink, the cursor, and the 16 ANSI colours programs name. */
export interface TerminalColors {
  ground: string;
  ink: string;
  /** The cursor and the bell's edge: the grid's own ink (CO-9: a caret is in its field's ink), so a block cursor's letter, in the ground's colour, is as readable as the text. */
  cursor: string;
  /** Black, red, green, yellow, blue, magenta, cyan, white, then the bright eight. */
  ansi: readonly string[];
}

/**
 * Made from Dashi's ingredients: red from ume, yellow from broth, green from
 * moss, cyan from kombu, magenta from shiso (docs/design.html "Terminal
 * colors"). In Light the bright colours are a step darker, so they stay readable.
 * The ground is the window's own (Light: surface.window, so the toolbar and the
 * grid are one white; Dark: true black), and the cursor is the ink (R5): the
 * accent means chosen or on, never a caret or the bell.
 */
export const TERMINAL: Readonly<Record<"light" | "dark", TerminalColors>> = {
  light: {
    ground: LIGHT_SURFACE.window,
    ink: "#1d1d1f",
    cursor: "#1d1d1f",
    ansi: ["#1d1d1f", "#b23a50", "#3d7a2e", "#866000", "#2c5faf", "#6a4fc4", "#22786a", "#d6d3cc"].concat([
      "#636260",
      "#a8304a",
      "#336b26",
      "#755400",
      "#244f96",
      "#5a40ae",
      "#1b665a",
      "#f3f1ec",
    ]),
  },
  /** Dark is true black: the window's ground and Dashi's 92% ink. */
  dark: {
    ground: TRUE_BLACK.ground,
    ink: TRUE_BLACK.ink,
    cursor: TRUE_BLACK.ink,
    ansi: ["#3a3a3d", "#f07a8f", "#7fc46a", "#e5b13f", "#6fa3ef", "#a897f0", "#5fbfa6", "#d8d8dc"].concat([
      "#8e8e93",
      "#ff97a8",
      "#9cd988",
      "#f5cd6a",
      "#93bbf6",
      "#c2b5f8",
      "#86d6c0",
      "#f5f5f7",
    ]),
  },
};

/** The file categories with a glyph of their own. */
export type FileCategory = "image" | "audio" | "video" | "archive" | "code" | "text" | "document";

/** The tint each category's glyph wears (TINTS). */
export const FILE_TINTS: Readonly<Record<FileCategory, string>> = {
  image: TINTS.matcha,
  audio: TINTS.kabocha,
  video: TINTS.mizu,
  archive: TINTS.miso,
  code: TINTS.wakame,
  text: TINTS.goma,
  document: TINTS.nori,
};

/** A file icon's colours in one mode: the page, its edge and fold, the folder's two layers, an emblem. */
export interface FileIconColors {
  page: [string, string];
  edge: string;
  fold: string;
  folderBack: [string, string];
  folderFront: [string, string];
  emblem: string;
  /** A category's glyph drawn lighter than its tint, where the tint is too dim on this page. */
  lift: Partial<Record<FileCategory, string>>;
}

export const FILE_ICONS: Readonly<Record<"light" | "dark", FileIconColors>> = {
  light: {
    page: ["#ffffff", "#f1f2f5"],
    edge: "#1d1d1f29",
    fold: "#dfe1e6",
    folderBack: ["#5d93c3", "#4a82b6"],
    folderFront: ["#8cbbe2", "#69a1d2"],
    emblem: "#2f6493b3",
    lift: {},
  },
  dark: {
    page: ["#3d3d42", "#333337"],
    edge: "#ffffff29",
    fold: "#55555b",
    folderBack: ["#45739e", "#3a6590"],
    folderFront: ["#6f9fc9", "#5687b5"],
    emblem: "#1f4466c7",
    lift: { text: "#aaa59e", document: "#8aa3b8", archive: "#c08a52" },
  },
};

/** One of the persona's colours (decisions.md D59): the fill's two ends, deep and soft words, a glow. */
export interface PersonaColor {
  id: "violet" | "blue" | "teal" | "moss" | "berry" | "cocoa";
  name: string;
  from: string;
  to: string;
  deep: string;
  soft: string;
  glow: string;
}

/** The six colours Dashi's capsule, questions and jobs may wear: white words on both ends 4.5:1 at least. */
export const PERSONA_COLORS: readonly PersonaColor[] = [
  { id: "violet", name: "Violet", from: "#3f2a9e", to: "#5b41c4", deep: "#2f2080", soft: "#d9d2fb", glow: "#a58bff80" },
  { id: "blue", name: "Blue", from: "#17479e", to: "#2558b8", deep: "#123a82", soft: "#d3e2fb", glow: "#7fb0ff80" },
  { id: "teal", name: "Teal", from: "#0c5560", to: "#136770", deep: "#0a4750", soft: "#cdeef0", glow: "#6fd3dc80" },
  { id: "moss", name: "Moss", from: "#3f5220", to: "#4d6326", deep: "#34451a", soft: "#e1edc8", glow: "#b5d67a80" },
  { id: "berry", name: "Berry", from: "#8a1f4f", to: "#9f2a5f", deep: "#701840", soft: "#fbd5e4", glow: "#ff8fbc80" },
  { id: "cocoa", name: "Cocoa", from: "#4e3629", to: "#6f4d3c", deep: "#432e23", soft: "#f1dfd3", glow: "#e0b29880" },
];

/** The capsule's own inks (pill-v2): dictation's ink and paper, Dashi's own fill and its words, the agents' purple it starts from. */
export const CAPSULE = {
  ink: "#1d1d1f",
  paper: "#f4f4f6",
  white: "#ffffff",
  /** Words that are not the point, on ink and on paper. */
  softOnInk: "#ffffffa8",
  softOnPaper: "#1d1d1fa8",
  softOnFill: "#ffffffd0",
  /** The light line round the capsule's fill (pill-v2): white at 35 %. */
  rimOnFill: "#ffffff59",
  /** The rim of dictation's capsule in Light. */
  rimOnInk: "#c9c6d2",
  /** Done, on paper and on ink. */
  okOnPaper: "#2f7a3a",
  okOnInk: "#8fe0a2",
  dashiFill: "#4a33b0",
  dashiSoft: "#d9d2fb",
  dashiInk: "#2f2080",
  defaultPurple: "#6e56cf",
} as const;
