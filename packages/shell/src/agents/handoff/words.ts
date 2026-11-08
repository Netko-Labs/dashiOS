/**
 * A task's steps in Dashi's words, from the tool and its arguments (never
 * the model's): "Opening bodytech.com.co" while it runs, "Opened
 * bodytech.com.co" once it has. The card in the menu bar's panel shows the
 * last three; the chip shows the one going on.
 */

type Input = Readonly<Record<string, unknown>>;

const text = (value: unknown, most = 40): string | null => {
  if (typeof value !== "string" && typeof value !== "number") return null;
  const words = String(value).replace(/\s+/g, " ").trim();
  if (!words) return null;
  return words.length > most ? `${words.slice(0, most - 1)}…` : words;
};

/** A site's host from what an agent named (an address or a host), without www. */
export function hostOf(value: unknown): string | null {
  if (typeof value !== "string" || !value.trim()) return null;
  try {
    const url = new URL(value.includes("://") ? value : `https://${value}`);
    return url.hostname.replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** [while it runs, once it ran] for each of Dashi's tools a task uses most. */
function pair(tool: string, input: Input): readonly [string, string] | null {
  const site = hostOf(input.site) ?? hostOf(input.url);
  switch (tool) {
    case "open_url":
      return site ? [`Opening ${site}`, `Opened ${site}`] : ["Opening a page", "Opened a page"];
    case "read_page":
      return ["Reading the page", "Read the page"];
    case "click_element":
      return ["Clicking on the page", "Clicked on the page"];
    case "fill_element":
      return ["Filling in a field", "Filled in a field"];
    case "select_option": {
      const value = text(input.value, 24);
      return value ? [`Choosing ${value}`, `Chose ${value}`] : ["Choosing an option", "Chose an option"];
    }
    case "press": {
      const keys = text(input.keys, 16);
      return keys ? [`Pressing ${keys}`, `Pressed ${keys}`] : ["Pressing keys", "Pressed keys"];
    }
    case "scroll_page":
      return ["Scrolling", "Scrolled"];
    case "list_tabs":
      return ["Looking at the tabs", "Looked at the tabs"];
    case "switch_tab":
      return ["Switching tabs", "Switched tabs"];
    case "list_logins":
      return ["Looking at your logins", "Looked at your logins"];
    case "sign_in":
      return site ? [`Signing in to ${site}`, `Signed in to ${site}`] : ["Signing in", "Signed in"];
    case "fill_code":
      return site ? [`Entering the code for ${site}`, `Entered the code for ${site}`] : ["Entering a code", "Entered a code"];
    case "pay": {
      const amount = text(input.amount, 12);
      const what = [site, amount ? `$${amount.replace(/^\$/, "")}` : null].filter(Boolean).join(" ");
      return what ? [`Paying ${what}`, `Paid ${what}`] : ["Paying", "Paid"];
    }
    case "hand_over": {
      const reason = text(input.reason, 48) ?? "your turn";
      return [`Waiting for you: ${reason}`, `You did: ${reason}`];
    }
    case "shell":
    case "Bash":
      return ["Running a command", "Ran a command"];
    default:
      return null;
  }
}

/** "Change a setting" → "Changing a setting": a title's first word as it goes on. */
function going(title: string): string {
  const [first = "", ...rest] = title.split(" ");
  const stem = first.toLowerCase();
  const ing = stem.endsWith("e") && !stem.endsWith("ee") ? `${stem.slice(0, -1)}ing` : `${stem}ing`;
  return [ing.charAt(0).toUpperCase() + ing.slice(1), ...rest].join(" ");
}

/**
 * A step's words: its own pair for Dashi's common tools, else the tool's
 * title from Dashi's catalog ("Change a setting"), else its name.
 */
export function stepWords(tool: string, input: Input, done: boolean, title?: string): string {
  const known = pair(tool, input);
  if (known) return done ? known[1] : known[0];
  if (title) return done ? title : going(title);
  const name = tool.replace(/^.*?\./, "").replace(/_/g, " ");
  return done ? `Used ${name}` : `Using ${name}`;
}

/** "Signing in to x" → "signing in to x", to follow "Claude Code is". */
export const lowerFirst = (words: string): string => (words ? words.charAt(0).toLowerCase() + words.slice(1) : words);

/** Words cut to `most` characters on a word, with an ellipsis. */
export function cut(words: string, most: number): string {
  const one = words.replace(/\s+/g, " ").trim();
  if (one.length <= most) return one;
  const head = one.slice(0, most - 1);
  const space = head.lastIndexOf(" ");
  return `${(space > most / 2 ? head.slice(0, space) : head).replace(/[\s,.;:]+$/, "")}…`;
}
