/**
 * Units the answer row converts between: length, mass, volume, area, speed,
 * temperature, durations, and sizes of data. Each unit is a factor to its
 * dimension's base (metres, kilograms, litres, square metres, metres a second,
 * seconds, bytes); temperatures also have an offset. Sizes are decimal
 * (1 GB = 1000 MB, as Files and Disks write them), with KiB, MiB… for the
 * binary ones.
 */

export type Dimension = "length" | "mass" | "volume" | "area" | "speed" | "temperature" | "time" | "data";

export interface Unit {
  /** How a result is written: `mi`, `°F`, `GB`. */
  symbol: string;
  dimension: Dimension;
  /** One of this unit in the base unit. */
  factor: number;
  /** Added after the factor (temperatures: °C to kelvin is +273.15). */
  offset?: number;
}

/** Each unit and the names it is typed as (folded to lower case; a trailing "s" is tried off too). */
const TABLE: ReadonlyArray<[Unit, readonly string[]]> = [
  [{ symbol: "mm", dimension: "length", factor: 0.001 }, ["mm", "millimeter", "millimetre"]],
  [{ symbol: "cm", dimension: "length", factor: 0.01 }, ["cm", "centimeter", "centimetre"]],
  [{ symbol: "m", dimension: "length", factor: 1 }, ["m", "meter", "metre"]],
  [{ symbol: "km", dimension: "length", factor: 1000 }, ["km", "kilometer", "kilometre", "kms"]],
  [{ symbol: "in", dimension: "length", factor: 0.0254 }, ["in", "inch", "inches", '"']],
  [{ symbol: "ft", dimension: "length", factor: 0.3048 }, ["ft", "foot", "feet", "'"]],
  [{ symbol: "yd", dimension: "length", factor: 0.9144 }, ["yd", "yard"]],
  [{ symbol: "mi", dimension: "length", factor: 1609.344 }, ["mi", "mile"]],
  [{ symbol: "nmi", dimension: "length", factor: 1852 }, ["nmi", "nautical mile"]],
  [{ symbol: "mg", dimension: "mass", factor: 1e-6 }, ["mg", "milligram"]],
  [{ symbol: "g", dimension: "mass", factor: 0.001 }, ["g", "gram", "gramme"]],
  [{ symbol: "kg", dimension: "mass", factor: 1 }, ["kg", "kilo", "kilogram", "kilogramme"]],
  [{ symbol: "t", dimension: "mass", factor: 1000 }, ["t", "tonne", "metric ton"]],
  [{ symbol: "oz", dimension: "mass", factor: 0.028349523125 }, ["oz", "ounce"]],
  [{ symbol: "lb", dimension: "mass", factor: 0.45359237 }, ["lb", "lbs", "pound"]],
  [{ symbol: "st", dimension: "mass", factor: 6.35029318 }, ["st", "stone"]],
  [{ symbol: "ml", dimension: "volume", factor: 0.001 }, ["ml", "milliliter", "millilitre"]],
  [{ symbol: "cl", dimension: "volume", factor: 0.01 }, ["cl", "centiliter", "centilitre"]],
  [{ symbol: "dl", dimension: "volume", factor: 0.1 }, ["dl", "deciliter", "decilitre"]],
  [{ symbol: "L", dimension: "volume", factor: 1 }, ["l", "liter", "litre"]],
  [{ symbol: "m³", dimension: "volume", factor: 1000 }, ["m3", "m³", "cubic meter", "cubic metre"]],
  [{ symbol: "tsp", dimension: "volume", factor: 0.00492892159375 }, ["tsp", "teaspoon"]],
  [{ symbol: "tbsp", dimension: "volume", factor: 0.01478676478125 }, ["tbsp", "tablespoon"]],
  [{ symbol: "fl oz", dimension: "volume", factor: 0.0295735295625 }, ["fl oz", "floz", "fluid ounce"]],
  [{ symbol: "cups", dimension: "volume", factor: 0.2365882365 }, ["cup"]],
  [{ symbol: "pt", dimension: "volume", factor: 0.473176473 }, ["pt", "pint"]],
  [{ symbol: "qt", dimension: "volume", factor: 0.946352946 }, ["qt", "quart"]],
  [{ symbol: "gal", dimension: "volume", factor: 3.785411784 }, ["gal", "gallon"]],
  [{ symbol: "m²", dimension: "area", factor: 1 }, ["m2", "m²", "sq m", "square meter", "square metre"]],
  [{ symbol: "km²", dimension: "area", factor: 1e6 }, ["km2", "km²", "sq km", "square kilometer", "square kilometre"]],
  [{ symbol: "ft²", dimension: "area", factor: 0.09290304 }, ["ft2", "ft²", "sq ft", "square foot", "square feet"]],
  [{ symbol: "mi²", dimension: "area", factor: 2589988.110336 }, ["mi2", "mi²", "sq mi", "square mile"]],
  [{ symbol: "ha", dimension: "area", factor: 10_000 }, ["ha", "hectare"]],
  [{ symbol: "acres", dimension: "area", factor: 4046.8564224 }, ["acre", "ac"]],
  [{ symbol: "km/h", dimension: "speed", factor: 1 / 3.6 }, ["km/h", "kmh", "kph", "kmph"]],
  [{ symbol: "mph", dimension: "speed", factor: 0.44704 }, ["mph", "mi/h"]],
  [{ symbol: "m/s", dimension: "speed", factor: 1 }, ["m/s", "mps"]],
  [{ symbol: "kn", dimension: "speed", factor: 1852 / 3600 }, ["kn", "kt", "knot"]],
  [{ symbol: "°C", dimension: "temperature", factor: 1, offset: 273.15 }, ["c", "°c", "celsius", "centigrade"]],
  [{ symbol: "°F", dimension: "temperature", factor: 5 / 9, offset: 459.67 * (5 / 9) }, ["f", "°f", "fahrenheit"]],
  [{ symbol: "K", dimension: "temperature", factor: 1, offset: 0 }, ["k", "kelvin"]],
  [{ symbol: "ms", dimension: "time", factor: 0.001 }, ["ms", "millisecond"]],
  [{ symbol: "s", dimension: "time", factor: 1 }, ["s", "sec", "second"]],
  [{ symbol: "min", dimension: "time", factor: 60 }, ["min", "mins", "minute"]],
  [{ symbol: "h", dimension: "time", factor: 3600 }, ["h", "hr", "hrs", "hour"]],
  [{ symbol: "days", dimension: "time", factor: 86_400 }, ["d", "day"]],
  [{ symbol: "weeks", dimension: "time", factor: 604_800 }, ["wk", "week"]],
  [{ symbol: "bits", dimension: "data", factor: 1 / 8 }, ["bit"]],
  [{ symbol: "B", dimension: "data", factor: 1 }, ["b", "byte"]],
  [{ symbol: "KB", dimension: "data", factor: 1e3 }, ["kb", "kilobyte"]],
  [{ symbol: "MB", dimension: "data", factor: 1e6 }, ["mb", "megabyte"]],
  [{ symbol: "GB", dimension: "data", factor: 1e9 }, ["gb", "gigabyte", "gig"]],
  [{ symbol: "TB", dimension: "data", factor: 1e12 }, ["tb", "terabyte"]],
  [{ symbol: "PB", dimension: "data", factor: 1e15 }, ["pb", "petabyte"]],
  [{ symbol: "KiB", dimension: "data", factor: 2 ** 10 }, ["kib", "kibibyte"]],
  [{ symbol: "MiB", dimension: "data", factor: 2 ** 20 }, ["mib", "mebibyte"]],
  [{ symbol: "GiB", dimension: "data", factor: 2 ** 30 }, ["gib", "gibibyte"]],
  [{ symbol: "TiB", dimension: "data", factor: 2 ** 40 }, ["tib", "tebibyte"]],
];

const BY_NAME: ReadonlyMap<string, Unit> = new Map(TABLE.flatMap(([unit, names]) => names.map((name) => [name, unit] as const)));

/** The unit `typed` names ("Miles", "°F", "degrees celsius", "sq ft"), or null. */
export function unitNamed(typed: string): Unit | null {
  const name = typed
    .trim()
    .toLowerCase()
    .replace(/^degrees?\s+/, "")
    .replace(/^°\s*/, "°")
    .replace(/\s+/g, " ");
  if (!name) return null;
  // "°celsius" is "celsius"; "°c" is in the table as it is.
  for (const each of [name, name.replace(/^°/, "")]) {
    const unit = BY_NAME.get(each) ?? (each.endsWith("s") ? BY_NAME.get(each.slice(0, -1)) : undefined);
    if (unit) return unit;
  }
  return null;
}

/** `value` of `from` in `to`; null across dimensions. */
export function convert(value: number, from: Unit, to: Unit): number | null {
  if (from.dimension !== to.dimension) return null;
  const base = value * from.factor + (from.offset ?? 0);
  return (base - (to.offset ?? 0)) / to.factor;
}
