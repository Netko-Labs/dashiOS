/**
 * The sound outputs (PipeWire sinks) Control Center's Sound page lists, and
 * the backend that reads them and makes one the default.
 */

/** What an output is, for its glyph; guessed from the node's name, form factor, or label. */
export type OutputKind = "speaker" | "headphones" | "display" | "bluetooth";

export interface Output {
  /** PipeWire's object id: what `wpctl set-default` takes. */
  id: number;
  /** The node's description (what the device is called), or its name. */
  label: string;
  /** Whether it is the default output. */
  current: boolean;
  kind: OutputKind;
}

/** Reads the outputs and makes one the default. A null list means PipeWire cannot be asked. */
export interface SoundBackend {
  list(): Promise<Output[] | null>;
  /** Whether the default is now `id`. */
  setDefault(id: number): Promise<boolean>;
  /** Tells the list each time PipeWire changes (apps/watch.ts), so nothing polls; absent where PipeWire can't be watched. Returns the stop. */
  follow?(onList: (list: Output[]) => void): () => void;
}

/** The backend Settings' Sound pane uses: the outputs and the inputs (microphones). */
export interface AudioBackend extends SoundBackend {
  /** The input devices (PipeWire sources); `setDefault` makes one the default input. Null means PipeWire cannot be asked. */
  listInputs(): Promise<Output[] | null>;
  /** `follow` for the inputs. */
  followInputs?(onList: (list: Output[]) => void): () => void;
}
