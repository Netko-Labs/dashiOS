/**
 * Agents: first what each agent may do, what it did lately, and taking it
 * back (the consent dashboard, agents-consent.tsx); the sites they may use
 * without asking (agents-sites.tsx); letting them work alone for a set
 * time (agents-alone.tsx); then who answers the
 * launcher's Ask and what agents did (agents-answer.tsx). Privacy &
 * Security points here for agents, beside the apps' permissions.
 */

import type { PaneContext } from "../../context.ts";
import { Page } from "../../ui.tsx";
import { WorkAloneSection } from "./agents-alone.tsx";
import { AnswerSettings } from "./agents-answer.tsx";
import { ConsentDashboard } from "./agents-consent.tsx";
import { AgentSitesSection } from "./agents-sites.tsx";

export function AgentsPane({
  ctx,
}: {
  ctx: Pick<PaneContext, "grants" | "sites" | "alone" | "showAloneRecord" | "settings" | "flags" | "agents" | "answers" | "home" | "show">;
}) {
  return (
    <Page title="Agents">
      <ConsentDashboard ctx={ctx} />
      <AgentSitesSection sites={ctx.sites} />
      <WorkAloneSection ctx={ctx} />
      {ctx.answers && <AnswerSettings settings={ctx.settings} answers={ctx.answers} />}
    </Page>
  );
}
