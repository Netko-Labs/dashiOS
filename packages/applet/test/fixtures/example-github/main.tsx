import { defineApplet } from "@dashi/applet";
import { Action, ActionPanel, Detail, keepAnswers, List, usePreferences, useQuery } from "@dashi/applet/launcher";

export interface PullRequest {
  number: number;
  title: string;
  repo: string;
  url: string;
  draft: boolean;
  reviewRequested: boolean;
  body: string;
}

/** Asks GitHub for your open pull requests and the ones waiting on your review. */
export async function myPullRequests(token: string, orgs: string[]): Promise<PullRequest[]> {
  const scope = orgs.map((org) => ` org:${org}`).join("");
  const queries = [`is:open is:pr author:@me${scope}`, `is:open is:pr review-requested:@me${scope}`];
  const pages = await Promise.all(
    queries.map(async (q) => {
      const response = await fetch(`https://api.github.com/search/issues?per_page=30&q=${encodeURIComponent(q)}`, {
        headers: { authorization: `Bearer ${token}`, accept: "application/vnd.github+json", "user-agent": "dashi-example" },
      });
      if (!response.ok) throw new Error(response.status === 401 ? "GitHub didn't take the token" : `GitHub said ${response.status}`);
      const body: { items?: Array<Record<string, unknown>> } = await response.json();
      return (body.items ?? []).map((item) => ({
        number: Number(item.number),
        title: String(item.title),
        repo: String(item.repository_url).split("/").pop() ?? "",
        url: String(item.html_url),
        draft: item.draft === true,
        reviewRequested: q.includes("review-requested"),
        body: typeof item.body === "string" ? item.body : "",
      }));
    }),
  );
  return pages.flat();
}

function PullRequestDetail({ pr }: { pr: PullRequest }) {
  return (
    <Detail
      markdown={`# ${pr.title}\n\n${pr.body}`}
      metadata={
        <Detail.Metadata>
          <Detail.Metadata.TagList title="State">
            <Detail.Metadata.TagList.Item text={pr.draft ? "Draft" : "Open"} tone={pr.draft ? "secondary" : "moss"} />
          </Detail.Metadata.TagList>
          <Detail.Metadata.Link title="Link" text={`${pr.repo}#${pr.number}`} target={pr.url} />
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

function Row({ pr }: { pr: PullRequest }) {
  return (
    <List.Item
      id={`${pr.repo}#${pr.number}`}
      title={pr.title}
      subtitle={`${pr.repo} #${pr.number}`}
      keywords={[pr.repo, String(pr.number)]}
      accessories={pr.draft ? [{ tag: "Draft", tone: "secondary" }] : []}
      actions={
        <ActionPanel title={`#${pr.number} · ${pr.title}`}>
          <Action.Open title="Open in Browser" target={pr.url} />
          <Action.Push title="Show Details" target={<PullRequestDetail pr={pr} />} />
          <ActionPanel.Section title="Copy">
            <Action.Copy title="Copy Link" content={pr.url} shortcut="mod+c" />
          </ActionPanel.Section>
        </ActionPanel>
      }
    />
  );
}

const ANSWERS = keepAnswers<PullRequest[]>("5m");

export function MyPullRequests() {
  const { token, orgs } = usePreferences<{ token?: string; orgs?: string }>();
  const wanted = (orgs ?? "")
    .split(",")
    .map((org) => org.trim())
    .filter(Boolean);
  const { data, loading, error, reload } = useQuery(() => (token ? myPullRequests(token, wanted) : Promise.resolve([])), [token, orgs], { keep: ANSWERS });
  if (!token)
    return (
      <List>
        <List.EmptyView
          title="GitHub needs a token for your pull requests"
          description="Paste one; Dashi keeps it in the Secret Service"
          actions={
            <ActionPanel>
              <Action.SetPreference title="Use a GitHub Token…" name="token" />
            </ActionPanel>
          }
        />
      </List>
    );
  if (error)
    return (
      <List>
        <List.EmptyView
          title="Couldn't reach GitHub"
          description={error.message}
          actions={
            <ActionPanel>
              <Action title="Try Again" onAction={reload} />
            </ActionPanel>
          }
        />
      </List>
    );
  const review = (data ?? []).filter((pr) => pr.reviewRequested);
  const mine = (data ?? []).filter((pr) => !pr.reviewRequested);
  return (
    <List filter="launcher" loading={loading} placeholder="Filter pull requests">
      <List.Section title="Review requested" subtitle={String(review.length)}>
        {review.map((pr) => (
          <Row key={pr.url} pr={pr} />
        ))}
      </List.Section>
      <List.Section title="Yours, open" subtitle={String(mine.length)}>
        {mine.map((pr) => (
          <Row key={pr.url} pr={pr} />
        ))}
      </List.Section>
    </List>
  );
}

export default defineApplet({ commands: { "my-prs": { view: MyPullRequests } } });
