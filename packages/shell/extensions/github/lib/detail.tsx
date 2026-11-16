/** A pull request's detail (store-v2 frame L7): its description, and a facts column with its checks, branch and link. */

import { Action, ActionPanel, Detail, usePreferences, useQuery } from "@dashi/applet/launcher";
import { ago, type Checks, checksOf, type PullRequest } from "./api.ts";

const CHECKS: Record<Checks, { text: string; tone: "moss" | "ume" | "secondary" }> = {
  pass: { text: "Checks pass", tone: "moss" },
  fail: { text: "Failing", tone: "ume" },
  running: { text: "Running", tone: "secondary" },
  none: { text: "No checks", tone: "secondary" },
};

/** Where the person sets what the extension uses: the repository, and a token (kept in the Secret Service). */
export function SettingsActions() {
  return (
    <ActionPanel.Section title="GitHub">
      <Action.SetPreference title="Choose Repository…" name="repo" />
      <Action.SetPreference title="Use a GitHub Token…" name="token" />
    </ActionPanel.Section>
  );
}

export function PullRequestDetail({ repo, pr }: { repo: string; pr: PullRequest }) {
  const { token } = usePreferences<{ token?: string }>();
  const { data: checks } = useQuery(() => checksOf(repo, pr.sha, token), [repo, pr.sha, token]);
  const shown = CHECKS[checks ?? "running"];
  return (
    <Detail
      markdown={`# ${pr.title}\n\n${pr.body.trim() || "No description."}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="Checks">
            <Detail.Metadata.TagList.Item text={checks ? shown.text : "Asking…"} tone={shown.tone} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Label title="Author" text={pr.author || "Unknown"} />
          <Detail.Metadata.Label title="Branch" text={pr.branch || "—"} />
          <Detail.Metadata.Label title="Updated" text={ago(pr.updated) || "—"} />
          <Detail.Metadata.Separator />
          <Detail.Metadata.Link title="Link" text={`${repo}#${pr.number}`} target={pr.url} />
        </Detail.Metadata>
      }
      actions={
        <ActionPanel>
          <Action.Open title="Open in Browser" target={pr.url} />
          <Action.Copy title="Copy Link" content={pr.url} shortcut="mod+c" />
        </ActionPanel>
      }
    />
  );
}
