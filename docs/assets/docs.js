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
 * from, with the logo's wisp of steam above it. One flat shape in the accent,
 * two dot eyes and a mouth; one body, six faces.
 */
// biome-ignore lint/correctness/noUnusedVariables: a global the pages' inline scripts use (mascot.html).
const EXPRESSIONS = ["happy", "wink", "thinking", "surprised", "sleepy", "cheer"];

function kombuSprite(expression = "happy", { dark = false } = {}) {
  const ink = "#123a2f";
  const body = dark ? "#5fae95" : "#3e8a72";
  const faint = 'style="fill:var(--ink-faint,#8888)"';
  const line = (d, width = 3) => `<path d="${d}" stroke="${ink}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`;
  const dot = (x, r = 4.2) => `<circle cx="${x}" cy="98" r="${r}" fill="${ink}"/>`;
  const smile = line("M56 108q5 4.5 10 0");
  let face;
  let extra = "";
  switch (expression) {
    case "wink":
      face = dot(50) + line("M67 99q5 -5 10 0") + smile;
      break;
    case "thinking":
      face = dot(50) + dot(72) + line("M57 109h8");
      extra = `<circle cx="96" cy="50" r="2.6" ${faint}/><circle cx="104" cy="40" r="3.4" ${faint}/><circle cx="111" cy="28" r="4.4" ${faint}/>`;
      break;
    case "surprised":
      face = dot(50, 5) + dot(72, 5) + `<circle cx="61" cy="110" r="3.4" fill="${ink}"/>`;
      break;
    case "sleepy":
      face = line("M45 98q5 3.5 10 0") + line("M67 98q5 3.5 10 0") + line("M58 109h6", 2.6);
      extra = `<text x="90" y="54" font-family="Inter, sans-serif" font-weight="700" font-size="15" ${faint}>z</text><text x="101" y="40" font-family="Inter, sans-serif" font-weight="700" font-size="11" ${faint}>z</text>`;
      break;
    case "cheer":
      face =
        line("M45 99q5 -5 10 0") +
        line("M67 99q5 -5 10 0") +
        `<path d="M55 106h12q0 7 -6 7q-6 0 -6 -7z" fill="${ink}" stroke="${ink}" stroke-width="1.5" stroke-linejoin="round"/>`;
      extra = `<path d="M16 64l1.6 -4.6 1.6 4.6 4.6 1.6 -4.6 1.6 -1.6 4.6 -1.6 -4.6 -4.6 -1.6z" fill="#e5b13f"/><path d="M103 60l1.2 -3.6 1.2 3.6 3.6 1.2 -3.6 1.2 -1.2 3.6 -1.2 -3.6 -3.6 -1.2z" fill="#e5b13f"/>`;
      break;
    default:
      face = dot(50) + dot(72) + smile;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 122 150" role="img" aria-label="Kombu, ${expression}">
<path d="M70 24c-3.2 -3.4 3.2 -6.4 0 -10" stroke="${body}" stroke-width="3.2" fill="none" stroke-linecap="round"/>
<path d="M69 31C67 50 96 70 96 100C96 121 80 136 61 136C42 136 26 121 26 100C26 70 46 46 69 31Z" fill="${body}"/>
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
