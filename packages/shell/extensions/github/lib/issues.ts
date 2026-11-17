/**
 * Create Issue's side of GitHub's REST API (store-v2 frame L8): the
 * repositories the person can file in, a repository's labels, and the issue
 * sent. Without an account it is a dry run: what would be sent, shown, and
 * nothing sent (`issueRequest` is that request, whole).
 */

import { isRecord } from "@dashi/shape";
import { fit } from "./api.ts";

export const API = "https://api.github.com";

export interface IssueDraft {
  repo: string;
  title: string;
  body: string;
  labels: readonly string[];
}

/** The request Create Issue sends: where, and what (GitHub's own field names). */
export function issueRequest(draft: IssueDraft, api = API): { url: string; body: { title: string; body?: string; labels?: string[] } } {
  return {
    url: `${api}/repos/${draft.repo}/issues`,
    body: { title: draft.title.trim(), ...(draft.body.trim() ? { body: draft.body } : {}), ...(draft.labels.length > 0 ? { labels: [...draft.labels] } : {}) },
  };
}

const headers = (token: string | undefined): Record<string, string> => ({
  accept: "application/vnd.github+json",
  "user-agent": "Dashi-GitHub-extension",
  ...(token ? { authorization: `Bearer ${token}` } : {}),
});

/** Sends the issue: its number and address, or GitHub's reason in words. */
export async function createIssue(draft: IssueDraft, token: string, fetcher: typeof fetch = fetch, api = API): Promise<{ number: number; url: string }> {
  const { url, body } = issueRequest(draft, api);
  const reply = await fetcher(url, { method: "POST", headers: { ...headers(token), "content-type": "application/json" }, body: JSON.stringify(body) });
  const answer: unknown = await reply.json().catch(() => ({}));
  if (!reply.ok) {
    const message = isRecord(answer) && typeof answer.message === "string" ? answer.message : `GitHub said ${reply.status}`;
    throw new Error(reply.status === 404 ? `${draft.repo} isn't there, or the account can't file issues in it` : message);
  }
  if (!isRecord(answer) || typeof answer.number !== "number" || typeof answer.html_url !== "string") throw new Error("GitHub's answer wasn't an issue");
  return { number: answer.number, url: answer.html_url };
}

async function list(path: string, token: string | undefined, fetcher: typeof fetch): Promise<Record<string, unknown>[]> {
  const reply = await fetcher(`${API}${path}`, { headers: headers(token) });
  if (!reply.ok) throw new Error(`GitHub said ${reply.status}`);
  const body: unknown = await reply.json();
  return (Array.isArray(body) ? body : []).filter(isRecord);
}

/** The repositories the account pushed to last, newest first. */
export async function myRepositories(token: string, fetcher: typeof fetch = fetch): Promise<string[]> {
  const repos = await list("/user/repos?sort=pushed&per_page=30&affiliation=owner,collaborator,organization_member", token, fetcher);
  return repos.map((repo) => (typeof repo.full_name === "string" ? repo.full_name : "")).filter(Boolean);
}

/** A repository's labels' names (public repositories need no token). */
export async function labelsOf(repo: string, token: string | undefined, fetcher: typeof fetch = fetch): Promise<string[]> {
  if (!repo) return [];
  const labels = await list(`/repos/${repo}/labels?per_page=50`, token, fetcher);
  return labels.map((label) => fit(typeof label.name === "string" ? label.name : "", 60)).filter(Boolean);
}
