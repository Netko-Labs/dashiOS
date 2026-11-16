import { describe, expect, test } from "bun:test";
import { decodeEntities, htmlToMarkdown } from "../apps/notes/lib/html.ts";

describe("rich text pasted as Markdown", () => {
  test("headings, paragraphs, bold, links and nested lists", () => {
    const html = `<meta charset="utf-8"><h2>Plan</h2><p>Buy <b>milk</b> &amp; <a href="https://x.org/?a=1&amp;b=2">eggs</a>.</p><ul><li>one</li><li>two<ul><li>deep</li></ul></li></ul><ol><li>a</li><li>b</li></ol>`;
    expect(htmlToMarkdown(html)).toBe("## Plan\n\nBuy **milk** & [eggs](https://x.org/?a=1&b=2).\n\n- one\n- two\n  - deep\n\n1. a\n2. b");
  });

  test("a quote, a rule, a code block keeping its lines", () => {
    const html = "<blockquote><p>quoted <em>words</em></p></blockquote><hr><pre><code>const a = 1;\nconst b = 2;</code></pre><p>after</p>";
    expect(htmlToMarkdown(html)).toBe("> quoted *words*\n\n---\n\n```\nconst a = 1;\nconst b = 2;\n```\n\nafter");
  });

  test("a table, a pipe in a cell escaped", () => {
    const html = "<table><thead><tr><th>Name</th><th>Cost</th></tr></thead><tbody><tr><td>A | B</td><td>$1</td></tr></tbody></table>";
    expect(htmlToMarkdown(html)).toBe("| Name | Cost |\n| --- | --- |\n| A \\| B | $1 |");
  });

  test("scripts and styles say nothing; entities are letters", () => {
    expect(htmlToMarkdown("<style>p{}</style><script>x()</script>just text")).toBe("just text");
    expect(decodeEntities("&lt;a&gt; &#39;b&#x27; &nbsp;&bogus;")).toBe("<a> 'b'  &bogus;".replace(" ", " "));
  });
});
