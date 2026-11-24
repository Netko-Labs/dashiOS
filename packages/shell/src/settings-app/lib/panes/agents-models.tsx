/**
 * Settings › Agents, the model Dashi's agent runs with (decisions.md D262):
 * one pop-up for typed asks and one for spoken ones ("Same as typed" unless
 * chosen), per answerer, so a fast model by voice and a stronger one in the
 * launcher can be compared; and whether typed answers are also said out
 * loud. The models offered are the answerer's own: Claude Code's aliases
 * (its `--help` names fable, opus and sonnet, and full names), Codex's
 * (its `--model` flag; untested, Codex isn't on the laptop), what an
 * Anthropic key lists, what Ollama has installed.
 */

import { PopUpButton, type PopUpOption } from "@dashi/ui";
import { useEffect, useState } from "react";
import { ANSWERERS, type AnswererChoice } from "../../../agents/ask/answerer.ts";
import type { AnswerStatus } from "../../../agents/ask/types.ts";
import { Group } from "../../../shared/cards/index.ts";
import { useSettings } from "../../hooks.ts";
import type { SettingsStore } from "../../store.ts";
import { Switch } from "../../ui.tsx";
import { Setting } from "../setting.tsx";

/** A spoken model that is the answerer's own default even when a typed one is chosen. */
export const OWN_DEFAULT = "default";
const SAME = "";
const POP_WIDTH = 220;

/** The models each harness takes by name; a key's and Ollama's are listed live. */
const NAMED: Partial<Record<AnswererChoice, ReadonlyArray<{ value: string; label: string }>>> = {
  "claude-code": [
    { value: "opus", label: "Opus" },
    { value: "sonnet", label: "Sonnet" },
    { value: "haiku", label: "Haiku" },
    { value: "fable", label: "Fable" },
  ],
  codex: [
    { value: "gpt-5-codex", label: "gpt-5-codex" },
    { value: "gpt-5", label: "gpt-5" },
  ],
};

/** The pop-up's models for `answerer`: its named ones, or what it lists, and the one in use if it is neither. */
export function modelOptions(
  answerer: AnswererChoice,
  listed: readonly string[] | null | undefined,
  inUse: readonly (string | undefined)[] = [],
): Array<{ value: string; label: string }> {
  const base = NAMED[answerer] ?? (listed ?? []).map((id) => ({ value: id, label: id }));
  const extra = inUse.filter((id): id is string => !!id && id !== OWN_DEFAULT && !base.some((each) => each.value === id));
  return [...base, ...extra.map((id) => ({ value: id, label: id }))];
}

const ownDefault = (answerer: AnswererChoice): string => `${ANSWERERS[answerer === "none" ? "claude" : answerer].name}’s own default`;

export function ModelRows({ settings, answers }: { settings: SettingsStore; answers: AnswerStatus }) {
  const { data } = useSettings(settings);
  const choice = data.agents.answerer;
  const [listed, setListed] = useState<string[] | null | undefined>(undefined);
  useEffect(() => {
    let current = true;
    setListed(undefined);
    if (choice === "claude") void answers.claudeModels().then((found) => current && setListed(found));
    if (choice === "local") void answers.localModels().then((found) => current && setListed(found));
    return () => {
      current = false;
    };
  }, [choice, answers]);
  if (!choice || choice === "none" || choice === "gpt") return null;
  const now = data.agents.models?.[choice] ?? {};
  const typed = now.typed ?? (choice === "local" ? data.agents.localModel : undefined);
  const models = modelOptions(choice, listed, [typed, now.spoken]);
  const set = (which: "typed" | "spoken", value: string) =>
    settings.patch("agents", { models: { ...data.agents.models, [choice]: { ...now, [which]: value === SAME ? undefined : value } } });
  const typedOptions: PopUpOption<string>[] = [
    { value: SAME, label: ownDefault(choice) },
    ...(models.length > 0 ? [{ type: "separator" as const }] : []),
    ...models,
  ];
  const sameLabel = `Same as typed (${models.find((each) => each.value === typed)?.label ?? "its default"})`;
  const spokenOptions: PopUpOption<string>[] = [
    { value: SAME, label: sameLabel },
    { type: "separator" },
    { value: OWN_DEFAULT, label: ownDefault(choice) },
    ...models,
  ];
  return (
    <Group testID="agents-models">
      <Setting id="agents/model-typed" testID="agents-model-typed">
        <PopUpButton
          testID="agents-model-typed-choice"
          options={typedOptions}
          value={typed ?? SAME}
          onChange={(value) => set("typed", value)}
          width={POP_WIDTH}
        />
      </Setting>
      <Setting id="agents/model-spoken" testID="agents-model-spoken">
        <PopUpButton
          testID="agents-model-spoken-choice"
          options={spokenOptions}
          value={now.spoken ?? SAME}
          onChange={(value) => set("spoken", value)}
          width={POP_WIDTH}
        />
      </Setting>
      <Setting id="agents/read-typed" testID="agents-read-typed">
        <Switch
          testID="agents-read-typed-switch"
          on={data.agents.readTyped === true}
          onChange={(on) => settings.patch("agents", { readTyped: on ? true : undefined })}
        />
      </Setting>
    </Group>
  );
}
