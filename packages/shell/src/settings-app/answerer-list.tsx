/**
 * "Answer requests with": one row per answerer (agents/ask/choices.ts), the
 * chosen one in the selection look (SE-10) and none until the person picks;
 * one Tab stop the arrows move through (SE-A18). Settings ›
 * Agents and Setup's Agents page both draw it, from the same reads. A row's
 * detail may wrap (an install command is long); its name never does.
 */

import { useEffect, useState } from "react";
import type { AnswererChoice } from "../agents/ask/answerer.ts";
import { answererRows } from "../agents/ask/choices.ts";
import type { HarnessStatus } from "../agents/ask/harness/index.ts";
import { RowList } from "../shared/cards/index.ts";
import { ListRow } from "./lib/panes/parts.tsx";

/** The harnesses' rows, looked up while the list is up; null until they answer. */
export function useHarnesses(read: (() => Promise<HarnessStatus[]>) | undefined): readonly HarnessStatus[] | null {
  const [found, setFound] = useState<readonly HarnessStatus[] | null>(null);
  useEffect(() => {
    let current = true;
    if (read) void read().then((statuses) => current && setFound(statuses));
    return () => {
      current = false;
    };
  }, [read]);
  return found;
}

export function AnswererList({
  testID,
  chosen,
  harnesses,
  onChoose,
}: {
  testID: string;
  chosen: AnswererChoice | undefined;
  harnesses: readonly HarnessStatus[] | null;
  onChoose(value: AnswererChoice): void;
}) {
  return (
    <RowList testID={testID} role="listbox">
      {answererRows(harnesses, chosen).map((row) => (
        <ListRow
          key={row.value}
          testID={`${testID}:${row.value}`}
          name={row.name}
          detail={row.detail}
          wrap
          chosen={row.value === chosen}
          unavailable={!row.available}
          onPress={() => row.value !== chosen && onChoose(row.value)}
        />
      ))}
    </RowList>
  );
}
