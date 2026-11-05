/**
 * When an applet applies: applet.json's `when`, matched against this
 * machine. Every condition given must hold; a condition with a list holds
 * when any entry does; text matches exactly, or as a prefix with a trailing
 * `*` ("ROG *"). No `when` means every machine.
 *
 *   "when": { "vendor": "ASUSTeK COMPUTER INC.", "laptop": true, "hardware": ["platform-profile"] }
 *
 * `vendor`, `product`, `board`, `family` are DMI's sys_vendor, product_name,
 * board_name and product_family; `laptop` is the chassis; `hardware` lists
 * what dashi-hardware must report (a knob name from docs/hardware.md, or
 * `fan-curves`, `slash`, `aura`, `keyboard-light`, `curve-optimizer`).
 */

import { isRefusal, list, optionalBoolean, type Refusal, record, refuse, text } from "./parse.ts";

export interface When {
  vendor?: string[];
  product?: string[];
  board?: string[];
  family?: string[];
  laptop?: boolean;
  hardware?: string[];
}

/** What is known about this machine; a field left out is unknown, and a condition on it does not hold. */
export interface Machine {
  vendor?: string;
  product?: string;
  board?: string;
  family?: string;
  laptop?: boolean;
  /** What dashi-hardware reported; absent when it isn't running. */
  hardware?: readonly string[];
}

const TEXT_KEYS = ["vendor", "product", "board", "family"] as const;
const PATTERN = 128;

function patterns(value: unknown, what: string): string[] | Refusal {
  if (typeof value === "string") {
    const one = text(value, what, PATTERN);
    return isRefusal(one) ? one : [one];
  }
  if (!Array.isArray(value)) return refuse(`${what} must be text or a list of text`);
  return list(value, what, 16, (entry, where) => text(entry, where, PATTERN));
}

export function parseWhen(value: unknown): When | Refusal {
  const fields = record(value, "when", [...TEXT_KEYS, "laptop", "hardware"]);
  if (isRefusal(fields)) return fields;
  const when: When = {};
  for (const key of TEXT_KEYS) {
    if (fields[key] === undefined) continue;
    const given = patterns(fields[key], `when.${key}`);
    if (isRefusal(given)) return given;
    when[key] = given;
  }
  const laptop = optionalBoolean(fields.laptop, "when.laptop");
  if (isRefusal(laptop)) return laptop;
  if (laptop !== undefined) when.laptop = laptop;
  if (fields.hardware !== undefined) {
    const hardware = list(fields.hardware, "when.hardware", 16, (entry, where) =>
      typeof entry === "string" && /^[a-z][a-z0-9-]{0,40}$/.test(entry) ? entry : refuse(`${where} must be a hardware name such as "platform-profile"`),
    );
    if (isRefusal(hardware)) return hardware;
    when.hardware = hardware;
  }
  return when;
}

function matches(pattern: string, value: string | undefined): boolean {
  if (value === undefined) return false;
  return pattern.endsWith("*") ? value.startsWith(pattern.slice(0, -1)) : value === pattern;
}

/** Whether an applet that says `when` fits `machine`. */
export function fits(when: When | undefined, machine: Machine): boolean {
  if (!when) return true;
  for (const key of TEXT_KEYS) {
    const given = when[key];
    if (given && !given.some((pattern) => matches(pattern, machine[key]))) return false;
  }
  if (when.laptop !== undefined && machine.laptop !== when.laptop) return false;
  if (when.hardware && !when.hardware.every((name) => machine.hardware?.includes(name))) return false;
  return true;
}

/** "Works on" in words, for the store's page: the vendor and the kind of machine. */
export function describeWhen(when: When | undefined): string {
  if (!when) return "Any computer";
  const parts: string[] = [];
  const who = [...(when.vendor ?? []), ...(when.family ?? []), ...(when.product ?? [])].map((each) => each.replace(/\*$/, "…"));
  if (who.length > 0) parts.push(who.join(", "));
  if (when.laptop === true) parts.push(parts.length > 0 ? "laptops" : "Laptops");
  if (when.laptop === false) parts.push(parts.length > 0 ? "desktops" : "Desktops");
  if (when.hardware) parts.push(`with ${when.hardware.join(", ")}`);
  return parts.length > 0 ? parts.join(" ") : "Any computer";
}
