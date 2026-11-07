import { describe, expect, test } from "bun:test";
import { applyFrame, cellAt, cellText, EMPTY_SCREEN, type Frame, gridFor, parseEngineLine, type Span, scrolledBack } from "../apps/terminal/screen.ts";

const frame = (overrides: Partial<Frame>): Frame => ({
  cols: 4,
  rows: 2,
  full: true,
  cursor: { x: 0, y: 0, visible: true, style: "block" },
  lines: [],
  scroll: [2, 0, 2],
  selected: false,
  marks: [],
  ...overrides,
});

const span = (s: string, x = 0, w = Array.from(s).length): Span => ({ s, x, w });

describe("dashi-term's lines", () => {
  test("a frame parses, with its spans' columns, flags and colors, the selection and the marks", () => {
    const message = parseEngineLine(
      '{"t":"frame","cols":4,"rows":2,"full":true,"ink":"#ffffff","ground":"#000000","cursor":{"x":1,"y":0,"visible":true,"style":"bar"},"lines":[{"y":0,"spans":[{"s":"hi","x":0,"w":2,"fg":"#ff0000","b":true},{"s":"界","x":2,"w":2,"sel":true}]}],"scroll":[10,8,2],"selected":true,"marks":[{"y":1,"failed":true},{"y":0},{"x":3}]}',
    );
    expect(message).toEqual({
      t: "frame",
      frame: {
        cols: 4,
        rows: 2,
        full: true,
        ink: "#ffffff",
        ground: "#000000",
        cursor: { x: 1, y: 0, visible: true, style: "bar" },
        lines: [
          {
            y: 0,
            spans: [
              { s: "hi", x: 0, w: 2, fg: "#ff0000", b: true },
              { s: "界", x: 2, w: 2, sel: true },
            ],
          },
        ],
        scroll: [10, 8, 2],
        selected: true,
        marks: [
          { y: 1, failed: true },
          { y: 0, failed: false },
        ],
      },
    });
  });

  test("an older engine's spans, without columns, follow one another a cell a character", () => {
    const message = parseEngineLine('{"t":"frame","cols":6,"rows":1,"cursor":{},"lines":[{"y":0,"spans":[{"s":"ab"},{"s":"cde"}]}]}');
    expect(message?.t === "frame" && message.frame.lines[0]?.spans).toEqual([span("ab", 0, 2), span("cde", 2, 3)]);
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

  test("the shell integration's folder and command steps parse", () => {
    expect(parseEngineLine('{"t":"cwd","path":"/home/alexk","host":"dashi"}')).toEqual({ t: "cwd", path: "/home/alexk", host: "dashi" });
    expect(parseEngineLine('{"t":"cwd","path":"/tmp"}')).toEqual({ t: "cwd", path: "/tmp", host: "" });
    expect(parseEngineLine('{"t":"cwd"}')).toBeNull();
    expect(parseEngineLine('{"t":"prompt"}')).toEqual({ t: "prompt" });
    expect(parseEngineLine('{"t":"command","command":"cargo build"}')).toEqual({ t: "command", command: "cargo build" });
    expect(parseEngineLine('{"t":"done","code":1}')).toEqual({ t: "done", code: 1 });
    expect(parseEngineLine('{"t":"done","code":null}')).toEqual({ t: "done", code: null });
  });

  test("the answer to running: a program's name, or null at the prompt", () => {
    expect(parseEngineLine('{"t":"running","program":"sleep"}')).toEqual({ t: "running", program: "sleep" });
    expect(parseEngineLine('{"t":"running","program":null}')).toEqual({ t: "running", program: null });
    expect(parseEngineLine('{"t":"running"}')).toBeNull();
  });

  test("a frame's own colors are kept only when they are colors; an older engine's fg and bg are not taken for them", () => {
    const message = parseEngineLine('{"t":"frame","cols":1,"rows":1,"ink":"red","ground":"#10203","cursor":{},"lines":[]}');
    expect(message?.t === "frame" && [message.frame.ink, message.frame.ground]).toEqual([undefined, undefined]);
    const older = parseEngineLine('{"t":"frame","cols":1,"rows":1,"fg":"#000000","bg":"#000000","cursor":{},"lines":[]}');
    expect(older?.t === "frame" && [older.frame.ink, older.frame.ground]).toEqual([undefined, undefined]);
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
          { y: 0, spans: [span("ab")] },
          { y: 1, spans: [span("cd")] },
        ],
      }),
    );
    const second = applyFrame(first, frame({ full: false, lines: [{ y: 1, spans: [span("ef")] }] }));
    expect(second.lines[0]).toBe(first.lines[0]);
    expect(second.lines[1]).toEqual([span("ef")]);
  });

  test("a new size starts a fresh grid; rows out of range are ignored", () => {
    const first = applyFrame(EMPTY_SCREEN, frame({ lines: [{ y: 0, spans: [span("ab")] }] }));
    const resized = applyFrame(
      first,
      frame({
        cols: 6,
        rows: 3,
        full: false,
        lines: [
          { y: 2, spans: [span("x")] },
          { y: 9, spans: [span("y")] },
        ],
      }),
    );
    expect(resized.lines).toEqual([[], [], [span("x")]]);
  });

  test("the marks keep their identity while they stay where they are", () => {
    const first = applyFrame(EMPTY_SCREEN, frame({ marks: [{ y: 1, failed: true }] }));
    const same = applyFrame(first, frame({ marks: [{ y: 1, failed: true }] }));
    expect(same.marks).toBe(first.marks);
    const moved = applyFrame(same, frame({ marks: [{ y: 0, failed: true }] }));
    expect(moved.marks).toEqual([{ y: 0, failed: true }]);
  });

  test("the terminal's ink and ground follow the frames that carry them (a program's own, too)", () => {
    const plain = applyFrame(EMPTY_SCREEN, frame({}));
    expect([plain.ink, plain.ground]).toEqual([undefined, undefined]);
    const set = applyFrame(plain, frame({ ink: "#1d1d1f", ground: "#102030" }));
    expect([set.ink, set.ground]).toEqual(["#1d1d1f", "#102030"]);
  });

  test("the grid a window holds, and the cell under the pointer", () => {
    expect(gridFor(800, 360, 8, 18)).toEqual({ cols: 100, rows: 20 });
    expect(gridFor(5, 5, 8, 18)).toEqual({ cols: 2, rows: 1 });
    expect(gridFor(800, 360, 0, 18)).toEqual({ cols: 80, rows: 24 });
    expect(cellAt(17, 40, 8, 18, 80, 24)).toEqual({ x: 2, y: 2 });
    expect(cellAt(-5, 9999, 8, 18, 80, 24)).toEqual({ x: 0, y: 23 });
  });

  test("the letter under the cursor: one cell of a run, or the whole of a wide character", () => {
    const row = [span("ls", 0, 2), span("界", 2, 2), span(" x", 4, 2)];
    expect(cellText(row, 1)).toEqual({ span: span("ls", 0, 2), text: "s" });
    expect(cellText(row, 3)).toEqual({ span: span("界", 2, 2), text: "界" });
    expect(cellText(row, 5)?.text).toBe("x");
    expect(cellText(row, 4)).toBeNull();
    expect(cellText(row, 9)).toBeNull();
  });

  test("scrolled back while the view isn't on the last rows", () => {
    expect(scrolledBack([100, 76, 24])).toBe(false);
    expect(scrolledBack([100, 40, 24])).toBe(true);
    expect(scrolledBack([0, 0, 0])).toBe(false);
  });
});
