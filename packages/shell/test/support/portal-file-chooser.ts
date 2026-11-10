import { type ChooserRequest, parseChooser } from "../../apps/portal/file-chooser/options.ts";

export const request = (overrides: Partial<ChooserRequest>): ChooserRequest => ({ ...parseChooser("open", ["", "", "", new Map()]), ...overrides });
