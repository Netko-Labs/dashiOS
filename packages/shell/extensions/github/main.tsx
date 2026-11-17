/**
 * GitHub, a first-party launcher extension written on Dashi's extension API
 * (docs/launcher-extensions.md): a repository's open pull requests (store-v2
 * frame L5), their actions (L6) and a pull request's detail (L7), and a
 * search for repositories. Public data without an account; a token the
 * person pastes (Use a GitHub Token…) is kept by Dashi in the Secret
 * Service, or a GitHub account connected (Dashi signs in; the token comes
 * over the channel). Create Issue is a form (frame L8).
 */

import { defineApplet } from "@dashi/applet";
import { Action, ActionPanel, List, useLauncher, usePreferences, useQuery } from "@dashi/applet/launcher";
import { useEffect, useState } from "react";
import { ago, fit, isRepo, type PullRequest, pullRequests, type Repository, searchRepositories } from "./lib/api.ts";
import { CreateIssue } from "./lib/create-issue.tsx";
import { PullRequestDetail, SettingsActions, useGitHubToken } from "./lib/detail.tsx";
import { PULL_REQUEST } from "./lib/glyphs.ts";

type Prefs = { repo?: string };

function Row({ repo, pr }: { repo: string; pr: PullRequest }) {
  return (
    <List.Item
      id={String(pr.number)}
      icon={{ svg: PULL_REQUEST, tone: pr.draft ? "tertiary" : "moss" }}
      title={pr.title}
      subtitle={`#${pr.number} · ${pr.author}`}
      keywords={[String(pr.number), pr.author, fit(pr.branch, 60), ...pr.labels].filter(Boolean).slice(0, 16)}
      accessories={[...(pr.draft ? [{ tag: "Draft", tone: "secondary" as const }] : []), { text: ago(pr.updated) }]}
      actions={
        <ActionPanel title={`#${pr.number} · ${pr.title}`}>
          <Action.Open title="Open in Browser" target={pr.url} />
          <Action.Push title="Show Details" target={<PullRequestDetail repo={repo} pr={pr} />} />
          <ActionPanel.Section title="Copy">
            <Action.Copy title="Copy Link" content={pr.url} shortcut="mod+c" />
            <Action.Copy title="Copy Branch Name" content={pr.branch} shortcut="shift+mod+c" />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

/** One repository's open pull requests: the preference's, or one a search pushed. */
export function PullRequests({ repo: given }: { repo?: string }) {
  const { repo: preferred } = usePreferences<Prefs>();
  const token = useGitHubToken();
  const repo = given ?? (preferred && isRepo(preferred) ? preferred.trim() : "oven-sh/bun");
  const { data, loading, error, reload } = useQuery(() => pullRequests(repo, token), [repo, token]);
  const { toast } = useLauncher();
  useEffect(() => {
    if (!token) toast("done", "Public data only: ❖K › Connect GitHub…");
  }, [token, toast]);
  if (error)
    return (
      <List>
        <List.EmptyView
          title="Couldn't reach GitHub"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Try Again" onAction={reload} />
              <SettingsActions />
            </ActionPanel>
          }
        />
      </List>
    );
  const prs = data ?? [];
  return (
    <List
      filter="launcher"
      loading={loading}
      placeholder={`Filter ${repo}'s pull requests`}
      actions={
        <ActionPanel>
          <SettingsActions />
        </ActionPanel>
      }
    >
      {/* No count until the list came: an empty subtitle is refused, and the whole view with it (pass 43). */}
      <List.Section title={`Open in ${repo}`} {...(loading && !data ? {} : { subtitle: String(prs.length) })}>
        {prs.map((pr) => (
          <Row key={pr.number} repo={repo} pr={pr} />
        ))}
      </List.Section>
      {!loading && prs.length === 0 && <List.EmptyView title={`No open pull requests in ${repo}`} />}
    </List>
  );
}

function RepoRow({ repo }: { repo: Repository }) {
  return (
    <List.Item
      id={repo.fullName}
      title={repo.fullName}
      // A repository without a description has no subtitle: an empty one is refused, and the whole search with it.
      {...(repo.description ? { subtitle: repo.description } : {})}
      accessories={[{ text: `★ ${repo.stars.toLocaleString("en")}` }]}
      actions={
        <ActionPanel title={repo.fullName}>
          <Action.Push title="Show Pull Requests" target={<PullRequests repo={repo.fullName} />} />
          <Action.Open title="Open in Browser" target={repo.url} />
          <Action.Copy title="Copy Link" content={repo.url} shortcut="mod+c" />
        </ActionPanel>
      }
    />
  );
}

function SearchRepositories() {
  const token = useGitHubToken();
  const [query, setQuery] = useState("");
  const [asked, setAsked] = useState("");
  // Asked a moment after the typing stops, so GitHub isn't asked for every letter.
  useEffect(() => {
    const timer = setTimeout(() => setAsked(query), 350);
    return () => clearTimeout(timer);
  }, [query]);
  const { data, loading, error } = useQuery(() => searchRepositories(asked, token), [asked, token]);
  return (
    <List filter="extension" loading={loading && asked !== ""} placeholder="Search repositories on GitHub" onSearchTextChange={setQuery}>
      {(data ?? []).map((repo) => (
        <RepoRow key={repo.fullName} repo={repo} />
      ))}
      {error && <List.EmptyView title="Couldn't reach GitHub" description={error.message} />}
      {!error && asked === "" && <List.EmptyView title="Type a repository's name" description="Public repositories; private ones with a token" />}
    </List>
  );
}

export default defineApplet({
  commands: {
    "pull-requests": { view: () => <PullRequests /> },
    "search-repos": { view: SearchRepositories },
    "create-issue": { view: () => <CreateIssue /> },
  },
});
