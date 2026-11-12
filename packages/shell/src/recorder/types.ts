/** The recorder's public types: what a recording shows, and the capture modes. */

/** A screen by its output name, or an area in global logical pixels. */
export type RecordTarget = { kind: "screen"; output: string } | { kind: "area"; x: number; y: number; width: number; height: number };

export type CaptureMode = "screen" | "window" | "area" | "record-screen" | "record-area";
