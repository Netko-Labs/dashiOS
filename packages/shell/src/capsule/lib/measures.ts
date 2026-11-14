/**
 * The capsule's and the card's measures and colours (docs/design.html, "The capsule"):
 * the design's (dashi-0.9.0-design/round3/pill-v2/src/01-pill.css, 02-v2.css) in points,
 * its 41 px being 28 points.
 */

/** The one line. */
export const CAPSULE = {
  height: 31,
  paddingX: 13,
  gap: 8,
  fontSize: 13,
  rim: 1.5,
  /** The widest the capsule gets at home, and the most of the words it shows. */
  maxWidth: 700,
  tail: 400,
  /** Beside the Dock. */
  seatMaxWidth: 350,
  seatTail: 180,
  /** Dashi's disc, led by its mark. */
  disc: 22,
  discGlyph: 12,
  /** Five dots, and how tall the middle one gets at the loudest. */
  dot: 4,
  dotGap: 4,
  dotsHeight: 19,
  button: { height: 22, paddingX: 9, fontSize: 11.5, gap: 5 },
  stop: 8,
  /** The amber ring of something that needs the person. */
  ring: 3,
} as const;

/** What must be answered or read in full. */
export const CARD = {
  width: 470,
  /** At most this size (pill-v2 README): six lines of message, four choices. */
  maxWidth: 520,
  maxHeight: 240,
  radius: 17.5,
  /** Its rim, and the outline it wears while it has the keyboard. */
  rim: 1.5,
  focusRim: 3,
  paddingX: 12,
  paddingTop: 9,
  paddingBottom: 10,
  fontSize: 13,
  headSize: 11,
  questionSize: 13.5,
  messageSize: 12.5,
  hintSize: 10.5,
  disc: 20,
  button: { height: 24, paddingX: 12, fontSize: 12 },
  choice: 27,
  /** How far it stands over the Dock's top edge. */
  onDock: 8,
  /** What fits while its buttons are live. */
  lines: 6,
  lineChars: 68,
  choices: 4,
} as const;

/** Where things sit from the screen's bottom edge, with the Dock's own measures. */
export const SEAT = {
  /** Home: this far above the Dock. */
  aboveDock: 9,
  /** In the Dock's row, beside it. */
  row: 21,
  beside: 12,
  /** The least room beside the Dock that is a seat. */
  least: 200,
  /** One step up from home. */
  step: 62,
  /** No Dock: against the edge, or one step up from it. */
  edge: 11,
  edgeUp: 74,
  /** The volume indicator, small, this far above the capsule or the card. */
  aboveCapsule: 8,
} as const;

/** The layer surface: the screen's width, this tall, see-through; the pointer is taken only on what is drawn. */
export const SURFACE_HEIGHT = 340;

export const INK = "#1d1d1f";
export const AMBER = "#f0b93c";
/** The amber on a light capsule (dictation's in Dark). */
export const AMBER_DEEP = "#86600a";
const PAPER = "#f4f4f6";
const DASHI_FILL = "#4a33b0";
const DASHI_SOFT = "#d9d2fb";
const DASHI_INK = "#2f2080";
const DEFAULT_PURPLE = "#6e56cf";

export interface CapsuleColours {
  fill: string;
  text: string;
  /** Words that are not the point. */
  soft: string;
  rim: string;
  /** The primary button. */
  primary: string;
  onPrimary: string;
  ok: string;
  amber: string;
}

const channels = (colour: string): [number, number, number] => [1, 3, 5].map((at) => Number.parseInt(colour.slice(at, at + 2), 16)) as [number, number, number];
const hex = (parts: readonly number[]): string => `#${parts.map((part) => Math.round(part).toString(16).padStart(2, "0")).join("")}`;

/** WCAG's contrast of `colour` against white. */
export function contrastWithWhite(colour: string): number {
  const [r, g, b] = channels(colour).map((value) => {
    const part = value / 255;
    return part <= 0.03928 ? part / 12.92 : ((part + 0.055) / 1.055) ** 2.4;
  });
  return 1.05 / (0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0) + 0.05);
}

/** Dashi's capsule's fill for a persona's colour: the colour, darkened until white words read on it (7 to 1). The agents' purple gives the design's fill. */
export function dashiFill(colour: string): string {
  if (colour.toLowerCase() === DEFAULT_PURPLE) return DASHI_FILL;
  let parts = channels(colour);
  for (let step = 0; step < 20 && contrastWithWhite(hex(parts)) < 7; step++) parts = parts.map((part) => part * 0.9) as [number, number, number];
  return hex(parts);
}

/** Dictation's capsule: ink in Light, paper in Dark. It types your words. */
export function inkColours(dark: boolean): CapsuleColours {
  return dark
    ? { fill: PAPER, text: INK, soft: "#1d1d1fa8", rim: INK, primary: INK, onPrimary: "#ffffff", ok: "#2f7a3a", amber: AMBER_DEEP }
    : { fill: INK, text: "#ffffff", soft: "#ffffffa8", rim: "#c9c6d2", primary: "#ffffff", onPrimary: INK, ok: "#8fe0a2", amber: AMBER };
}

/** Dashi's capsule: its colour in both modes. It does things. */
export function dashiColours(colour: string): CapsuleColours {
  const fill = dashiFill(colour);
  const own = fill === DASHI_FILL;
  return {
    fill,
    text: "#ffffff",
    soft: own ? DASHI_SOFT : "#ffffffd0",
    rim: "#ffffff",
    primary: "#ffffff",
    onPrimary: own ? DASHI_INK : fill,
    ok: "#ffffff",
    amber: AMBER,
  };
}
