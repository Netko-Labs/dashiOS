/**
 * Settings › Agents, the launcher's part: who answers an Ask ("Answer
 * requests with": the harnesses installed, a local model, Claude or GPT
 * with a key, or none; nothing until the person picks; answerer-list.tsx),
 * where the key is, which model, and the history of what agents did, with
 * Undo for settings changes.
 */

import { CHEVRON_DOWN, CHEVRON_UP } from "@dashi/ui";
import { Svg, Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { ANSWERERS, type AnswererChoice, isHarnessId } from "../../../agents/ask/answerer.ts";
import { ago, type HistoryEntry } from "../../../agents/ask/history.ts";
import type { KeyPlace, Provider } from "../../../agents/ask/keys.ts";
import type { AnswerStatus } from "../../../agents/ask/types.ts";
import { harnessOrder } from "../../../agents/handoff/order.ts";
import { AnswererList, useHarnesses } from "../../answerer-list.tsx";
import { useColors } from "../../colors.ts";
import { useSettings } from "../../hooks.ts";
import { Spot } from "../../spot.tsx";
import type { SettingsStore } from "../../store.ts";
import { Button, Caption, Choices, Group, Note, Switch } from "../../ui.tsx";
import { Row as Item } from "../row.tsx";
import { Setting } from "../setting.tsx";
import { ListRow } from "./parts.tsx";

const KEY_NAMES: Readonly<Record<Provider, { who: string; variable: string; host: string }>> = {
  anthropic: { who: "Claude", variable: "ANTHROPIC_API_KEY", host: "api.anthropic.com" },
  openai: { who: "GPT", variable: "OPENAI_API_KEY", host: "api.openai.com" },
};

/** How the key row says where a provider's key is (Claude's by default). */
export function keyWords(place: KeyPlace | null, provider: Provider = "anthropic"): string {
  const { who, variable, host } = KEY_NAMES[provider];
  switch (place) {
    case "vault":
      return `In your vault. ${who} never sees it.`;
    case "environment":
      return `From ${variable} in your session. ${who} never sees it; your vault can keep it instead.`;
    case "none":
      return `No key yet. In Passwords, add a token called “${provider}” for ${host}.`;
    default:
      return "Looking…";
  }
}

/** How GPT's model row says what answers. */
export function gptModelWords(models: readonly string[] | null | undefined, named: string | undefined): string {
  if (models === undefined) return "Looking…";
  if (named) return `Answers with ${named}.`;
  if (models === null) return "Your key's models will be listed here once it's in.";
  if (models.length === 0) return "Your key lists no chat model.";
  return `Answers with ${models[0]}, the most capable your key lists.`;
}

/** How the model row says what runs here. */
export function modelWords(models: readonly string[] | null | undefined, named: string | undefined): string {
  if (models === undefined) return "Looking…";
  if (models === null) return "No local model is running. Install Ollama and a model, then come back.";
  if (models.length === 0) return "No model is installed yet.";
  return `${named ?? models[0]}, on this computer. Nothing you ask leaves it.`;
}

/** Most models offered as pills (UI-2); more are a hand-edit of settings.json. */
const MODEL_PILLS = 6;
/** An opened row lists this many of its connections, newest first. */
const PARTS_SHOWN = 20;

const now = (): number => Math.floor(Date.now() / 1000);

/** One agent's connections in quick succession (agents/ask/lib/sessions.ts): one row, opened to list each. */
function SessionsRow({ entry, parts }: { entry: HistoryEntry; parts: readonly HistoryEntry[] }) {
  const colors = useColors();
  const [opened, setOpened] = useState(false);
  const shown = parts.slice(-PARTS_SHOWN).reverse();
  const earlier = parts.length - shown.length;
  return (
    <View testID={`agents-history:${entry.id}`} style={{ flexDirection: "column" }}>
      <ListRow
        testID={`agents-history-open:${entry.id}`}
        name={entry.who}
        detail={`${entry.summary} · ${ago(entry.time, now())}`}
        onPress={() => setOpened((open) => !open)}
      >
        <Text style={{ fontSize: 11, color: colors.textMuted }}>{`${parts.length} connections`}</Text>
        <Svg markup={opened ? CHEVRON_UP : CHEVRON_DOWN} size={12} color={colors.textMuted} />
      </ListRow>
      {opened && (
        <View testID={`agents-history-parts:${entry.id}`} style={{ flexDirection: "column", paddingLeft: 24, paddingBottom: 6 }}>
          {shown.map((part) => (
            <ListRow key={part.id} testID={`agents-history-part:${part.id}`} name={part.summary} detail={ago(part.time, now())} />
          ))}
          {earlier > 0 && <Note>{earlier === 1 ? "And 1 earlier connection." : `And ${earlier} earlier connections.`}</Note>}
        </View>
      )}
    </View>
  );
}

export function HistoryRow({ entry, onUndo }: { entry: HistoryEntry; onUndo: (index: number) => void }) {
  if (entry.parts && entry.parts.length > 1) return <SessionsRow entry={entry} parts={entry.parts} />;
  const undos = entry.steps.flatMap((step, index) => (step.undo && !step.undone && step.outcome === "done" ? [{ index, title: step.undo.title }] : []));
  // A Row gives the words the room they need (a lone Text with one line and no width shows only "…").
  return (
    <Item
      testID={`agents-history:${entry.id}`}
      stack={undos.length > 0}
      label={entry.request ? `${entry.who}: ${entry.request}` : entry.who}
      detail={`${entry.summary} · ${ago(entry.time, now())}`}
    >
      {undos.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {undos.map((undo) => (
            <Button key={undo.index} testID={`agents-undo:${entry.id}:${undo.index}`} label={`Undo: ${undo.title}`} onPress={() => onUndo(undo.index)} />
          ))}
        </View>
      )}
    </Item>
  );
}

export function AnswerSettings({ settings, answers }: { settings: SettingsStore; answers: AnswerStatus }) {
  const { data } = useSettings(settings);
  const choice = data.agents.answerer;
  const [place, setPlace] = useState<KeyPlace | null>(null);
  const [models, setModels] = useState<string[] | null | undefined>(undefined);
  const [gptModels, setGptModels] = useState<string[] | null | undefined>(undefined);
  const [entries, setEntries] = useState<readonly HistoryEntry[]>(() => answers.history());
  const [notice, setNotice] = useState<string | null>(null);
  const harnesses = useHarnesses(answers.harnesses);

  useEffect(() => {
    let current = true;
    setPlace(null);
    if (choice === "claude") void answers.keyPlace("anthropic").then((found) => current && setPlace(found));
    if (choice === "gpt") void answers.keyPlace("openai").then((found) => current && setPlace(found));
    if (choice === "gpt") void answers.gptModels().then((found) => current && setGptModels(found));
    if (choice === "local") void answers.localModels().then((found) => current && setModels(found));
    return () => {
      current = false;
    };
  }, [choice, answers]);
  useEffect(() => answers.onHistory(() => setEntries(answers.history())), [answers]);

  const choose = (value: AnswererChoice) => settings.patch("agents", { answerer: value });
  const gptPills = gptModels && gptModels.length > 1 ? gptModels.slice(0, MODEL_PILLS) : [];
  const undo = (entry: HistoryEntry, index: number) => {
    const step = entry.steps[index];
    if (!step?.undo) return;
    void answers.undo(entry.id, index, step.undo).then((outcome) => setNotice(outcome.ok ? `Undone: ${step.undo?.title}` : outcome.error));
  };
  const pills = models && models.length > 1 ? models.slice(0, MODEL_PILLS) : [];
  const harnessName = isHarnessId(choice) ? ANSWERERS[choice].name : null;
  // "Hand off to": the harnesses installed, the one named first (else the answerer, else the first).
  const installed = harnessOrder(
    (harnesses ?? []).filter((each) => each.installed).map((each) => each.id),
    data.agents.handOff,
    choice,
  );
  const handOff = installed[0] ?? "claude-code";

  return (
    <>
      <Group testID="agents-answerer">
        <Setting id="agents/answer-with" />
        <AnswererList testID="agents-answerer-choice" chosen={choice} harnesses={harnesses} onChoose={choose} />
      </Group>
      {(choice === "claude" || choice === "gpt" || choice === "local") && (
        <Group testID="agents-answerer-detail">
          {choice === "claude" && <Setting id="agents/key" testID="agents-key" detail={keyWords(place, "anthropic")} />}
          {choice === "gpt" && <Setting id="agents/key" testID="agents-key" detail={keyWords(place, "openai")} />}
          {choice === "gpt" && (
            <Setting id="agents/model" testID="agents-gpt-model" detail={gptModelWords(gptModels, data.agents.gptModel)} stack={gptPills.length > 0}>
              {gptPills.length > 0 && (
                <Choices
                  testID="agents-gpt-model-choice"
                  options={gptPills.map((name) => ({ value: name, label: name }))}
                  value={data.agents.gptModel ?? gptPills[0] ?? ""}
                  onChange={(name) => settings.patch("agents", { gptModel: name })}
                />
              )}
            </Setting>
          )}
          {choice === "local" && (
            <Setting id="agents/model" testID="agents-model" detail={modelWords(models, data.agents.localModel)} stack={pills.length > 0}>
              {pills.length > 0 && (
                <Choices
                  testID="agents-model-choice"
                  options={pills.map((name) => ({ value: name, label: name }))}
                  value={data.agents.localModel ?? pills[0] ?? ""}
                  onChange={(name) => settings.patch("agents", { localModel: name })}
                />
              )}
            </Setting>
          )}
        </Group>
      )}
      {installed.length > 0 && (
        <Group testID="agents-hand-off">
          <Setting id="agents/hand-off-to" testID="agents-hand-off-to" stack={installed.length > 1}>
            {installed.length > 1 ? (
              <Choices
                testID="agents-hand-off-choice"
                options={installed.map((id) => ({ value: id, label: ANSWERERS[id].name }))}
                value={handOff}
                onChange={(id) => settings.patch("agents", { handOff: id })}
              />
            ) : (
              <Note>{ANSWERERS[handOff].name}</Note>
            )}
          </Setting>
          <Setting id="agents/skip-grants">
            <Switch
              testID="agents-skip-grants"
              on={data.agents.skipGrants === true}
              onChange={(on) => settings.patch("agents", { skipGrants: on || undefined })}
            />
          </Setting>
        </Group>
      )}
      {harnessName !== null && (
        <Caption>{`${harnessName} runs in Dashi's agent sandbox with only its own sign-in, and its own tools are off: it can only plan.`}</Caption>
      )}
      <Caption>
        Only what you type is sent, with the window or selection you leave beside it, and only when you ask. Ask runs nothing until you see the plan and press
        Return.
      </Caption>
      <Spot id="agents/history" cards>
        <Caption above>History</Caption>
        <Group testID="agents-history">
          {entries.length === 0 ? (
            <Note testID="agents-history-none">Nothing yet. What agents do for you is listed here.</Note>
          ) : (
            entries.map((entry) => <HistoryRow key={entry.id} entry={entry} onUndo={(index) => undo(entry, index)} />)
          )}
        </Group>
      </Spot>
      {notice !== null && <Caption>{notice}</Caption>}
    </>
  );
}
