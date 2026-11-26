/**
 * What is playing, from any player on the session bus (MPRIS): the title,
 * the artist, where it is, the cover's address, and play, pause, next and
 * previous. The player that is playing wins; else the one that played last.
 * Players come and go: the bus's names are looked at again every 10 s.
 */

import { BusLink, DBusConnection, getAllProperties, listNames, onPropertiesChanged, unwrap } from "../../../shared/dbus/index.ts";
import { busWord, playerName } from "./player-name.ts";
import { Source } from "./source.ts";

const ROOT = "org.mpris.MediaPlayer2";
const PLAYER = "org.mpris.MediaPlayer2.Player";
const PATH = "/org/mpris/MediaPlayer2";
const PREFIX = "org.mpris.MediaPlayer2.";
/** Timers (not design motion, tokens.md): how often the player is looked at. */
const TIMERS = { look: 10_000 } as const;

export interface Playing {
  /** The player's bus name, where commands go. */
  player: string;
  /** The player as a person knows it: "Helium", "Spotify" (player-name.ts). */
  name: string;
  title: string;
  artist: string;
  playing: boolean;
  /** Track length and position in ms; 0 when the player does not say. */
  length: number;
  position: number;
  /** When `position` was read (ms), so the widget counts on by itself. */
  positionAt: number;
  /** The cover: a file:// or https:// address, or "". */
  art: string;
  /** When it started playing (ms): the tally's "newest". */
  since: number;
}

/** A player's properties as `Playing`; null without a title. */
export function readPlaying(
  player: string,
  properties: ReadonlyMap<string, unknown>,
  now: number,
  before: Playing | null,
  name: string = busWord(player),
): Playing | null {
  const metadata = properties.get("Metadata");
  const meta = metadata instanceof Map ? new Map([...metadata].map(([key, value]) => [String(key), unwrap(value)])) : new Map<string, unknown>();
  const title = typeof meta.get("xesam:title") === "string" ? String(meta.get("xesam:title")) : "";
  if (title === "") return null;
  const artists = meta.get("xesam:artist");
  const artist = Array.isArray(artists) ? artists.filter((each) => typeof each === "string").join(", ") : "";
  const length = Number(meta.get("mpris:length") ?? 0) / 1000;
  const position = Number(properties.get("Position") ?? 0) / 1000;
  const playing = properties.get("PlaybackStatus") === "Playing";
  const art = typeof meta.get("mpris:artUrl") === "string" ? String(meta.get("mpris:artUrl")) : "";
  const since = before && before.playing === playing && before.title === title ? before.since : now;
  return {
    player,
    name,
    title,
    artist,
    playing,
    length: Number.isFinite(length) ? length : 0,
    position: Number.isFinite(position) ? position : 0,
    positionAt: now,
    art,
    since,
  };
}

/** Where a track is at `now`, counting on while it plays. */
export function positionAt(playing: Playing, now: number): number {
  const at = playing.playing ? playing.position + (now - playing.positionAt) : playing.position;
  return playing.length > 0 ? Math.min(playing.length, at) : at;
}

/** The player's name from its root interface (Identity, DesktopEntry); its bus name cleaned when it says neither. */
async function knownAs(bus: Parameters<typeof getAllProperties>[0], player: string): Promise<string> {
  const root = await getAllProperties(bus, { destination: player, path: PATH, interface: ROOT }).catch(() => null);
  const text = (key: string): string => {
    const value = root ? unwrap(root.get(key)) : "";
    return typeof value === "string" ? value : "";
  };
  return playerName({ bus: player, identity: text("Identity"), desktopEntry: text("DesktopEntry") });
}

export class Media extends Source<Playing | null> {
  private readonly link = new BusLink(() => DBusConnection.connect());
  private readonly players = new Map<string, { state: Playing | null; stop: (() => Promise<void>) | null }>();

  start(): () => void {
    const look = () => void this.look().catch(() => {});
    look();
    const timer = setInterval(look, TIMERS.look);
    return () => {
      clearInterval(timer);
      for (const each of this.players.values()) void each.stop?.();
      this.link.close();
    };
  }

  /** Play or pause, next, previous, on the player shown. */
  async command(member: "PlayPause" | "Next" | "Previous"): Promise<void> {
    const shown = this.getSnapshot();
    if (!shown) return;
    const bus = await this.link.bus();
    await bus.call({ destination: shown.player, path: PATH, interface: PLAYER, member });
  }

  /** Brings the player shown forward (its root's Raise): Control Center's Now Playing tile, pressed (CC-7). */
  async raise(): Promise<void> {
    const shown = this.getSnapshot();
    if (!shown) return;
    const bus = await this.link.bus();
    await bus.call({ destination: shown.player, path: PATH, interface: ROOT, member: "Raise" });
  }

  private async look(): Promise<void> {
    const bus = await this.link.bus();
    const names = (await listNames(bus)).filter((name) => name.startsWith(PREFIX));
    for (const [name, each] of this.players)
      if (!names.includes(name)) {
        void each.stop?.();
        this.players.delete(name);
      }
    for (const name of names) {
      if (this.players.has(name)) continue;
      const entry: { state: Playing | null; stop: (() => Promise<void>) | null } = { state: null, stop: null };
      this.players.set(name, entry);
      const target = { destination: name, path: PATH, interface: PLAYER };
      const known = await knownAs(bus, name);
      const read = async () => {
        const properties = await getAllProperties(bus, target);
        if (properties) entry.state = readPlaying(name, properties, Date.now(), entry.state, known);
        this.choose();
      };
      entry.stop = await onPropertiesChanged(bus, target, () => void read().catch(() => {}));
      await read().catch(() => {});
    }
    this.choose();
  }

  private choose(): void {
    const states = [...this.players.values()].map((each) => each.state).filter((each): each is Playing => each !== null);
    const best = states.find((each) => each.playing) ?? states.sort((a, b) => b.since - a.since)[0] ?? null;
    this.set(best);
  }
}
