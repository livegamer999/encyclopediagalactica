/* Encyclopedia Galactica — mini-wiki statique
   Chaque article est un fichier Markdown dans /pages, listé dans pages/index.json. */

const CONFIG = {
  siteName: "Encyclopedia Galactica",
  // Lien « Modifier » vers GitHub. Laisse vide ("") pour le masquer.
  editUrl: "https://github.com/livegamer999/iktyro/edit/main/pages/{slug}.md",
};

const state = { pages: {}, lookup: {}, backlinks: {}, current: null };
const app = document.getElementById("app");

/* ---------- Utilitaires ---------- */
const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const slugify = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const stripMd = s => s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, a, b) => b || a).replace(/[*_`#>\[\]{}]/g, "");

function resolve(target) {
  return state.lookup[norm(target)] || state.lookup[slugify(target)] || null;
}

/* ---------- Front matter ---------- */
function parseFrontMatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let key = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    let r;
    if (key && (r = raw.match(/^\s+-\s+(.*)$/))) {
      if (!Array.isArray(meta[key])) meta[key] = [];
      meta[key].push(r[1].trim());
    } else if (key && (r = raw.match(/^\s+([^:]+):\s*(.*)$/))) {
      if (typeof meta[key] !== "object" || Array.isArray(meta[key])) meta[key] = {};
      meta[key][r[1].trim()] = r[2].trim();
    } else if ((r = raw.match(/^([\w-]+):\s*(.*)$/))) {
      key = r[1];
      meta[key] = r[2].trim();
    }
  }
  return { meta, body: m[2] };
}

/* ---------- Texte enrichi : [[liens]] et {citations} ---------- */
function wikilinks(text) {
  return text.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (_, target, label) => {
    const slug = resolve(target);
    const shown = label || target;
    return slug
      ? `<a href="#/${slug}">${shown}</a>`
      : `<a href="#/${slugify(target)}" class="redlink" title="Cette page n'existe pas encore">${shown}</a>`;
  });
}
function citations(text, slug) {
  return text.replace(/\{(\d+)\}/g, (_, n) => `<sup><a href="#/${slug}/source-${n}">[${n}]</a></sup>`);
}
const inline = (text, slug) => marked.parseInline(citations(wikilinks(text), slug));

/* ---------- Chargement ---------- */
async function load() {
  const list = await (await fetch("pages/index.json")).json();
  await Promise.all(list.map(async slug => {
    try {
      const res = await fetch(`pages/${slug}.md`);
      if (!res.ok) throw new Error(res.status);
      const { meta, body } = parseFrontMatter(await res.text());
      state.pages[slug] = { slug, meta, body, title: meta.title || slug };
    } catch (e) {
      console.warn(`Page introuvable : pages/${slug}.md`);
    }
  }));
  for (const p of Object.values(state.pages)) {
    state.lookup[slugify(p.slug)] = p.slug;
    state.lookup[norm(p.title)] = p.slug;
    (p.meta.aliases ? p.meta.aliases.split(",") : []).forEach(a => (state.lookup[norm(a)] = p.slug));
  }
  for (const p of Object.values(state.pages)) {
    const text = p.body + JSON.stringify(p.meta);
    for (const m of text.matchAll(/\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g)) {
      const t = resolve(m[1]);
      if (t && t !== p.slug) (state.backlinks[t] ||= new Set()).add(p.slug);
    }
  }
}

/* ---------- Rendu d'une page ---------- */
function renderPage(slug) {
  const p = state.pages[slug];
  if (!p) return renderMissing(slug);
  const { meta } = p;
  document.title = `${p.title} — ${CONFIG.siteName}`;

  const tmp = document.createElement("div");
  tmp.innerHTML = marked.parse(citations(wikilinks(p.body), slug));

  // Premier paragraphe = introduction
  const first = tmp.querySelector(":scope > p");
  if (first) first.classList.add("lead");

  // Sources
  const sources = Array.isArray(meta.sources) ? meta.sources : [];
  if (sources.length) {
    const sec = document.createElement("div");
    sec.innerHTML = `<h2>Sources</h2><ol class="references">${sources
      .map((s, i) => `<li id="source-${i + 1}">${inline(s, slug)}</li>`).join("")}</ol>`;
    while (sec.firstChild) tmp.appendChild(sec.firstChild);
  }

  // Titres + sommaire
  const heads = [...tmp.querySelectorAll("h2, h3")];
  const used = new Set();
  heads.forEach(h => {
    let id = slugify(h.textContent) || "section";
    while (used.has(id)) id += "-2";
    used.add(id);
    h.id = id;
  });
  let toc = "";
  if (heads.length >= 3) {
    const tree = [];
    heads.forEach(h => {
      if (h.tagName === "H3" && tree.length) tree[tree.length - 1].subs.push(h);
      else tree.push({ h, subs: [] });
    });
    const link = h => `<a href="#/${slug}/${h.id}">${h.innerHTML}</a>`;
    const html = "<ol>" + tree.map((n, i) => `<li><span class="num">${i + 1}</span>${link(n.h)}` +
      (n.subs.length ? "<ol>" + n.subs.map((s, j) => `<li><span class="num">${i + 1}.${j + 1}</span>${link(s)}</li>`).join("") + "</ol>" : "") +
      "</li>").join("") + "</ol>";
    toc = `<div class="toc"><div class="toc-title">Sommaire</div>${html}</div>`;
  }

  // Infobox
  let infobox = "";
  const info = meta.info && typeof meta.info === "object" && !Array.isArray(meta.info) ? meta.info : null;
  if (info || meta.image) {
    const rows = info ? Object.entries(info)
      .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${inline(v, slug)}</td></tr>`).join("") : "";
    infobox = `<aside class="infobox">
      <div class="infobox-title">${esc(p.title)}</div>
      <div class="infobox-subtitle">${meta.image ? `<img src="${esc(meta.image)}" alt="${esc(p.title)}">` : ""}${esc(meta.subtitle || meta.type || "")}</div>
      ${rows ? `<table>${rows}</table>` : ""}
    </aside>`;
  }

  // Catégories et pages liées
  const cats = (meta.category || "").split(",").map(c => c.trim()).filter(Boolean);
  const catBox = cats.length
    ? `<div class="meta-box">Catégories : ${cats.map(c => `<a href="#/cat/${encodeURIComponent(c)}">${esc(c)}</a>`).join(", ")}</div>` : "";
  const back = [...(state.backlinks[slug] || [])].sort();
  const backBox = back.length
    ? `<div class="meta-box">Pages liées : ${back.map(s => `<a href="#/${s}">${esc(state.pages[s].title)}</a>`).join(", ")}</div>` : "";

  const edit = CONFIG.editUrl
    ? `<a href="${CONFIG.editUrl.replace("{slug}", slug)}" target="_blank" rel="noopener">Modifier</a>` : "";

  app.innerHTML = `
    <div class="page-header">
      <h1>${esc(p.title)}</h1>
      <div class="tabs">
        <div class="tabs-left"><span class="active">Article</span></div>
        <div class="tabs-right">${edit}</div>
      </div>
    </div>
    <div class="content">
      ${infobox}
      <div id="body"></div>
      ${catBox}${backBox}
      <footer class="footer"><p>${meta.updated ? `Dernière modification : ${esc(meta.updated)}` : ""}</p></footer>
    </div>`;
  const bodyEl = document.getElementById("body");
  // sommaire inséré après l'introduction
  while (tmp.firstChild) bodyEl.appendChild(tmp.firstChild);
  if (toc) {
    const lead = bodyEl.querySelector(".lead");
    (lead || bodyEl).insertAdjacentHTML(lead ? "afterend" : "afterbegin", toc);
  }
}

function renderMissing(slug) {
  document.title = `Page inexistante — ${CONFIG.siteName}`;
  app.innerHTML = `<div class="page-header"><h1>Page inexistante</h1></div>
    <div class="content"><p>Il n'y a pas encore d'article nommé « ${esc(slug)} ».</p>
    <p>Pour le créer : ajoute <code>pages/${esc(slug)}.md</code> puis <code>"${esc(slug)}"</code> dans <code>pages/index.json</code>.</p>
    <p><a href="#/">Retour à l'accueil</a></p></div>`;
}

function renderHome() {
  document.title = CONFIG.siteName;
  const groups = {};
  Object.values(state.pages).forEach(p => {
    const cats = (p.meta.category || "Sans catégorie").split(",").map(c => c.trim());
    cats.forEach(c => (groups[c] ||= []).push(p));
  });
  const html = Object.keys(groups).sort().map(c => `
    <div class="cat-group"><h3><a href="#/cat/${encodeURIComponent(c)}">${esc(c)}</a></h3>
    <ul class="page-list">${groups[c].sort((a, b) => a.title.localeCompare(b.title))
      .map(p => `<li><a href="#/${p.slug}">${esc(p.title)}</a></li>`).join("")}</ul></div>`).join("");
  app.innerHTML = `<div class="page-header"><h1>Encyclopedia Galactica</h1></div>
    <div class="content"><p class="lead">${Object.keys(state.pages).length} articles. Choisis une catégorie ou utilise la recherche.</p>${html}</div>`;
}

function renderCategory(name) {
  document.title = `${name} — ${CONFIG.siteName}`;
  const pages = Object.values(state.pages)
    .filter(p => (p.meta.category || "").split(",").map(c => c.trim()).includes(name))
    .sort((a, b) => a.title.localeCompare(b.title));
  app.innerHTML = `<div class="page-header"><h1>Catégorie : ${esc(name)}</h1></div>
    <div class="content"><ul class="page-list">${pages
      .map(p => `<li><a href="#/${p.slug}">${esc(p.title)}</a></li>`).join("") || "<li>Aucune page.</li>"}</ul>
    <p><a href="#/">Retour à l'accueil</a></p></div>`;
}

/* ---------- Routage ---------- */
function route() {
  const parts = location.hash.replace(/^#\/?/, "").split("/").map(decodeURIComponent);
  const [a, b] = parts;
  hideResults();
  if (!a) { state.current = null; renderHome(); return window.scrollTo(0, 0); }
  if (a === "random") {
    const slugs = Object.keys(state.pages);
    location.hash = "#/" + slugs[Math.floor(Math.random() * slugs.length)];
    return;
  }
  if (a === "cat") { state.current = null; renderCategory(b || ""); return window.scrollTo(0, 0); }
  if (state.current !== a) { state.current = a; renderPage(a); }
  const target = b && document.getElementById(b);
  if (target) {
    target.scrollIntoView();
    if (target.tagName === "LI") { target.classList.add("flash"); setTimeout(() => target.classList.remove("flash"), 1500); }
  } else window.scrollTo(0, 0);
}

/* ---------- Recherche ---------- */
const q = document.getElementById("q");
const box = document.getElementById("results");
function hideResults() { box.hidden = true; }
function search() {
  const term = norm(q.value);
  if (!term) return hideResults();
  const hits = [];
  for (const p of Object.values(state.pages)) {
    const title = norm(p.title);
    const text = norm(stripMd(p.body));
    let score = 0, snippet = "";
    if (title === term) score = 100;
    else if (title.includes(term)) score = 50;
    const i = text.indexOf(term);
    if (i >= 0) {
      score += 10;
      const plain = stripMd(p.body);
      snippet = "…" + plain.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " ") + "…";
    }
    if (score) hits.push({ p, score, snippet });
  }
  hits.sort((a, b) => b.score - a.score);
  box.innerHTML = hits.length
    ? hits.slice(0, 8).map(h => `<a href="#/${h.p.slug}">${esc(h.p.title)}<small>${esc(h.snippet || h.p.meta.subtitle || h.p.meta.type || "")}</small></a>`).join("")
    : `<div class="empty">Aucun résultat.</div>`;
  box.hidden = false;
}
q.addEventListener("input", search);
q.addEventListener("keydown", e => {
  if (e.key === "Enter") { const a = box.querySelector("a"); if (a) { location.hash = a.getAttribute("href"); q.blur(); } }
  if (e.key === "Escape") hideResults();
});
document.getElementById("go").addEventListener("click", search);
document.addEventListener("click", e => { if (!e.target.closest(".search")) hideResults(); });

/* ---------- Démarrage ---------- */
load().then(() => {
  window.addEventListener("hashchange", route);
  route();
}).catch(err => {
  app.innerHTML = `<p>Impossible de charger l'encyclopédie (${esc(err.message)}). Si tu ouvres le fichier directement depuis ton disque, lance plutôt un petit serveur local : <code>python -m http.server</code></p>`;
});
