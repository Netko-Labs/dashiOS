/**
 * Privacy & Security: every permission you gave, per app, with what it is
 * and since when, each taken back on its own; agents' "Always Allow"
 * answers are counted here and listed in Settings › Agents
 * (agents-consent.tsx), with what each agent did; the apps' answers xdg-desktop-portal keeps (the Access
 * dialog's camera, microphone, location and background, and screenshots,
 * the wallpaper, notifications: privacy/); and screen sharing: the programs
 * settings.json lets capture the screen directly, and the apps the portal
 * lets share it again without asking. A permission taken back is asked for
 * again the next time it is needed.
 */

import { useState, useSyncExternalStore } from "react";
import { byApp } from "../../../privacy/portal-grants.ts";
import type { AppGrant, AppGrants } from "../../../privacy/store.ts";
import { paneTitle } from "../../../shared/settings/panes.ts";
import { useClockPrefs } from "../../../shared/time/clock.ts";
import type { PaneContext } from "../../context.ts";
import { useGrantEntries, useSettings } from "../../hooks.ts";
import { Spot } from "../../spot.tsx";
import { Button, Caption, Group, Note, Page } from "../../ui.tsx";
import { agentPermissions, appTitle, grantDetail, lastUsedWords, programTitle, sinceWords } from "../privacy-words.ts";
import { Row as Item } from "../row.tsx";

type Installed = PaneContext["installedApp"];

const LOADING: AppGrants = { state: "loading" };
const UNAVAILABLE: AppGrants = { state: "unavailable" };
const NO_PRIVACY = { subscribe: () => () => {}, getSnapshot: (): AppGrants => UNAVAILABLE };

function Revoke({ testID, onPress, label = "Revoke" }: { testID: string; onPress: () => void; label?: string }) {
  return <Button testID={testID} label={label} onPress={onPress} />;
}

/** How many agents may do what without asking: "claude may do 3 things without asking". */
export function agentsSummary(agents: ReadonlyArray<{ title: string; scopes: readonly unknown[] }>): string {
  const kept = agents.filter((agent) => agent.scopes.length > 0);
  const [only] = kept;
  if (!only) return "Every agent asks before it does anything";
  if (kept.length === 1)
    return only.scopes.length === 1 ? `${only.title} may do 1 thing without asking` : `${only.title} may do ${only.scopes.length} things without asking`;
  return `${kept.length} agents may do things without asking`;
}

/** Agents: how many may act without asking, and the way to Settings › Agents, where each is listed and revoked. */
function AgentsSection({ grants, home, show }: Pick<PaneContext, "grants" | "home" | "show">) {
  const entries = useGrantEntries(grants);
  return (
    <Spot id="privacy/agents" cards>
      <Caption above>Agents</Caption>
      <Group testID="privacy-agents">
        <Item label={agentsSummary(agentPermissions(entries, home))} detail="What each may do, what it did lately, and Revoke.">
          <Button testID="privacy-agents-open" label={`${paneTitle("agents")}…`} onPress={() => show("agents", "permissions")} />
        </Item>
      </Group>
    </Spot>
  );
}

const detailProps = (detail: string | undefined): { detail?: string } => (detail === undefined ? {} : { detail });

/** One app's permissions, or one app's screen shares. */
function AppGroup({
  name,
  app,
  grants,
  testID,
  onRevoke,
}: {
  name: string;
  app: string;
  grants: readonly AppGrant[];
  testID: string;
  onRevoke: (grant: AppGrant) => void;
}) {
  const prefs = useClockPrefs();
  const now = new Date();
  return (
    <Group testID={`${testID}:${app}`}>
      <Item label={name} {...detailProps(app === "" ? "Apps that aren't sandboxed share one answer." : undefined)} />
      {grants.map((grant) => (
        <Item
          key={`${grant.table}/${grant.id}`}
          testID={`${testID}-grant:${app}:${grant.table}/${grant.id}`}
          label={grant.what}
          {...detailProps(grantDetail([sinceWords(grant.since, now, prefs.locale), lastUsedWords(grant.lastUsed, now, prefs.locale)]))}
        >
          <Revoke testID={`${testID}-revoke:${app}:${grant.table}/${grant.id}`} onPress={() => onRevoke(grant)} />
        </Item>
      ))}
    </Group>
  );
}

export function PrivacyPane({
  grants,
  home,
  privacy,
  settings,
  installedApp,
  show,
}: Pick<PaneContext, "grants" | "home" | "privacy" | "settings" | "installedApp" | "show">) {
  const source = privacy ?? NO_PRIVACY;
  const apps = useSyncExternalStore(source.subscribe, source.getSnapshot) ?? LOADING;
  const { screenSharing } = useSettings(settings).data;
  const [done, setDone] = useState<{ section: "apps" | "screen"; words: string } | null>(null);
  const installed: Installed = installedApp;
  const nameOf = (app: string) => appTitle(app, installed);
  const ready = apps.state === "ready" ? apps.grants : [];
  const portal = byApp(
    ready.filter((grant) => !grant.screen),
    nameOf,
  );
  const shares = byApp(
    ready.filter((grant) => grant.screen),
    nameOf,
  );
  const clients = screenSharing.clients ?? [];
  const revokeApp = (section: "apps" | "screen") => (grant: AppGrant) => {
    void privacy
      ?.revoke(grant)
      .then(() => setDone({ section, words: `${nameOf(grant.app)} can no longer ${grant.what.toLowerCase()}. It asks again when it needs to.` }))
      .catch(() => setDone({ section, words: `That permission couldn't be taken back. Try again.` }));
  };
  const removeClient = (path: string) => {
    settings.patch("screenSharing", { clients: clients.filter((client) => client !== path) });
    setDone({ section: "screen", words: `${programTitle(path, installed)} can no longer capture the screen.` });
  };

  return (
    <Page title="Privacy">
      <AgentsSection grants={grants} home={home} show={show} />

      <Spot id="privacy/apps" cards>
        <Caption above>Apps</Caption>
        {apps.state === "ready" && portal.length > 0 ? (
          portal.map((group) => <AppGroup key={group.app} testID="privacy-app" {...group} onRevoke={revokeApp("apps")} />)
        ) : (
          <Group testID="privacy-apps-none">
            <Note>
              {apps.state === "loading"
                ? "Looking…"
                : apps.state === "unavailable"
                  ? "Apps' permissions can't be read on this computer."
                  : "No app has been given a permission. When one asks for the camera, your location, or to run in the background, your answer is listed here."}
            </Note>
          </Group>
        )}
      </Spot>
      <Caption>{done?.section === "apps" ? done.words : "An app asks again the next time it needs what you take back."}</Caption>

      <Spot id="privacy/screen-sharing" cards>
        <Caption above>Screen sharing</Caption>
        {clients.length === 0 && shares.length === 0 ? (
          <Group testID="privacy-screen-none">
            <Note>Every app asks before it shares your screen.</Note>
          </Group>
        ) : (
          <>
            {clients.length > 0 && (
              <Group testID="privacy-screen-clients">
                {clients.map((path) => (
                  <Item
                    key={path}
                    testID={`privacy-screen-client:${path}`}
                    label={programTitle(path, installed)}
                    detail={`Captures the screen without asking · ${path}`}
                  >
                    <Revoke testID={`privacy-screen-client-remove:${path}`} label="Remove" onPress={() => removeClient(path)} />
                  </Item>
                ))}
              </Group>
            )}
            {shares.map((group) => (
              <AppGroup key={group.app} testID="privacy-share" {...group} onRevoke={revokeApp("screen")} />
            ))}
          </>
        )}
      </Spot>
      <Caption>{done?.section === "screen" ? done.words : "The menu bar shows whenever the screen is being shared."}</Caption>
    </Page>
  );
}
