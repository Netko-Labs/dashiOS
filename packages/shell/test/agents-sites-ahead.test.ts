/**
 * Sites the person allows ahead of time (agents/sites.ts, Settings ›
 * Agents' "Sites agents may use"): kept in sites.json beside the agents'
 * own answers, used by every agent with no sheet, and never added to by an
 * agent's answer.
 */

import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parsePersonSites, SiteConsent, SiteGrants, siteFromInput } from "../src/agents/sites.ts";
import { siteToAdd } from "../src/settings-app/panes/agents-sites.tsx";

test("what the person types becomes a site: an address or a host, without www", () => {
  expect(siteFromInput("bodytech.com.co")).toBe("bodytech.com.co");
  expect(siteFromInput(" https://www.Bodytech.com.co/clases?x=1 ")).toBe("bodytech.com.co");
  expect(siteFromInput("signin.localhost")).toBe("signin.localhost");
  expect(siteFromInput("localhost")).toBe("localhost");
  for (const bad of ["", "bodytech", "two words.com", "file:///etc/passwd", "javascript:alert(1)"]) expect(siteFromInput(bad)).toBeNull();
  expect(siteToAdd("", [])).toEqual({ problem: null });
  expect(siteToAdd("bodytech", [])).toEqual({ problem: "Type a site, like bodytech.com.co" });
  expect(siteToAdd("www.bodytech.com.co", ["bodytech.com.co"])).toEqual({ problem: "bodytech.com.co is on the list" });
  expect(siteToAdd("example.com", ["bodytech.com.co"])).toEqual({ site: "example.com" });
});

test("the person's list is kept in sites.json beside the agents' answers, and read back", () => {
  const path = join(mkdtempSync(join(tmpdir(), "dashi-sites-")), "sites.json");
  writeFileSync(path, JSON.stringify({ version: 1, agents: { "claude-code": { "example.com": 5 } } }));
  const sites = new SiteGrants(path);
  let heard = 0;
  sites.subscribe(() => heard++);
  sites.allowAhead("bodytech.com.co", 100);
  sites.allowAhead("bodytech.com.co", 200);
  expect(heard).toBe(1);
  expect(sites.ahead()).toEqual(["bodytech.com.co"]);
  const saved = JSON.parse(readFileSync(path, "utf8"));
  expect(saved).toEqual({ version: 1, agents: { "claude-code": { "example.com": 5 } }, person: { "bodytech.com.co": 100 } });
  expect(new SiteGrants(path).ahead()).toEqual(["bodytech.com.co"]);
  sites.forgetAhead("bodytech.com.co");
  expect(new SiteGrants(path).ahead()).toEqual([]);
  // A hand-edited file's junk is left out.
  expect([...parsePersonSites({ person: { "ok.com": 1, "not a site": 2, "https://x.com": 3 } }).keys()]).toEqual(["ok.com"]);
  expect(parsePersonSites({ person: ["ok.com"] }).size).toBe(0);
});

test("every agent uses a site on the list with no sheet; an agent's Always Allow never adds to it", async () => {
  const sites = new SiteGrants(null);
  sites.allowAhead("bodytech.com.co");
  const asked: string[] = [];
  const consent = new SiteConsent(
    sites,
    () => "codex",
    async (site) => {
      asked.push(site);
      return "always";
    },
  );
  expect(await consent.allow("login.bodytech.com.co")).toBe(true);
  expect(await consent.allow("bodytech.com.co")).toBe(true);
  expect(asked).toEqual([]);
  expect(await consent.allow("example.com")).toBe(true);
  expect(asked).toEqual(["example.com"]);
  // Kept for that agent, not on the person's list.
  expect(sites.ahead()).toEqual(["bodytech.com.co"]);
  expect(sites.has("codex", "example.com")).toBe(true);
  expect(sites.has("claude-code", "example.com")).toBe(false);
  // Off the list, it is asked about again.
  sites.forgetAhead("bodytech.com.co");
  expect(
    new SiteConsent(
      sites,
      () => "claude-code",
      async () => null,
    ).has("bodytech.com.co"),
  ).toBe(false);
});
