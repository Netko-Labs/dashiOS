/**
 * The model that hears what is said (Settings › Voice, "Recogniser"; decisions.md D200): Parakeet TDT 0.6B v3, the
 * default, or Whisper large-v3-turbo, which dashi-voice already has for the languages Parakeet lacks ("More languages").
 * Dictation and the Dashi key both use the one chosen; the service falls back to Parakeet when Whisper is not here.
 */

export type Recognizer = "parakeet" | "whisper";

export const RECOGNIZERS: readonly Recognizer[] = ["parakeet", "whisper"];

export const isRecognizer = (value: unknown): value is Recognizer => value === "parakeet" || value === "whisper";

/** What `listen` is sent for a choice: nothing for the default. */
export const listenModel = (choice: string | undefined): { model?: Recognizer } => (choice === "whisper" ? { model: "whisper" } : {});
