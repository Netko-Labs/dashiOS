/**
 * What a chooser frame is given: the model, how to tell a file exists (a
 * save would replace it), and where the answer goes.
 */

import type { ChooserAnswer } from "../../../src/shared/files/index.ts";
import type { ChooserModel } from "./model.ts";

export interface ChooserViewProps {
  model: ChooserModel;
  exists: (path: string) => boolean;
  answer: (value: ChooserAnswer | null) => void;
}
