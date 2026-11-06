/**
 * Privacy & Security: every permission you gave, per agent or app, with
 * what it is and since when, each taken back on its own. Agents' "Always
 * Allow" answers (agents/consent.ts: revoking one cuts it off a live
 * connection too); the apps' answers xdg-desktop-portal keeps (the Access
 * dialog's camera, microphone, location and background, and screenshots,
 * the wallpaper, notifications: privacy/); and screen sharing: the programs
 * settings.json lets capture the screen directly, and the apps the portal
 * lets share it again without asking. A permission taken back is asked for
 * again the next time it is needed.
 */

import { useState, useSyncExternalStore } from "react";
import type { Scope } from "../../agents/consent.ts";
import { useClockPrefs } from "../../clock.ts";
import { byApp } from "../../privacy/portal-grants.ts";
import type { AppGrant, AppGrants } from "../../privacy/store.ts";
import type { PaneContext } from "../context.ts";
import { useGrantEntries, useSettings } from "../hooks.ts";
import { agentPermissions, appTitle, grantDetail, lastUsedWords, programTitle, sinceWords } from "../privacy-words.ts";
import { Button, Caption, Group, Item, Note, Page, Spot } from "../ui.tsx";

type Installed = PaneContext["installedApp"];

const LOADING: AppGrants = { state: "loading" };
const UNAVAILABLE: AppGrants = { state: "unavailable" };
const NO_PRIVACY = { subscribe: () => () => {}, getSnapshot: (): AppGrants => UNAVAILABLE };

function Revoke({ testID, onPress, label = "Revoke" }: { testID: string; onPress: () => void; label?: string }) {
  return <Button testID={testID} label={label} onPress={onPress} />;
}

/** The agents and what each may do for good. */
function AgentsSection({ grants, home, onDone }: Pick<PaneContext, "grants" | "home"> & { onDone: (words: string) => void }) {
  const entries = useGrantEntries(grants);
  const prefs = useClockPrefs();
  const now = new Date();
  const agents = agentPermissions(entries, home);
  return (
    <>
      <Spot id="privacy/agents">
        <Caption above>Agents</Caption>
      </Spot>
      {agents.length === 0 ? (
        <Group testID="privacy-agents-none">
          <Note>No agent has been allowed for good. When one asks and you choose Always Allow, it is listed here.</Note>
        </Group>
      ) : (
        agents.map((agent) => (
          <Group key={agent.key} testID={`privacy-agent:${agent.key}`}>
            <Item label={agent.title} detail={agent.detail} />
            {agent.scopes.map(({ scope, label, since }) => (
              <Item key={scope} testID={`privacy-agent-scope:${agent.key}:${scope}`} label={label} {...detailProps(sinceWords(since, now, prefs.locale))}>
                <Revoke
                  testID={`privacy-agent-revoke:${agent.key}:${scope}`}
                  onPress={() => {
                    if (grants.revoke(agent.key, scope as Scope))
                      onDone(`${agent.title} can no longer ${label.toLowerCase()}. It asks again when it needs to.`);
                  }}
                />
              </Item>
            ))}
          </Group>
        ))
      )}
    </>
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

export function PrivacyPane({ grants, home, privacy, settings, installedApp }: Pick<PaneContext, "grants" | "home" | "privacy" | "settings" | "installedApp">) {
  const source = privacy ?? NO_PRIVACY;
  const apps = useSyncExternalStore(source.subscribe, source.getSnapshot) ?? LOADING;
  const { screenSharing } = useSettings(settings).data;
  const [done, setDone] = useState<{ section: "agents" | "apps" | "screen"; words: string } | null>(null);
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
    <Page title="Privacy & Security">
      <AgentsSection grants={grants} home={home} onDone={(words) => setDone({ section: "agents", words })} />
      <Caption>{done?.section === "agents" ? done.words : "Revoke takes a permission back at once, from a connected agent too."}</Caption>

      <Spot id="privacy/apps">
        <Caption above>Apps</Caption>
      </Spot>
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
      <Caption>{done?.section === "apps" ? done.words : "An app asks again the next time it needs what you take back."}</Caption>

      <Spot id="privacy/screen-sharing">
        <Caption above>Screen sharing</Caption>
      </Spot>
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
      <Caption>{done?.section === "screen" ? done.words : "The menu bar shows whenever the screen is being shared."}</Caption>
    </Page>
  );
}
