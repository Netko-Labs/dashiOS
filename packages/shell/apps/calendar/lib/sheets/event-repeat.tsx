/**
 * The repeat part of the event sheet: how often, on which weekdays or which
 * day of the month, and when it ends. Shown only for a plain repeat (a
 * custom rule, which the form cannot change, shows none of it).
 */

import { Choices, useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { type ClockPrefs, weekdayNames } from "../../../../src/shared/time/index.ts";
import { type Draft, type EndsChoice, type MonthlyBy, nthOf } from "../draft.ts";
import { nthName } from "../format.ts";
import { DayField, FormRow, LineText, Stepper } from "./form-fields.tsx";

const ENDS: ReadonlyArray<{ value: EndsChoice; label: string }> = [
  { value: "never", label: "Never" },
  { value: "count", label: "After" },
  { value: "until", label: "On date" },
];
const UNITS = { daily: "day", weekly: "week", monthly: "month", yearly: "year" } as const;

export interface RepeatFieldsProps {
  draft: Draft;
  prefs: ClockPrefs;
  firstDay: number;
  change: (patch: Partial<Draft>) => void;
}

/** The weekday buttons, starting on the region's first day and saying its letters. */
function Weekdays({ draft, prefs, firstDay, change }: RepeatFieldsProps) {
  const colors = useColors();
  const names = weekdayNames(prefs.locale, 0);
  const order = Array.from({ length: 7 }, (_, offset) => (firstDay + offset) % 7);
  return (
    <FormRow label="On" pills>
      <View testID="event-weekdays" style={{ flexDirection: "row", gap: 4 }}>
        {order.map((index) => {
          const on = draft.weekdays.includes(index);
          return (
            <View
              key={index}
              testID={`event-weekday:${index}`}
              focusable
              accessibilityRole="checkbox"
              accessibilityLabel={names[index]}
              onPress={() => change({ weekdays: on ? draft.weekdays.filter((each) => each !== index) : [...draft.weekdays, index] })}
              style={{
                width: 26,
                height: 26,
                borderRadius: 13,
                alignItems: "center",
                justifyContent: "center",
                backgroundColor: on ? colors.selection : colors.button,
                focusRingColor: colors.focusRing,
              }}
            >
              <Text style={{ fontSize: 11, fontWeight: "semibold", color: on ? "#ffffff" : colors.text }}>
                {(names[index] ?? "").slice(0, 1).toUpperCase()}
              </Text>
            </View>
          );
        })}
      </View>
    </FormRow>
  );
}

/** Every N days, weeks, months or years; which weekdays or day of the month; and when it ends. */
export function RepeatFields(props: RepeatFieldsProps) {
  const { draft, prefs, firstDay, change } = props;
  const fields = { prefs, firstDay };
  const monthly: ReadonlyArray<{ value: MonthlyBy; label: string }> = [
    { value: "date", label: `On day ${Number(draft.startDay.slice(8, 10))}` },
    { value: "weekday", label: `On ${nthName(nthOf(draft.startDay), prefs)}` },
  ];
  return (
    <>
      <FormRow label="Every">
        <Stepper id="event-every" value={draft.every} min={1} max={99} onChange={(every) => change({ every })} />
        <LineText>{`${UNITS[draft.repeat as keyof typeof UNITS]}${draft.every === 1 ? "" : "s"}`}</LineText>
      </FormRow>
      {draft.repeat === "weekly" && <Weekdays {...props} />}
      {draft.repeat === "monthly" && (
        <FormRow label="On" pills>
          <Choices testID="event-monthly" options={monthly} value={draft.monthlyBy} onChange={(monthlyBy) => change({ monthlyBy })} />
        </FormRow>
      )}
      <FormRow label="Ends" pills>
        <Choices testID="event-ends" options={ENDS} value={draft.ends} onChange={(ends) => change({ ends })} />
        {draft.ends === "count" && (
          <>
            <Stepper id="event-count" value={draft.count} min={1} max={999} onChange={(count) => change({ count })} />
            <LineText>times</LineText>
          </>
        )}
        {draft.ends === "until" && <DayField id="until" value={draft.until} {...fields} onChange={(until) => change({ until })} />}
      </FormRow>
    </>
  );
}
