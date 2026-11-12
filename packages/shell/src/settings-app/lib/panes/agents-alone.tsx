/**
 * Settings › Agents, "Let agents work alone" (agents/alone/; docs/actions.md,
 * "Working alone"): one switch. Off, the person picks for how long, what
 * agents may do without asking, which sites, and whether it outlasts a
 * lock, starting from what they already allowed. On, the row says until
 * when and what it covers, and the switch stops it; to change it, stop it
 * and start again. Under it, the last times it ran, each with what agents
 * did and Show for the whole record. Only the person's own press here turns
 * it on or changes a pick (the shell asks the compositor whose press it was).
 */

import { Text, TextInput, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import {
  ALONE_MAX_MINUTES,
  ALONE_MINUTES,
  ALONE_SCOPES,
  type AloneRecord,
  type AloneState,
  aloneDefaults,
  customMinutes,
  minutesWords,
  recordSummary,
} from "../../../agents/alone/index.ts";
import { label, type Scope } from "../../../agents/consent.ts";
import { Button, Caption, Group, useSurface } from "../../../shared/cards/index.ts";
import { elapsedText, formatTime, useClockPrefs } from "../../../shared/time/index.ts";
import { useColors } from "../../colors.ts";
import type { PaneContext } from "../../context.ts";
import { useGrantEntries } from "../../hooks.ts";
import { Choices, Switch } from "../../ui.tsx";
import { Row as Item } from "../row.tsx";
import { Setting } from "../setting.tsx";
import { AddSite, Ticks } from "./agents-alone-parts.tsx";

/** How many of the last times it lists. */
const RECORDS_SHOWN = 3;

export const ONLY_YOU_PICK = "Only you can change what is picked. Press it yourself, here.";

export const NEVER_WORDS =
  "Payments, sign-ins, your clipboard history, force quit, the Trash, and installing or updating software always ask. Only you can turn this on, here; agents can't, and can't make it longer or wider.";

type Time = "custom" | `${(typeof ALONE_MINUTES)[number]}`;
const TIMES: ReadonlyArray<{ value: Time; label: string }> = [
  ...ALONE_MINUTES.map((minutes) => ({ value: `${minutes}` as const, label: minutesWords(minutes) })),
  { value: "custom", label: "Custom" },
];

/** What the row says while it is on: until when, and what it covers. */
export function onWords(state: Extract<AloneState, { on: true }>, ends: string): string {
  const sites = state.scopes.includes("web") && state.sites.length > 0 ? ` On ${state.sites.join(", ")}.` : "";
  return `On until ${ends}. Without asking: ${state.scopes.map(label).join(", ")}.${sites}${state.throughLock ? " It stays on when the screen locks." : ""}`;
}

type Alone = NonNullable<PaneContext["alone"]>;

/** A set with `value` in or out. */
function toggled<T extends string>(set: ReadonlySet<T>, value: T, on: boolean): Set<T> {
  const next = new Set(set);
  if (on) next.add(value);
  else next.delete(value);
  return next;
}

/** What the person picked, kept while Settings is open, so a second run starts from the first's picks. */
function usePicks(ctx: Pick<PaneContext, "grants" | "sites">) {
  const entries = useGrantEntries(ctx.grants);
  const [first] = useState(() => aloneDefaults(entries, [...(ctx.sites?.ahead() ?? []), ...(ctx.sites?.everyAgents() ?? [])]));
  const [scopes, setScopes] = useState<ReadonlySet<Scope>>(() => new Set(first.scopes));
  const [offered, setOffered] = useState<readonly string[]>(first.sites);
  const [sites, setSites] = useState<ReadonlySet<string>>(() => new Set(first.sites));
  const [time, setTime] = useState<Time>("60");
  const [custom, setCustom] = useState("30");
  const [throughLock, setThroughLock] = useState(false);
  return { scopes, setScopes, offered, setOffered, sites, setSites, time, setTime, custom, setCustom, throughLock, setThroughLock };
}

/** The picks, before it is on. */
function Picks({ picks, alone }: { picks: ReturnType<typeof usePicks>; alone: Alone }) {
  const colors = useColors();
  const surface = useSurface();
  const { scopes, setScopes, offered, setOffered, sites, setSites, time, setTime, custom, setCustom, throughLock, setThroughLock } = picks;
  const [problem, setProblem] = useState<string | null>(null);
  // A pick changes only when the person's own press changed it: an agent's pointer or keys here change nothing.
  const mine = (change: () => void) =>
    void alone.byPerson().then((person) => {
      if (person) change();
      setProblem(person ? null : ONLY_YOU_PICK);
    });
  const minutes = time === "custom" ? customMinutes(custom) : Number(time);
  const start = () => {
    setProblem(null);
    void alone.start({ scopes: [...scopes], sites: [...sites], minutes, throughLock }).then((started) => setProblem(started.ok ? null : started.why));
  };
  return (
    <>
      <Group testID="agents-alone">
        {/* Why it didn't start, where the person just pressed. */}
        <Setting id="agents/work-alone" testID="alone-row" {...(problem === null ? {} : { detail: problem })}>
          <Switch testID="alone-switch" on={false} onChange={start} />
        </Setting>
        <Setting id="agents/work-alone-time" stack>
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
            <Choices testID="alone-time" options={TIMES} value={time} onChange={(value) => mine(() => setTime(value))} />
            {time === "custom" && (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={{ width: 56, height: 28, justifyContent: "center", paddingHorizontal: 8, borderRadius: 8, backgroundColor: surface.field }}>
                  <TextInput
                    testID="alone-custom"
                    value={custom}
                    onChangeText={(text) => mine(() => setCustom(text))}
                    onSubmitEditing={start}
                    style={{ flex: 1, fontSize: 12, color: colors.text, backgroundColor: "#00000000" }}
                  />
                </View>
                <Text style={{ fontSize: 12, color: minutes === null ? colors.critical : colors.textMuted }}>
                  {minutes === null ? `minutes, from 1 to ${ALONE_MAX_MINUTES}` : "minutes"}
                </Text>
              </View>
            )}
          </View>
        </Setting>
        <Setting id="agents/work-alone-tools" stack>
          <Ticks
            testID="alone-tools"
            options={ALONE_SCOPES.map((scope) => ({ value: scope, label: label(scope) }))}
            chosen={scopes}
            onChange={(scope, on) => mine(() => setScopes((now) => toggled(now, scope, on)))}
          />
        </Setting>
        {scopes.has("web") && (
          <Setting id="agents/work-alone-sites" stack>
            <Ticks
              testID="alone-sites"
              options={offered.map((site) => ({ value: site, label: site }))}
              chosen={sites}
              onChange={(site, on) => mine(() => setSites((now) => toggled(now, site, on)))}
            />
            <AddSite
              listed={offered}
              onAdd={(site) =>
                mine(() => {
                  setOffered((now) => [...now, site]);
                  setSites((now) => toggled(now, site, true));
                })
              }
            />
          </Setting>
        )}
        <Setting id="agents/work-alone-lock">
          <Switch testID="alone-through-lock" on={throughLock} onChange={(on) => mine(() => setThroughLock(on))} />
        </Setting>
      </Group>
      <Caption>{NEVER_WORDS}</Caption>
    </>
  );
}

function Records({ records, onShow }: { records: readonly AloneRecord[]; onShow?: (record: AloneRecord) => void }) {
  const prefs = useClockPrefs();
  if (records.length === 0) return null;
  return (
    <Group testID="agents-alone-records">
      <Setting id="agents/work-alone-records" />
      {records.slice(0, RECORDS_SHOWN).map((record) => {
        const started = new Date(record.started);
        return (
          <Item
            key={record.started}
            testID={`alone-record:${record.started}`}
            label={`${started.toLocaleDateString(prefs.locale, { month: "short", day: "numeric" })}, ${formatTime(started, prefs)} · ${elapsedText(record.ended - record.started)}`}
            detail={recordSummary(record)}
          >
            {onShow && <Button testID={`alone-record-show:${record.started}`} label="Show" onPress={() => onShow(record)} />}
          </Item>
        );
      })}
    </Group>
  );
}

export function WorkAloneSection({ ctx }: { ctx: Pick<PaneContext, "alone" | "grants" | "sites" | "showAloneRecord"> }) {
  const { alone } = ctx;
  if (!alone) return null;
  return <Section ctx={ctx} alone={alone} />;
}

function Section({ ctx, alone }: { ctx: Pick<PaneContext, "grants" | "sites" | "showAloneRecord">; alone: Alone }) {
  const prefs = useClockPrefs();
  const state = useSyncExternalStore(alone.subscribe, alone.getSnapshot);
  const records = useSyncExternalStore(alone.records.subscribe, alone.records.getSnapshot);
  const picks = usePicks(ctx);
  return (
    <>
      {state.on ? (
        <>
          <Group testID="agents-alone">
            <Setting id="agents/work-alone" testID="alone-row" detail={onWords(state, formatTime(new Date(state.ends), prefs))}>
              <Switch testID="alone-switch" on onChange={() => void alone.stop()} />
            </Setting>
          </Group>
          <Caption>To change it, turn it off and on again. The menu bar shows the time left, and a click there stops it.</Caption>
        </>
      ) : (
        <Picks picks={picks} alone={alone} />
      )}
      <Records records={records} {...(ctx.showAloneRecord ? { onShow: ctx.showAloneRecord } : {})} />
    </>
  );
}
