// Dashi's developer docs: what every page shares. The header, the theme
// switch, the contents sidebar, copy-to-clipboard, and the drawings (the
// logo and the Kombu sprite) that more than one page shows. Plain browser
// JavaScript, no modules, so the pages work from file://.

const PAGES = [
  ["index.html", "Overview"],
  ["distro.html", "Distro"],
  ["brand.html", "Brand"],
  ["mascot.html", "Kombu"],
  ["design.html", "Design"],
];

/** The mark: the bowl and its three wisps of steam (packages/shell/icons/setup.svg). */
function dashiMark({ tile = true, ink = "#f4f4f6" } = {}) {
  const glyph = `<g transform="translate(9 9) scale(1.875)"><path d="M1.5 8.25h13a6.5 6 0 0 1-13 0z" fill="${ink}"/><path d="M5 1.75c-.9 1 .9 1.9 0 2.9M8 1.25c-.9 1 .9 1.9 0 2.9M11 1.75c-.9 1 .9 1.9 0 2.9" stroke="${ink}" stroke-width="1.3" fill="none" stroke-linecap="round"/></g>`;
  if (!tile) return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="9 9 30 30" aria-label="Dashi">${glyph}</svg>`;
  const id = `t${Math.random().toString(36).slice(2, 8)}`;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" aria-label="Dashi"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#5fae95"/><stop offset="1" stop-color="#2f6f5a"/></linearGradient></defs><rect x="2" y="2" width="44" height="44" rx="10.5" fill="url(#${id})"/><rect x="2.75" y="2.75" width="42.5" height="42.5" rx="9.8" fill="none" stroke="#fff" stroke-opacity="0.18" stroke-width="1.5"/>${glyph}</svg>`;
}

/**
 * Kombu, Dashi's mascot: a sprite of kelp, the leaf that dashi is simmered
 * from, with the logo's wisp of steam above it. One body, six faces.
 */
// biome-ignore lint/correctness/noUnusedVariables: a global the pages' inline scripts use (mascot.html).
const EXPRESSIONS = ["happy", "wink", "thinking", "surprised", "sleepy", "cheer"];

function kombuSprite(expression = "happy", { dark = false } = {}) {
  const id = `k${Math.random().toString(36).slice(2, 8)}`;
  const eye = "#123a2f";
  const top = dark ? "#6cc0a5" : "#5fae95";
  const bottom = dark ? "#357a64" : "#2f6f5a";
  const blush = `<ellipse cx="41" cy="88" rx="6.5" ry="4" fill="#d0596f" opacity=".42"/><ellipse cx="81" cy="88" rx="6.5" ry="4" fill="#d0596f" opacity=".42"/>`;
  const openEye = (x, dx = 0, dy = 0) =>
    `<ellipse cx="${x}" cy="76" rx="4.6" ry="5.8" fill="${eye}"/><circle cx="${x + 1.6 + dx}" cy="${73.6 + dy}" r="1.7" fill="#fff"/>`;
  const arcEye = (x) => `<path d="M${x - 5} 77q5 -6 10 0" stroke="${eye}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const closedEye = (x) => `<path d="M${x - 5} 76q5 4 10 0" stroke="${eye}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  const smile = `<path d="M55 88q6 6.5 12 0" stroke="${eye}" stroke-width="3" fill="none" stroke-linecap="round"/>`;
  let arms = `<path d="M27 96q-9 2 -12 9" stroke="${bottom}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M95 96q9 2 12 9" stroke="${bottom}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
  let face = "";
  let extra = "";
  switch (expression) {
    case "wink":
      face = openEye(49) + arcEye(73) + smile + blush;
      break;
    case "thinking":
      face = `${openEye(49, 1.2, -1.6)}${openEye(73, 1.2, -1.6)}<path d="M56 90h10" stroke="${eye}" stroke-width="3" stroke-linecap="round"/>`;
      extra = `<circle cx="100" cy="40" r="3" style="fill:var(--ink-faint,#8888)"/><circle cx="108" cy="30" r="4" style="fill:var(--ink-faint,#8888)"/><circle cx="114" cy="17" r="5.5" style="fill:var(--ink-faint,#8888)"/>`;
      break;
    case "surprised":
      face = `<ellipse cx="49" cy="75" rx="5.6" ry="7" fill="${eye}"/><circle cx="51" cy="72" r="2" fill="#fff"/><ellipse cx="73" cy="75" rx="5.6" ry="7" fill="${eye}"/><circle cx="75" cy="72" r="2" fill="#fff"/><ellipse cx="61" cy="91" rx="4" ry="4.8" fill="${eye}"/>`;
      arms = `<path d="M27 92q-10 -4 -13 -14" stroke="${bottom}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M95 92q10 -4 13 -14" stroke="${bottom}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
      break;
    case "sleepy":
      face = `${closedEye(49)}${closedEye(73)}<path d="M58 90q3 2 6 0" stroke="${eye}" stroke-width="2.6" fill="none" stroke-linecap="round"/>${blush}`;
      extra = `<text x="92" y="44" font-family="Inter, sans-serif" font-weight="700" font-size="15" style="fill:var(--ink-faint,#8888)">z</text><text x="102" y="30" font-family="Inter, sans-serif" font-weight="700" font-size="11" style="fill:var(--ink-faint,#8888)">z</text>`;
      break;
    case "cheer":
      face =
        arcEye(49) +
        arcEye(73) +
        `<path d="M53 86q8 0 16 0q0 9 -8 9q-8 0 -8 -9z" fill="${eye}"/><path d="M56.5 91.5q4.5 3 9 0" stroke="#d0596f" stroke-width="2.4" fill="none" stroke-linecap="round"/>` +
        blush;
      arms = `<path d="M28 88q-10 -8 -11 -22" stroke="${bottom}" stroke-width="6" fill="none" stroke-linecap="round"/><path d="M94 88q10 -8 11 -22" stroke="${bottom}" stroke-width="6" fill="none" stroke-linecap="round"/>`;
      extra = `<path d="M13 50l2 -6 2 6 6 2 -6 2 -2 6 -2 -6 -6 -2z" fill="#e5b13f"/><path d="M104 46l1.5 -4.5 1.5 4.5 4.5 1.5 -4.5 1.5 -1.5 4.5 -1.5 -4.5 -4.5 -1.5z" fill="#e5b13f"/>`;
      break;
    default:
      face = openEye(49) + openEye(73) + smile + blush;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 122 150" role="img" aria-label="Kombu, ${expression}">
<defs>
  <linearGradient id="${id}b" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${top}"/><stop offset="1" stop-color="${bottom}"/></linearGradient>
  <radialGradient id="${id}h" cx="0.34" cy="0.3" r="0.5"><stop offset="0" stop-color="#fff" stop-opacity=".35"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
</defs>
<ellipse cx="61" cy="141" rx="26" ry="4.5" fill="#000" opacity=".12"/>
<path d="M64 21c-3.4 -3.6 3.4 -6.8 0 -10.6" stroke="${top}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
${arms}
<path d="M61 136C38 133 24 116 25 92C26 70 33 52 45 38C50 32 55 28 59 26C62 24.6 65 25 67.5 27.5C80 40 95 62 97 88C99 116 84 134 61 136Z" fill="url(#${id}b)"/>
<path d="M61 136C38 133 24 116 25 92C26 70 33 52 45 38C50 32 55 28 59 26C62 24.6 65 25 67.5 27.5C80 40 95 62 97 88C99 116 84 134 61 136Z" fill="url(#${id}h)"/>
<path d="M33 112q4 4 3 9M89 112q-4 4 -3 9" stroke="#fff" stroke-opacity=".16" stroke-width="2.4" fill="none" stroke-linecap="round"/>
<path d="M61 104v26" stroke="#fff" stroke-opacity=".2" stroke-width="2.6" stroke-linecap="round"/>
${face}
${extra}
</svg>`;
}

/* ── Theme ────────────────────────────────────────────────────────── */

const THEME_KEY = "dashi-docs-theme";

function preferredTheme() {
  const saved = localStorage.getItem(THEME_KEY);
  if (saved === "light" || saved === "dark") return saved;
  return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  document.dispatchEvent(new CustomEvent("themechange", { detail: theme }));
}

applyTheme(preferredTheme());

const SUN = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"><circle cx="12" cy="12" r="4.2"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4"/></svg>`;
const MOON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/></svg>`;

/* ── Header ───────────────────────────────────────────────────────── */

function buildHeader() {
  const here = location.pathname.split("/").pop() || "index.html";
  const header = document.createElement("header");
  header.className = "topbar";
  header.innerHTML = `
    <a class="brand" href="index.html">${dashiMark()}Dashi <span>Docs</span></a>
    <nav>${PAGES.map(([href, label]) => `<a href="${href}"${href === here ? ' aria-current="page"' : ""}>${label}</a>`).join("")}</nav>
    <div class="spacer"></div>
    <button class="icon-button" id="theme-toggle" title="Switch light and dark"></button>`;
  document.body.prepend(header);
  const toggle = header.querySelector("#theme-toggle");
  const paint = () => {
    toggle.innerHTML = document.documentElement.dataset.theme === "dark" ? SUN : MOON;
  };
  paint();
  toggle.addEventListener("click", () => {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem(THEME_KEY, next);
    applyTheme(next);
    paint();
  });
}

/* ── Contents sidebar, from the page's h2 and h3 ──────────────────── */

function buildToc() {
  const toc = document.querySelector(".toc");
  if (!toc) return;
  const heads = [...document.querySelectorAll("main h2:not(.notoc), main h3:not(.notoc)")];
  const slug = (text) =>
    text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "");
  toc.innerHTML = "<h4>On this page</h4>";
  for (const head of heads) {
    head.id ||= slug(head.textContent);
    const link = document.createElement("a");
    link.href = `#${head.id}`;
    link.textContent = head.dataset.toc ?? head.textContent;
    if (head.tagName === "H3") link.className = "sub";
    toc.append(link);
  }
  const links = new Map([...toc.querySelectorAll("a")].map((a) => [a.hash.slice(1), a]));
  const spy = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        for (const a of links.values()) a.classList.remove("active");
        links.get(entry.target.id)?.classList.add("active");
      }
    },
    { rootMargin: "-60px 0px -70% 0px" },
  );
  for (const head of heads) spy.observe(head);
}

/* ── Copy to clipboard ────────────────────────────────────────────── */

let toastTimer;
function toast(message) {
  let el = document.querySelector(".toast");
  if (!el) {
    el = document.createElement("div");
    el.className = "toast";
    document.body.append(el);
  }
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1400);
}

document.addEventListener("click", async (event) => {
  const target = event.target.closest("[data-copy]");
  if (!target) return;
  try {
    await navigator.clipboard.writeText(target.dataset.copy);
    toast(`Copied ${target.dataset.copy}`);
  } catch {
    toast("Copying needs a secure page (open the docs over http, or allow it).");
  }
});

/* ── Segmented controls: <div class="segmented" data-group="x"> ──── */

// biome-ignore lint/correctness/noUnusedVariables: a global the pages' inline scripts use.
function segmented(root, onChange) {
  const buttons = [...root.querySelectorAll("button")];
  for (const button of buttons) {
    button.addEventListener("click", () => {
      for (const b of buttons) b.setAttribute("aria-pressed", String(b === button));
      onChange(button.dataset.value);
    });
  }
}

/* ── Drawings placed by attribute ─────────────────────────────────── */

function placeDrawings() {
  const dark = document.documentElement.dataset.theme === "dark";
  for (const el of document.querySelectorAll("[data-sprite]")) el.innerHTML = kombuSprite(el.dataset.sprite, { dark });
  for (const el of document.querySelectorAll("[data-mark]")) el.innerHTML = dashiMark({ tile: el.dataset.mark !== "glyph", ink: el.dataset.ink ?? "#f4f4f6" });
}
document.addEventListener("themechange", () => {
  if (document.body) placeDrawings();
});

document.addEventListener("DOMContentLoaded", () => {
  buildHeader();
  buildToc();
  placeDrawings();
  const foot = document.createElement("footer");
  foot.className = "page-foot";
  foot.innerHTML = "<span>Dashi developer docs · source in <code>docs/</code></span><span>Change these pages with the behavior they describe.</span>";
  document.querySelector("main")?.append(foot);
});
