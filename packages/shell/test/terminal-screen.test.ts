import { describe, expect, test } from "bun:test";
import { applyFrame, cellAt, EMPTY_SCREEN, type Frame, gridFor, parseEngineLine, terminalTitle } from "../apps/terminal/screen.ts";

const frame = (overrides: Partial<Frame>): Frame => ({
  cols: 4,
  rows: 2,
  full: true,
  cursor: { x: 0, y: 0, visible: true, style: "block" },
  lines: [],
  scroll: [2, 0, 2],
  ...overrides,
});

describe("dashi-term's lines", () => {
  test("a frame parses, with its spans' flags and colors", () => {
    const message = parseEngineLine(
      '{"t":"frame","cols":4,"rows":2,"full":true,"fg":"#ffffff","bg":"#000000","cursor":{"x":1,"y":0,"visible":true,"style":"bar"},"lines":[{"y":0,"spans":[{"s":"hi","fg":"#ff0000","b":true},{"s":"  ","sel":true}]}],"scroll":[10,8,2]}',
    );
    expect(message).toEqual({
      t: "frame",
      frame: {
        cols: 4,
        rows: 2,
        full: true,
        fg: "#ffffff",
        bg: "#000000",
        cursor: { x: 1, y: 0, visible: true, style: "bar" },
        lines: [
          {
            y: 0,
            spans: [
              { s: "hi", fg: "#ff0000", b: true },
              { s: "  ", sel: true },
            ],
          },
        ],
        scroll: [10, 8, 2],
      },
    });
  });

  test("titles, the bell, copies, and the exit parse; anything else is dropped", () => {
    expect(parseEngineLine('{"t":"title","title":"vim"}')).toEqual({ t: "title", title: "vim" });
    expect(parseEngineLine('{"t":"bell"}')).toEqual({ t: "bell" });
    expect(parseEngineLine('{"t":"copied","text":"ls"}')).toEqual({ t: "copied", text: "ls" });
    expect(parseEngineLine('{"t":"exit","code":0}')).toEqual({ t: "exit", code: 0 });
    expect(parseEngineLine('{"t":"exit"}')).toBeNull();
    expect(parseEngineLine("not json")).toBeNull();
    expect(parseEngineLine('{"t":"frame","cols":"4"}')).toBeNull();
  });

  test("the answer to running: a program's name, or null at the prompt", () => {
    expect(parseEngineLine('{"t":"running","program":"sleep"}')).toEqual({ t: "running", program: "sleep" });
    expect(parseEngineLine('{"t":"running","program":null}')).toEqual({ t: "running", program: null });
    expect(parseEngineLine('{"t":"running"}')).toBeNull();
  });

  test("a frame's own colors are kept only when they are colors", () => {
    const message = parseEngineLine('{"t":"frame","cols":1,"rows":1,"fg":"red","bg":"#10203","cursor":{},"lines":[]}');
    expect(message?.t === "frame" && [message.frame.fg, message.frame.bg]).toEqual([undefined, undefined]);
  });

  test("an unknown cursor style falls back to a block", () => {
    const message = parseEngineLine('{"t":"frame","cols":1,"rows":1,"cursor":{"style":"blob"},"lines":[]}');
    expect(message?.t === "frame" && message.frame.cursor.style).toBe("block");
  });
});

describe("the screen", () => {
  test("a partial frame replaces only its rows, and keeps the others' identity", () => {
    const first = applyFrame(
      EMPTY_SCREEN,
      frame({
        lines: [
          { y: 0, spans: [{ s: "ab" }] },
          { y: 1, spans: [{ s: "cd" }] },
        ],
      }),
    );
    const second = applyFrame(first, frame({ full: false, lines: [{ y: 1, spans: [{ s: "ef" }] }] }));
    expect(second.lines[0]).toBe(first.lines[0]);
    expect(second.lines[1]).toEqual([{ s: "ef" }]);
  });

  test("a new size starts a fresh grid; rows out of range are ignored", () => {
    const first = applyFrame(EMPTY_SCREEN, frame({ lines: [{ y: 0, spans: [{ s: "ab" }] }] }));
    const resized = applyFrame(
      first,
      frame({
        cols: 6,
        rows: 3,
        full: false,
        lines: [
          { y: 2, spans: [{ s: "x" }] },
          { y: 9, spans: [{ s: "y" }] },
        ],
      }),
    );
    expect(resized.lines).toEqual([[], [], [{ s: "x" }]]);
  });

  test("the terminal's ink and ground follow the frames that carry them (a program's own, too)", () => {
    const plain = applyFrame(EMPTY_SCREEN, frame({}));
    expect([plain.fg, plain.bg]).toEqual([undefined, undefined]);
    const set = applyFrame(plain, frame({ fg: "#1d1d1f", bg: "#102030" }));
    expect([set.fg, set.bg]).toEqual(["#1d1d1f", "#102030"]);
  });

  test("the grid a window holds, and the cell under the pointer", () => {
    expect(gridFor(800, 360, 8, 18)).toEqual({ cols: 100, rows: 20 });
    expect(gridFor(5, 5, 8, 18)).toEqual({ cols: 2, rows: 1 });
    expect(gridFor(800, 360, 0, 18)).toEqual({ cols: 80, rows: 24 });
    expect(cellAt(17, 40, 8, 18, 80, 24)).toEqual({ x: 2, y: 2 });
    expect(cellAt(-5, 9999, 8, 18, 80, 24)).toEqual({ x: 0, y: 23 });
  });
});

test("the title bar names the program, then the grid once it is known", () => {
  expect(terminalTitle("dashi@dashi:~", 96, 24)).toBe("dashi@dashi:~ — 96×24");
  expect(terminalTitle("Terminal", 0, 0)).toBe("Terminal");
});
