import { parseChooser } from "../../apps/portal/lib/file-chooser/options.ts";
import type { ChooserRequest } from "../../src/shared/files/index.ts";

export const request = (overrides: Partial<ChooserRequest>): ChooserRequest => ({ ...parseChooser("open", ["", "", "", new Map()]), ...overrides });
