/** settings.json `agents.models`, read from the file (decisions.md D262): per answerer, a model's name when typed and when spoken. */

import { isRecord } from "@dashi/shape";
import { isModelName } from "../ask/index.ts";
import type { ModelChoices } from "./types.ts";

const isPair = (value: unknown): boolean =>
  isRecord(value) && Object.entries(value).every(([key, name]) => (key === "typed" || key === "spoken") && isModelName(name));

export function isModelChoices(value: unknown): value is ModelChoices {
  return isRecord(value) && Object.keys(value).length <= 16 && Object.values(value).every(isPair);
}
