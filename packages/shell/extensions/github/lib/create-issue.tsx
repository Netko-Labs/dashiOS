/**
 * Create Issue (store-v2 frame L8): a form the launcher draws (Repository,
 * Title, Description, Labels), with a draft kept if the launcher closes.
 * With a GitHub account connected (or a token pasted) ❖↩ files the issue and
 * the launcher closes with its link copied; without one it is a dry run: the
 * request is shown, nothing is sent, and Connect GitHub… is offered.
 */

import { Action, ActionPanel, Detail, Form, type FormValues, useLauncher, useNavigation, usePreferences, useQuery } from "@dashi/applet/launcher";
import { useState } from "react";
import { isRepo } from "./api.ts";
import { SettingsActions, useGitHubToken } from "./detail.tsx";
import { createIssue, type IssueDraft, issueRequest, labelsOf, myRepositories } from "./issues.ts";
import { lastRepository, rememberRepository } from "./last.ts";

const draftOf = (values: FormValues): IssueDraft => ({
  repo: typeof values.repo === "string" ? values.repo : "",
  title: typeof values.title === "string" ? values.title : "",
  body: typeof values.body === "string" ? values.body : "",
  labels: Array.isArray(values.labels) ? values.labels.filter((each): each is string => typeof each === "string") : [],
});

/** What a dry run shows: the request that would go, whole. */
function DryRun({ draft }: { draft: IssueDraft }) {
  const { url, body } = issueRequest(draft);
  return (
    <Detail
      markdown={`# Not sent: a dry run\n\nNo GitHub account is connected, so nothing went to GitHub. This is what Create Issue would send:\n\n\`\`\`\nPOST ${url}\n${JSON.stringify(body, null, 2)}\n\`\`\``}
      actions={
        <ActionPanel>
          <Action.ConnectAccount title="Connect GitHub…" provider="github.com" />
          <Action.Copy title="Copy the Request" content={JSON.stringify(body, null, 2)} shortcut="mod+c" />
        </ActionPanel>
      }
    />
  );
}

export function CreateIssue() {
  const { repo: preferred } = usePreferences<{ repo?: string }>();
  const token = useGitHubToken();
  const last = lastRepository() ?? (preferred && isRepo(preferred) ? preferred.trim() : "oven-sh/bun");
  const [repo, setRepo] = useState(last);
  const { data: mine } = useQuery(() => (token ? myRepositories(token) : Promise.resolve([])), [token]);
  const { data: labels } = useQuery(() => labelsOf(repo, token), [repo, token]);
  const { toast, close } = useLauncher();
  const { push } = useNavigation();
  const repos = [...new Set([last, ...(mine ?? [])])];
  const send = async (values: FormValues): Promise<void> => {
    const draft = draftOf(values);
    if (!token) return push(<DryRun draft={draft} />);
    toast("working", `Filing in ${draft.repo}…`);
    const issue = await createIssue(draft, token);
    rememberRepository(draft.repo);
    toast("done", `#${issue.number} filed`);
    close();
  };
  return (
    <Form
      draft
      actions={
        <ActionPanel>
          <Action.SubmitForm title={token ? "Create Issue" : "Create Issue (Dry Run)"} onSubmit={send} />
          <SettingsActions />
        </ActionPanel>
      }
    >
      <Form.Dropdown name="repo" title="Repository" value={last} info={repo === last ? "The last one you used" : undefined} onChange={setRepo}>
        {repos.map((each) => (
          <Form.Dropdown.Item key={each} title={each} value={each} />
        ))}
      </Form.Dropdown>
      <Form.TextField name="title" title="Title" placeholder="What is wrong, in a line" required max={256} />
      <Form.TextArea name="body" title="Description" placeholder="Steps, what you saw, what you expected" />
      <Form.TagPicker name="labels" title="Labels">
        {(labels ?? []).map((label) => (
          <Form.TagPicker.Item key={label} title={label} value={label} />
        ))}
      </Form.TagPicker>
      {!token && <Form.Description text="Not connected to GitHub: sending shows what would go, and sends nothing. Connect GitHub… is on ❖K." />}
    </Form>
  );
}
