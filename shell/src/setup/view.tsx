/**
 * The Setup Assistant's window: the page the flow is on, in the frame every
 * page shares. Each page changes the real settings as it is used (the same
 * stores System Settings has), so Continue only moves on and Back never
 * undoes anything.
 */

import { useSyncExternalStore } from "react";
import { CONTRAST } from "../control-center/glyphs.ts";
import { CHECK, wifiGlyph } from "../glyphs.ts";
import { CLOCK, GLOBE, KEYBOARD, SPARKLE } from "../settings-app/glyphs.ts";
import { useWifi } from "../wifi/store.ts";
import type { SetupContext } from "./context.ts";
import { Frame } from "./frame.tsx";
import { type PageId, PAGE_INFO } from "./flow.ts";
import { AgentsPage } from "./pages/agents.tsx";
import { AppearancePage } from "./pages/appearance.tsx";
import { DonePage } from "./pages/done.tsx";
import { KeyboardPage } from "./pages/keyboard.tsx";
import { LanguagePage } from "./pages/language.tsx";
import { TimezonePage } from "./pages/timezone.tsx";
import { WelcomePage } from "./pages/welcome.tsx";
import { WifiPage } from "./pages/wifi.tsx";

/** The window's size. */
export const SETUP_WINDOW = { width: 700, height: 640 } as const;

const GLYPHS: Partial<Record<PageId, { glyph: string; tint: string }>> = {
  language: { glyph: GLOBE, tint: "#0a84ff" },
  keyboard: { glyph: KEYBOARD, tint: "#8e8e93" },
  wifi: { glyph: wifiGlyph(3), tint: "#0a84ff" },
  timezone: { glyph: CLOCK, tint: "#ff9f0a" },
  appearance: { glyph: CONTRAST, tint: "#5e5ce6" },
  agents: { glyph: SPARKLE, tint: "#6E56CF" },
  done: { glyph: CHECK, tint: "#3E8A72" },
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
      return <AgentsPage />;
    case "done":
      return <DonePage ctx={ctx} />;
  }
}

export function SetupWindow({ ctx }: { ctx: SetupContext }) {
  const view = useSyncExternalStore(ctx.flow.subscribe, ctx.flow.getSnapshot);
  const wifi = useWifi(ctx.wifi);
  const style = GLYPHS[view.page];
  const connected = wifi.current !== null;
  const continueLabel = view.page === "welcome" ? "Get Started" : view.last ? "Done" : view.page === "wifi" && !connected ? "Skip" : "Continue";
  return (
    <Frame
      info={PAGE_INFO[view.page]}
      view={view}
      bare={view.page === "welcome"}
      {...(style ? { glyph: style.glyph, tint: style.tint } : {})}
      continueLabel={continueLabel}
      onContinue={() => (view.last ? ctx.finish("finished") : ctx.flow.next())}
      onBack={() => ctx.flow.back()}
      onSkip={() => ctx.finish("skipped")}
    >
      <Page key={view.page} id={view.page} ctx={ctx} />
    </Frame>
  );
}
