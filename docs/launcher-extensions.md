# Launcher extensions

A launcher extension adds commands to Dashi's launcher whose views Dashi
draws: a list (with a preview column beside it), a grid, a detail, a form,
with actions on ❖K. The extension never
draws a pixel. It runs in its own sandboxed process, renders React
components into a small tree of data, and the launcher draws that tree in its
own rows, type, keys and colours, in Light and Dark. This is version 6 of the
applets channel (`docs/applets.md`); everything else (the manifest, the
package, signing, the catalog, the sandbox, the consent sheet) is the
applets' own.

Dashi's own Emoji and GitHub are written this way
(`packages/shell/extensions/`), and so is the example below
(`packages/applet/test/fixtures/example-github/`, built and run by
`packages/applet/test/launcher-example.test.tsx`).

## The example

`applet.json`:

```json
{
  "id": "dev.example.github",
  "name": "GitHub",
  "version": "1.4.0",
  "dashi": ">=0.9",
  "entry": "main.tsx",
  "summary": "Your pull requests, issues and repositories, from the launcher.",
  "author": { "name": "Alex Kim", "url": "https://github.com/alexk" },
  "license": "MIT",
  "source": "https://github.com/alexk/dashi-github",
  "categories": ["developer"],
  "shows": ["launcher"],
  "permissions": ["network:api.github.com", "account:github.com"],
  "accounts": [{ "provider": "github.com", "scopes": ["repo"] }],
  "preferences": [
    { "name": "token", "type": "secret", "title": "GitHub token", "description": "Instead of connecting an account." },
    { "name": "orgs", "type": "text", "title": "Only these organisations", "default": "" }
  ],
  "commands": [{ "id": "my-prs", "title": "My Pull Requests", "keywords": ["pr", "review"], "mode": "list" }]
}
```

`main.tsx` (abridged; the whole file is the fixture):

```tsx
import { defineApplet } from "@dashi/applet";
import { Action, ActionPanel, Detail, keepAnswers, List, usePreferences, useQuery } from "@dashi/applet/launcher";

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
  const { data, loading, error, reload } = useQuery(() => myPullRequests(token ?? "", split(orgs)), [token, orgs], { keep: ANSWERS });
  if (!token)
    return (
      <List>
        <List.EmptyView title="GitHub needs a token for your pull requests" description="Paste one; Dashi keeps it in the Secret Service"
          actions={<ActionPanel><Action.SetPreference title="Use a GitHub Token…" name="token" /></ActionPanel>} />
      </List>
    );
  …
  return (
    <List filter="launcher" loading={loading} placeholder="Filter pull requests">
      <List.Section title="Review requested" subtitle={String(review.length)}>{review.map((pr) => <Row key={pr.url} pr={pr} />)}</List.Section>
      <List.Section title="Yours, open" subtitle={String(mine.length)}>{mine.map((pr) => <Row key={pr.url} pr={pr} />)}</List.Section>
    </List>
  );
}

export default defineApplet({ commands: { "my-prs": { view: MyPullRequests } } });
```

The loop is the applets' own: `dashi-applet new` (then make the manifest's
commands `list`, `grid` or `detail`), `bun run dev` (the commands appear in
the launcher with a DEV tag), `bun run pack`, `bun run publish`.

## What a developer writes

- **Commands** in `applet.json` with `"mode": "list"`, `"grid"`,
  `"detail"` or `"form"`, and in `defineApplet({ commands: { id: { view: Component } } })`
  a component for each. The component gets `{ query, args }`.
- **`"shows": ["launcher"]`** for an extension that is only commands: it is
  not started at login, has no menu bar item, and runs while it is used
  ("When it runs").
- **Preferences** (`preferences` in `applet.json`: `text`, `secret`,
  `checkbox`, `dropdown` (with `options`: `{title, value}`), each with
  `name`, `title`, `description`?, `required`?, `default`?). Dashi keeps them: words and switches in
  `~/.local/share/dashi/applet-data/<id>.prefs.json`, a `secret` in the
  Secret Service under the extension's id, never on disk. Read them with
  `usePreferences()`; `Action.SetPreference` asks the person in the field (a
  secret's field shows dots), and the view renders again with the new value.
  The Store's Settings… for the extension (frame S5) shows and changes them
  too; a command opened after reads the new values.
- **Accounts** (`accounts` in `applet.json`, each with its `account:PROVIDER`
  permission): Dashi signs the person in (OAuth with PKCE, in Helium), keeps
  the token in the Secret Service, and hands it over the channel; read it
  with `useAccount("github.com")` (`{connected, login, token}`).
  `Action.ConnectAccount` connects from the launcher: the first time it asks
  one question in the field ("Sign in to GitHub for GitHub?", ↩ Sign In),
  then the browser opens; where Dashi has no app for the provider in this
  build, it asks for a token to paste instead (checked with the provider
  before it is kept). Settings… in the Store has Connect…, Paste a Token…
  and Disconnect. GitHub is the one provider so far; Claude's and ChatGPT's
  subscriptions are refused (decisions.md D460).

### Components (`@dashi/applet/launcher`)

Named as Raycast names them, on purpose.

| Component | Props | Draws as |
| --- | --- | --- |
| `List` | `filter` (`"launcher"`: Dashi filters by title, subtitle, keywords; `"extension"`: you get `onSearchTextChange` and send the rows), `placeholder`, `loading`, `onSelectionChange`, `more` and `onLoadMore`, `actions` | the launcher's rows |
| `List.Section` | `title`, `subtitle` | a section head, the subtitle at its right |
| `List.Item` | `id` (yours: it keeps the selection when rows move), `title`, `subtitle`, `icon` (`{svg, tone}`, `{src, tone}` a file of the package, `{emoji}`), `keywords`, `accessories` (`{tag, tone}`, `{text}`), `actions`, `detail` (a `Detail`) | a row: the icon, the title, the subtitle muted, tags and words at the right end; with a `detail`, the preview column at the list's right shows it for the selected row (Markdown, then its facts) |
| `List.EmptyView` | `title`, `description`, `icon`, `actions` | one row saying it |
| `Grid`, `Grid.Section`, `Grid.Item` | as List; `columns` (4 to 12, 8 by default); an item's `content` is its picture | cells: the picture, its title under it; ↑ ↓ a line, ← → a cell |
| `Detail` | `markdown` (headings, paragraphs, lists, code, tables, rules, quotes and GitHub's alerts; links show their words; no HTML, no images yet; it scrolls), `loading`, `metadata`, `actions` | the Markdown, and a facts column 200 wide |
| `Detail.Metadata` with `.Label`, `.Link`, `.TagList` (`.TagList.Item`), `.Separator` | `title`, `text`, `target`, `tone` | the facts column |
| `ActionPanel`, `ActionPanel.Section` | `title` | ❖K: the actions in place, in sections |
| `Action` | `title`, `shortcut` (`"mod+c"`, `"shift+mod+enter"`), `danger`, `onAction` | runs `onAction` in the extension |
| `Action.Open` `target` · `Action.Copy` `content` · `Action.Paste` `content` · `Action.SetPreference` `name` | | run by the shell (below) |
| `Action.Push` | `target` (an element) | shows it over this view; Esc comes back |
| `Form` | `draft` (keep what is typed if the launcher closes), `loading`, `actions` | fields in a column, labels at the left (L8) |
| `Form.TextField`, `Form.TextArea` | `name`, `title`, `value`, `placeholder`, `info`, `error`, `required`, `max`, `onChange`; a TextField's `secure` | a line of words; a long field 88 tall |
| `Form.Dropdown` (`.Item`: `title`, `value`), `Form.TagPicker` (`.Item`) | `name`, `title`, `value`, `info`, `error`, `required`, `onChange` | a choice; tags, "+ Add" for more (options open in place) |
| `Form.Checkbox` | `name`, `title`, `label`, `value`, `onChange` | a box and its words |
| `Form.Description` | `title`, `text` | words between fields |
| `Action.SubmitForm` | `title`, `onSubmit(values)` | ❖↩: the launcher checks the fields, then you get every value by `name` |
| `Action.ConnectAccount` | `title`, `provider` | connects the account (asks once, signs in in Helium) |

The first action is ↩ and the second ❖↩, unless they name their own key;
the rest are on ❖K. **Open, Copy, Paste and SetPreference run in the shell**,
never in the extension, which only hears that they ran: an extension with no
clipboard permission can still offer Copy, because the person did it.
Paste types into the window that was in front of the launcher; where it
can't yet, it copies and says so.

### Hooks

- `usePreferences<T>()`: the preferences, re-rendered when one changes.
- `useQuery(fn, deps, { keep })`: `{ data, loading, error, reload }`; with
  `keep: keepAnswers<T>("5m")` (made once, outside the component), a command
  opened again shows the last answer at once while a new one comes.
- `useNavigation()`: `push(element)`, `pop()`.
- `useLauncher()`: `toast(style, title)` (one line in the field row: `done`,
  `failed`, `working`), `close()` (done: the launcher closes).

### Forms

The launcher holds what is typed; your `value` is where a field starts, and
a draft kept (`<Form draft>`) wins over it. `onChange` hears each change, so
a field can set its own `error`. ⇥ moves between fields, Return moves on from
a line (a long field takes it as a new line), **❖↩ sends**. Before sending,
the launcher checks each field: `required` and empty, or over `max`
characters, or carrying your `error`, and it shows the words under the field
and sends nothing. Then `onSubmit` gets `{name: value}`: words for a text or
a choice, `true`/`false` for a checkbox, a list for tags. The draft goes once
you close the view after a send (`useLauncher().close()`); a failure keeps it.

```tsx
<Form draft actions={<ActionPanel><Action.SubmitForm title="Create Issue" onSubmit={send} /></ActionPanel>}>
  <Form.Dropdown name="repo" title="Repository" value={last} info="The last one you used">{repos.map((r) => <Form.Dropdown.Item key={r} title={r} value={r} />)}</Form.Dropdown>
  <Form.TextField name="title" title="Title" required max={256} />
  <Form.TextArea name="body" title="Description" />
  <Form.TagPicker name="labels" title="Labels">{labels.map((l) => <Form.TagPicker.Item key={l} title={l} value={l} />)}</Form.TagPicker>
</Form>
```

## The elements (one set with widgets)

Components render the elements below; the tree on the wire is made of them,
`{"t": type, "i": id, "p": props, "c": children}`. The authority is
`packages/applet/src/view/elements.ts`; the shell checks every tree with it
before it draws a node.

- **Shared with widgets**, named once: `Text` (`text`, `tone`), `Image`
  (`src`, `svg`, `emoji`, `tone`), `Tag` (`text`, `tone`), `Label` (`title`,
  `text`), `Link` (`title`, `text`, `target`), `Action` (`title`, `kind`,
  `target`, `content`, `shortcut`, `danger`). Widgets (when they are built,
  `dashi-0.9.0-design/widgets/api.md` § 4) use these same six and add their
  own beside them.
- **The launcher's own**: `List`, `Grid`, `Section`, `Item`, `Detail`,
  `Metadata`, `TagList`, `Separator`, `ActionPanel`, `ActionSection`,
  `EmptyView`, and a form's `Form`, `TextField`, `TextArea`, `Dropdown`,
  `TagPicker`, `Checkbox`, `Option`, `Description` (a field's own complaint
  is `invalid` on the wire: no prop is named `error`). A view's root is a
  `List`, `Grid`, `Detail` or `Form`.
- **Tones** (shared): `primary`, `secondary`, `tertiary` (the ink at three
  strengths), `accent`, and the job colours with their jobs only: `ume` (an
  error, a failure), `broth` (a warning), `moss` (success). They are Dashi's
  tokens for the mode drawn: right in Light, Dark and a theme.

## The wire (version 6)

```
shell → ext  {"type":"open","seq":12,"command":"my-prs","args":{},"query":"","preferences":{"token":"…"},"accounts":{"github.com":{"login":"alexk","token":"…"}}}
ext → shell  {"type":"tree","seq":12,"root":{"t":"List","i":"n1","p":{"filter":"launcher"},"c":[…]}}
             {"type":"patch","seq":12,"ops":[{"op":"replace","path":[0,2],"node":{…}},{"op":"insert","path":[0,3],"node":{…}},{"op":"remove","path":[0,4]}]}
             {"type":"push","seq":12,"root":{…}}   {"type":"pop","seq":12}
             {"type":"toast","seq":12,"style":"done","title":"Copied"}
             {"type":"close","seq":12}
shell → ext  {"type":"event","seq":12,"on":"action","node":"n19"}
             {"type":"event","seq":12,"on":"search","text":"widg"}
             {"type":"event","seq":12,"on":"select","node":"k:dashi#42"}
             {"type":"event","seq":12,"on":"more"}  {"type":"event","seq":12,"on":"pop"}  {"type":"event","seq":12,"on":"close"}
             {"type":"event","seq":12,"on":"change","node":"f3","value":"Fix the dock"}
             {"type":"event","seq":12,"on":"submit","node":"a7","values":{"repo":"…","title":"…","labels":["bug"]}}
             {"type":"prefs","seq":12,"preferences":{…}}
             {"type":"accounts","seq":12,"accounts":{…}}
```

- The SDK (`launcher/lib/view-root.ts`) sends the whole tree first, then the
  smallest nodes that changed as patches (or the whole tree again when a
  patch would be as big), at most once every 50 ms. A tree and a patch apply
  to the view on top (the last pushed).
- The shell checks every tree and every patch's result (`view/tree.ts`); one
  it refuses is answered with `error` and the view stays as it was. The SDK
  checks the same before it sends: a tree the shell would refuse shows "This
  view can't be shown" with the reason, and the reason goes to stderr
  (`dashi-applet dev` shows it).

### Limits

- A tree: 2,000 nodes, 12 deep, one line of the channel (64 KB). A bigger
  list filters itself (`filter: "extension"`) or pages (`more`).
- The channel's own: 30 messages a second, 8 refused messages end the
  connection.
- Words a person reads are trimmed and refused with control characters
  (bidi overrides included). A title 120 characters, Markdown 32 KB.
- Pictures: the package's own files, an SVG glyph under the menu bar
  glyph's rules, or an emoji. The shell fetches nothing for an extension.

## When it runs

An extension with `"shows": ["launcher"]` is not started at login. Opening
one of its commands starts it (a systemd user unit in bubblewrap, as every
applet), and the launcher draws the view's skeleton at once (the chip, three
empty rows), "Loading…" after 300 ms, and the tree when it comes; "GitHub
didn't start." or "GitHub isn't answering." after 10 s. A minute after its
last view closed it is stopped.

Measured (`dashi-0.9.0-review/36-launcher-ext/README.md`). On the laptop, Bun in bubblewrap
reaches its first message in about 6 ms, and the GitHub extension's whole bundle (React, the
reconciler, the SDK; 580 KB) says hello in about 17 ms. In the VM, from the command chosen to its
first tree in the launcher, with systemd starting the unit, the runner, bubblewrap and the
extension: **cold 73 to 204 ms** (nine opens), **warm 11 to 24 ms**. So it is not kept warm
(store-v2 spec § 6 asked for that only past ~250 ms); the skeleton covers the cold start.

## Permissions, shown before install

The consent sheet (`src/shared/applet-store/consent-sheet.tsx`, the store's)
lists what an extension reaches, in the words of
`packages/applet/src/permissions.ts`, before anything runs, and nothing asks
again at run time (decisions.md D260: only critical operations ask; an
extension's view reaching its declared host is not one).

| Permission | The sheet says | The sandbox gives |
| --- | --- | --- |
| `network:HOST` | Talk to HOST, and no other address | No network of its own (only loopback). One socket to a proxy outside the sandbox that lets through HTTPS (port 443) to the hosts named and refuses the rest; a bridge inside on 127.0.0.1:3128, which Bun's `fetch` uses by `HTTPS_PROXY` (decisions.md D463) |
| `network` | Use the network | The network |
| `account:PROVIDER` | Use your PROVIDER account, once you connect it | Nothing more: the token comes over the channel |
| preferences of type `secret` | (nothing more) | The Secret Service is the shell's; the extension gets its own values with `open` |

Commands alone add "Adds 2 commands to the launcher". Files, D-Bus and the
rest are the applets' permissions, unchanged.

## For the store (what this side assumed)

The Store (branch `v09/store`) lists and installs; this side runs, draws and
sandboxes. Agreed through the existing package format:

- An extension is an applet package (`.dashi-applet`, `applet.json`,
  signed, from the catalog), with `shows`, `preferences` and modes `list`,
  `grid`, `detail` added to the manifest (`packages/applet/src/manifest.ts`
  parses them; `manifest.schema.json` says the same). Its shelves come from
  `shows` (`showsOf`: an applet without it is a menu bar applet, and a
  launcher one too when it has commands).
- Dashi's own extensions are installed by the shell at start from
  `packages/shell/extensions/` into the same folder, with `"firstParty": true`
  and `"source": "local"` in `install.json`: the store can show them as
  Dashi's and offer no Remove (removed, they come back at the next start).
- Settings… for an extension (S5) is in the Store's Installed list
  (`apps/software/lib/applets/settings-sheet.tsx`): its accounts, its
  preferences, its commands and what it can reach, kept where the shell's
  views keep them (`src/shared/extension-settings/`).
