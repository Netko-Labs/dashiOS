/**
 * Voice, put together (boot/voice.ts starts it): the connection to
 * dashi-voice, the models as Settings › Voice shows them, and talking to
 * Dashi. Voice is off until the person turns it on in Settings › Voice
 * (settings.json `voice.on`): until then no key is held, nothing is fetched
 * and the service is never asked to listen.
 */

import type { VoiceLink } from "./client.ts";
import { type heldKeys, isTalkKeyId, talkKey } from "./keys.ts";
import { voiceConnector } from "./lib/launch.ts";
import { VoiceService } from "./lib/service.ts";
import { basicsHere, VoiceModels } from "./models.ts";
import type { Asker, ChipGo, Trouble, VoiceSettings } from "./types.ts";
import { Voice } from "./voice.ts";

export interface VoiceOptions {
  /** settings.json's `voice`. */
  settings: { getSnapshot(): { data: { voice: VoiceSettings } }; subscribe(listener: () => void): () => void };
  /** The compositor's `held-keys`. */
  hold(keys: ReturnType<typeof heldKeys>): void;
  asker: Asker;
  /** Where a notice sends the person: Settings › Voice, Settings › Agents, the launcher. */
  go(where: ChipGo): void;
  connect?: () => Promise<VoiceLink | null>;
  locale?: string | undefined;
}

export interface VoiceParts {
  voice: Voice;
  /** The connection to dashi-voice: dictation hears through it too (dictation/). */
  service: VoiceService;
  models: VoiceModels;
  /** Say a few words in a voice (Settings › Voice's "Play"). */
  sample(voice: string): void;
  go(where: ChipGo): void;
  close(): void;
}

/** What a voice says of itself, in its own language. */
const SAMPLES: Readonly<Record<string, string>> = {
  en: "Hello, I'm Dashi. This is how I sound.",
  es: "Hola, soy Dashi. Así es como sueno.",
  fr: "Bonjour, je suis Dashi. Voici ma voix.",
  hi: "नमस्ते, मैं दाशी हूँ। मेरी आवाज़ ऐसी है।",
  it: "Ciao, sono Dashi. Questa è la mia voce.",
  pt: "Olá, eu sou Dashi. Esta é a minha voz.",
};

/** The sample for a voice of `language` ("en-GB"); English for one Dashi has no words in. */
export const sampleWords = (language: string): string => SAMPLES[language.split("-")[0]?.toLowerCase() ?? ""] ?? SAMPLES.en ?? "";

/** What is missing before Voice can be used, with the one thing to do. */
export function troubleOf(models: VoiceModels): Trouble {
  const view = models.getSnapshot();
  if (view.service === "looking") return { text: "Voice is starting. Try again in a moment." };
  // Short enough for the chip's one line; Settings › Voice says the rest.
  if (view.service === "missing") return { text: "Voice isn't running. Log out and in again.", go: "voice" };
  if (!basicsHere(view.sets)) return { text: "Voice needs its models. See Settings › Voice.", go: "voice" };
  return null;
}

export function startVoice(options: VoiceOptions): VoiceParts {
  const service = new VoiceService(options.connect ?? voiceConnector());
  const models = new VoiceModels(service);
  const prefs = () => {
    const { on, key, voice } = options.settings.getSnapshot().data.voice;
    return { on: on === true, key: talkKey(isTalkKeyId(key) ? key : undefined), voice };
  };
  const voice = new Voice({
    service,
    prefs,
    trouble: () => {
      const trouble = troubleOf(models);
      // It may have come back since (the session's unit restarted): look again for the next press.
      if (trouble && models.getSnapshot().service !== "ready") void models.refresh();
      return trouble;
    },
    hold: options.hold,
    asker: options.asker,
    locale: options.locale,
  });
  // Warm while it is on and can be used, so the first hold answers at once (docs/voice.md).
  let warmed = false;
  const warm = (): void => {
    const usable = prefs().on && models.ready;
    if (usable && !warmed) void service.call("warm", { listen: true, speak: true }).catch(() => {});
    warmed = usable;
  };
  const offs = [
    options.settings.subscribe(() => {
      voice.sync();
      warm();
    }),
    models.subscribe(warm),
  ];
  void models.refresh();
  return {
    voice,
    service,
    models,
    sample(id) {
      const language = models.getSnapshot().voices.find((each) => each.id === id)?.language ?? "en";
      void voice.say(sampleWords(language), id);
    },
    go: options.go,
    close() {
      for (const off of offs) off();
      voice.close();
      models.close();
      service.close();
    },
  };
}
