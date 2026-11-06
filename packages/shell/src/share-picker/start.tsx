/**
 * Dashi's screen-share picker: xdg-desktop-portal-wlr runs
 * `dashi-share-picker` as its chooser (session/xdg-desktop-portal-wlr.conf),
 * which asks here (server.ts). The picker opens on the screen the person is
 * on with every screen and window as a live picture, and answers with the
 * one chosen; the portal shares it. With "Hide notifications while sharing"
 * on, banners stay away (Do Not Disturb) until the compositor says the
 * capture ended.
 */

import { parseOutputs } from "../arrange.ts";
import type { Compositor, CompositorWindow } from "../compositor.ts";
import type { OpenOverlay, OverlayHandle } from "../overlay.tsx";
import { centeredOn } from "../switcher/index.ts";
import { PICKER, pickerLayout } from "./layout.ts";
import { PickerStore, SharePicker } from "./panel.tsx";
import { type ShareChoice, socketPath } from "./protocol.ts";
import { serveSharePicker } from "./server.ts";

export interface SharePickerDeps {
  compositor: Compositor;
  open: OpenOverlay;
  /** The screen the person is on (active-screen.ts). */
  screen(): Promise<string | undefined>;
  /** The Desktop that shows: screens are pictured as it is. */
  currentSpace(): number;
  /** What the Dock calls a window's app. */
  appName(window: CompositorWindow): string;
  notifications: { readonly doNotDisturb: boolean; setDoNotDisturb(on: boolean): void };
}

/** If the capture never starts (the portal failed), notifications come back after this long. */
const QUIET_UNTIL_CAPTURE_MS = 30_000;

export function startSharePicker(deps: SharePickerDeps): () => void {
  const { compositor } = deps;
  const path = socketPath();
  if (!path) {
    console.error("dashi-shell: no XDG_RUNTIME_DIR; the share picker is off");
    return () => {};
  }
  let stopQuiet: (() => void) | null = null;

  /** Do Not Disturb until the capture that follows the choice ends. */
  const quietWhileSharing = () => {
    if (deps.notifications.doNotDisturb) return;
    stopQuiet?.();
    deps.notifications.setDoNotDisturb(true);
    let started = false;
    const giveUp = setTimeout(() => !started && end(), QUIET_UNTIL_CAPTURE_MS);
    const off = compositor.on((event) => {
      if (event.event !== "screen-capture") return;
      if (event.active) started = true;
      else if (started) end();
    });
    const end = () => {
      clearTimeout(giveUp);
      off();
      stopQuiet = null;
      deps.notifications.setDoNotDisturb(false);
    };
    stopQuiet = end;
  };

  const ask = async (abort: AbortSignal): Promise<ShareChoice | null> => {
    const [name, answer, windows] = await Promise.all([deps.screen(), compositor.request("outputs"), compositor.windows()]);
    const outputs = parseOutputs(answer);
    const output = outputs.find((each) => each.name === name) ?? outputs[0];
    if (!output || abort.aborted) return null;
    const shareable = windows
      .filter((window): window is CompositorWindow & { toplevel: string } => window.state === "normal" && window.toplevel !== undefined)
      .slice(0, PICKER.windows);
    const layout = pickerLayout(
      outputs.map((each) => each.frame.width / Math.max(1, each.frame.height)),
      shareable.length,
    );
    const origin = centeredOn(output.usable, layout.size);
    const store = new PickerStore();
    const space = deps.currentSpace();
    const pictures = (on: boolean) =>
      Promise.all([
        compositor.request("space-previews", {
          output: output.name,
          rects: on
            ? outputs.flatMap((screen, index) => {
                const rect = layout.screens[index];
                return rect ? [{ space, screen: screen.name, x: origin.x + rect.x, y: origin.y + rect.y, w: rect.width, h: rect.height }] : [];
              })
            : [],
        }),
        compositor.request("window-thumbnails", {
          rects: on
            ? shareable.flatMap((window, index) => {
                const rect = layout.windows[index];
                return rect ? [{ window: window.id, x: origin.x + rect.x, y: origin.y + rect.y, w: rect.width, h: rect.height }] : [];
              })
            : [],
        }),
      ]).catch((error) => console.error("dashi-shell: the share picker's pictures:", error));

    return new Promise<ShareChoice | null>((resolve) => {
      let done = false;
      let handle: OverlayHandle | null = null;
      const finish = (choice: ShareChoice | null) => {
        if (done) return;
        done = true;
        void pictures(false);
        handle?.close();
        if (choice && store.getSnapshot().quiet) quietWhileSharing();
        resolve(choice);
      };
      handle = deps.open(
        {
          title: "Share",
          width: layout.size.width,
          height: layout.size.height,
          surface: { layer: "overlay", keyboard: "exclusive", namespace: "dashi.share-picker", output: output.name },
        },
        <SharePicker
          store={store}
          layout={layout}
          screens={outputs.map((each) => ({ output: each.name }))}
          windows={shareable.map((window) => ({ toplevel: window.toplevel, title: window.title, app: deps.appName(window) }))}
          onDone={finish}
        />,
        () => finish(null),
      );
      abort.addEventListener("abort", () => finish(null), { once: true });
      void pictures(true);
    });
  };

  const stop = serveSharePicker(path, ask);
  return () => {
    stop();
    stopQuiet?.();
  };
}
