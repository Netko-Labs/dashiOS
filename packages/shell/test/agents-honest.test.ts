import { describe, expect, test } from "bun:test";
import { type PageFacts, readOutcome } from "../browser-extension/src/page/outcome.ts";
import { changeWords, landingWords, outcomeWords } from "../src/agents/desktop/lib/browser-words.ts";
import { parseChanges, parseOutcome, parseProbe } from "../src/browser/index.ts";

const facts = (over: Partial<PageFacts>): PageFacts => ({
  urlBefore: "https://example.com/login",
  url: "https://example.com/login",
  fieldShows: true,
  codeShows: false,
  captcha: false,
  alerts: [],
  text: "Sign in",
  loading: false,
  ...over,
});

describe("a sign-in's outcome, from what the page shows", () => {
  test("signed in: the password field went and the address changed, once the page is quiet", () => {
    const after = facts({ url: "https://example.com/home", fieldShows: false });
    expect(readOutcome(after, "password", false, false)).toEqual({ kind: "pending" });
    expect(readOutcome(after, "password", true, false)).toEqual({ kind: "signed-in", how: "the password field is gone and the address changed" });
    expect(readOutcome(facts({ fieldShows: false }), "password", true, false)).toMatchObject({ how: expect.stringContaining("stayed the same") });
  });

  test("a wrong password is the site's own words; a code, a CAPTCHA and a block are told apart", () => {
    expect(readOutcome(facts({ alerts: ["The password you entered is incorrect."] }), "password", true, false)).toEqual({
      kind: "wrong",
      message: "The password you entered is incorrect.",
    });
    expect(readOutcome(facts({ alerts: ["La contraseña es incorrecta"] }), "password", true, false)).toMatchObject({ kind: "wrong" });
    expect(readOutcome(facts({ fieldShows: false, codeShows: true }), "password", true, false)).toMatchObject({ kind: "code" });
    expect(readOutcome(facts({ fieldShows: false, text: "Enter the code we sent you" }), "password", true, false)).toMatchObject({ kind: "code" });
    expect(readOutcome(facts({ captcha: true }), "password", false, false)).toEqual({ kind: "captcha" });
    expect(readOutcome(facts({ alerts: ["Too many attempts. Try later."] }), "password", true, false)).toMatchObject({ kind: "blocked" });
  });

  test("only when time is up: still loading, or nothing changed", () => {
    expect(readOutcome(facts({ loading: true }), "password", false, false)).toEqual({ kind: "pending" });
    expect(readOutcome(facts({ loading: true }), "password", false, true)).toEqual({ kind: "loading" });
    expect(readOutcome(facts({}), "password", true, true)).toEqual({ kind: "unchanged" });
  });

  test("each outcome is said with what to do next", () => {
    expect(outcomeWords({ kind: "captcha" }, 15)).toContain("hand_over");
    expect(outcomeWords({ kind: "loading" }, 15)).toContain("still loading after 15 s");
    expect(outcomeWords({ kind: "code", how: "a one-time code field shows" }, 15)).toContain("fill_code");
    expect(parseOutcome({ kind: "submitted" })).toBeNull();
    expect(parseOutcome({ kind: "wrong", message: "Bad\\npassword" })).toEqual({ kind: "wrong", message: "Bad\\npassword" });
  });
});

describe("what an action did", () => {
  test("a click that changed nothing says so; one that opened a dialog names it", () => {
    expect(changeWords(parseChanges({ changed: "none", still: true, now: 'button "Next"' }))).toBe('Nothing on the page changed. It is now: button "Next".');
    expect(changeWords(parseChanges({ changed: "near", still: false, dialog: "Sign in", appeared: "Added to cart" }))).toBe(
      "A dialog opened: “Sign in”. The page changed around it. New text: “Added to cart”. The element is gone from the page now.",
    );
    expect(changeWords(null)).toContain("read_page");
  });

  test("open_url says where it landed: a redirect, a sign-in page, a bot check", () => {
    const signIn = landingWords("https://facebook.com/marketplace", "https://www.facebook.com/login/?next=x", parseProbe({ password: true }));
    expect(signIn).toMatchObject({ redirected: true, signIn: true });
    expect(signIn.words).toContain("sign-in page");
    expect(landingWords("https://example.com", "https://www.example.com/", parseProbe({}))).toEqual({ words: "", redirected: false, signIn: false });
    expect(landingWords("https://a.com", "https://a.com", parseProbe({ captcha: true })).words).toContain("CAPTCHA");
  });
});
