/** Words the capsule piece says or hears: a spoken yes or no, a plan read out, a finished task's line. */

const YES = new Set(["yes", "yeah", "yep", "yes please", "do it", "go ahead", "go", "ok", "okay", "sure", "sí", "si", "dale", "hazlo", "claro"]);
const NO = new Set(["no", "nope", "no thanks", "cancel", "stop", "don't", "do not", "never mind", "nevermind", "cancela", "para"]);

/** A yes or a no said as the whole of what was said (pill-v2 README, "What it may take from the keyboard"); null for anything else. */
export function spokenYesNo(heard: string): boolean | null {
  const said = heard
    .toLowerCase()
    .replace(/[.,!?¡¿…]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (YES.has(said)) return true;
  if (NO.has(said)) return false;
  return null;
}

const sentence = (text: string): string => {
  const clean = text.replace(/\s+/g, " ").trim();
  return clean === "" || /[.!?…]$/.test(clean) ? clean : `${clean}.`;
};

/** A plan as Dashi says it when its card opens: what it would do, and how to say yes. */
export function planSpoken(said: string, steps: readonly string[]): string {
  const plan = steps.length === 1 ? `I would ${lower(steps[0] ?? "")}` : `My plan has ${steps.length} steps: ${steps.join("; ")}`;
  return [sentence(said), sentence(plan), "Say yes, or press Yes."].filter(Boolean).join(" ");
}
const lower = (text: string): string => text.charAt(0).toLowerCase() + text.slice(1);

/** What the capsule says when a spoken task's steps have run. */
export function doneLine(steps: ReadonlyArray<{ title: string; state: { kind: string } }>): { line: string; ok: boolean } {
  const failed = steps.filter((step) => step.state.kind !== "done").length;
  if (failed > 0) return { line: failed === steps.length ? "It didn't work. See the launcher." : `${failed} of ${steps.length} steps didn't work.`, ok: false };
  return { line: steps.length === 1 ? `Done: ${steps[0]?.title ?? ""}` : `Done: ${steps.length} steps`, ok: true };
}
