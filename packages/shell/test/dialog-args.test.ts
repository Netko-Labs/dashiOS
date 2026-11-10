import { describe, expect, test } from "bun:test";
import { parseArgs } from "../apps/dialog/lib/args.ts";
import { prepare, ZENITY_VERSION } from "../apps/dialog/lib/cli.ts";
import { dialogSize, lineCount } from "../apps/dialog/lib/size.ts";
import { type DialogSpec, specFrom } from "../apps/dialog/lib/spec.ts";

const NOW = new Date(2026, 10, 3);

function spec(...argv: string[]): DialogSpec {
  const result = specFrom(parseArgs(argv), NOW);
  if (!("spec" in result)) throw new Error(`no spec: ${JSON.stringify(result)}`);
  return result.spec;
}

describe("parseArgs", () => {
  test("--opt=value and --opt value", () => {
    const parsed = parseArgs(["--info", "--title=Steam", "--text", "Hello there", "--width=300"]);
    expect(parsed.kinds).toEqual(["info"]);
    expect(parsed.values.get("title")).toBe("Steam");
    expect(parsed.values.get("text")).toBe("Hello there");
    expect(parsed.values.get("width")).toBe("300");
    expect(parsed.error).toBeNull();
  });

  test("a value may start with a dash, and may be empty or hold an =", () => {
    const parsed = parseArgs(["--entry", "--text", "--not-an-option", "--entry-text=a=b", "--title="]);
    expect(parsed.values.get("text")).toBe("--not-an-option");
    expect(parsed.values.get("entry-text")).toBe("a=b");
    expect(parsed.values.get("title")).toBe("");
  });

  test("repeatable options keep every value, in order", () => {
    const parsed = parseArgs(["--list", "--column=Pick", "--column", "Name", "--extra-button", "A", "--extra-button=B"]);
    expect(parsed.repeats.get("column")).toEqual(["Pick", "Name"]);
    expect(parsed.repeats.get("extra-button")).toEqual(["A", "B"]);
  });

  test("positional arguments, and everything after --", () => {
    const parsed = parseArgs(["--list", "--column=A", "one", "two", "--", "--three", "-4"]);
    expect(parsed.positional).toEqual(["one", "two", "--three", "-4"]);
  });

  test("unknown options are warned about and skipped", () => {
    const parsed = parseArgs(["--info", "--frobnicate", "--text=hi", "--modal"]);
    expect(parsed.warnings).toEqual(["unknown option --frobnicate, ignored"]);
    expect(parsed.values.get("text")).toBe("hi");
    expect(parsed.flags.has("modal")).toBe(true);
  });

  test("a value missing at the end is an error", () => {
    expect(parseArgs(["--info", "--text"]).error).toBe("Missing argument for --text");
  });

  test("options Dashi ignores still take their value off the command line", () => {
    const parsed = parseArgs(["--list", "--column=A", "--window-icon", "/x.png", "row"]);
    expect(parsed.positional).toEqual(["row"]);
  });

  test("help and version", () => {
    expect(parseArgs(["--help"]).info).toBe("help");
    expect(parseArgs(["--help-general"]).info).toBe("help");
    expect(parseArgs(["--version"]).info).toBe("version");
  });
});

describe("specFrom", () => {
  test("a message's defaults", () => {
    const info = spec("--info");
    expect(info).toMatchObject({ kind: "info", title: "Information", text: "All updates are complete.", okLabel: "OK", extraButtons: [] });
    const question = spec("--question");
    expect(question).toMatchObject({ kind: "question", okLabel: "Yes", cancelLabel: "No", defaultCancel: false, noButtons: false });
  });

  test("labels, extra buttons, size, timeout", () => {
    const question = spec(
      "--question",
      "--ok-label=Delete",
      "--cancel-label",
      "Keep",
      "--extra-button=Later",
      "--width=500",
      "--height",
      "200",
      "--timeout=10",
    );
    expect(question).toMatchObject({ okLabel: "Delete", cancelLabel: "Keep", extraButtons: ["Later"], width: 500, height: 200, timeout: 10 });
  });

  test("markup and escapes in --text, unless --no-markup", () => {
    expect(spec("--info", "--text=<b>Done</b>\\nAll &amp; well").text).toBe("Done\nAll & well");
    expect(spec("--info", "--no-markup", "--text=<b>Done</b>\\n").text).toBe("<b>Done</b>\\n");
  });

  test("--default-cancel and --switch", () => {
    expect(spec("--question", "--default-cancel")).toMatchObject({ defaultCancel: true });
    expect(spec("--info", "--default-cancel")).toMatchObject({ defaultCancel: false });
    expect(spec("--question", "--switch", "--extra-button=A")).toMatchObject({ noButtons: true });
  });

  test("progress", () => {
    expect(spec("--progress", "--percentage=30", "--auto-close", "--pulsate", "--no-cancel")).toMatchObject({
      kind: "progress",
      percentage: 30,
      autoClose: true,
      pulsate: true,
      noCancel: true,
      text: "Running...",
    });
    expect(spec("--progress", "--percentage=250")).toMatchObject({ percentage: 100 });
  });

  test("list: columns, rows, and what is printed", () => {
    expect(spec("--list", "--column=Name", "--column=Size", "a", "1", "b", "2")).toMatchObject({
      kind: "list",
      columns: ["Name", "Size"],
      cells: ["a", "1", "b", "2"],
      mode: "plain",
      separator: "|",
      printColumns: [1],
    });
    expect(spec("--list", "--checklist", "--column=", "--column=Name")).toMatchObject({ mode: "checklist", printColumns: [2] });
    expect(spec("--list", "--radiolist", "--column=", "--column=Name", "--print-column=ALL", "--separator=\\n")).toMatchObject({
      mode: "radiolist",
      printColumns: "all",
      separator: "\n",
    });
    expect(spec("--list", "--column=A", "--column=B", "--print-column=1,2", "--hide-column=2")).toMatchObject({ printColumns: [1, 2], hiddenColumns: [2] });
  });

  test("scale's range is checked", () => {
    expect(spec("--scale")).toMatchObject({ value: 0, min: 0, max: 100, step: 1 });
    expect(spec("--scale", "--min-value=10", "--max-value=20")).toMatchObject({ value: 10 });
    expect(specFrom(parseArgs(["--scale", "--min-value=5", "--max-value=5"]), NOW)).toEqual({ error: "Maximum value must be greater than minimum value." });
    expect(specFrom(parseArgs(["--scale", "--value=200"]), NOW)).toEqual({ error: "Value out of range." });
  });

  test("calendar starts on today, or the day given", () => {
    expect(spec("--calendar")).toMatchObject({ year: 2026, month: 11, day: 3, dateFormat: null });
    expect(spec("--calendar", "--day=9", "--month=2", "--year=2024", "--date-format=%F")).toMatchObject({ year: 2024, month: 2, day: 9, dateFormat: "%F" });
  });

  test("errors", () => {
    expect(specFrom(parseArgs([]), NOW)).toEqual({ error: "You must specify a dialog type. See 'zenity --help' for details" });
    expect(specFrom(parseArgs(["--info", "--error"]), NOW)).toEqual({ error: "Two or more dialog options specified" });
    expect(specFrom(parseArgs(["--list"]), NOW)).toEqual({ error: "No column titles specified for List dialog." });
    expect(specFrom(parseArgs(["--info", "--width=wide"]), NOW)).toEqual({ error: "Cannot parse integer value 'wide' for --width" });
    expect(specFrom(parseArgs(["--forms"]), NOW)).toEqual({ unsupported: "forms" });
  });
});

describe("prepare", () => {
  test("no window for help, version, and errors", () => {
    expect(prepare(["--version"])).toEqual({ exit: 0, stdout: `${ZENITY_VERSION}\n`, stderr: [] });
    expect(prepare(["--help"])).toMatchObject({ exit: 0 });
    expect(prepare(["--info", "--bogus"], NOW)).toMatchObject({ stderr: ["dashi-dialog: unknown option --bogus, ignored"] });
    expect(prepare(["--notification", "--text=hi"])).toEqual({ exit: 255, stdout: "", stderr: ["dashi-dialog: --notification is not supported yet"] });
    expect(prepare([])).toMatchObject({ exit: 255 });
  });
});

describe("dialogSize", () => {
  test("lines a text takes", () => {
    expect(lineCount("", 300)).toBe(0);
    expect(lineCount("short", 300)).toBe(1);
    expect(lineCount("a\n\nb", 300)).toBe(3);
    expect(lineCount("x".repeat(200), 66)).toBe(20);
    expect(lineCount("x".repeat(200), 66, true)).toBe(1);
  });

  test("--width and --height win; long text makes a taller window, up to a limit", () => {
    expect(dialogSize(spec("--info", "--width=600", "--height=300"))).toEqual({ width: 600, height: 300 });
    const short = dialogSize(spec("--info", "--text=Hi"));
    const long = dialogSize(spec("--info", `--text=${"word ".repeat(200)}`));
    expect(long.width).toBe(short.width);
    expect(long.height).toBeGreaterThan(short.height);
    expect(dialogSize(spec("--info", `--text=${"word ".repeat(5000)}`)).height).toBe(640);
  });

  test("a message's window is as tall as its alert, nothing to spare", () => {
    // The controls' strip and 6, the 40 px tile beside two short lines, 10 and 6, the 28 px buttons, 18.
    expect(dialogSize(spec("--question", "--text=Delete it?\\nYou can't undo this.")).height).toBe(146);
    expect(dialogSize(spec("--info", "--text=Saved.")).height).toBe(146);
  });

  test("--no-wrap widens the window to the longest line", () => {
    const wide = dialogSize(spec("--info", "--no-wrap", `--text=${"x".repeat(100)}`));
    expect(wide.width).toBeGreaterThan(420);
  });
});
