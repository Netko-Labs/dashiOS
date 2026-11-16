/**
 * Voice, put together (boot/voice.ts starts it): the connection to
 * dashi-voice, the models as Settings › Voice shows them, and talking to
 * Dashi. Voice is off until the person turns it on in Settings › Voice
 * (settings.json `voice.on`): until then no key is held, nothing is fetched
 * and the service is never asked to listen.
 */

import type { VoiceLink } from "./client.ts";
import { type heldKeys, isTalkKeyId, talkKey } from "./keys.ts";
import { KeptTongue } from "./lib/fillers.ts";
import { voiceConnector } from "./lib/launch.ts";
import { VoiceService } from "./lib/service.ts";
import { watchFolder } from "./lib/watch-folder.ts";
import { basicsHere, VoiceModels } from "./models.ts";
import { speakExtras, tagOf, tongueOf, tonguesOn } from "./tongues.ts";
import type { Asker, ChipGo, Trouble, VoiceSettings } from "./types.ts";
import { Voice } from "./voice.ts";

export interface VoiceOptions {
  /** settings.json's `voice`; the region's formats and the persona's language say how other languages are read. */
  settings: {
    getSnapshot(): { data: { voice: VoiceSettings; region?: { formats?: string }; persona?: { language?: string } } };
    subscribe(listener: () => void): () => void;
  };
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
  const models = new VoiceModels(service, watchFolder);
  // The conversation's language: the last one the person's words told with confidence, among those turned on (lib/fillers.ts).
  const tongue = new KeptTongue(() => {
    const data = options.settings.getSnapshot().data;
    const view = models.getSnapshot();
    return tonguesOn(data.voice, view.voices, data.voice.voice ?? view.defaultVoice);
  });
  const formats = (): string | undefined => options.settings.getSnapshot().data.region?.formats ?? options.locale;
  const prefs = () => {
    const data = options.settings.getSnapshot().data;
    const { on, key, voice, listenAgain, recognizer } = data.voice;
    const view = models.getSnapshot();
    const heard = tongue.language;
    const speak = speakExtras(data.voice, view.voices, voice ?? view.defaultVoice, { formats: formats(), heard, persona: data.persona?.language });
    return { on: on === true, key: talkKey(isTalkKeyId(key) ? key : undefined), voice, listenAgain: listenAgain !== false, speak, recognizer };
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
    // Models copied in while the session runs are seen only on a read (Settings › Voice watches the folder only while open).
    recheck: () => models.refresh().then(() => troubleOf(models)),
    hold: options.hold,
    asker: options.asker,
    locale: options.locale,
    tongue,
    log: (line) => console.error(`dashi-shell: voice ${line}`),
  });
  // Warm while it is on and can be used, so the first hold answers at once (docs/voice.md).
  let warmed = false;
  const warm = (): void => {
    const usable = prefs().on && models.ready;
    if (usable && !warmed) void service.call("warm", { listen: true, speak: true }).catch(() => {});
    warmed = usable;
  };
  const offs = [
    // Every listen that ends by itself tells it too (the loop's own, a held key's, are told in voice.ts): telling twice is the same.
    service.on((event) => {
      if (event.event === "heard") tongue.tell(event.text, event.language);
    }),
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
      // In that voice alone, read as the person's region reads it: a Spanish sample sounds as Spanish answers will.
      const tag = tongueOf(language) === "es" ? tagOf("es", formats()) : language;
      voice.say(sampleWords(language), id, tag);
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
