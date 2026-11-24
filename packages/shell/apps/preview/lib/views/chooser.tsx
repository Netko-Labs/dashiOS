/**
 * Open… and Export's "where to" are Files' own chooser as a sheet over the
 * window (R7, PA-12), as Text Editor's are: never a typed path, and the
 * window's context stays. The chooser is the file browser, so it is loaded
 * the first time it is asked for, not when Preview starts (entry-weight).
 */

import { useEffect, useState } from "react";
import type { ChooserRequest } from "../../../../src/shared/files/index.ts";

type AppChooser = typeof import("../../../../src/shared/file-browser/chooser-view.tsx").AppChooser;

/** Once loaded, kept: a second Open shows at once. */
let loaded: AppChooser | null = null;

/** The chooser for `request`; `answer` gets the paths chosen, or null for Cancel. */
export function FileChooser({ request, answer }: { request: ChooserRequest; answer: (paths: string[] | null) => void }) {
  const [Chooser, setChooser] = useState<AppChooser | null>(() => loaded);
  useEffect(() => {
    if (loaded) return;
    void import("../../../../src/shared/file-browser/chooser-view.tsx").then((module) => {
      loaded = module.AppChooser;
      setChooser(() => module.AppChooser);
    });
  }, []);
  return Chooser ? <Chooser request={request} answer={answer} /> : null;
}
