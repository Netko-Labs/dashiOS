/**
 * What `dashi-applet new NAME` writes: an applet with a glyph, a label, a
 * menu with a submenu, and a popover, ready for `bun run dev`. The SDK and
 * the UI packages come from the folders this CLI runs from (a Dashi checkout
 * or /usr/share/dashi), by path, until they are published.
 */

import { basename, dirname, join } from "node:path";

/**
 * The SDK's folder, and the UI packages beside it: in a checkout packages/applet, packages/dashi-ui
 * and ../mirin's packages/mirin-metal; installed, node_modules/@dashi/applet, @dashi/ui and @mirinjs/metal.
 */
export function sdkPaths(applet: string = join(import.meta.dir, "../../..")): { applet: string; ui: string; metal: string } {
  const packages = dirname(applet);
  if (basename(packages) === "@dashi") return { applet, ui: join(packages, "ui"), metal: join(dirname(packages), "@mirinjs/metal") };
  return { applet, ui: join(packages, "dashi-ui"), metal: join(dirname(dirname(packages)), "mirin/packages/mirin-metal") };
}

const title = (name: string): string =>
  name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((word) => word[0]?.toUpperCase() + word.slice(1))
    .join(" ");

export function templateFiles(name: string, paths = sdkPaths()): Record<string, string> {
  const id = `dev.example.${name}`;
  const manifest = {
    // biome-ignore lint/style/useNamingConvention: JSON Schema's own key.
    $schema: `${paths.applet}/manifest.schema.json`,
    id,
    name: title(name),
    version: "0.1.0",
    dashi: ">=0.4",
    entry: "src/main.tsx",
    summary: `${title(name)} in the menu bar.`,
    author: { name: "Alex Kim" },
    categories: ["utilities"],
    permissions: [],
    // In the launcher before it ever runs (docs/applets.md, Commands): src/main.tsx's `commands` answer them.
    commands: [
      { id: "now", title: `${title(name)} now`, keywords: ["temperature"], mode: "instant" },
      { id: "city", title: `${title(name)} in a city`, keywords: ["forecast"], mode: "pick" },
      { id: "glance", title: `${title(name)} at a glance`, keywords: ["today"], mode: "view" },
    ],
  };
  const pkg = {
    name,
    private: true,
    type: "module",
    scripts: { dev: "dashi-applet dev", pack: "dashi-applet pack", publish: "dashi-applet publish" },
    dependencies: {
      "@dashi/applet": `file:${paths.applet}`,
      "@dashi/ui": `file:${paths.ui}`,
      "@mirinjs/metal": `file:${paths.metal}`,
      react: "^19.2.0",
    },
    devDependencies: { "@types/bun": "latest", "@types/react": "^19.2.0", typescript: "^5.9.0" },
  };
  const tsconfig = {
    compilerOptions: {
      target: "ESNext",
      module: "ESNext",
      moduleResolution: "bundler",
      allowImportingTsExtensions: true,
      noEmit: true,
      strict: true,
      skipLibCheck: true,
      jsx: "react-jsx",
      types: ["bun"],
    },
    include: ["src"],
  };
  return {
    "applet.json": `${JSON.stringify(manifest, null, 2)}\n`,
    "package.json": `${JSON.stringify(pkg, null, 2)}\n`,
    "tsconfig.json": `${JSON.stringify(tsconfig, null, 2)}\n`,
    ".gitignore": "node_modules/\ndist/\n*.key\n",
    "src/main.tsx": MAIN,
  };
}

const MAIN = `/**
 * An applet: its state, and what the menu bar shows for it. A click opens
 * the popover; a right-click, the menu. \`bun run dev\` runs it with a "dev"
 * badge and reloads it on save (docs/applets.md).
 *
 * It also adds three commands to the launcher (applet.json's \`commands\`):
 * one that answers at once, one that offers rows as you type, and one that
 * draws its answer itself where the launcher's rows were.
 */

import { defineApplet, type PopoverProps, type ViewProps } from "@dashi/applet";
import { useColors } from "@dashi/ui";
import { Text, View } from "@mirinjs/metal";

const SUN = \`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="3" fill="none" stroke="#000" stroke-width="1.5"/><path d="M8 1.5v1.5M8 13v1.5M1.5 8h1.5M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M3.4 12.6l1-1M11.6 4.4l1-1" stroke="#000" stroke-width="1.5" stroke-linecap="round"/></svg>\`;

interface State {
  celsius: number;
  unit: "C" | "F";
}

const shown = (state: State): string => \`\${state.unit === "C" ? state.celsius : Math.round((state.celsius * 9) / 5 + 32)}°\`;

const CITIES = [
  { id: "lisbon", name: "Lisbon", celsius: 19, sky: "clear" },
  { id: "porto", name: "Porto", celsius: 17, sky: "cloudy" },
  { id: "oslo", name: "Oslo", celsius: 4, sky: "snow" },
  { id: "tokyo", name: "Tokyo", celsius: 22, sky: "rain" },
];

/** The view command's answer, drawn by this applet where the launcher's rows were. */
function Glance({ state }: ViewProps<State>) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 16, padding: 16, backgroundColor: colors.launcher }}>
      <Text style={{ fontSize: 40, fontWeight: "bold", color: colors.text }}>{shown(state)}</Text>
      <View style={{ flexDirection: "column", gap: 4 }}>
        <Text style={{ fontSize: 15, color: colors.text }}>Clear all day</Text>
        <Text style={{ fontSize: 13, color: colors.textMuted }}>Esc goes back</Text>
      </View>
    </View>
  );
}

function Panel({ state, set, close }: PopoverProps<State>) {
  const colors = useColors();
  return (
    <View style={{ flex: 1, flexDirection: "column", gap: 6, padding: 16, borderRadius: 12, borderWidth: 1, borderColor: colors.menuEdge }}>
      <Text style={{ fontSize: 30, fontWeight: "bold", color: colors.text }}>{shown(state)}</Text>
      <Text style={{ fontSize: 13, color: colors.textMuted }}>Clear</Text>
      <View
        onPress={() => set({ unit: state.unit === "C" ? "F" : "C" })}
        style={{ marginTop: "auto", height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center", backgroundColor: colors.button }}
      >
        <Text style={{ fontSize: 13, color: colors.text }}>{state.unit === "C" ? "Use Fahrenheit" : "Use Celsius"}</Text>
      </View>
      <View onPress={close} style={{ height: 28, borderRadius: 7, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: 13, color: colors.textMuted }}>Close</Text>
      </View>
    </View>
  );
}

export default defineApplet<State>({
  initial: { celsius: 21, unit: "C" },
  glyph: SUN,
  label: shown,
  menu: (state) => [
    { id: "refresh", label: "Refresh" },
    { type: "separator" },
    {
      type: "submenu",
      label: "Units",
      items: [
        { id: "celsius", label: "Celsius", checked: state.unit === "C" },
        { id: "fahrenheit", label: "Fahrenheit", checked: state.unit === "F" },
      ],
    },
  ],
  onSelect: (item, applet) => {
    if (item === "celsius") applet.set({ unit: "C" });
    if (item === "fahrenheit") applet.set({ unit: "F" });
  },
  popover: { width: 260, height: 170, component: Panel },
  commands: {
    // instant: the launcher shows the line; Return copies it.
    now: { run: (_args, applet) => \`\${shown(applet.state)} and clear\` },
    // pick: rows for what is typed, then what the chosen one comes to (here, text on the clipboard).
    city: {
      items: (query) =>
        CITIES.filter((city) => city.name.toLowerCase().startsWith(query.trim().toLowerCase())).map((city) => ({
          id: city.id,
          title: \`\${city.name}, now \${city.celsius}°\`,
          detail: city.sky,
        })),
      choose: (item) => {
        const city = CITIES.find((each) => each.id === item);
        return city ? { copy: \`\${city.name}: \${city.celsius}°, \${city.sky}\` } : { error: "There is no such city." };
      },
    },
    // view: drawn by this applet's own Metal host, 160 points tall.
    glance: { view: { height: 160, component: Glance } },
  },
});
`;
