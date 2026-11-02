/**
 * The Terminal's window: Dashi's unified toolbar (the running program's title
 * and the grid's size), then the grid dashi-term describes, drawn in the
 * monospace face. The grid takes the keyboard raw (Metal's `onKeyDown`) and
 * sends every key to the engine, which encodes it the way the program asked
 * (libghostty-vt). The wheel scrolls back; dragging selects (two clicks a
 * word, three a line); the menu bar's Edit menu copies and pastes on ❖C/❖V.
 */

import { AppWindow, useColors, useDark } from "@dashi/ui";
import { type Bounds, type KeyDownInfo, type PointerInfo, Text, View } from "@mirinjs/metal";
import { memo, useEffect, useRef, useState } from "react";
import { type Clipboard, systemClipboard, useAppMenus } from "../kit/index.ts";
import { type Engine, startEngine } from "./engine.ts";
import { terminalMenus } from "./menus.ts";
import { applyFrame, cellAt, EMPTY_SCREEN, gridFor, type Screen, type Span } from "./screen.ts";

export const TERMINAL_SIZE = { width: 760, height: 480 } as const;
const FONT_SIZE = 13;
const LINE_HEIGHT = 18;
const PROBE = "M".repeat(10);
/** Two presses this close (ms) and this near (cells) count as a double click. */
const MULTI_CLICK_MS = 400;

interface Look {
  ground: string;
  ink: string;
  selection: string;
  cursor: string;
}

function lookFor(dark: boolean, accent: string): Look {
  return dark
    ? { ground: "#1c1c1e", ink: "#e8e8ea", selection: `${accent}66`, cursor: "#e8e8eacc" }
    : { ground: "#ffffff", ink: "#1d1d1f", selection: `${accent}40`, cursor: "#1d1d1fb3" };
}

function color(value: string | undefined, look: Look, fallback: string): string {
  if (value === "fg") return look.ink;
  if (value === "bg") return look.ground;
  return value ?? fallback;
}

const Line = memo(function Line({ spans, look }: { spans: Span[]; look: Look }) {
  return (
    <View style={{ flexDirection: "row", height: LINE_HEIGHT, flexShrink: 0, overflow: "hidden" }}>
      {spans.map((span, index) => {
        const background = span.sel ? look.selection : span.bg ? color(span.bg, look, look.ground) : undefined;
        return (
          <View key={index} style={background ? { backgroundColor: background, flexShrink: 0 } : { flexShrink: 0 }}>
            <Text
              style={{
                fontFamily: "monospace",
                fontSize: FONT_SIZE,
                lineHeight: LINE_HEIGHT,
                color: color(span.fg, look, look.ink),
                fontWeight: span.b ? "bold" : "normal",
                fontStyle: span.i ? "italic" : "normal",
                textDecorationLine: span.u ? "underline" : span.st ? "line-through" : "none",
                opacity: span.dim ? 0.6 : 1,
              }}
            >
              {span.s}
            </Text>
          </View>
        );
      })}
    </View>
  );
});

export interface TerminalWindowProps {
  binary: string;
  onExit(): void;
  newWindow(): void;
  clipboard?: Clipboard;
}

export function TerminalWindow({ binary, onExit, newWindow, clipboard = systemClipboard() }: TerminalWindowProps) {
  const colors = useColors();
  const look = lookFor(useDark(), colors.selection);
  const [screen, setScreen] = useState<Screen>(EMPTY_SCREEN);
  const [title, setTitle] = useState("Terminal");
  const [cell, setCell] = useState<{ width: number; height: number } | null>(null);
  const engine = useRef<Engine | null>(null);
  const grid = useRef<Bounds | null>(null);
  const lastSize = useRef("");
  const lastPress = useRef({ at: 0, x: -1, y: -1, clicks: 0 });

  // The engine starts once the cell is measured, at the grid the window holds.
  const fit = (): void => {
    const bounds = grid.current;
    if (!cell || !bounds) return;
    const { cols, rows } = gridFor(bounds.width, bounds.height, cell.width, cell.height);
    const key = `${cols}x${rows}`;
    if (key === lastSize.current) return;
    lastSize.current = key;
    if (!engine.current) {
      engine.current = startEngine(binary, { cols, rows }, (message) => {
        if (message.t === "frame") setScreen((current) => applyFrame(current, message.frame));
        else if (message.t === "title") setTitle(message.title || "Terminal");
        else if (message.t === "copied" && message.text) void clipboard.writeText(message.text);
        else if (message.t === "exit") onExit();
      });
    }
    engine.current.send({ t: "resize", cols, rows, cw: Math.round(cell.width), ch: Math.round(cell.height) });
  };
  // biome-ignore lint/correctness/useExhaustiveDependencies: fit reads refs; it runs when the cell is first measured.
  useEffect(fit, [cell]);
  useEffect(() => () => engine.current?.stop(), []);

  const { menus, run } = terminalMenus({
    canCopy: clipboard.canWrite,
    actions: {
      copy: () => engine.current?.send({ t: "copy" }),
      paste: () => {
        void clipboard.readText().then((text) => {
          if (text) engine.current?.send({ t: "paste", text });
        });
      },
      selectAll: () => engine.current?.send({ t: "select-all" }),
      newWindow,
      close: onExit,
    },
  });
  useAppMenus(menus, run);

  const onKeyDown = (key: KeyDownInfo): void => {
    // ❖ chords are the menu bar's (copy, paste, new window), not the program's.
    if (key.meta) return;
    engine.current?.send({ t: "key", ...key });
  };

  const onPointer = (event: PointerInfo): void => {
    const bounds = event.bounds ?? grid.current;
    if (!cell || !bounds) return;
    const at = cellAt(event.x - bounds.x, event.y - bounds.y, cell.width, cell.height, screen.cols, screen.rows);
    let clicks = 1;
    if (event.phase === "down") {
      const last = lastPress.current;
      const now = Date.now();
      clicks = now - last.at < MULTI_CLICK_MS && Math.abs(last.x - at.x) <= 1 && last.y === at.y ? Math.min(last.clicks + 1, 3) : 1;
      lastPress.current = { at: now, x: at.x, y: at.y, clicks };
    }
    engine.current?.send({ t: "select", phase: event.phase, x: at.x, y: at.y, clicks });
  };

  const { cursor } = screen;
  return (
    <AppWindow title={title} subtitle={screen.cols > 0 ? `${screen.cols} × ${screen.rows}` : undefined}>
      <View style={{ flex: 1, backgroundColor: look.ground, paddingLeft: 8, paddingTop: 6 }}>
        <View
          testID="terminal-grid"
          style={{ flex: 1, position: "relative", overflow: "hidden" }}
          onLayout={(bounds) => {
            grid.current = bounds;
            fit();
          }}
          onKeyDown={onKeyDown}
          onWheel={(wheel) => engine.current?.send({ t: "scroll", lines: wheel.dy * 3 })}
          onPointer={onPointer}
        >
          {screen.lines.map((spans, y) => (
            <Line key={y} spans={spans} look={look} />
          ))}
          {cell && cursor.visible && (
            <View
              style={{
                position: "absolute",
                left: cursor.x * cell.width,
                top: cursor.y * cell.height + (cursor.style === "underline" ? cell.height - 2 : 0),
                width: cursor.style === "bar" ? 2 : cell.width,
                height: cursor.style === "underline" ? 2 : cell.height,
                backgroundColor: cursor.style === "hollow" ? undefined : look.cursor,
                borderWidth: cursor.style === "hollow" ? 1 : 0,
                borderColor: look.cursor,
                opacity: 0.75,
              }}
            />
          )}
        </View>
        {/* Measures one cell of the monospace face. */}
        <View style={{ position: "absolute", left: 0, top: -LINE_HEIGHT * 3, width: 2000, flexDirection: "row", opacity: 0 }}>
          <View
            style={{ flexShrink: 0 }}
            onLayout={(bounds) => {
              if (bounds.width > 0 && !cell) setCell({ width: bounds.width / PROBE.length, height: LINE_HEIGHT });
            }}
          >
            <Text style={{ fontFamily: "monospace", fontSize: FONT_SIZE, lineHeight: LINE_HEIGHT }}>{PROBE}</Text>
          </View>
        </View>
      </View>
    </AppWindow>
  );
}
