// The design checks' pure parts (H21a, H23): what each counts, and which workstream's list it lands on.
import { describe, expect, test } from "bun:test";
import { STEPS } from "../check.ts";
import { colorJobs } from "../check-design-colours.ts";
import { kitControls } from "../check-design-kit.ts";
import { bindings, disagreement } from "../check-design-sync.ts";
import { countByFile } from "../check-design-values.ts";
import { ownerOf, splitByOwner } from "../design-lists.ts";
import { isOffScale, isScanned, scanText } from "../design-scan.ts";

const offScale = (file: string, text: string): string[] =>
  scanText(file, text)
    .filter(isOffScale)
    .map((hit) => `${hit.category}:${hit.value}`);

describe("H21a values off the scales", () => {
  test("a hex anywhere outside the theme counts; the theme and a glyph's SVG template don't", () => {
    expect(offScale("packages/shell/src/a.tsx", 'const ink = "#1d1d1f";')).toEqual(["colour:#1d1d1f"]);
    expect(offScale("packages/dashi-ui/src/theme/x.ts", 'const ink = "#1d1d1f";')).toEqual([]);
    expect(offScale("packages/shell/src/a.ts", "const G = '<svg><path stroke=\"#000\"/></svg>';")).toEqual([]);
    expect(offScale("packages/shell/src/a.tsx", 'const x = { color: "white" };')).toEqual(["colour:white"]);
  });
  test("sizes off TY-1, radii off RA-1, weights off TY-2 and shadows off DE-1 count; tokens and the scales don't", () => {
    const text = [
      'const a = { fontSize: 14, borderRadius: 8, fontWeight: "medium", shadow: "md" };',
      'const b = { fontSize: 12.5, borderRadius: 7, fontWeight: "semibold", shadow: "lg" };',
      "const c = { fontSize: TYPE.body.size, borderRadius: RADIUS.card, fontWeight: WEIGHT.display.extraLight };",
      "const d = { fontSize: big ? 16 : 13, borderRadius: height / 2 };",
    ].join("\n");
    expect(offScale("packages/shell/src/a.tsx", text)).toEqual(["fontSize:14", "radius:8", "weight:medium", "shadow:md", "fontSize:16"]);
  });
  test("a name bound to a literal in the same file counts where it is used", () => {
    expect(offScale("packages/shell/src/a.tsx", "const SIZE = 16;\nconst s = { fontSize: SIZE };")).toEqual(["fontSize:16"]);
  });
  test("reads production TypeScript under the four roots only", () => {
    expect(isScanned("packages/shell/src/menubar/view.tsx")).toBe(true);
    expect(isScanned("packages/shell/test/menubar.test.tsx")).toBe(false);
    expect(isScanned("packages/applet/src/a.ts")).toBe(false);
    expect(isScanned("packages/greeter/src/view.tsx")).toBe(true);
  });
  test("counts per file", () => {
    const hits = scanText("packages/shell/src/a.tsx", 'const a = "#fff"; const b = "#000";').filter(isOffScale);
    expect([...countByFile(hits)]).toEqual([["packages/shell/src/a.tsx", 2]]);
  });
});

describe("H23 colours keep their job", () => {
  const jobs = (file: string, text: string): string[] => colorJobs(file, text).map((hit) => hit.job);
  test("purple as an edge outside the agents' modules, unless it is a field's own focus edge", () => {
    expect(jobs("packages/shell/src/widgets/edit.tsx", "  style={{ borderColor: colors.focusRing }}")).toEqual(["purple-off-job"]);
    expect(jobs("packages/shell/src/agents/x.tsx", "  style={{ borderColor: colors.focusRing }}")).toEqual([]);
    const field = "style={{\n  borderColor: colors.focusRing,\n  focusBorderColor: colors.focusRing,\n}}";
    expect(jobs("packages/shell/src/shared/file-browser/lib/views/rename-field.tsx", field)).toEqual([]);
    expect(jobs("packages/shell/src/x.tsx", "  style={{ focusRingColor: colors.focusRing }}")).toEqual([]);
  });
  test("the accent in a widget, on a logo, as words; another platform's green", () => {
    expect(jobs("packages/shell/src/widgets/clock.tsx", "const c = colors.selection;")).toEqual(["accent-in-place"]);
    expect(jobs("packages/shell/src/setup/a.tsx", "<Svg markup={LOGO} size={96} color={colors.selection} />")).toEqual(["accent-decor"]);
    expect(jobs("packages/shell/src/a.tsx", "<Text style={{ fontSize: 12, color: colors.selection }}>More</Text>")).toEqual(["accent-words"]);
    expect(jobs("packages/shell/src/a.ts", 'const CHARGING = "#30d158";')).toEqual(["foreign-palette"]);
    expect(jobs("packages/shell/src/a.ts", '// "#30d158" in a comment')).toEqual([]);
  });
});

describe("H22 controls from the kit", () => {
  const kinds = (text: string): string[] => kitControls("packages/shell/src/a.tsx", text).map((hit) => `${hit.kind}:${hit.name}`);
  test("a View drawn as a button, a bare TextInput, and a control named outside the kit", () => {
    expect(kinds('const a = <View accessibilityRole="button" style={{ backgroundColor: x }} />;')).toEqual(["role:button:View"]);
    expect(kinds('const a = <View accessibilityRole="button" onPress={go} />;')).toEqual([]);
    expect(kinds("const a = <TextInput value={v} />;")).toEqual(["text-input:TextInput"]);
    expect(kinds("function SaveButton() { return <View />; }")).toEqual(["defines:SaveButton"]);
  });
  test("a sheet of its own built on the kit's Sheet or Button is not a new control", () => {
    expect(kinds('function RenameSheet() { return <FormSheet title="Rename" buttons={[]} />; }')).toEqual([]);
    expect(kinds('function DoneButton() { return <Button label="Done" />; }')).toEqual([]);
    // A status built on the kit's Chip (D634): the agents' access chip, the bar's "Screen is being shared".
    expect(kinds('function AccessChip() { return <Chip label="Connected" tone="agent" />; }')).toEqual([]);
    // The menu bar's item built on the kit's BarItem (UI-18).
    expect(kinds('function AloneChip() { return <BarItem tone="agent" label="Stop" />; }')).toEqual([]);
  });
});

describe("H24 design.html in sync", () => {
  const tokens = { TYPE: { body: { size: 13, line: 17 } }, WEIGHT: { bold: "bold" }, SHADOW: { lg: "lg" }, MENU: { padding: 5 } };
  test("reads each bound element's text", () => {
    const html = '<td><span data-token="TYPE.body">13 / 17</span></td>\n<span class="x" data-token="MENU.padding"><b>5</b></span>';
    expect(bindings(html)).toEqual([
      { token: "TYPE.body", text: "13 / 17", line: 1 },
      { token: "MENU.padding", text: "5", line: 2 },
    ]);
  });
  test("a role's size, then its line; a weight's number; a shadow's name; a wrong or missing token fails", () => {
    expect(disagreement({ token: "TYPE.body", text: "13", line: 1 }, tokens)).toBeNull();
    expect(disagreement({ token: "TYPE.body", text: "13 / 17", line: 1 }, tokens)).toBeNull();
    expect(disagreement({ token: "TYPE.body", text: "13 / 18", line: 1 }, tokens)).toContain("13 / 18");
    expect(disagreement({ token: "WEIGHT.bold", text: "700", line: 1 }, tokens)).toBeNull();
    expect(disagreement({ token: "SHADOW.lg", text: "lg", line: 1 }, tokens)).toBeNull();
    expect(disagreement({ token: "MENU.padding", text: "6", line: 1 }, tokens)).not.toBeNull();
    expect(disagreement({ token: "MENU.gap", text: "6", line: 1 }, tokens)).toContain("no @dashi/ui export");
  });
});

describe("the lists, one per workstream", () => {
  test("a file lands on the list of the workstream that owns it", () => {
    expect(ownerOf("packages/dashi-ui/src/button.tsx")).toBe("W1");
    expect(ownerOf("packages/dashi-ui/src/login-screen.tsx")).toBe("W7");
    expect(ownerOf("packages/shell/src/consent.tsx")).toBe("W2");
    expect(ownerOf("packages/shell/src/menubar/view.tsx")).toBe("W3");
    expect(ownerOf("packages/shell/src/settings-app/view.tsx")).toBe("W4");
    expect(ownerOf("packages/shell/apps/files/main.tsx")).toBe("W5");
    expect(ownerOf("packages/shell/apps/calendar/main.tsx")).toBe("W6");
    const parts = splitByOwner(new Map([["packages/shell/src/consent.tsx", 3]]));
    expect(parts.get("W2")?.get("packages/shell/src/consent.tsx")).toBe(3);
    expect(parts.get("W3")?.size).toBe(0);
  });
  test("bun run check runs both, in the fast set", () => {
    const fast = STEPS.filter((step) => step.fast).map((step) => step.command.join(" "));
    expect(fast).toContain("bun scripts/check-design-values.ts");
    expect(fast).toContain("bun scripts/check-design-colours.ts");
    expect(fast).toContain("bun scripts/check-design-kit.ts");
    expect(fast).toContain("bun scripts/check-design-sync.ts");
  });
});
