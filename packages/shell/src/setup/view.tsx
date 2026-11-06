/**
 * The Setup Assistant's window: the page the flow is on, in the frame every
 * page shares. Each page changes the real settings as it is used (the same
 * stores System Settings has), so Continue only moves on and Back never
 * undoes anything.
 */

import { CHECK, ConfirmSheet, lightColors, TINTS } from "@dashi/ui";
import { useState, useSyncExternalStore } from "react";
import { CONTRAST } from "../control-center/glyphs.ts";
import { wifiGlyph } from "../glyphs.ts";
import { CLOCK, GLOBE, KEYBOARD, SPARKLE } from "../settings-app/glyphs.ts";
import { paneTitle } from "../settings-app/panes.ts";
import { useWifi } from "../wifi/store.ts";
import type { SetupContext } from "./context.ts";
import { DOWNLOAD, PACKAGE } from "./extras/glyphs.ts";
import { installingContinueLabel } from "./extras/words.ts";
import { PAGE_INFO, type PageId } from "./flow.ts";
import { Frame } from "./frame.tsx";
import { AgentsPage } from "./pages/agents.tsx";
import { AppearancePage } from "./pages/appearance.tsx";
import { DonePage } from "./pages/done.tsx";
import { ExtrasPage } from "./pages/extras.tsx";
import { InstallingPage } from "./pages/installing.tsx";
import { KeyboardPage } from "./pages/keyboard.tsx";
import { LanguagePage } from "./pages/language.tsx";
import { TimezonePage } from "./pages/timezone.tsx";
import { WelcomePage } from "./pages/welcome.tsx";
import { WifiPage } from "./pages/wifi.tsx";

/** The window's size. */
export const SETUP_WINDOW = { width: 700, height: 640 } as const;

/** Each page's tile: the same tint as its pane in System Settings (panes.ts), shiso only for Agents. */
const GLYPHS: Partial<Record<PageId, { glyph: string; tint: string }>> = {
  language: { glyph: GLOBE, tint: TINTS.mizu },
  keyboard: { glyph: KEYBOARD, tint: TINTS.goma },
  wifi: { glyph: wifiGlyph(3), tint: TINTS.mizu },
  timezone: { glyph: CLOCK, tint: TINTS.miso },
  appearance: { glyph: CONTRAST, tint: TINTS.nori },
  agents: { glyph: SPARKLE, tint: lightColors.agent },
  extras: { glyph: PACKAGE, tint: TINTS.kabocha },
  installing: { glyph: DOWNLOAD, tint: TINTS.kabocha },
  done: { glyph: CHECK, tint: TINTS.matcha },
};

function Page({ id, ctx }: { id: PageId; ctx: SetupContext }) {
  switch (id) {
    case "welcome":
      return <WelcomePage />;
    case "language":
      return <LanguagePage ctx={ctx} />;
    case "keyboard":
      return <KeyboardPage ctx={ctx} />;
    case "wifi":
      return <WifiPage ctx={ctx} />;
    case "timezone":
      return <TimezonePage ctx={ctx} />;
    case "appearance":
      return <AppearancePage ctx={ctx} />;
    case "agents":
      return <AgentsPage ctx={ctx} />;
    case "extras":
      return <ExtrasPage ctx={ctx} />;
    case "installing":
      return <InstallingPage ctx={ctx} />;
    case "done":
      return <DonePage ctx={ctx} />;
  }
}

export function SetupWindow({ ctx }: { ctx: SetupContext }) {
  const view = useSyncExternalStore(ctx.flow.subscribe, ctx.flow.getSnapshot);
  const wifi = useWifi(ctx.wifi);
  const extras = useSyncExternalStore(ctx.extras.subscribe, ctx.extras.getSnapshot);
  const style = GLYPHS[view.page];
  const connected = wifi.current !== null;
  const installs = ctx.extras.hasWork();
  // Skip Setup asks first, on a sheet over the page.
  const [asking, setAsking] = useState(false);
  const continueLabel =
    view.page === "welcome"
      ? "Get Started"
      : view.last
        ? "Done"
        : view.page === "wifi" && !connected
          ? "Not now"
          : view.page === "extras" && installs
            ? "Install"
            : view.page === "installing"
              ? installingContinueLabel(extras.run)
              : "Continue";
  const onContinue = (): void => {
    if (view.last) return ctx.finish("finished");
    if (view.page === "extras") {
      // Install shows the Installing page and starts; with nothing chosen it is passed by (unless a run is going).
      if (installs) {
        ctx.flow.setInstalling(true);
        void ctx.extras.start();
      } else if (extras.run.phase === "idle") {
        ctx.flow.setInstalling(false);
      }
    }
    ctx.flow.next();
  };
  return (
    <Frame
      info={PAGE_INFO[view.page]}
      view={view}
      bare={view.page === "welcome"}
      {...(style ? { glyph: style.glyph, tint: style.tint } : {})}
      continueLabel={continueLabel}
      hideBack={view.page === "installing" && extras.run.phase === "running"}
      onContinue={onContinue}
      onBack={() => ctx.flow.back()}
      onSkip={() => setAsking(true)}
      overlay={
        asking ? (
          <ConfirmSheet
            testID="setup-skip-sheet"
            title="Skip setup?"
            message={`What you chose so far stays. You can run Setup Assistant again from System Settings › ${paneTitle("about")}.`}
            confirmLabel="Skip Setup"
            onCancel={() => setAsking(false)}
            onConfirm={() => ctx.finish("skipped")}
          />
        ) : undefined
      }
    >
      <Page key={view.page} id={view.page} ctx={ctx} />
    </Frame>
  );
}
