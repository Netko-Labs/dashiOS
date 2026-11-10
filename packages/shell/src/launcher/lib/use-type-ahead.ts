/**
 * The launcher's side of typing ahead (type-ahead.ts): keys typed before its
 * field had the keyboard are played into it in order, one step per commit, so
 * a Return typed after "ter" acts on the rows for "ter", not on the empty
 * field's. Text and BackSpaces in a row are one step; each other key is its own.
 */

import { useEffect, useRef, useState } from "react";
import { isEdit, type Typed, type TypedKey } from "../type-ahead.ts";

export interface TypeAheadSource {
  subscribe(listener: (keys: readonly Typed[]) => void): () => void;
  /** Every key given has been played in and committed. */
  drained?(): void;
}

export interface TypeAheadHandlers {
  /** Text and BackSpaces, to apply to the field's text (`applyEdits`). */
  edit(edits: readonly Typed[]): void;
  /** Return, Escape, ↑ or ↓, as the field would take them now. */
  key(key: TypedKey): void;
}

export function useTypeAhead(source: TypeAheadSource | undefined, handlers: TypeAheadHandlers): void {
  const queue = useRef<Typed[]>([]);
  const [step, setStep] = useState(0);
  // The handlers of the last render: they see its text and its rows.
  const latest = useRef(handlers);
  latest.current = handlers;

  useEffect(
    () =>
      source?.subscribe((keys) => {
        queue.current.push(...keys);
        setStep((now) => now + 1);
      }),
    [source],
  );

  // biome-ignore lint/correctness/useExhaustiveDependencies: each step runs after the commit the one before it caused
  useEffect(() => {
    const [next] = queue.current;
    // Empty after a commit: what was given is in the field.
    if (!next) return source?.drained?.();
    if (isEdit(next)) {
      const count = queue.current.findIndex((typed) => !isEdit(typed));
      latest.current.edit(queue.current.splice(0, count < 0 ? queue.current.length : count));
    } else if (next.kind === "key") {
      queue.current.shift();
      latest.current.key(next.key);
    }
    setStep((now) => now + 1);
  }, [step]);
}
