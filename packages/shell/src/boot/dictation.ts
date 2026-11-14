/**
 * Dictation and the two keys (main.tsx; dictation/; docs/night-0.9-contract.md,
 * "core"): the compositor reports the Dashi key and the dictation key
 * (`held-key`), the voice service hears, and the words are typed into the
 * window that has the keyboard (`type-text`). What the capsule draws is told
 * on the hub (`late.peek("pill")`). The lock stops whatever is being heard.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { runningCapsule } from "../capsule/index.ts";
import { atspiFieldCheck } from "../clipboard/index.ts";
import type { Compositor } from "../compositor/index.ts";
import { type DictationParts, type Layout, startDictation, tapClosesLauncher } from "../dictation/index.ts";
import { idleKeymap } from "../keymap/keymap-state.ts";
import type { SettingsStore } from "../settings-app/index.ts";
import { type Clipboard, systemClipboard } from "../shared/clipboard/index.ts";
import { type DictationTrouble, isDictationKeyId } from "../shared/pill/index.ts";
import { basicsHere, isTalkKeyId, listenLanguage, talkKey } from "../voice/index.ts";
import type { LateParts } from "./parts.ts";
import type { Late, Services } from "./services.ts";
import type { Talking } from "./voice.ts";

interface DictatingNeeds {
  compositor: Compositor | null;
  settingsStore: SettingsStore;
  services: Services;
  late: Late<LateParts>;
  talking: Talking;
}

/** The layout the system starts with, where settings.json names none (what the compositor reads too). */
function systemLayout(): Layout {
  try {
    const text = readFileSync("/etc/X11/xorg.conf.d/00-keyboard.conf", "utf8");
    const option = (name: string): string | undefined => new RegExp(`Option\\s+"${name}"\\s+"([^"]*)"`).exec(text)?.[1];
    return { layout: option("XkbLayout"), variant: option("XkbVariant") };
  } catch {
    return {};
  }
}

/** Whether the microphone is muted (wpctl, as the volume keys ask it); false when it can't be told. */
async function microphoneMuted(): Promise<boolean> {
  const wpctl = Bun.which("wpctl");
  if (!wpctl) return false;
  try {
    const child = Bun.spawn([wpctl, "get-volume", "@DEFAULT_AUDIO_SOURCE@"], { stdout: "pipe", stderr: "ignore" });
    const text = await new Response(child.stdout).text();
    return (await child.exited) === 0 && text.includes("[MUTED]");
  } catch {
    return false;
  }
}

/** The short sound of hands-free ending: a freedesktop sound, by a separate program. */
function chime(): void {
  const sound = "/usr/share/sounds/freedesktop/stereo/message.oga";
  const play = Bun.which("pw-play");
  if (!play || !existsSync(sound)) return;
  try {
    Bun.spawn([play, sound], { stdout: "ignore", stderr: "ignore" });
  } catch {}
}

/** How long the pasted words are given to arrive before the clipboard is put back. */
const PASTE_MS = 300;

/** The honest fallback where `type-text` can't be used: the words go through the clipboard, and what was on it is put back. */
async function paste(compositor: Compositor | null, clipboard: Clipboard, window: number, text: string): Promise<boolean> {
  if (!compositor || !clipboard.canWrite) return false;
  const before = await clipboard.readText();
  if (!(await clipboard.writeText(text))) return false;
  const pasted = await compositor.sendKeys({ window, chord: "ctrl+v" }).then(
    () => true,
    () => false,
  );
  // Once the app has read the words.
  setTimeout(() => void clipboard.writeText(before ?? ""), PASTE_MS);
  return pasted;
}

/** Whether the key was taught already (a file in the state folder), and teaching it. */
function teaching(): { known: boolean; now(): void } {
  const file = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "dashi", "dictation-taught");
  const taught = {
    known: existsSync(file),
    now(): void {
      taught.known = true;
      try {
        mkdirSync(join(file, ".."), { recursive: true });
        writeFileSync(file, "");
      } catch {}
    },
  };
  return taught;
}

/** How often, and how many times, the card is asked whether it has the keyboard yet. */
const CARD_KEYS_MS = 40;
const CARD_KEYS_TRIES = 50;

/**
 * A tap that went to a card: the plain keys the compositor took for the launcher go back, once the card has the
 * keyboard (no window has it any more), or after two seconds. Until then they are dropped: a Return pressed
 * before the card could hear it must never land in the window in front.
 */
async function keysBackToCard(compositor: Compositor | null, late: Late<LateParts>): Promise<void> {
  if (!compositor) return;
  for (let tries = 0; tries < CARD_KEYS_TRIES; tries++) {
    const windows = await compositor.windows().catch(() => null);
    if (!windows?.some((window) => window.focused)) break;
    await new Promise((resolve) => setTimeout(resolve, CARD_KEYS_MS));
  }
  // A launcher that opened meanwhile keeps its own keys (boot/keys.ts).
  if (late.peek("overlays")?.has("launcher")) return;
  await compositor.keymap(idleKeymap()).catch((error) => console.error("dashi-shell: dashi-comp refused the keymap:", error));
}

/** A tap of the Dashi key: the launcher, as ❖Space always did. `sinceSuperTap` is how long ago ❖ alone was tapped. */
function dashiTap(compositor: Compositor | null, late: Late<LateParts>, sinceSuperTap: number): void {
  const launcherOpen = late.peek("overlays")?.has("launcher") === true;
  // A card that is on screen takes the tap (capsule/), never an ask that is not shown. The compositor began sending plain
  // keys the launcher's way the moment the key was tapped (launcher/type-ahead.ts): they go back to whoever has the keyboard.
  if (runningCapsule.getSnapshot()?.cardUp() && !launcherOpen) return void keysBackToCard(compositor, late);
  // A launcher that a tap of ❖ alone just opened stays: ❖ and then ❖Space is one habit, not two wishes.
  if (launcherOpen && !tapClosesLauncher(sinceSuperTap)) return;
  late.peek("launcher")?.toggle();
}

export function startDictating({ compositor, settingsStore, services, late, talking }: DictatingNeeds): DictationParts {
  const hub = late.get("pill");
  const clipboard = systemClipboard();
  // Accessibility is turned on at the first hold (as snippets do at their first keyword: clipboard/lib/fields.ts), so a
  // password field can be told: asked again at the landing, by when an app that only then published its fields has.
  const fields = atspiFieldCheck({ turnOn: true });
  const system = systemLayout();
  const taught = teaching();
  let superTapAt = Number.NEGATIVE_INFINITY;
  const settings = () => settingsStore.getSnapshot().data;
  const trouble = (): DictationTrouble | null => {
    const view = talking.models.getSnapshot();
    if (view.service !== "ready") void talking.models.refresh();
    if (view.service === "looking") return "loading";
    if (view.service === "missing") return "voice-gone";
    return basicsHere(view.sets) ? null : "no-model";
  };
  const parts = startDictation({
    hub,
    service: talking.service,
    settings: () => {
      const { voice, dictation, keyboard } = settings();
      return {
        voiceOn: voice.on === true,
        on: dictation.on !== false,
        key: isDictationKeyId(dictation.key) ? dictation.key : undefined,
        handsFree: dictation.handsFree !== false,
        tidy: dictation.tidy !== false,
        layout: keyboard.layout ? { layout: keyboard.layout, variant: keyboard.variant } : system,
      };
    },
    subscribe: (listener) => settingsStore.subscribe(listener),
    talkCodes: () => {
      const { key } = settings().voice;
      return talkKey(isTalkKeyId(key) ? key : undefined).codes;
    },
    hold: (keys) => talking.heldKeys.set("dictation", keys),
    voice: talking.voice,
    launcher: () => dashiTap(compositor, late, performance.now() - superTapAt),
    trouble,
    busy: () => talking.voice.getSnapshot()?.kind === "listening",
    muted: microphoneMuted,
    front: async () => {
      const windows = await compositor?.windows().catch(() => null);
      const front = windows?.find((window) => window.focused);
      return front ? { window: front.id, pid: front.pid } : null;
    },
    secret: async (front) => (front.pid !== null && (await fields.passwordFocused(front.pid)) ? true : null),
    pressed: async (window) => (compositor ? (await compositor.inputOrigin({ window })).person : null),
    typeText: async (window, text) => {
      if (!compositor) throw new Error("no compositor");
      await compositor.typeText({ window, text });
    },
    paste: (window, text) => paste(compositor, clipboard, window, text),
    copy: (text) => clipboard.writeText(text),
    chime,
    taught: () => taught.known,
    teach: () => taught.now(),
    language: listenLanguage(process.env.LC_ALL || process.env.LC_MESSAGES || process.env.LANG),
  });
  // DASHI_DICTATION_LOG=1: each gesture and each state in the session's log, for a proof with no capsule to look at.
  if (process.env.DASHI_DICTATION_LOG === "1") {
    hub.keys.listen((gesture) => console.error(`dashi-shell: key ${gesture.key} ${gesture.gesture}`));
    hub.dictation.subscribe(() => console.error(`dashi-shell: dictation ${JSON.stringify(hub.dictation.getSnapshot())}`));
  }
  const stopHearing = compositor
    ? compositor.on((event) => {
        if (event.event === "held-key") parts.key(event.name, event.down, event.chord === true);
        if (event.event === "super" && event.phase === "tap") superTapAt = performance.now();
        if (event.event === "lock" && event.locked) parts.dictation.stop();
      })
    : () => {};
  services.add("dictation", () => {
    stopHearing();
    parts.close();
  });
  return parts;
}
