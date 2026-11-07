import { describe, expect, test } from "bun:test";
import type { PageNode, PageOption } from "../browser-extension/src/page/node.ts";
import { roleOf, secrecyOf } from "../browser-extension/src/page/node.ts";
import { readFrame } from "../browser-extension/src/page/read.ts";
import { marker, RefTable, renumber, unmark } from "../browser-extension/src/page/refs.ts";

interface Spec {
  tag: string;
  attrs?: Record<string, string>;
  children?: Array<Spec | string>;
  value?: string;
  checked?: boolean;
  options?: PageOption[];
  label?: string;
  href?: string;
  hidden?: boolean;
  inline?: boolean;
  wasPassword?: boolean;
  dashiFilled?: boolean;
}

const BLOCKS = new Set(["div", "p", "h1", "h2", "h3", "form", "section", "main", "body", "ul", "li", "table", "tr"]);

/** Every value read, so a test can say no secret was. */
let valuesRead: string[] = [];

function node(spec: Spec | string): PageNode {
  if (typeof spec === "string") {
    return {
      tag: "#text",
      text: () => spec,
      attr: () => null,
      children: () => [],
      shown: () => true,
      block: () => false,
      value: () => "",
      hasValue: () => false,
      checked: () => false,
      options: () => [],
      labelText: () => null,
      href: () => null,
      disabled: () => false,
      wasPassword: () => false,
      dashiFilled: () => false,
      labelsField: () => false,
    };
  }
  const kids = (spec.children ?? []).map(node);
  const self: PageNode = {
    tag: spec.tag,
    text: () => "",
    attr: (name) => spec.attrs?.[name] ?? null,
    children: () => kids,
    shown: () => !spec.hidden,
    block: () => !spec.inline && BLOCKS.has(spec.tag),
    value: () => {
      if (secrecyOf(self)) throw new Error(`a secret field's value was read: ${spec.value}`);
      valuesRead.push(spec.value ?? "");
      return spec.value ?? "";
    },
    hasValue: () => (spec.value ?? "").length > 0,
    checked: () => spec.checked === true,
    options: () => spec.options ?? [],
    labelText: () => spec.label ?? null,
    href: () => spec.href ?? null,
    disabled: () => spec.attrs?.disabled !== undefined,
    wasPassword: () => spec.wasPassword === true,
    dashiFilled: () => spec.dashiFilled === true,
    labelsField: () => spec.tag === "label" && spec.attrs?.for !== undefined,
  };
  return self;
}

/** Numbers as content.ts gives them: the same node, the same number, for the document's life. */
function numbering() {
  const numbers = new Map<PageNode, number>();
  return (n: PageNode) => {
    let ref = numbers.get(n);
    if (ref === undefined) {
      ref = numbers.size + 1;
      numbers.set(n, ref);
    }
    return ref;
  };
}

/** A frame's text with its own numbers, as the background renumbers them. */
const plain = (text: string) => renumber(text, (local) => local);

const loginPage: Spec = {
  tag: "body",
  children: [
    { tag: "h1", children: ["Ingresa a tu cuenta"] },
    {
      tag: "p",
      children: ["¿No tienes cuenta? ", { tag: "a", href: "https://bodytech.example/registro", attrs: { href: "/registro" }, children: ["Regístrate"] }],
    },
    {
      tag: "form",
      children: [
        { tag: "label", attrs: { for: "email" }, children: ["Correo electrónico"] },
        { tag: "input", attrs: { type: "email", id: "email" }, label: "Correo electrónico", value: "alexk@example.com" },
        { tag: "label", attrs: { for: "pw" }, children: ["Contraseña"] },
        { tag: "input", attrs: { type: "password", id: "pw" }, label: "Contraseña", value: "hunter2-secret" },
        { tag: "input", attrs: { type: "checkbox" }, label: "Recordarme", checked: true },
        { tag: "button", attrs: { type: "submit" }, children: ["Ingresar"] },
      ],
    },
    { tag: "script", children: ["var token = 'nope';"] },
    { tag: "div", hidden: true, children: ["Hidden promo"] },
  ],
};

describe("read_page's text", () => {
  test("headings, text in reading order, and numbered elements", () => {
    const { text, truncated } = readFrame(node(loginPage), numbering());
    expect(truncated).toBe(false);
    expect(plain(text)).toBe(
      [
        "# Ingresa a tu cuenta",
        "¿No tienes cuenta?",
        '[1] link "Regístrate" → https://bodytech.example/registro',
        '[2] textbox "Correo electrónico" value="alexk@example.com"',
        '[3] password field "Contraseña" (filled: yes)',
        '[4] checkbox "Recordarme" (checked)',
        '[5] button "Ingresar"',
      ].join("\n"),
    );
  });

  test("a heading that is a link stays one line, list items are dashed, table cells are split", () => {
    const page: Spec = {
      tag: "body",
      children: [
        { tag: "h2", children: [{ tag: "a", href: "https://example.com/a", attrs: { href: "/a" }, children: ["Planes"] }] },
        {
          tag: "ul",
          children: [
            { tag: "li", children: ["Uno"] },
            { tag: "li", children: ["Dos"] },
          ],
        },
        {
          tag: "table",
          children: [
            {
              tag: "tr",
              children: [
                { tag: "td", children: ["Sede"] },
                { tag: "td", children: ["Norte"] },
              ],
            },
          ],
        },
        {
          tag: "select",
          label: "Sede",
          options: [
            { label: "Norte", value: "n", selected: true },
            { label: "Sur", value: "s", selected: false },
          ],
        },
      ],
    };
    expect(plain(readFrame(node(page), numbering()).text)).toBe(
      ['## [1] link "Planes" → https://example.com/a', "- Uno", "- Dos", "Sede | Norte", '[2] combobox "Sede" value="Norte" options: "Norte", "Sur"'].join(
        "\n",
      ),
    );
  });

  test("the limits cut a long page and say so", () => {
    const long: Spec = { tag: "body", children: Array.from({ length: 50 }, (_, i) => ({ tag: "p", children: [`Line ${i} `.repeat(10)] })) };
    const { text, truncated } = readFrame(node(long), numbering(), { chars: 500, elements: 10 });
    expect(truncated).toBe(true);
    expect(text.length).toBeLessThanOrEqual(500);
  });
});

describe("secrets never leave the page", () => {
  const secretFields: Array<[string, Spec, string]> = [
    ["a password field", { tag: "input", attrs: { type: "password" }, label: "Password", value: "pw-SECRET-1" }, "password field"],
    ["a password shown as text", { tag: "input", attrs: { type: "text" }, wasPassword: true, label: "Password", value: "pw-SECRET-2" }, "password field"],
    ["autocomplete current-password", { tag: "input", attrs: { autocomplete: "current-password" }, label: "PIN", value: "pw-SECRET-3" }, "password field"],
    ["a card number", { tag: "input", attrs: { autocomplete: "cc-number" }, label: "Card", value: "4111111111111111" }, "card field"],
    ["a security code", { tag: "input", attrs: { autocomplete: "section-pay cc-csc" }, label: "CVC", value: "737" }, "card field"],
    ["a card named only by its name", { tag: "input", attrs: { name: "cardNumber" }, label: "Número", value: "5500000000000004" }, "card field"],
    ["a one-time code", { tag: "input", attrs: { autocomplete: "one-time-code" }, label: "Code", value: "492817" }, "one-time code field"],
    ["a field Dashi typed a secret into", { tag: "input", attrs: { type: "text" }, dashiFilled: true, label: "Clave", value: "pw-SECRET-4" }, "password field"],
  ];

  for (const [what, spec, role] of secretFields) {
    test(`${what}: only whether it is filled`, () => {
      valuesRead = [];
      const page = node({ tag: "body", children: [{ tag: "form", children: [spec] }] });
      const text = plain(readFrame(page, numbering()).text);
      expect(text).toContain(`[1] ${role}`);
      expect(text).toContain("filled: yes");
      expect(text).not.toContain(spec.value ?? "");
      expect(valuesRead).toEqual([]);
    });
  }

  test("an empty password field says so; one Dashi filled says by whom", () => {
    const page = node({
      tag: "body",
      children: [
        { tag: "input", attrs: { type: "password" }, label: "Contraseña" },
        { tag: "input", attrs: { type: "password" }, label: "Otra", dashiFilled: true, value: "x" },
      ],
    });
    const text = plain(readFrame(page, numbering()).text);
    expect(text).toContain('[1] password field "Contraseña" (filled: no)');
    expect(text).toContain('[2] password field "Otra" (filled: yes, by Dashi)');
  });

  test("ordinary fields still show what they hold", () => {
    const field = node({ tag: "input", attrs: { type: "search" }, label: "Buscar", value: "yoga" });
    expect(roleOf(field)).toBe("searchbox");
    expect(secrecyOf(field)).toBeNull();
  });
});

describe("element numbers", () => {
  test("a page's text can't fake a number", () => {
    const sneaky = `Click ${marker(1)} now`;
    expect(unmark(sneaky)).toBe("Click 1 now");
    const page = node({
      tag: "body",
      children: [
        { tag: "p", children: [sneaky] },
        { tag: "button", children: ["Go"] },
      ],
    });
    const table = new RefTable();
    const text = renumber(readFrame(page, numbering()).text, (local) => table.ref({ frameId: 0, doc: "d1", local }));
    expect(text).toBe('Click 1 now\n[1] button "Go"');
  });

  test("stay the same across a read, a click and a read", () => {
    const tree = node(loginPage);
    const refOf = numbering();
    const table = new RefTable();
    const read = (frameId: number, doc: string) => renumber(readFrame(tree, refOf).text, (local) => table.ref({ frameId, doc, local }));
    const first = read(0, "doc-a");
    // The click finds the element read_page numbered: the same frame, document and element.
    const button = /\[(\d+)\] button "Ingresar"/.exec(first)?.[1];
    expect(table.target(Number(button))).toEqual({ frameId: 0, doc: "doc-a", local: 5 });
    const second = read(0, "doc-a");
    expect(second).toBe(first);
    // Another frame's elements get numbers of their own, after the page's.
    expect(table.ref({ frameId: 3, doc: "doc-f", local: 1 })).toBe(6);
    // A document that went: its numbers point nowhere.
    table.forgetDocument(0, "doc-a");
    expect(table.target(Number(button))).toBeNull();
  });
});
