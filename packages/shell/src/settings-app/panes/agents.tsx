/**
 * Agents: who answers the launcher's Ask, and what agents did (agents-answer.tsx).
 * What each agent may do for good, one permission at a time, is in
 * Privacy & Security (privacy.tsx), with the apps' permissions.
 */

import type { PaneContext } from "../context.ts";
import { paneTitle } from "../panes.ts";
import { Button, Group, Page, Setting } from "../ui.tsx";
import { AnswerSettings } from "./agents-answer.tsx";

export function AgentsPane({ settings, answers, show }: Pick<PaneContext, "settings" | "answers" | "show">) {
  return (
    <Page title="Agents">
      {answers && <AnswerSettings settings={settings} answers={answers} />}
      <Group>
        <Setting id="agents/permissions">
          <Button testID="agents-permissions" label={`${paneTitle("privacy")}…`} onPress={() => show("privacy", "agents")} />
        </Setting>
      </Group>
    </Page>
  );
}
