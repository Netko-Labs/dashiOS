/**
 * "Answer requests with": one row per answerer (agents/ask/choices.ts), a
 * check on the one chosen and none until the person picks. Settings ›
 * Agents and Setup's Agents page both draw it, from the same reads. A row's
 * detail may wrap (an install command is long); its name never does.
 */

import { Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import type { AnswererChoice } from "../../agents/ask/answerer.ts";
import { type AnswererRow, answererRows } from "../../agents/ask/choices.ts";
import type { HarnessStatus } from "../../agents/ask/harness/index.ts";
import { useColors } from "../colors.ts";
import { CheckSlot } from "./parts.tsx";

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

function AnswererItem({ testID, row, chosen, onPress }: { testID: string; row: AnswererRow; chosen: boolean; onPress: (() => void) | undefined }) {
  const colors = useColors();
  return (
    <View
      testID={testID}
      onPress={onPress}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 10,
        minHeight: 44,
        paddingHorizontal: 12,
        paddingVertical: 6,
        hoverBackgroundColor: onPress ? colors.button : "#00000000",
      }}
    >
      <CheckSlot on={chosen} />
      <View style={{ flex: 1, flexDirection: "column", gap: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 13, fontWeight: chosen ? "semibold" : "normal", color: row.available ? colors.text : colors.textMuted }}>
          {row.name}
        </Text>
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{row.detail}</Text>
      </View>
    </View>
  );
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
    <>
      {answererRows(harnesses, chosen).map((row) => (
        <AnswererItem
          key={row.value}
          testID={`${testID}:${row.value}`}
          row={row}
          chosen={row.value === chosen}
          onPress={row.available && row.value !== chosen ? () => onChoose(row.value) : undefined}
        />
      ))}
    </>
  );
}
