/**
 * Who Dashi is (docs/night-0.9-contract.md, "persona"): what the capsule,
 * the bar and the voice loop read to honour the person's choices. The
 * persona piece sets it from settings.json `persona` and `voice.voice`;
 * until it does, everyone gets `DEFAULT_PERSONA`. A persona changes how
 * Dashi sounds and looks, never what it may do.
 */

/** The glyph in Dashi's white disc (look.ts draws each). */
export const PERSONA_GLYPHS = ["spark", "bowl", "dot", "moon", "leaf", "drop", "flame", "paw"] as const;
export type PersonaGlyph = (typeof PERSONA_GLYPHS)[number];
/** What leads Dashi's capsule: a glyph in its disc, or `dots` for no disc at all (the first slice's choice, still honoured). Dictation's capsule is always five dots. */
export const PERSONA_MARKS = [...PERSONA_GLYPHS, "dots"] as const;
export type PersonaMark = (typeof PERSONA_MARKS)[number];
/** The five dots at rest: its face (look.ts has each shape). */
export const PERSONA_DOTS = ["line", "smile", "wave", "pearls", "steps", "hop"] as const;
export type PersonaDots = (typeof PERSONA_DOTS)[number];
/** How the dots move while Dashi waits, listens, thinks and speaks (capsule/lib/motion.ts); `still` never moves. */
export const PERSONA_MOTIONS = ["calm", "warm", "quiet", "dry", "patient", "bright", "still"] as const;
export type PersonaMotion = (typeof PERSONA_MOTIONS)[number];
/** How much Dashi says. */
export const PERSONA_TALK = ["less", "normal", "more"] as const;
export type PersonaTalk = (typeof PERSONA_TALK)[number];

export interface Persona {
  /** What Dashi is called in the capsule, the bar and what it says of itself. */
  name: string;
  /** The capsule's colour while Dashi does things, `#rrggbb`; the agents' purple unless set. Dictation's capsule stays ink. */
  colour: string;
  mark: PersonaMark;
  /** The five dots' shape at rest. */
  dots: PersonaDots;
  /** How the dots move; `still` while Dashi drops the act (persona/lib/act.ts) and for Reduce Motion's sake never more than the shape. */
  motion: PersonaMotion;
  /** A voice id of dashi-voice (docs/voice.md); undefined is Dashi's own. */
  voice: string | undefined;
  talk: PersonaTalk;
  /** Added after the assistant's own prompt (agents/ask/answerer.ts `SYSTEM_PROMPT`); "" for none. Never replaces it. */
  prompt: string;
}

export const DEFAULT_PERSONA: Persona = {
  name: "Dashi",
  colour: "#6E56CF",
  mark: "spark",
  dots: "line",
  motion: "calm",
  voice: undefined,
  talk: "normal",
  prompt: "",
};

/** settings.json `persona` (Settings › Dashi). The persona piece may add keys; these are what the others may count on. */
export interface PersonaSettings {
  /** 1 to 24 characters; "Dashi" unless set. */
  name?: string;
  /** A character's id (the persona piece's presets, or the person's own). */
  character?: string;
  /** `#rrggbb`. */
  colour?: string;
  mark?: string;
  dots?: string;
  talk?: string;
}

export const isPersonaName = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length >= 1 && value.length <= 24 && !/[\n\r\0]/.test(value);
export const isPersonaColour = (value: unknown): value is string => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value);
export const isPersonaMark = (value: unknown): value is PersonaMark => PERSONA_MARKS.some((mark) => mark === value);
export const isPersonaGlyph = (value: unknown): value is PersonaGlyph => PERSONA_GLYPHS.some((glyph) => glyph === value);
export const isPersonaDots = (value: unknown): value is PersonaDots => PERSONA_DOTS.some((dots) => dots === value);
export const isPersonaMotion = (value: unknown): value is PersonaMotion => PERSONA_MOTIONS.some((motion) => motion === value);
export const isPersonaTalk = (value: unknown): value is PersonaTalk => PERSONA_TALK.some((talk) => talk === value);
export const isCharacterId = (value: unknown): value is string => typeof value === "string" && /^[a-z0-9][a-z0-9-]{0,31}$/.test(value);
