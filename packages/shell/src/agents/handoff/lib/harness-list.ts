/** The installed harnesses on the "Hand it off" rows: which come first (Settings › Agents), and whether each is signed in. */

import { ANSWERERS, HARNESS_IDS, type HarnessId } from "../../ask/answerer.ts";
import { findHarness, HARNESSES, signedIn } from "../../ask/harness/index.ts";
import { harnessOrder } from "../order.ts";
import type { HandoffDeps, HandoffHarness } from "../types.ts";

/** The harnesses' words for their rows, mid-sentence: "your ChatGPT plan", "OpenCode's configured provider" (a name keeps its capital). */
export function usesWords(id: HarnessId): string {
  const uses = HARNESSES[id].uses;
  return /^(?:Your|A|An|The)\b/.test(uses) ? uses.charAt(0).toLowerCase() + uses.slice(1) : uses;
}

export class HarnessList {
  private signed = new Map<HarnessId, boolean | null>();
  private found: HandoffHarness[] = [];
  private readonly listeners = new Set<() => void>();
  private readonly offSettings: () => void;

  constructor(private readonly deps: HandoffDeps) {
    this.look();
    this.offSettings = deps.options.settings.subscribe(() => this.look());
  }

  harnesses(): readonly HandoffHarness[] {
    return this.found;
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Look again for harnesses (the launcher opened), and whether they're signed in. */
  refresh(): void {
    const { home, env, files, options } = this.deps;
    this.look();
    void Promise.all(
      this.found.map(async (harness) => {
        const where = findHarness(HARNESSES[harness.id], home, env.PATH, files);
        const yes = where ? await signedIn(HARNESSES[harness.id], where, home, env, options.probe).catch(() => null) : null;
        return [harness.id, yes] as const;
      }),
    ).then((answers) => {
      this.signed = new Map(answers);
      this.look();
    });
  }

  close(): void {
    this.offSettings();
  }

  private look(): void {
    const { home, env, files, options } = this.deps;
    const installed = home ? HARNESS_IDS.filter((id) => findHarness(HARNESSES[id], home, env.PATH, files) !== null) : [];
    const agents = options.settings.getSnapshot().data.agents;
    this.found = harnessOrder(installed, agents.handOff, agents.answerer).map((id) => ({
      id,
      name: ANSWERERS[id].name,
      uses: usesWords(id),
      signedIn: this.signed.get(id) ?? null,
    }));
    for (const listener of this.listeners) listener();
  }
}
