/**
 * What the GitHub extension asks of GitHub's REST API: public data without a
 * token, a person's own with one. Only `api.github.com` (applet.json's
 * permission); links open on github.com in the browser, by the shell.
 */

import { isRecord } from "@dashi/shape";

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  url: string;
  branch: string;
  sha: string;
  draft: boolean;
  body: string;
  updated: string;
  labels: string[];
}

export interface Repository {
  fullName: string;
  description: string;
  stars: number;
  url: string;
}

export type Checks = "pass" | "fail" | "running" | "none";

const API = "https://api.github.com";

/** An object's field as words, or "". */
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const record = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

async function get(path: string, token: string | undefined): Promise<unknown> {
  const response = await fetch(`${API}${path}`, {
    headers: { accept: "application/vnd.github+json", "user-agent": "Dashi-GitHub-extension", ...(token ? { authorization: `Bearer ${token}` } : {}) },
  });
  if (response.status === 401) throw new Error("GitHub didn't take the token: set it again");
  if (response.status === 403 || response.status === 429)
    throw new Error(token ? "GitHub's rate limit: try again in a while" : "GitHub's limit for public use: set a token for more");
  if (response.status === 404) throw new Error("GitHub has no such repository (or it is private: set a token)");
  if (!response.ok) throw new Error(`GitHub said ${response.status}`);
  return response.json();
}

export async function pullRequests(repo: string, token: string | undefined): Promise<PullRequest[]> {
  const body = await get(`/repos/${repo}/pulls?state=open&per_page=30&sort=updated&direction=desc`, token);
  return (Array.isArray(body) ? body : []).map((raw) => {
    const item = record(raw);
    const head = record(item.head);
    return {
      number: typeof item.number === "number" ? item.number : 0,
      title: text(item.title) || "Untitled",
      author: text(record(item.user).login),
      url: text(item.html_url),
      branch: text(head.ref),
      sha: text(head.sha),
      draft: item.draft === true,
      body: text(item.body),
      updated: text(item.updated_at),
      labels: (Array.isArray(item.labels) ? item.labels : []).map((label) => text(record(label).name)).filter(Boolean),
    };
  });
}

export async function searchRepositories(query: string, token: string | undefined): Promise<Repository[]> {
  if (!query.trim()) return [];
  const body = record(await get(`/search/repositories?per_page=20&q=${encodeURIComponent(query.trim())}`, token));
  return (Array.isArray(body.items) ? body.items : []).map((raw) => {
    const item = record(raw);
    return {
      fullName: text(item.full_name),
      description: text(item.description),
      stars: typeof item.stargazers_count === "number" ? item.stargazers_count : 0,
      url: text(item.html_url),
    };
  });
}

/** The head commit's checks, as one word. */
export async function checksOf(repo: string, sha: string, token: string | undefined): Promise<Checks> {
  if (!sha) return "none";
  const body = record(await get(`/repos/${repo}/commits/${sha}/check-runs?per_page=50`, token));
  const runs = (Array.isArray(body.check_runs) ? body.check_runs : []).map(record);
  if (runs.length === 0) return "none";
  if (runs.some((run) => run.status !== "completed")) return "running";
  return runs.every((run) => ["success", "neutral", "skipped"].includes(text(run.conclusion))) ? "pass" : "fail";
}

/** "3 hours ago", "2 days ago": how long since `iso`. */
export function ago(iso: string, now: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((now - Date.parse(iso)) / 60_000));
  if (!Number.isFinite(minutes)) return "";
  if (minutes < 60) return minutes <= 1 ? "just now" : `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  const days = Math.round(hours / 24);
  return days === 1 ? "yesterday" : days < 31 ? `${days} days ago` : `${Math.round(days / 30)} mo ago`;
}

/** A repository name as a person types it: "owner/name". */
export const isRepo = (value: string): boolean => /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value.trim());
