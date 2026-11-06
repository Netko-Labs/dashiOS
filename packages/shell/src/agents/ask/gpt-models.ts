/**
 * Which OpenAI model answers when the person hasn't named one: the most
 * capable chat model the key's `/v1/models` lists. Nothing is hard-coded as
 * the only choice: the list comes from the key, and this only orders it.
 *
 * Kept: GPT and o-series models that Chat Completions answers with tools.
 * Left out: audio, realtime, speech, transcription, images, search,
 * embeddings, moderation, instruct and legacy completions, and the
 * Responses-only lines (`-pro`, `-codex`, `computer-use`, `deep-research`).
 *
 * Ordered by generation (gpt-5.1 over gpt-5 over o3 over gpt-4.1 over
 * gpt-4o), a full model over its mini and nano, an alias over its dated
 * snapshots, a later snapshot over an earlier one.
 */

const LEFT_OUT =
  /audio|realtime|tts|transcribe|whisper|image|dall-e|sora|search|embedding|moderation|instruct|babbage|davinci|-pro\b|codex|computer-use|deep-research|oss/;

/** Whether `id` is a chat model this answerer can plan with. */
export function isChatModel(id: string): boolean {
  if (LEFT_OUT.test(id)) return false;
  return /^(?:gpt-\d|o\d|chatgpt-)/.test(id);
}

/** A generation score: gpt-X.Y is X.Y, gpt-4o 4.05, an o-series oN sits between gpt-4.5 and gpt-5. */
function generation(id: string): number {
  const gpt = /^(?:chatgpt|gpt)-(\d+)(?:\.(\d+))?(o)?/.exec(id);
  if (gpt) return Number(gpt[1]) + Number(gpt[2] ?? 0) / 10 + (gpt[3] ? 0.05 : 0);
  const o = /^o(\d+)/.exec(id);
  if (o) return 4.5 + Number(o[1]) / 10;
  return 0;
}

const SIZE_COST: ReadonlyArray<[RegExp, number]> = [
  [/-nano\b/, 1],
  [/-mini\b/, 0.5],
  [/-chat-latest$|^chatgpt-/, 0.05],
];

const DATED = /-(\d{4}-\d{2}-\d{2}|\d{4})$/;

function score(id: string): number {
  const size = SIZE_COST.find(([pattern]) => pattern.test(id))?.[1] ?? 0;
  return generation(id) - size;
}

/** The chat models in `ids`, the most capable first. */
export function rankGptModels(ids: readonly string[]): string[] {
  return [...new Set(ids)].filter(isChatModel).sort((a, b) => {
    const byScore = score(b) - score(a);
    if (byScore !== 0) return byScore;
    const datedA = DATED.exec(a)?.[1] ?? null;
    const datedB = DATED.exec(b)?.[1] ?? null;
    // The alias (always the current snapshot) first, then later snapshots.
    if (datedA === null || datedB === null) return datedA === null ? (datedB === null ? a.localeCompare(b) : -1) : 1;
    return datedB.localeCompare(datedA);
  });
}
