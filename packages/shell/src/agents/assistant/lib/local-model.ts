/** A model on this computer through Ollama, for the shell's own loop: one streamed chat request a turn (models.ts says how and why). */

import { isRecord } from "@dashi/shape";
import { AnswerError, type Fetch, LOCAL_URL, localModels, toolsForRequest } from "../../ask/index.ts";
import { type ChatModel, linesOf, parsed, send, TIMEOUT_MS, type ToolSpec, type WantedCall } from "./models.ts";

/** The tools every local model is offered, whatever the words: enough to open, read and act on a page, see the windows, change a setting, and ask. */
export const LOCAL_CORE = [
  "open_url",
  "read_page",
  "click_element",
  "fill_element",
  "press",
  "launch_app",
  "list_windows",
  "set_setting",
  "get_settings",
  "ask_person",
];

/** The core, then the tools the words name, with no tool twice. */
export function localTools(words: string, tools: readonly ToolSpec[]): ToolSpec[] {
  const core = LOCAL_CORE.flatMap((name) => tools.filter((tool) => tool.name === name));
  const named = toolsForRequest(words, tools).filter((tool) => !LOCAL_CORE.includes(tool.name));
  return [...core, ...named];
}

export interface LocalOptions {
  /** The model the person named, or null for the first installed. */
  model(): string | null;
  fetch?: Fetch;
}

export function localModel(options: LocalOptions): ChatModel {
  let serial = 0;
  return {
    user: (text) => ({ role: "user", content: text }),
    said: (text) => ({ role: "assistant", content: text }),
    results: (results) =>
      results.map((result) => ({ role: "tool", tool_name: result.call.name, content: result.text || (result.error ? "It failed." : "Done.") })),
    async turn({ system, messages, tools, words, signal, onText }) {
      const named = options.model();
      const installed = named ? null : await localModels(send(options.fetch), signal);
      if (!named && installed === null) throw new AnswerError("no-answer", "The local model isn't running.");
      const model = named ?? installed?.[0];
      if (!model) throw new AnswerError("no-model", "No local model is installed.");
      let response: Response;
      try {
        response = await send(options.fetch)(`${LOCAL_URL}/api/chat`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "system", content: system }, ...messages],
            stream: true,
            think: false,
            options: { num_ctx: 16_384 },
            tools: localTools(words, tools).map((tool) => ({
              type: "function",
              function: { name: tool.name, description: tool.description, parameters: tool.schema },
            })),
          }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]),
        });
      } catch (error) {
        if (signal.aborted) throw error;
        throw new AnswerError("no-answer", "The local model didn't answer.");
      }
      if (response.status === 404) throw new AnswerError("no-model", `The local model “${model}” isn't installed.`);
      if (!response.ok) throw new AnswerError("failed", `The local model answered ${response.status}.`);
      let text = "";
      const raw: unknown[] = [];
      const calls: WantedCall[] = [];
      const turn = ++serial;
      for await (const line of linesOf(response)) {
        const message = parsed(line)?.message;
        if (!isRecord(message)) continue;
        if (typeof message.content === "string" && message.content !== "") {
          text += message.content;
          onText(message.content);
        }
        for (const call of Array.isArray(message.tool_calls) ? message.tool_calls : []) {
          const fn = isRecord(call) && isRecord(call.function) ? call.function : null;
          if (!fn || typeof fn.name !== "string") continue;
          raw.push(call);
          calls.push({ id: `local-${turn}-${calls.length}`, name: fn.name, input: fn.arguments ?? {} });
        }
      }
      return { text: text.trim(), calls, echo: { role: "assistant", content: text, ...(raw.length > 0 ? { tool_calls: raw } : {}) } };
    },
  };
}
