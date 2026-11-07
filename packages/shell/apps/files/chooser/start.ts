/** A chooser for a request on this machine: Files' view of it, started where the request says (accept.ts `startFolder`). */

import { type Env, systemEnv } from "../env.ts";
import { startFolder, startName } from "./accept.ts";
import { ChooserModel, type ChooserOptions } from "./model.ts";
import type { ChooserRequest } from "./request.ts";

/** A chooser model for `request`, listing at once; the caller stops it when it is answered. */
export function openChooser(request: ChooserRequest, env: Env = systemEnv(), options: ChooserOptions = {}): ChooserModel {
  const documents = env.dirs.find((dir) => dir.name === "DOCUMENTS")?.path ?? null;
  const model = new ChooserModel(request, env, { folder: startFolder(request, documents, env.home), name: startName(request) }, options);
  model.start();
  return model;
}
