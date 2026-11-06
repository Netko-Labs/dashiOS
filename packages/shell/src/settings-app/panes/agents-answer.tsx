/**
 * Settings › Agents, the launcher's part: who answers an Ask ("Answer
 * requests with": a local model first, Claude, or none; nothing until the
 * person picks), where Claude's key is, which local model, and the history
 * of what agents did, with Undo for settings changes.
 */

import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";
import { useEffect, useState } from "react";
import { type AnswererChoice, CHOICE_LABELS } from "../../agents/ask/answerer.ts";
import { ago, type HistoryEntry } from "../../agents/ask/history.ts";
import type { KeyPlace } from "../../agents/ask/keys.ts";
import type { AnswerStatus } from "../../agents/ask/service.ts";
import { useSettings } from "../hooks.ts";
import type { SettingsStore } from "../store.ts";
import { Button, Caption, Choices, Group, Note, Row } from "../ui.tsx";

/** How the key row says where Claude's key is. */
export function keyWords(place: KeyPlace | null): string {
  switch (place) {
    case "vault":
      return "In your vault. Claude never sees it.";
    case "environment":
      return "From ANTHROPIC_API_KEY in your session. Claude never sees it; your vault can keep it instead.";
    case "none":
      return "No key yet. In Passwords, add a token called “anthropic” for api.anthropic.com.";
    default:
      return "Looking…";
  }
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

function HistoryRow({ entry, onUndo }: { entry: HistoryEntry; onUndo: (index: number) => void }) {
  const colors = useColors();
  const undos = entry.steps.flatMap((step, index) => (step.undo && !step.undone && step.outcome === "done" ? [{ index, title: step.undo.title }] : []));
  return (
    <View testID={`agents-history:${entry.id}`} style={{ flexDirection: "column", gap: 4, padding: 12 }}>
      <Text numberOfLines={1} style={{ fontSize: 13, color: colors.text }}>
        {entry.request ? `${entry.who}: ${entry.request}` : entry.who}
      </Text>
      <Text numberOfLines={1} style={{ fontSize: 11, color: colors.textMuted }}>
        {`${entry.summary} · ${ago(entry.time, Math.floor(Date.now() / 1000))}`}
      </Text>
      {undos.length > 0 && (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {undos.map((undo) => (
            <Button key={undo.index} testID={`agents-undo:${entry.id}:${undo.index}`} label={`Undo: ${undo.title}`} onPress={() => onUndo(undo.index)} />
          ))}
        </View>
      )}
    </View>
  );
}

export function AnswerSettings({ settings, answers }: { settings: SettingsStore; answers: AnswerStatus }) {
  const { data } = useSettings(settings);
  const choice = data.agents.answerer;
  const [place, setPlace] = useState<KeyPlace | null>(null);
  const [models, setModels] = useState<string[] | null | undefined>(undefined);
  const [entries, setEntries] = useState<readonly HistoryEntry[]>(() => answers.history());
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    if (choice === "claude") void answers.keyPlace().then((found) => current && setPlace(found));
    if (choice === "local") void answers.localModels().then((found) => current && setModels(found));
    return () => {
      current = false;
    };
  }, [choice, answers]);
  useEffect(() => answers.onHistory(() => setEntries(answers.history())), [answers]);

  const choose = (value: AnswererChoice | "unset") => {
    if (value !== "unset") settings.patch("agents", { answerer: value });
  };
  const undo = (entry: HistoryEntry, index: number) => {
    const step = entry.steps[index];
    if (!step?.undo) return;
    void answers.undo(entry.id, index, step.undo).then((outcome) => setNotice(outcome.ok ? `Undone: ${step.undo?.title}` : outcome.error));
  };
  const pills = models && models.length > 1 ? models.slice(0, MODEL_PILLS) : [];

  return (
    <>
      <Group testID="agents-answerer">
        <Row label="Answer requests with" detail="In the launcher, type what to do, then press Tab to ask." stack>
          <Choices<AnswererChoice | "unset"> testID="agents-answerer-choice" options={CHOICE_LABELS} value={choice ?? "unset"} onChange={choose} />
        </Row>
        {choice === "claude" && <Row testID="agents-key" label="Key" detail={keyWords(place)} />}
        {choice === "local" && (
          <Row testID="agents-model" label="Model" detail={modelWords(models, data.agents.localModel)} stack={pills.length > 0}>
            {pills.length > 0 && (
              <Choices
                testID="agents-model-choice"
                options={pills.map((name) => ({ value: name, label: name }))}
                value={data.agents.localModel ?? pills[0] ?? ""}
                onChange={(name) => settings.patch("agents", { localModel: name })}
              />
            )}
          </Row>
        )}
      </Group>
      <Caption>Only what you type is sent, and only when you ask. Nothing runs until you see the plan and press Return.</Caption>
      <Caption above>History</Caption>
      <Group testID="agents-history">
        {entries.length === 0 ? (
          <Note testID="agents-history-none">Nothing yet. What agents do for you is listed here.</Note>
        ) : (
          entries.map((entry) => <HistoryRow key={entry.id} entry={entry} onUndo={(index) => undo(entry, index)} />)
        )}
      </Group>
      {notice !== null && <Caption>{notice}</Caption>}
    </>
  );
}
