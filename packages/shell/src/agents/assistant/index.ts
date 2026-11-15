export { startAssistant, wayOf } from "./assistant.ts";
export { contextBlock, type Moment, talkWords, USUAL_NAMES } from "./context.ts";
export { Conversation, type Exchange, TALK_OPEN_MS, type TalkLog, talkLogPath } from "./conversation.ts";
export { ASSISTANT_KEY } from "./lib/first-use.ts";
export { hostSpawner } from "./lib/harness.ts";
export { ASSISTANT_PROMPT, assistantPrompt } from "./prompt.ts";
export type { Assistant, AssistantOptions, Hears, SpokenAnswer } from "./types.ts";
