/* Encyclopedia Galactica — mini-wiki statique
   Chaque article est un fichier Markdown dans /pages, listé dans pages/index.json.
   Modifier / Historique utilisent l'API GitHub du dépôt indiqué dans CONFIG.repo. */

const CONFIG = {
  siteName: "Encyclopedia Galactica",
  tagline: "L'encyclopédie de la galaxie",
  repo: "livegamer999/iktyro", // "utilisateur/dépôt"
  branch: "",                  // vide = branche par défaut, détectée automatiquement
};
const PENDING_MS = 15 * 60 * 1000;
const RESERVED = ["edit", "history", "rev", "cat", "all", "random"];

const state = { pages: {}, order: [], lookup: {}, backlinks: {}, wanted: {}, titles: {}, current: null, seed: null, revRaw: "" };
const app = document.getElementById("app");

/* ---------- Utilitaires ---------- */
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const norm = s => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();
const slugify = s => norm(s).replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const safeDecode = s => { try { return decodeURIComponent(s); } catch { return s; } };
const LINK_RE = /\[\[(?!(?:Fichier|Image|File):)([^\]\[|]+)(?:\|([^\]\[]*))?\]\]/gi;
const FILE_RE = /\[\[(?:Fichier|Image|File):[^\]]*\]\]/gi;
const stripMd = s => s.replace(LINK_RE, (_, a, b) => b || a).replace(FILE_RE, "").replace(/\{\d+\}/g, "").replace(/[*_`#>\[\]{}]/g, "");
const catsOf = meta => (meta.category || "").split(",").map(c => c.trim()).filter(Boolean);
const aliasesOf = meta => [].concat(meta.aliases || []).flatMap(a => String(a).split(",")).map(a => a.trim()).filter(Boolean);
const fmtDate = iso => new Date(iso).toLocaleString("fr", { dateStyle: "long", timeStyle: "short" });

function resolve(target) {
  const t = String(target).split("#")[0];
  return state.lookup[norm(t)] || state.lookup[slugify(t)] || null;
}

/* ---------- Front matter ---------- */
const unquote = v => v.trim().replace(/^(["'])(.*)\1$/, "$2");
function parseFrontMatter(text) {
  const m = text.replace(/^\uFEFF/, "").match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { meta: {}, body: text };
  const meta = {};
  let key = null;
  for (const raw of m[1].split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith("#")) continue;
    let r;
    if (key && (r = raw.match(/^\s+-\s+(.*)$/))) {
      if (!Array.isArray(meta[key])) meta[key] = [];
      meta[key].push(unquote(r[1]));
    } else if (key && (r = raw.match(/^\s+([^:]+):\s*(.*)$/))) {
      if (typeof meta[key] !== "object" || Array.isArray(meta[key])) meta[key] = {};
      meta[key][r[1].trim()] = unquote(r[2]);
    } else if ((r = raw.match(/^([\w-]+):\s*(.*)$/))) {
      key = r[1];
      meta[key] = unquote(r[2]);
    }
  }
  return { meta, body: m[2] };
}

/* ---------- Liens, citations, images ---------- */
function wikilinks(text, slug) {
  return text.replace(LINK_RE, (_, target, label) => {
    const [t, anch] = target.split("#");
    const base = t.trim() ? resolve(t) : slug;
    const shown = label || t.trim() || anch;
    const a = anch ? "/" + slugify(anch) : "";
    return base
      ? `<a href="#/${base}${a}">${shown}</a>`
      : `<a href="#/${slugify(t)}" class="redlink" title="Cette page n'existe pas encore">${shown}</a>`;
  });
}
const citations = (text, slug) => text.replace(/\{(\d+)\}/g, (_, n) => `<sup><a href="#/${slug}/source-${n}">[${n}]</a></sup>`);
const inline = (text, slug) => marked.parseInline(citations(wikilinks(text, slug), slug));

const imgSrc = f => (/^(https?:|data:)/.test(f) || f.includes("/") ? f : "images/" + f);
function imgTag(f, alt) {
  f = f.trim();
  const fb = f.includes("/") ? "" : ` onerror="this.onerror=null;this.src='${esc(f)}'"`; // repli : racine du site
  return `<img src="${esc(imgSrc(f))}" alt="${esc(alt)}" loading="lazy"${fb}>`;
}

// Découpe sur "|" en ignorant ceux qui sont dans un [[lien|texte]]
function splitTop(s) {
  const parts = []; let depth = 0, cur = "";
  for (let i = 0; i < s.length; i++) {
    if (s.startsWith("[[", i)) { depth++; cur += "[["; i++; }
    else if (s.startsWith("]]", i)) { depth--; cur += "]]"; i++; }
    else if (s[i] === "|" && depth === 0) { parts.push(cur); cur = ""; }
    else cur += s[i];
  }
  parts.push(cur);
  return parts;
}

// [[Fichier:nom.jpg|droite|300px|Légende avec [[liens]]]]
function figureHTML(body, slug) {
  const parts = splitTop(body).map(s => s.trim());
  const file = parts.shift();
  let align = "right", width = null, frame = true, full = false;
  const caps = [];
  for (const o of parts) {
    const k = o.toLowerCase();
    if (/^(droite|right)$/.test(k)) align = "right";
    else if (/^(gauche|left)$/.test(k)) align = "left";
    else if (/^(centre|center)$/.test(k)) align = "center";
    else if (/^(vignette|thumb|thumbnail)$/.test(k)) frame = true;
    else if (/^(sans-cadre|frameless)$/.test(k)) frame = false;
    else if (/^(pleine-largeur|full)$/.test(k)) { full = true; align = "center"; }
    else if (/^\d+px$/.test(k)) width = parseInt(k, 10);
    else if (o) caps.push(o);
  }
  const caption = caps.length ? caps[caps.length - 1] : "";
  const capHTML = caption ? inline(caption, slug) : "";
  const alt = capHTML.replace(/<[^>]*>/g, "") || file;
  const style = full ? "" : ` style="width:${width || 250}px"`;
  const cls = `thumb ${align}${frame ? "" : " frameless"}${full ? " full" : ""}`;
  return `\n\n<figure class="${cls}"${style}><a href="${esc(imgSrc(file))}" target="_blank" rel="noopener">${imgTag(file, alt)}</a>${capHTML ? `<figcaption>${capHTML}</figcaption>` : ""}</figure>\n\n`;
}

function processFiles(text, slug) {
  let out = "", i = 0, m;
  const re = /\[\[(?:Fichier|Image|File):/gi;
  while ((m = re.exec(text))) {
    const inner = m.index + m[0].length;
    let depth = 1, j = inner;
    while (j < text.length && depth > 0) {
      if (text.startsWith("[[", j)) { depth++; j += 2; }
      else if (text.startsWith("]]", j)) { depth--; j += 2; }
      else j++;
    }
    if (depth !== 0) break;
    out += text.slice(i, m.index) + figureHTML(text.slice(inner, j - 2), slug);
    i = j;
    re.lastIndex = j;
  }
  return out + text.slice(i);
}

/* ---------- GitHub ---------- */
const ghUrl = p => `https://github.com/${CONFIG.repo}/${p}`;
const getToken = () => { try { return localStorage.getItem("eg_token") || ""; } catch { return ""; } };
const b64 = s => btoa(unescape(encodeURIComponent(s)));
const unb64 = s => decodeURIComponent(escape(atob(s.replace(/\s/g, ""))));
let _branch = CONFIG.branch || null;

async function api(path, opts = {}) {
  const headers = { Accept: "application/vnd.github+json", ...(opts.headers || {}) };
  if (opts.auth !== false && getToken()) headers.Authorization = "Bearer " + getToken();
  const { auth, ...rest } = opts;
  const r = await fetch("https://api.github.com" + path, { ...rest, headers, cache: "no-store" });
  if (!r.ok) {
    let msg = r.statusText;
    try { msg = (await r.json()).message || msg; } catch {}
    const e = new Error(`GitHub ${r.status} — ${msg}`);
    e.status = r.status;
    throw e;
  }
  return r.json();
}
async function apiPublic(path) {
  try { return await api(path); }
  catch (e) { if (e.status === 401) return api(path, { auth: false }); throw e; }
}
async function getBranch() {
  if (_branch) return _branch;
  _branch = (await api(`/repos/${CONFIG.repo}`)).default_branch || "main";
  return _branch;
}
async function putFile(path, text, message) {
  const branch = await getBranch();
  let sha;
  try { sha = (await api(`/repos/${CONFIG.repo}/contents/${path}?ref=${encodeURIComponent(branch)}`)).sha; }
  catch (e) { if (e.status !== 404) throw e; }
  return api(`/repos/${CONFIG.repo}/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify({ message, content: b64(text), branch, ...(sha ? { sha } : {}) }),
  });
}
async function addToManifest(slug) {
  const branch = await getBranch();
  const cur = await api(`/repos/${CONFIG.repo}/contents/pages/index.json?ref=${encodeURIComponent(branch)}`);
  const list = JSON.parse(unb64(cur.content));
  if (list.includes(slug)) return;
  list.push(slug);
  await api(`/repos/${CONFIG.repo}/contents/pages/index.json`, {
    method: "PUT",
    body: JSON.stringify({ message: `Ajout de ${slug} à l'index`, content: b64(JSON.stringify(list, null, 2) + "\n"), branch, sha: cur.sha }),
  });
}

/* Modifications enregistrées mais pas encore publiées par GitHub Pages (~1 min) */
const pendingGet = () => { try { return JSON.parse(localStorage.getItem("eg_pending") || "{}"); } catch { return {}; } };
const pendingSet = o => { try { localStorage.setItem("eg_pending", JSON.stringify(o)); } catch {} };

/* ---------- Chargement ---------- */
async function fetchText(url) {
  try { const r = await fetch(url, { cache: "no-cache" }); return r.ok ? await r.text() : null; }
  catch { return null; }
}
function addPage(slug, raw) {
  const { meta, body } = parseFrontMatter(raw);
  state.pages[slug] = { slug, meta, body, raw, title: meta.title || slug };
}
async function load() {
  const pend = pendingGet();
  let list = [];
  const idx = await fetchText("pages/index.json");
  if (idx) { try { list = JSON.parse(idx); } catch (e) { console.warn("pages/index.json invalide", e); } }
  const now = Date.now();
  for (const [k, v] of Object.entries(pend)) {
    if (now - v.time > PENDING_MS) delete pend[k];
    else if (v.isNew && !list.includes(k)) list.push(k);
  }
  await Promise.all(list.map(async slug => {
    let raw = await fetchText(`pages/${slug}.md`);
    const p = pend[slug];
    if (p) { if (p.raw === raw) delete pend[slug]; else raw = p.raw; }
    if (raw == null) return console.warn(`Page introuvable : pages/${slug}.md`);
    addPage(slug, raw);
  }));
  state.order = list.filter(s => state.pages[s]);
  pendingSet(pend);
  rebuild();
}
function rebuild() {
  state.lookup = {}; state.backlinks = {}; state.wanted = {};
  for (const p of Object.values(state.pages)) {
    state.lookup[slugify(p.slug)] = p.slug;
    state.lookup[norm(p.title)] = p.slug;
    aliasesOf(p.meta).forEach(a => (state.lookup[norm(a)] = p.slug));
  }
  for (const p of Object.values(state.pages)) {
    for (const m of (p.body + " " + JSON.stringify(p.meta)).matchAll(LINK_RE)) {
      if (!m[1].split("#")[0].trim()) continue;
      const t = resolve(m[1]);
      if (t) { if (t !== p.slug) (state.backlinks[t] ||= new Set()).add(p.slug); }
      else {
        const k = slugify(m[1].split("#")[0]);
        (state.wanted[k] ||= { title: m[1].split("#")[0].trim(), from: new Set() }).from.add(p.slug);
      }
    }
  }
}

/* ---------- Construction d'un article ---------- */
function buildArticle(slug, meta, body) {
  const tmp = document.createElement("div");
  tmp.innerHTML = marked.parse(citations(wikilinks(processFiles(body, slug), slug), slug));

  const lead = tmp.querySelector(":scope > p");
  if (lead) lead.classList.add("lead");

  const sources = Array.isArray(meta.sources) ? meta.sources : [];
  if (sources.length) {
    const sec = document.createElement("div");
    sec.innerHTML = `<h2>Sources</h2><ol class="references">${sources.map((s, i) => `<li id="source-${i + 1}">${inline(s, slug)}</li>`).join("")}</ol>`;
    while (sec.firstChild) tmp.appendChild(sec.firstChild);
  }

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

  const title = meta.title || slug;
  let infobox = "";
  const info = meta.info && typeof meta.info === "object" && !Array.isArray(meta.info) ? meta.info : null;
  if (info || meta.image) {
    const rows = info ? Object.entries(info).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${inline(v, slug)}</td></tr>`).join("") : "";
    const cap = meta.image_caption ? `<div class="infobox-caption">${inline(meta.image_caption, slug)}</div>` : "";
    infobox = `<aside class="infobox">
      <div class="infobox-title">${esc(title)}</div>
      <div class="infobox-subtitle">${meta.image ? imgTag(meta.image, title) : ""}${cap}${esc(meta.subtitle || meta.type || "")}</div>
      ${rows ? `<table>${rows}</table>` : ""}</aside>`;
  }

  const cats = catsOf(meta);
  const catBox = cats.length ? `<div class="meta-box">Catégories : ${cats.map(c => `<a href="#/cat/${encodeURIComponent(c)}">${esc(c)}</a>`).join(", ")}</div>` : "";
  const back = [...(state.backlinks[slug] || [])].sort();
  const backBox = back.length ? `<div class="meta-box">Pages liées : ${back.map(s => `<a href="#/${s}">${esc(state.pages[s].title)}</a>`).join(", ")}</div>` : "";

  const root = document.createElement("div");
  root.innerHTML = `${infobox}<div class="article-body"></div>${catBox}${backBox}`;
  const bodyEl = root.querySelector(".article-body");
  while (tmp.firstChild) bodyEl.appendChild(tmp.firstChild);
  if (toc) {
    const l = bodyEl.querySelector(".lead");
    (l || bodyEl).insertAdjacentHTML(l ? "afterend" : "afterbegin", toc);
  }
  return root;
}

const tabsHTML = (slug, mode) => `<div class="tabs">
  <div class="tabs-left"><span class="active">Article</span></div>
  <div class="tabs-right">
    <a href="#/${slug}" class="${mode === "read" ? "active" : ""}">Lire</a>
    <a href="#/edit/${slug}" class="${mode === "edit" ? "active" : ""}">Modifier</a>
    <a href="#/history/${slug}" class="${mode === "history" ? "active" : ""}">Historique</a>
  </div></div>`;

/* ---------- Pages ---------- */
function renderPage(slug, rev) {
  const p = rev ? { slug, meta: rev.meta, body: rev.body, title: rev.meta.title || slug } : state.pages[slug];
  if (!p) return renderMissing(slug);
  document.title = `${p.title} — ${CONFIG.siteName}`;
  app.innerHTML = `<div class="page-header"><h1>${esc(p.title)}</h1>${tabsHTML(slug, rev ? "rev" : "read")}</div>
    <div class="content">${rev ? rev.banner : ""}<div id="article"></div>
    <footer class="footer"><p>${p.meta.updated ? `Dernière modification : ${esc(p.meta.updated)}` : ""}</p></footer></div>`;
  document.getElementById("article").appendChild(buildArticle(slug, p.meta, p.body));
}

function renderMissing(slug) {
  document.title = `Page inexistante — ${CONFIG.siteName}`;
  app.innerHTML = `<div class="page-header"><h1>Page inexistante</h1></div>
    <div class="content"><p>Il n'y a pas encore d'article nommé « ${esc(slug)} ».</p>
    <p><a class="btn primary" href="#/edit/${esc(slugify(slug))}">Créer cette page</a></p>
    <p><a href="#/">Retour à l'accueil</a></p></div>`;
}

/* ---------- Accueil, index, catégories ---------- */
function excerptHTML(p, max = 85) {
  const block = p.body.split(/\n\s*\n/).map(s => s.trim())
    .find(s => s && !/^(#{1,6}\s|\[\[(?:Fichier|Image|File):|!\[|<|[-*+]\s|>|\|)/i.test(s));
  if (!block) return "";
  let t = block.replace(LINK_RE, (_, a, b) => b || a.split("#")[0]).replace(FILE_RE, "").replace(/\{\d+\}/g, "").replace(/\s+/g, " ").trim();
  const words = t.split(" ");
  if (words.length > max) t = words.slice(0, max).join(" ") + "…";
  if ((t.match(/\*\*/g) || []).length % 2) t += "**";
  return marked.parseInline(t);
}
function pickFeatured(pages) {
  const f = pages.filter(p => /^(true|oui|yes)$/i.test(String(p.meta.featured || "")));
  const pool = f.length ? f : pages;
  if (!pool.length) return null;
  const d = new Date();
  return pool[(d.getFullYear() * 372 + d.getMonth() * 31 + d.getDate()) % pool.length];
}
function categoryMap() {
  const groups = {};
  state.order.map(s => state.pages[s]).forEach(p => {
    (catsOf(p.meta).length ? catsOf(p.meta) : ["Sans catégorie"]).forEach(c => (groups[c] ||= []).push(p));
  });
  return groups;
}
function dykHTML() {
  const facts = state.order.flatMap(s => [].concat(state.pages[s].meta.facts || []).map(f => ({ f, s })));
  for (let i = facts.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [facts[i], facts[j]] = [facts[j], facts[i]]; }
  return `<ul>${facts.slice(0, 4).map(({ f, s }) => `<li>… que ${inline(f, s)}&nbsp;?</li>`).join("")}</ul>`;
}

function renderHome() {
  document.title = CONFIG.siteName;
  const pages = state.order.map(s => state.pages[s]);
  const groups = categoryMap();
  const feat = pickFeatured(pages);
  const hasFacts = pages.some(p => [].concat(p.meta.facts || []).length);
  const recent = [...pages].reverse().slice(0, 6);
  const wanted = Object.entries(state.wanted).sort((a, b) => b[1].from.size - a[1].from.size).slice(0, 8);

  const featBox = feat ? `<section class="mp-box mp-blue"><h2>Article à la une</h2><div class="mp-body">
      ${feat.meta.image ? `<div class="mp-img">${imgTag(feat.meta.image, feat.title)}</div>` : ""}
      <p>${excerptHTML(feat)}</p>
      <p class="mp-more"><a href="#/${feat.slug}"><b>Lire la suite</b></a></p><div class="mp-clear"></div></div></section>` : "";
  const dykBox = hasFacts ? `<section class="mp-box mp-green"><h2>Le saviez-vous ?</h2><div class="mp-body">
      <div id="dyk">${dykHTML()}</div><p class="mp-more"><a href="#" data-reroll>Autres anecdotes</a></p></div></section>` : "";
  const recentBox = `<section class="mp-box mp-orange"><h2>Articles récents</h2><div class="mp-body"><ul>
      ${recent.map(p => `<li><a href="#/${p.slug}">${esc(p.title)}</a>${p.meta.subtitle ? ` <span class="note">— ${esc(p.meta.subtitle)}</span>` : ""}</li>`).join("")}
      </ul><p class="mp-more"><a href="#/all">Toutes les pages</a></p></div></section>`;
  const wantedBox = `<section class="mp-box mp-purple"><h2>Pages à créer</h2><div class="mp-body">
      ${wanted.length ? `<ul>${wanted.map(([k, w]) => `<li><a class="redlink" href="#/edit/${k}">${esc(w.title)}</a> <span class="note">— citée dans ${w.from.size} page${w.from.size > 1 ? "s" : ""}</span></li>`).join("")}</ul>`
        : "<p>Aucun lien rouge pour l'instant.</p>"}</div></section>`;
  const portals = `<section class="mp-box mp-blue"><h2>Catégories</h2><div class="mp-body"><div class="mp-portals">
      ${Object.keys(groups).sort().map(c => `<a class="portal" href="#/cat/${encodeURIComponent(c)}"><b>${esc(c)}</b><small>${groups[c].length} page${groups[c].length > 1 ? "s" : ""}</small></a>`).join("")}
      </div></div></section>`;

  app.innerHTML = `<div class="mp-welcome"><h1>Bienvenue sur ${esc(CONFIG.siteName)}</h1>
      <p>${esc(CONFIG.tagline)} — <b>${pages.length}</b> article${pages.length > 1 ? "s" : ""}, <b>${Object.keys(groups).length}</b> catégorie${Object.keys(groups).length > 1 ? "s" : ""}.</p></div>
    <div class="mp-grid"><div>${featBox}${dykBox}</div><div>${recentBox}${wantedBox}</div></div>
    ${portals}`;
}

function renderAll() {
  document.title = `Toutes les pages — ${CONFIG.siteName}`;
  const pages = state.order.map(s => state.pages[s]).sort((a, b) => a.title.localeCompare(b.title, "fr"));
  const by = {};
  pages.forEach(p => (by[norm(p.title)[0]?.toUpperCase() || "#"] ||= []).push(p));
  app.innerHTML = `<div class="page-header"><h1>Toutes les pages</h1></div><div class="content">
    ${Object.keys(by).sort().map(l => `<h3>${l}</h3><ul class="page-list">${by[l].map(p => `<li><a href="#/${p.slug}">${esc(p.title)}</a></li>`).join("")}</ul>`).join("")}
    <p><a href="#/">Retour à l'accueil</a></p></div>`;
}

function renderCategory(name) {
  document.title = `${name} — ${CONFIG.siteName}`;
  const pages = (categoryMap()[name] || []).sort((a, b) => a.title.localeCompare(b.title, "fr"));
  app.innerHTML = `<div class="page-header"><h1>Catégorie : ${esc(name)}</h1></div>
    <div class="content"><p class="note">${pages.length} page${pages.length > 1 ? "s" : ""}</p>
    <ul class="page-list">${pages.map(p => `<li><a href="#/${p.slug}">${esc(p.title)}</a></li>`).join("") || "<li>Aucune page.</li>"}</ul>
    <p><a href="#/">Retour à l'accueil</a></p></div>`;
}

/* ---------- Historique (commits GitHub) ---------- */
async function renderHistory(slug) {
  const p = state.pages[slug];
  const title = p ? p.title : slug;
  document.title = `Historique de ${title} — ${CONFIG.siteName}`;
  const head = `<div class="page-header"><h1>${esc(title)} : historique</h1>${tabsHTML(slug, "history")}</div>`;
  app.innerHTML = head + `<div class="content"><p>Chargement de l'historique…</p></div>`;
  try {
    const commits = await apiPublic(`/repos/${CONFIG.repo}/commits?path=${encodeURIComponent(`pages/${slug}.md`)}&per_page=50`);
    if (state.current !== null || !location.hash.startsWith("#/history/")) return;
    const items = commits.map((c, i) => {
      const who = c.author ? `<a href="${esc(c.author.html_url)}" target="_blank" rel="noopener">${esc(c.author.login)}</a>` : esc(c.commit.author.name);
      const msg = esc(c.commit.message.split("\n")[0]);
      return `<li>(${i === 0 ? "actuelle" : `<a href="#/rev/${slug}/${c.sha}">voir</a>`} | <a href="${esc(c.html_url)}" target="_blank" rel="noopener">diff</a>)
        <a href="#/${i === 0 ? slug : `rev/${slug}/${c.sha}`}">${esc(fmtDate(c.commit.author.date))}</a> <b>${who}</b> <span class="note">(${msg})</span></li>`;
    }).join("");
    app.innerHTML = head + `<div class="content"><p class="note">Chaque enregistrement est un commit GitHub. « voir » affiche l'ancienne version, « diff » ouvre la comparaison sur GitHub.</p>
      ${items ? `<ul class="history">${items}</ul>` : "<p>Aucune modification trouvée pour cette page (fichier pas encore publié ?).</p>"}</div>`;
  } catch (e) {
    app.innerHTML = head + `<div class="content"><p class="ed-status error">Impossible de charger l'historique : ${esc(e.message)}</p>
      <p>Le dépôt doit être public (ou ton jeton doit y avoir accès). Sans jeton, GitHub limite à 60 requêtes par heure. 
      <a href="${ghUrl(`commits/HEAD/pages/${slug}.md`)}" target="_blank" rel="noopener">Voir l'historique directement sur GitHub</a>.</p></div>`;
  }
}

async function renderRev(slug, sha) {
  document.title = `Ancienne version — ${CONFIG.siteName}`;
  app.innerHTML = `<div class="page-header"><h1>${esc(slug)}</h1>${tabsHTML(slug, "rev")}</div><div class="content"><p>Chargement de la version…</p></div>`;
  try {
    const [raw, commit] = await Promise.all([
      fetchText(`https://raw.githubusercontent.com/${CONFIG.repo}/${sha}/pages/${slug}.md`),
      apiPublic(`/repos/${CONFIG.repo}/commits/${sha}`).catch(() => null),
    ]);
    if (raw == null) throw new Error("Version introuvable.");
    state.revRaw = raw;
    const { meta, body } = parseFrontMatter(raw);
    const who = commit ? (commit.author ? commit.author.login : commit.commit.author.name) : "?";
    const when = commit ? fmtDate(commit.commit.author.date) : sha.slice(0, 7);
    const banner = `<div class="meta-box rev-banner" style="margin-top:0;margin-bottom:16px"><b>Ancienne version</b> du ${esc(when)} par ${esc(who)}.
      <a href="#/${slug}">Version actuelle</a> · <a href="#" data-restore>Restaurer cette version</a> · <a href="#/history/${slug}">Historique</a></div>`;
    renderPage(slug, { meta, body, banner });
  } catch (e) {
    app.innerHTML = `<div class="page-header"><h1>${esc(slug)}</h1>${tabsHTML(slug, "rev")}</div><div class="content"><p class="ed-status error">${esc(e.message)}</p><p><a href="#/history/${slug}">Retour à l'historique</a></p></div>`;
  }
}

/* ---------- Éditeur ---------- */
function newTemplate(slug) {
  const title = state.titles[slug] || state.wanted[slug]?.title || slug.replace(/-/g, " ").replace(/^./, c => c.toUpperCase());
  return `---\ntitle: ${title}\nsubtitle: \ncategory: \nupdated: \ninfo:\n  Clé: Valeur\n---\n\n**${title}** est …\n\n## Section\n\nTexte.\n`;
}
function wrapSel(ta, pre, post = "", ph = "") {
  const s = ta.selectionStart, e = ta.selectionEnd;
  const sel = ta.value.slice(s, e) || ph;
  ta.setRangeText(pre + sel + post, s, e, "end");
  ta.focus();
  ta.setSelectionRange(s + pre.length, s + pre.length + sel.length);
}
function toast(msg) {
  const t = document.createElement("div");
  t.className = "toast"; t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 7000);
}

function renderEdit(rawSlug) {
  const slug = slugify(rawSlug);
  if (!slug) return (location.hash = "#/");
  if (slug !== rawSlug) return location.replace("#/edit/" + slug);
  const existing = state.pages[slug];
  const isNew = !existing;
  const text = state.seed ?? (existing ? existing.raw : newTemplate(slug));
  state.seed = null;
  const title = existing ? existing.title : state.titles[slug] || slug;
  document.title = `Modification de ${title} — ${CONFIG.siteName}`;

  app.innerHTML = `<div class="page-header"><h1>${isNew ? "Création" : "Modification"} : ${esc(title)}</h1>${tabsHTML(slug, "edit")}</div>
  <div class="content editor">
    ${isNew ? `<p class="note">Cette page n'existe pas encore. Elle sera créée dans <code>pages/${esc(slug)}.md</code> et ajoutée à l'index.</p>` : ""}
    <div class="toolbar">
      <button type="button" class="btn" data-w="**|**|gras">Gras</button>
      <button type="button" class="btn" data-w="*|*|italique">Italique</button>
      <button type="button" class="btn" data-w="\n## |\n|Titre de section">Titre</button>
      <button type="button" class="btn" data-w="\n### |\n|Sous-titre">Sous-titre</button>
      <button type="button" class="btn" data-w="[[|]]|page|texte">Lien</button>
      <button type="button" class="btn" data-w="\n[[Fichier:|]]\n|fichier.jpg|droite|300px|Légende">Image</button>
      <button type="button" class="btn" data-w="{|}|1">Citation</button>
      <button type="button" class="btn" data-w="\n- ||élément">Liste</button>
    </div>
    <textarea id="ed" spellcheck="false" aria-label="Contenu Markdown de la page">${esc(text)}</textarea>
    <p><label>Résumé de la modification <input id="ed-msg" type="text" class="ed-input" placeholder="${isNew ? "Création de la page" : "Ce que tu as changé"}"></label></p>
    <div class="ed-actions">
      <button type="button" class="btn" id="ed-preview">Aperçu</button>
      <button type="button" class="btn primary" id="ed-save">Enregistrer sur GitHub</button>
      <button type="button" class="btn" id="ed-dl">Télécharger le .md</button>
      <button type="button" class="btn" id="ed-copy">Copier</button>
      <a href="#/${isNew ? "" : slug}">Annuler</a>
    </div>
    <div id="ed-status" class="ed-status" role="status"></div>
    <details id="ed-token" ${getToken() ? "" : "open"}><summary>Connexion GitHub (nécessaire pour enregistrer) <span id="tok-state" class="note"></span></summary>
      <ol>
        <li>Ouvre <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub → fine-grained token</a>.</li>
        <li><i>Repository access</i> : « Only select repositories » → <code>${esc(CONFIG.repo)}</code>.</li>
        <li><i>Permissions → Repository → Contents</i> : « Read and write ».</li>
        <li>Colle le jeton ici :</li>
      </ol>
      <input id="tok" type="password" class="ed-input" placeholder="github_pat_…" autocomplete="off">
      <button type="button" class="btn" id="tok-save">Enregistrer le jeton</button>
      <button type="button" class="btn" id="tok-clear">Effacer</button>
      <p class="note">Le jeton reste uniquement dans le navigateur de cet appareil. Ne l'enregistre pas sur un ordinateur partagé.
      Sans jeton, tu peux télécharger le .md ou <a id="gh-edit" href="${ghUrl(`edit/main/pages/${slug}.md`)}" target="_blank" rel="noopener">modifier le fichier sur GitHub</a>.</p>
    </details>
    <div id="ed-preview-box"></div>
  </div>`;

  const $ = id => document.getElementById(id);
  const ta = $("ed"), status = $("ed-status");
  const say = (cls, msg) => { status.className = "ed-status " + cls; status.textContent = msg; };
  const tokState = () => ($("tok-state").textContent = getToken() ? "— jeton enregistré ✓" : "— aucun jeton");
  tokState();
  getBranch().then(b => { $("gh-edit").href = ghUrl(`edit/${b}/pages/${slug}.md`); }).catch(() => {});

  app.querySelectorAll("[data-w]").forEach(b => b.addEventListener("click", () => {
    const [pre, post, ph, ...extra] = b.dataset.w.split("|");
    // formats : "avant|après|placeholder" ; Image/Lien utilisent des champs supplémentaires
    wrapSel(ta, pre, post, [ph, ...extra].join("|"));
  }));
  $("ed-preview").addEventListener("click", () => {
    const { meta, body } = parseFrontMatter(ta.value);
    const box = $("ed-preview-box");
    box.innerHTML = `<div class="meta-box" style="margin-top:20px">Aperçu — pas encore enregistré</div><h1 style="margin-top:14px">${esc(meta.title || slug)}</h1>`;
    box.appendChild(buildArticle(slug, meta, body));
    box.scrollIntoView({ behavior: "smooth" });
  });
  $("ed-dl").addEventListener("click", () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([ta.value], { type: "text/markdown" }));
    a.download = `${slug}.md`; a.click(); URL.revokeObjectURL(a.href);
  });
  $("ed-copy").addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(ta.value); say("ok", "Markdown copié."); }
    catch { ta.select(); say("info", "Sélectionné : fais Ctrl+C."); }
  });
  $("tok-save").addEventListener("click", () => {
    const v = $("tok").value.trim();
    if (!v) return say("error", "Colle d'abord un jeton.");
    try { localStorage.setItem("eg_token", v); } catch {}
    $("tok").value = ""; tokState(); say("ok", "Jeton enregistré sur cet appareil.");
  });
  $("tok-clear").addEventListener("click", () => { try { localStorage.removeItem("eg_token"); } catch {} tokState(); say("info", "Jeton effacé."); });

  $("ed-save").addEventListener("click", async () => {
    const raw = ta.value;
    const { meta } = parseFrontMatter(raw);
    if (!meta.title) return say("error", "L'en-tête doit contenir une ligne « title: … ».");
    if (!getToken()) { $("ed-token").open = true; return say("error", "Ajoute d'abord ton jeton GitHub (section ci-dessous)."); }
    const btn = $("ed-save");
    btn.disabled = true; say("info", "Enregistrement en cours…");
    try {
      const msg = $("ed-msg").value.trim() || (isNew ? `Création de ${meta.title}` : `Modification de ${meta.title}`);
      const res = await putFile(`pages/${slug}.md`, raw, msg);
      if (isNew) await addToManifest(slug);
      const pend = pendingGet();
      pend[slug] = { raw, time: Date.now(), isNew };
      pendingSet(pend);
      if (!state.order.includes(slug)) state.order.push(slug);
      addPage(slug, raw);
      rebuild();
      toast(`Enregistré (commit ${res.commit.sha.slice(0, 7)}). Le site public se met à jour dans environ une minute.`);
      state.current = null;
      location.hash = `#/${slug}`;
    } catch (e) {
      btn.disabled = false;
      say("error", e.status === 401 || e.status === 403 || e.status === 404
        ? `${e.message}. Vérifie le jeton : accès au dépôt ${CONFIG.repo} et permission Contents « Read and write ».`
        : e.message);
    }
  });
}

function newPagePrompt() {
  const t = prompt("Titre de la nouvelle page ?");
  if (!t) return;
  let s = slugify(t);
  if (!s) return;
  if (RESERVED.includes(s)) s += "-page";
  if (resolve(s)) { location.hash = "#/" + resolve(s); return; }
  state.titles[s] = t.trim();
  location.hash = "#/edit/" + s;
}

/* ---------- Routage ---------- */
function route() {
  const [a, b, c] = location.hash.replace(/^#\/?/, "").split("/").map(safeDecode);
  hideResults();
  const top = () => window.scrollTo(0, 0);
  if (!a) { state.current = null; renderHome(); return top(); }
  if (a === "random") {
    const slugs = state.order;
    if (slugs.length) location.hash = "#/" + slugs[Math.floor(Math.random() * slugs.length)];
    return;
  }
  if (a === "all") { state.current = null; renderAll(); return top(); }
  if (a === "cat") { state.current = null; renderCategory(b || ""); return top(); }
  if (a === "edit") { state.current = null; renderEdit(b || ""); return top(); }
  if (a === "history") { state.current = null; renderHistory(b || ""); return top(); }
  if (a === "rev") { state.current = null; renderRev(b || "", c || ""); return top(); }

  const canon = state.pages[a] ? a : resolve(a);
  if (canon && canon !== a) return location.replace("#/" + canon + (b ? "/" + b : ""));
  if (state.current !== a) { state.current = a; renderPage(a); }
  const target = b && document.getElementById(b);
  if (target) {
    target.scrollIntoView();
    if (target.tagName === "LI") { target.classList.add("flash"); setTimeout(() => target.classList.remove("flash"), 1500); }
  } else top();
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
    p._plain ||= stripMd(p.body);
    p._norm ||= norm(p._plain);
    let score = 0, snippet = "";
    if (title === term) score = 100; else if (title.includes(term)) score = 50;
    const i = p._norm.indexOf(term);
    if (i >= 0) { score += 10; snippet = "…" + p._plain.slice(Math.max(0, i - 40), i + 80).replace(/\s+/g, " ") + "…"; }
    if (score) hits.push({ p, score, snippet });
  }
  hits.sort((x, y) => y.score - x.score);
  box.innerHTML = hits.length
    ? hits.slice(0, 8).map(h => `<a href="#/${h.p.slug}">${esc(h.p.title)}<small>${esc(h.snippet || h.p.meta.subtitle || "")}</small></a>`).join("")
    : `<div class="empty">Aucun résultat.</div>`;
  box.hidden = false;
}
q.addEventListener("input", search);
q.addEventListener("keydown", e => {
  if (e.key === "Enter") { const a = box.querySelector("a"); if (a) { location.hash = a.getAttribute("href"); q.blur(); } }
  if (e.key === "Escape") hideResults();
});
document.getElementById("go").addEventListener("click", search);
document.addEventListener("click", e => {
  if (!e.target.closest(".search")) hideResults();
  if (e.target.closest(".js-new")) { e.preventDefault(); newPagePrompt(); }
});
app.addEventListener("click", e => {
  if (e.target.closest("[data-reroll]")) { e.preventDefault(); document.getElementById("dyk").innerHTML = dykHTML(); }
  if (e.target.closest("[data-restore]")) { e.preventDefault(); state.seed = state.revRaw; location.hash = "#/edit/" + (location.hash.split("/")[2] || ""); }
});

/* ---------- Démarrage ---------- */
load().then(() => {
  if (!Object.keys(state.pages).length) {
    app.innerHTML = `<div class="content"><h1>Aucune page chargée</h1>
      <p>Causes fréquentes sur GitHub Pages :</p><ul>
      <li>Il manque le fichier vide <code>.nojekyll</code> à la racine du dépôt (sans lui, GitHub transforme les .md et ils disparaissent).</li>
      <li>Les fichiers sont dans un sous-dossier au lieu de la racine du dépôt.</li>
      <li><code>pages/index.json</code> est absent ou mal formé.</li></ul></div>`;
    return;
  }
  window.addEventListener("hashchange", route);
  route();
}).catch(err => {
  app.innerHTML = `<p>Impossible de charger l'encyclopédie (${esc(err.message)}). En local, lance un serveur : <code>python -m http.server</code></p>`;
});
