/**
 * Voice's models and voices as Settings › Voice shows them: which sets are
 * on this computer, a fetch's progress, pausing and going on, removing them
 * (docs/voice.md, "The models"). The service fetches; nothing is fetched
 * until the person says so here.
 */

import { maybe } from "@dashi/shape";
import type { VoiceService } from "./lib/service.ts";
import type { FolderWatch } from "./lib/watch-folder.ts";
import { FetchReply, ModelsShape, VoicesShape } from "./lib/wire.ts";
import type { ModelSet, ModelsView } from "./types.ts";

const EMPTY: ModelsView = { service: "looking", sets: [], fetching: null, error: null, voices: [], defaultVoice: "af_heart" };

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The sets Voice needs before it can be used. */
export const basicSets = (sets: readonly ModelSet[]): ModelSet[] => sets.filter((set) => set.basic);

/** Whether every set Voice needs is here. */
export const basicsHere = (sets: readonly ModelSet[]): boolean => basicSets(sets).length > 0 && basicSets(sets).every((set) => set.installed);

/** A fetch that stopped part way left something: going on is "Resume". */
export const partly = (sets: readonly ModelSet[]): boolean => sets.some((set) => !set.installed && set.have > 0);

/** "1.01 GB", "673 MB": sizes as the fetch says them (1000s, as disks are sold). */
export function sizeWords(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(2)} GB`;
  return `${Math.max(1, Math.round(bytes / 1e6))} MB`;
}

export class VoiceModels {
  private view: ModelsView = EMPTY;
  private readonly listeners = new Set<() => void>();
  private readonly offs: Array<() => void>;

  /** `watcher`: what watches the models' folder for `watch` (voice/start.ts gives the real one); without it nothing is watched. */
  constructor(
    private readonly service: VoiceService,
    private readonly watcher: FolderWatch | null = null,
  ) {
    this.offs = [
      service.on((event) => {
        if (event.event === "models") void this.refresh();
        if (event.event !== "fetch") return;
        if (!event.done) return this.set({ fetching: { received: event.received, bytes: event.bytes, sets: this.fetchingSets() } });
        // A fetch the person paused ends with an error too: that is no failure to show.
        this.set({ fetching: null, error: event.error && !this.pausing ? event.error : null });
        this.pausing = false;
        void this.refresh();
      }),
      service.onLink((connected) => {
        if (connected) void this.refresh();
        else this.set({ service: "missing", fetching: null });
      }),
    ];
  }

  /** The person pressed Pause: the fetch's end is theirs, not an error. */
  private pausing = false;
  /** The sets the fetch under way was asked for; unknown for one that began before this shell did. */
  private wanted: readonly string[] | null = null;

  /** The sets a fetch brings: the ones asked for, else (a fetch found running) the ones that are part way. */
  private fetchingSets(): readonly string[] {
    return this.wanted ?? this.view.sets.filter((set) => !set.installed && set.have > 0).map((set) => set.id);
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): ModelsView => this.view;

  private set(change: Partial<ModelsView>): void {
    this.view = { ...this.view, ...change };
    for (const listener of [...this.listeners]) listener();
  }

  /** Whether Voice can listen and speak. */
  get ready(): boolean {
    return this.view.service === "ready" && basicsHere(this.view.sets);
  }

  /** Where the models are kept, once the service said. */
  private folder: string | null = null;

  /**
   * Look again whenever the models' folder changes behind Dashi's back
   * (models copied in by hand, `dashi-voice fetch` in a terminal), for as
   * long as someone looks at them: Settings › Voice, while it is open. A
   * burst of changes (a big file being copied) is one look, `settleMs`
   * after its last. Gives back how to stop.
   */
  watch(settleMs = 400): () => void {
    const watcher = this.watcher;
    if (!watcher) return () => {};
    let stop: (() => void) | null = null;
    let watched: string | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let stopped = false;
    const changed = (): void => {
      if (stopped) return;
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        void this.refresh();
      }, settleMs);
    };
    // The folder is known once the service answered, and may be another after it came back.
    const arm = (): void => {
      if (this.folder === null || this.folder === watched) return;
      stop?.();
      watched = this.folder;
      stop = watcher(watched, changed);
    };
    const off = this.subscribe(arm);
    arm();
    return () => {
      stopped = true;
      off();
      stop?.();
      if (timer) clearTimeout(timer);
    };
  }

  private reading: Promise<void> | null = null;

  /** Read the sets and the voices again (the pane opening, a fetch ending, the service coming back); one read at a time. */
  refresh(): Promise<void> {
    this.reading ??= this.read().finally(() => {
      this.reading = null;
    });
    return this.reading;
  }

  private async read(): Promise<void> {
    try {
      const models = maybe(ModelsShape, await this.service.call("models"));
      const voices = maybe(VoicesShape, await this.service.call("voices"));
      if (!models) throw new Error("Voice answered in a way Dashi doesn't know.");
      if (models.folder !== undefined) this.folder = models.folder;
      this.set({
        service: "ready",
        sets: models.sets,
        // A fetch found running (the shell began after it): its progress comes with its next event.
        fetching: models.fetching ? (this.view.fetching ?? { received: 0, bytes: 0, sets: this.fetchingSets() }) : null,
        voices: voices?.voices ?? [],
        defaultVoice: voices?.default ?? EMPTY.defaultVoice,
      });
    } catch {
      this.set({ service: "missing", fetching: null });
    }
  }

  /** Fetch `sets` (the ones Voice needs, when none are named); going on from what a stopped fetch left. */
  async fetch(sets?: readonly string[]): Promise<void> {
    this.pausing = false;
    this.set({ error: null });
    try {
      const reply = maybe(FetchReply, await this.service.call("fetch", sets ? { sets: [...sets] } : {}));
      this.wanted = sets ?? basicSets(this.view.sets).map((set) => set.id);
      if (reply?.fetching) this.set({ fetching: { received: 0, bytes: reply.bytes, sets: this.wanted } });
      else await this.refresh();
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  /** Pause: what came is kept, and `fetch` goes on from it. */
  async pause(): Promise<void> {
    this.pausing = true;
    await this.service.call("fetch.cancel").catch(() => {
      this.pausing = false;
    });
  }

  /** Delete `sets` (every set, when none are named). */
  async remove(sets?: readonly string[]): Promise<void> {
    this.set({ error: null });
    try {
      await this.service.call("remove", sets ? { sets: [...sets] } : {});
      await this.refresh();
    } catch (error) {
      this.set({ error: message(error) });
    }
  }

  close(): void {
    for (const off of this.offs) off();
  }
}
