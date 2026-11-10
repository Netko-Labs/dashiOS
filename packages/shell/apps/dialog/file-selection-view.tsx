/** `--file-selection`'s window: Files' chooser, whose answer is printed (paths and the separator) with exit 0, or exit 1 when cancelled. */

import { existsSync } from "node:fs";
import { useEffect, useMemo } from "react";
import { ChooserView, type Env, openChooser } from "../files/chooser/index.ts";
import { selectionOutput, selectionRequest } from "./file-selection.ts";
import type { Answer } from "./frame.tsx";
import type { FileSelectionSpec } from "./spec.ts";

export function FileSelectionDialog({ spec, answer, env, cwd = process.cwd() }: { spec: FileSelectionSpec; answer: Answer; env?: Env; cwd?: string }) {
  const request = useMemo(() => selectionRequest(spec.title, spec, cwd), [spec, cwd]);
  const model = useMemo(() => openChooser(request, env), [request, env]);
  useEffect(() => () => model.stop(), [model]);
  return (
    <ChooserView
      model={model}
      title={spec.title}
      exists={existsSync}
      answer={(chosen) => (chosen === null || chosen.paths.length === 0 ? answer(1) : answer(0, selectionOutput(chosen.paths, spec.separator)))}
    />
  );
}
