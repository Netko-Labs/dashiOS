import type { Variant } from "../../src/shared/dbus/index.ts";

export const dict = (entries: Record<string, Variant>): Map<string, Variant> => new Map(Object.entries(entries));
