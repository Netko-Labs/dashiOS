/**
 * Moon: writes its widget's tree once an hour into its data folder (its
 * `$HOME` in the sandbox), where the shell watches it. How lit the moon is,
 * from the days since a known new moon (2000-01-06 18:14 UTC) over the
 * synodic month.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const SYNODIC_DAYS = 29.530588853;
const NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);
const NAMES = ["New moon", "Waxing crescent", "First quarter", "Waxing gibbous", "Full moon", "Waning gibbous", "Last quarter", "Waning crescent"];

function phase(now: number): { lit: number; name: string; age: number } {
  const age = ((((now - NEW_MOON) / 86_400_000) % SYNODIC_DAYS) + SYNODIC_DAYS) % SYNODIC_DAYS;
  const lit = (1 - Math.cos((2 * Math.PI * age) / SYNODIC_DAYS)) / 2;
  return { lit, name: NAMES[Math.round((age / SYNODIC_DAYS) * 8) % 8] ?? "Moon", age };
}

function write(): void {
  const { lit, name, age } = phase(Date.now());
  const tree = {
    t: "Widget",
    i: "moon",
    p: { title: "Moon", detail: "tonight" },
    c: [
      { t: "Spacer", i: "s" },
      { t: "Value", i: "v", p: { text: String(Math.round(lit * 100)), unit: "%" } },
      { t: "Text", i: "n", p: { text: `${name} · day ${Math.floor(age)}` } },
      { t: "Dots", i: "d", p: { count: 15, value: Math.round(lit * 15) } },
    ],
  };
  const folder = join(process.env.HOME ?? ".", "widgets");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "moon.json"), JSON.stringify(tree));
}

write();
setInterval(write, 3_600_000);
