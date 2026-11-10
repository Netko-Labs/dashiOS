/**
 * Settings › Agents, "Sites agents may use": sites the person allows ahead
 * of time, for every agent, so an agent working alone (an unattended demo)
 * opens them with no sheet (agents/sites.ts, sites.json's `person`). Add…
 * opens a field for an address or a host; Remove takes one off, and agents
 * ask for it again. Only this list adds to it: no agent can.
 */

import { Text, TextInput, View } from "@mirinjs/metal";
import { useState, useSyncExternalStore } from "react";
import { siteFromInput } from "../../../agents/sites.ts";
import { useColors } from "../../colors.ts";
import type { AheadSites } from "../../context.ts";
import { Button, Caption, Group, useSurface } from "../../ui.tsx";
import { Setting } from "../setting.tsx";

const NOTHING: readonly string[] = [];
const NONE = { subscribe: () => () => {}, ahead: () => NOTHING };

/** What the field holds, read as a site to add: the site, or why it can't be. */
export function siteToAdd(text: string, listed: readonly string[]): { site: string } | { problem: string | null } {
  if (!text.trim()) return { problem: null };
  const site = siteFromInput(text);
  if (!site) return { problem: "Type a site, like bodytech.com.co" };
  if (listed.includes(site)) return { problem: `${site} is on the list` };
  return { site };
}

function SiteRow({ site, onRemove }: { site: string; onRemove: () => void }) {
  const colors = useColors();
  return (
    <View testID={`agents-site:${site}`} style={{ flexDirection: "row", alignItems: "center", gap: 8, height: 28 }}>
      <View style={{ flex: 1, minWidth: 0 }}>
        <Text numberOfLines={1} style={{ fontSize: 12.5, color: colors.text }}>
          {site}
        </Text>
      </View>
      <Button testID={`agents-site-remove:${site}`} label="Remove" onPress={onRemove} />
    </View>
  );
}

export function AgentSitesSection({ sites }: { sites: AheadSites | undefined }) {
  const colors = useColors();
  const surface = useSurface();
  const source = sites ?? NONE;
  const listed = useSyncExternalStore(source.subscribe, source.ahead);
  const [adding, setAdding] = useState<string | null>(null);
  if (!sites) return null;
  const wanted = adding === null ? null : siteToAdd(adding, listed);
  const add = () => {
    if (!wanted || !("site" in wanted)) return;
    sites.allowAhead(wanted.site);
    setAdding(null);
  };
  return (
    <>
      <Group testID="agents-sites">
        <Setting id="agents/sites" stack>
          <View style={{ flexDirection: "column", gap: 4, alignSelf: "stretch" }}>
            {listed.map((site) => (
              <SiteRow key={site} site={site} onRemove={() => sites.forgetAhead(site)} />
            ))}
            {adding === null ? (
              <View style={{ flexDirection: "row" }}>
                <Button testID="agents-site-add" label="Add…" onPress={() => setAdding("")} />
              </View>
            ) : (
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                <View style={{ flex: 1, height: 28, justifyContent: "center", paddingHorizontal: 8, borderRadius: 8, backgroundColor: surface.field }}>
                  <TextInput
                    testID="agents-site-field"
                    value={adding}
                    autoFocus
                    placeholder="A site, like bodytech.com.co"
                    onChangeText={setAdding}
                    onSubmitEditing={add}
                    style={{ flex: 1, fontSize: 12, color: colors.text, placeholderColor: colors.textMuted, backgroundColor: "#00000000" }}
                  />
                </View>
                <Button testID="agents-site-add-button" label="Add" primary disabled={!wanted || !("site" in wanted)} onPress={add} />
                <Button testID="agents-site-cancel" label="Cancel" onPress={() => setAdding(null)} />
              </View>
            )}
            {wanted && "problem" in wanted && wanted.problem !== null && (
              <View testID="agents-site-problem">
                <Text style={{ fontSize: 11.5, color: colors.textMuted }}>{wanted.problem}</Text>
              </View>
            )}
          </View>
        </Setting>
      </Group>
      <Caption>A site covers its subdomains: bodytech.com.co is www.bodytech.com.co too. Agents still ask before they sign in or pay.</Caption>
    </>
  );
}
