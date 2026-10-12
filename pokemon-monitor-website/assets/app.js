/* Poké Monitor — dashboard. Leest de JSON-bestanden die de monitor op de 'data'-tak zet. */
(() => {
  "use strict";
  const CFG = Object.assign({ owner: "", repo: "", branch: "data", refreshStatusSec: 60, refreshDataSec: 180 },
                            window.POKE_CONFIG || {});
  const qs = new URLSearchParams(location.search);
  const DEMO = qs.has("demo") || location.protocol === "file:" || ["localhost", "127.0.0.1"].includes(location.hostname);
  const $ = (sel, el = document) => el.querySelector(sel);

  // ---------- waar staan de gegevens ----------
  function repoInfo() {
    let owner = CFG.owner, repo = CFG.repo;
    if (!owner && location.hostname.endsWith(".github.io")) owner = location.hostname.split(".")[0];
    if (!repo) repo = location.pathname.split("/").filter(Boolean)[0] || "";
    return { owner, repo, branch: CFG.branch || "data" };
  }
  const RI = repoInfo();
  const DEMO_MODE = DEMO || !RI.owner || !RI.repo;     // geen repository bekend: voorbeeldgegevens tonen
  async function getJSON(file, fresh) {
    if (DEMO_MODE) {
      const r = await fetch(`demo/${file}?t=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`${file}: ${r.status}`);
      return r.json();
    }
    // status (online/offline) via de GitHub-API: altijd vers. Lukt dat niet (bv. limiet), dan via raw (max. 5 min oud).
    if (fresh) {
      try {
        const r = await fetch(`https://api.github.com/repos/${RI.owner}/${RI.repo}/contents/${file}?ref=${RI.branch}`,
                              { headers: { Accept: "application/vnd.github.raw+json" }, cache: "no-store" });
        if (r.ok) return r.json();
      } catch (e) { /* val terug op raw */ }
    }
    const r = await fetch(`https://raw.githubusercontent.com/${RI.owner}/${RI.repo}/${RI.branch}/${file}?t=${Date.now()}`,
                          { cache: "no-store" });
    if (!r.ok) throw new Error(`${file}: ${r.status}`);
    return r.json();
  }

  // ---------- hulpjes ----------
  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const safeUrl = (u) => (/^https?:\/\//i.test(u || "") ? u : "#");
  const fmtEUR = new Intl.NumberFormat("nl-NL", { style: "currency", currency: "EUR" });
  const euro = (n) => (typeof n === "number" ? fmtEUR.format(n) : "—");
  const nowSec = () => Date.now() / 1000;
  function ago(sec) {
    const d = Math.max(0, Math.round(nowSec() - sec));
    if (d < 60) return "zojuist";
    if (d < 3600) return `${Math.round(d / 60)} min geleden`;
    if (d < 86400) return `${Math.round(d / 3600)} uur geleden`;
    return `${Math.round(d / 86400)} dagen geleden`;
  }
  function duration(fromIso) {
    const s = Math.max(0, nowSec() - Date.parse(fromIso) / 1000);
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h >= 48) return `${Math.floor(h / 24)} dagen`;
    return h ? `${h} u ${m} min` : `${m} min`;
  }
  const hhmm = (iso) => new Date(iso).toLocaleTimeString("nl-NL", { hour: "2-digit", minute: "2-digit" });
  function dayLabel(iso) {
    const d = new Date(iso), t = new Date(), y = new Date(); y.setDate(t.getDate() - 1);
    const same = (a, b) => a.toDateString() === b.toDateString();
    if (same(d, t)) return "Vandaag";
    if (same(d, y)) return "Gisteren";
    return d.toLocaleDateString("nl-NL", { weekday: "short", day: "numeric", month: "short" });
  }
  function diffPct(price, ref) {
    if (typeof price !== "number" || typeof ref !== "number" || ref <= 0) return null;
    return (price / ref - 1) * 100;
  }
  function diffHtml(price, ref, label = "") {
    const d = diffPct(price, ref);
    if (d === null) return "";
    const cls = d <= 0.5 ? "good" : d <= 15 ? "mid" : "bad";
    const txt = Math.abs(d) < 0.5 ? "= ref" : `${d > 0 ? "+" : "−"}${Math.abs(d).toFixed(0)}%`;
    return `<span class="diff ${cls}" title="t.o.v. ${esc(label || "referentie")} ${euro(ref)}">${txt}</span>`;
  }
  const stockPill = (s) => (s === true ? `<span class="pill in">op voorraad</span>` :
                            s === false ? `<span class="pill out">uitverkocht</span>` : `<span class="pill unk">onbekend</span>`);

  // ---------- gegevens ----------
  const S = { status: null, products: [], alerts: [], history: [], err: "" };
  const setShort = (name) => {
    const x = (S.status?.sets || []).find((s) => s.name === name);
    return (x && x.short) || name || "—";
  };
  const setOrder = (name) => {
    const i = (S.status?.sets || []).findIndex((s) => s.name === name);
    return i < 0 ? 999 : i;
  };
  const histKey = (set, product) => `${set}|${product}`;
  let HIST = new Map();

  async function loadStatus() {
    try {
      S.status = await getJSON("status.json", true); S.err = "";
      if (DEMO_MODE && S.status) {                       // voorbeeldgegevens: altijd 'online' tonen
        S.status.heartbeat = Math.round(nowSec()) - 40;
        S.status.started = new Date(Date.now() - 3.2 * 3600e3).toISOString();
      }
    }
    catch (e) { S.err = String(e.message || e); }
  }
  async function loadData() {
    const [p, a, h] = await Promise.allSettled([getJSON("products.json"), getJSON("alerts.json"), getJSON("history.json")]);
    if (p.status === "fulfilled") S.products = p.value.products || [];
    if (a.status === "fulfilled") S.alerts = a.value.alerts || [];
    if (h.status === "fulfilled") {
      S.history = h.value.items || [];
      HIST = new Map(S.history.map((x) => [histKey(x.set, x.product), x]));
    }
  }

  // ---------- liveness ----------
  function live() {
    const st = S.status;
    if (!st) return { cls: "off", title: "Geen gegevens", sub: "De monitor heeft (nog) niets gepubliceerd." };
    const age = nowSec() - (st.heartbeat || 0);
    const limit = (st.interval_min || 3) * 60 * 2 + 360;   // 2 hartslagen gemist + cache van GitHub
    if (!st.online || age > limit) {
      return { cls: "off", title: "Offline", sub: `Laatst gezien ${ago(st.heartbeat || 0)}.` };
    }
    if (!st.monitoring) return { cls: "paused", title: "Gepauzeerd", sub: "De app staat aan, maar de monitor is gestopt." };
    const n = (st.shops || []).filter((s) => s.enabled).length;
    return { cls: "on", title: "Online", sub: `Controleert ${n} shops · draait al ${duration(st.started || st.updated)}.` };
  }

  function renderHeader() {
    const L = live();
    const b = $("#brand-status");
    b.className = `sub ${L.cls}`;
    b.textContent = `● ${L.title.toLowerCase()}`;
    $("#meta-updated").textContent = S.status ? ago(S.status.heartbeat) : "—";
    $("#meta-shops").textContent = S.status ? (S.status.shops || []).filter((s) => s.enabled).length : "—";
    $("#meta-products").textContent = S.products.length || "—";
    const inStock = S.products.filter((p) => p.stock === true).length;
    $("#cnt-products").textContent = S.products.length ? `${inStock} op voorraad` : "";
    const day = S.alerts.filter((a) => nowSec() - Date.parse(a.t) / 1000 < 86400).length;
    $("#cnt-alerts").textContent = day ? `${day} vandaag` : "";
    $("#foot-version").textContent = S.status?.version ? `· monitor v${S.status.version}` : "";
  }

  // ---------- router ----------
  const TABS = ["home", "meldingen", "producten", "historie"];
  function route() {
    const [tab, query] = (location.hash.replace(/^#/, "") || "home").split("?");
    return { tab: TABS.includes(tab) ? tab : "home", params: new URLSearchParams(query || "") };
  }
  function setParams(tab, obj) {
    const p = new URLSearchParams();
    Object.entries(obj).forEach(([k, v]) => {
      if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) return;
      p.set(k, Array.isArray(v) ? v.join("~") : v);
    });
    const s = p.toString();
    history.replaceState(null, "", `#${tab}${s ? "?" + s : ""}`);
  }
  function show() {
    const { tab } = route();
    document.querySelectorAll(".tab").forEach((a) => a.classList.toggle("active", a.dataset.tab === tab));
    const act = document.querySelector(".tab.active");
    if (act && act.parentElement.scrollWidth > act.parentElement.clientWidth) {
      act.parentElement.scrollLeft = act.offsetLeft - 16;          // actief tabblad in beeld (telefoon)
    }
    TABS.forEach((t) => ($(`#view-${t}`).hidden = t !== tab));
    VIEWS[tab].render();
  }

  // =========================================================== HOME
  const TG_SVG = `<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><path d="M9.04 15.6 8.9 19.4c.4 0 .58-.17.8-.38l1.9-1.82 3.94 2.88c.72.4 1.24.19 1.43-.67l2.6-12.18c.25-1.08-.4-1.5-1.1-1.24L3.2 10.5c-1.05.41-1.03 1-.18 1.27l3.94 1.23 9.14-5.77c.43-.28.82-.12.5.16"/></svg>`;
  function shopState(s) {
    if (!s.enabled) return "off";
    if (!S.status?.monitoring) return "off";
    return /blok|pauze|fout|verbinding|429|403/i.test(s.status || "") ? "warn" : "";
  }
  const VIEWS = {};
  VIEWS.home = {
    render() {
      const el = $("#view-home");
      if (!S.status) {
        el.innerHTML = `<div class="empty"><h2>Nog geen gegevens</h2><p>${S.err ? esc(S.err) + "<br>" : ""}
          Zet in de monitor op het tabblad <b>Website</b> de repository en het token, en klik op <b>Nu publiceren</b>.</p></div>`;
        return;
      }
      const L = live(), st = S.status;
      const inStock = S.products.filter((p) => p.stock === true);
      const shopsIn = new Set(inStock.map((p) => p.shop)).size;
      const day = S.alerts.filter((a) => nowSec() - Date.parse(a.t) / 1000 < 86400);
      const enabled = (st.shops || []).filter((s) => s.enabled);
      const tg = st.telegram && /^https:\/\/(t|telegram)\.me\//.test(st.telegram) ? st.telegram : "";
      el.innerHTML = `
        <div class="${tg ? "grid2" : ""}">
          <div class="panel status-card ${L.cls}">
            <div class="pulse"></div>
            <div><div class="kicker">status monitor</div><h2>${esc(L.title)}</h2><p>${esc(L.sub)}</p>
              <p style="font-family:var(--mono);font-size:11px;color:var(--ink-faint);margin-top:6px">laatste hartslag: ${esc(ago(st.heartbeat))}</p></div>
          </div>
          ${tg ? `<div class="panel tg-card"><div class="kicker">meldingen op je telefoon</div>
              <p>Krijg elke restock direct binnen, met een knop naar de shop.</p>
              <a class="btn-tg" href="${esc(tg)}" target="_blank" rel="noopener">${TG_SVG} Word lid van de Telegram-groep</a></div>` : ""}
        </div>
        <div class="summary-bar" style="margin-top:14px">
          <div class="stat"><div class="label">shops</div><div class="value">${enabled.length}</div><div class="sub">van ${(st.shops || []).length} in de lijst</div></div>
          <a class="stat" href="#producten" style="text-decoration:none"><div class="label">producten gevolgd</div><div class="value">${S.products.length}</div><div class="sub">${(st.sets || []).length} sets</div></a>
          <a class="stat" href="#producten?stock=in" style="text-decoration:none"><div class="label">nu op voorraad</div><div class="value mint">${inStock.length}</div><div class="sub">bij ${shopsIn} shops</div></a>
          <a class="stat" href="#meldingen" style="text-decoration:none"><div class="label">meldingen 24 u</div><div class="value">${day.length}</div><div class="sub">${day.filter((a) => a.stock).length} op voorraad</div></a>
        </div>
        <div class="section-head"><h3>Laatste meldingen</h3><span class="rule"></span><a href="#meldingen">alle meldingen →</a></div>
        <div>${S.alerts.slice(0, 6).map(alertRow).join("") || `<p class="note">Nog geen meldingen.</p>`}</div>
        <div class="section-head"><h3>Shops</h3><span class="rule"></span></div>
        <div class="shops">${(st.shops || []).filter((s) => s.enabled).map((s) => `
          <div class="shop ${shopState(s)}"><span class="dot"></span><div>
            <div class="nm">${esc(s.name)}</div>
            <div class="st">${s.products} producten · ${s.in_stock} op voorraad${s.method ? " · " + esc(s.method) : ""}</div></div></div>`).join("")}
        </div>`;
    },
  };

  // =========================================================== MELDINGEN
  function alertRow(a) {
    const isNew = /nieuw/.test(a.reason || ""), oos = /nog niet/.test(a.reason || "");
    return `<div class="alert ${a.stock ? "stock" : ""}">
      <div class="time">${hhmm(a.t)}</div>
      <div class="what"><div class="t"><a href="${esc(safeUrl(a.url))}" target="_blank" rel="noopener">${esc(a.title)}</a></div>
        <div class="m"><span class="badge set">${esc(setShort(a.set))}</span><span class="badge">${esc(a.product || a.rule || "")}</span>
          <span class="badge">${esc(a.shop)}</span><span class="pill ${oos ? "out" : isNew ? "new" : "in"}">${esc(a.reason)}</span></div></div>
      <div class="price"><span class="amt">${euro(a.price)}</span>${typeof a.ref === "number" ? `<span class="ref">ref ${euro(a.ref)} ${diffHtml(a.price, a.ref)}</span>` : ""}</div>
    </div>`;
  }
  const A = { q: "", shop: "", set: "", types: [], limit: 60 };
  VIEWS.meldingen = {
    built: false,
    build() {
      const el = $("#view-meldingen");
      el.innerHTML = `
        <button class="filter-toggle" data-for="a-filters">Filters <span class="n"></span></button>
        <div class="filters collapsible" id="a-filters">
          <div><label for="a-q">zoeken</label><input type="search" id="a-q" placeholder="bv. etb, greninja"></div>
          <div><label for="a-shop">shop</label><select id="a-shop"></select></div>
          <div><label for="a-set">set</label><select id="a-set"></select></div>
          <div><label>soort</label><div class="chips" id="a-types">
            <span class="chip mini" data-t="stock">op voorraad</span><span class="chip mini" data-t="oos">nog niet te koop</span>
            <span class="chip mini" data-t="price">prijs</span></div></div>
        </div>
        <div class="toolbar"><span class="count" id="a-count"></span></div>
        <div id="a-list"></div>`;
      $("#a-q").addEventListener("input", (e) => { A.q = e.target.value; A.limit = 60; this.results(); });
      $("#a-shop").addEventListener("change", (e) => { A.shop = e.target.value; A.limit = 60; this.results(); });
      $("#a-set").addEventListener("change", (e) => { A.set = e.target.value; A.limit = 60; this.results(); });
      $("#a-types").addEventListener("click", (e) => {
        const c = e.target.closest(".chip"); if (!c) return;
        const t = c.dataset.t; A.types = A.types.includes(t) ? A.types.filter((x) => x !== t) : [...A.types, t];
        this.results();
      });
      $("#a-list").addEventListener("click", (e) => { if (e.target.classList.contains("more")) { A.limit += 100; this.results(); } });
      this.built = true;
    },
    render() {
      if (!this.built) this.build();
      fillSelect($("#a-shop"), uniq(S.alerts.map((a) => a.shop)).sort(), "alle shops", A.shop);
      fillSelect($("#a-set"), uniq(S.alerts.map((a) => a.set)).sort((x, y) => setOrder(x) - setOrder(y)), "alle sets", A.set, setShort);
      this.results();
    },
    results() {
      document.querySelectorAll("#a-types .chip").forEach((c) => c.classList.toggle("on", A.types.includes(c.dataset.t)));
      const q = A.q.trim().toLowerCase();
      const list = S.alerts.filter((a) => {
        if (A.shop && a.shop !== A.shop) return false;
        if (A.set && a.set !== A.set) return false;
        if (A.types.length) {
          const t = /prijs/.test(a.reason) ? "price" : a.stock ? "stock" : "oos";
          if (!A.types.includes(t)) return false;
        }
        return !q || `${a.title} ${a.shop} ${a.set} ${a.product}`.toLowerCase().includes(q);
      });
      $("#a-count").textContent = `${list.length} meldingen`;
      activeCount("a-filters", [A.q, A.shop, A.set, A.types.length]);
      let html = "", lastDay = "";
      const byDay = {};
      list.forEach((a) => { const d = dayLabel(a.t); byDay[d] = (byDay[d] || 0) + 1; });
      list.slice(0, A.limit).forEach((a) => {
        const d = dayLabel(a.t);
        if (d !== lastDay) {
          html += `<div class="day-sep"><span class="dag">${esc(d)}</span><span class="rule"></span><span class="n">${byDay[d]}</span></div>`;
          lastDay = d;
        }
        html += alertRow(a);
      });
      if (list.length > A.limit) html += `<button class="more">Meer tonen (${list.length - A.limit})</button>`;
      $("#a-list").innerHTML = html || `<div class="empty"><h2>Geen meldingen</h2><p>Pas de filters aan.</p></div>`;
    },
  };

  // =========================================================== PRODUCTEN
  const P = { q: "", set: "", product: "", min: "", max: "", stock: "", shops: [], view: "list", sort: "stock", limit: 150 };
  function readP(params) {
    P.q = params.get("q") || ""; P.set = params.get("set") || ""; P.product = params.get("product") || "";
    P.min = params.get("min") || ""; P.max = params.get("max") || ""; P.stock = params.get("stock") || "";
    P.shops = (params.get("shops") || "").split("~").filter(Boolean);
    P.view = params.get("view") === "cmp" ? "cmp" : "list"; P.sort = params.get("sort") || "stock";
  }
  const writeP = () => setParams("producten", { q: P.q, set: P.set, product: P.product, min: P.min, max: P.max,
    stock: P.stock, shops: P.shops, view: P.view === "cmp" ? "cmp" : "", sort: P.sort === "stock" ? "" : P.sort });
  function filterProducts() {
    const q = P.q.trim().toLowerCase(), mn = parseFloat(P.min), mx = parseFloat(P.max);
    return S.products.filter((p) => {
      if (P.set && p.set !== P.set) return false;
      if (P.product && p.product !== P.product) return false;
      if (P.shops.length && !P.shops.includes(p.shop)) return false;
      if (P.stock === "in" && p.stock !== true) return false;
      if (P.stock === "out" && p.stock === true) return false;
      if (!isNaN(mn) && !(typeof p.price === "number" && p.price >= mn)) return false;
      if (!isNaN(mx) && !(typeof p.price === "number" && p.price <= mx)) return false;
      return !q || `${p.title} ${p.shop} ${p.set} ${p.product}`.toLowerCase().includes(q);
    });
  }
  const priceKey = (p) => (typeof p.price === "number" ? p.price : 1e9);
  const SORTS = {
    stock: (a, b) => (b.stock === true) - (a.stock === true) || priceKey(a) - priceKey(b),
    price: (a, b) => priceKey(a) - priceKey(b),
    "price-desc": (a, b) => priceKey(b) - priceKey(a),
    shop: (a, b) => a.shop.localeCompare(b.shop) || priceKey(a) - priceKey(b),
    set: (a, b) => setOrder(a.set) - setOrder(b.set) || a.product.localeCompare(b.product) || priceKey(a) - priceKey(b),
    ref: (a, b) => (diffPct(a.price, a.ref) ?? 1e9) - (diffPct(b.price, b.ref) ?? 1e9),
  };
  VIEWS.producten = {
    built: false,
    build() {
      const el = $("#view-producten");
      el.innerHTML = `
        <button class="filter-toggle" data-for="p-filters">Filters <span class="n"></span></button>
        <div class="filters collapsible" id="p-filters">
          <div><label for="p-q">zoeken</label><input type="search" id="p-q" placeholder="bv. etb, poster, bundle"></div>
          <div><label for="p-set">set</label><select id="p-set"></select></div>
          <div><label for="p-product">product</label><select id="p-product"></select></div>
          <div><label>prijs (€)</label><div class="pricebox"><input type="number" id="p-min" min="0" placeholder="min">
            <span>–</span><input type="number" id="p-max" min="0" placeholder="max"></div></div>
          <div><label>voorraad</label><div class="seg" id="p-stock"><button data-v="">alles</button><button data-v="in">op voorraad</button><button data-v="out">niet</button></div></div>
          <div class="wide"><label>shops <button class="linkbtn" id="p-all">alle</button> · <button class="linkbtn" id="p-none">geen</button></label>
            <div class="chips" id="p-shops"></div></div>
        </div>
        <div class="toolbar"><span class="count" id="p-count"></span>
          <div class="right">
            <div class="seg" id="p-view"><button data-v="list">lijst</button><button data-v="cmp">vergelijken</button></div>
            <select id="p-sort" aria-label="sorteren">
              <option value="stock">op voorraad eerst</option>
              <option value="price">prijs: laag → hoog</option><option value="price-desc">prijs: hoog → laag</option>
              <option value="set">set & product</option><option value="shop">shop</option><option value="ref">t.o.v. referentie</option></select>
          </div></div>
        <p class="note" id="p-note" hidden></p>
        <div id="p-list"></div>`;
      const upd = () => { P.limit = 150; writeP(); this.results(); };
      $("#p-q").addEventListener("input", (e) => { P.q = e.target.value; upd(); });
      $("#p-set").addEventListener("change", (e) => { P.set = e.target.value; P.product = ""; this.options(); upd(); });
      $("#p-product").addEventListener("change", (e) => { P.product = e.target.value; upd(); });
      $("#p-min").addEventListener("input", (e) => { P.min = e.target.value; upd(); });
      $("#p-max").addEventListener("input", (e) => { P.max = e.target.value; upd(); });
      $("#p-stock").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { P.stock = b.dataset.v; upd(); } });
      $("#p-view").addEventListener("click", (e) => { const b = e.target.closest("button"); if (b) { P.view = b.dataset.v; upd(); } });
      $("#p-sort").addEventListener("change", (e) => { P.sort = e.target.value; upd(); });
      $("#p-shops").addEventListener("click", (e) => {
        const c = e.target.closest(".chip"); if (!c) return;
        const s = c.dataset.s; P.shops = P.shops.includes(s) ? P.shops.filter((x) => x !== s) : [...P.shops, s]; upd();
      });
      $("#p-all").addEventListener("click", () => { P.shops = []; upd(); });
      $("#p-none").addEventListener("click", () => { P.shops = ["__geen__"]; upd(); });
      $("#p-list").addEventListener("click", (e) => { if (e.target.classList.contains("more")) { P.limit += 300; this.results(); } });
      this.built = true;
    },
    options() {
      const sets = uniq(S.products.map((p) => p.set)).sort((a, b) => setOrder(a) - setOrder(b));
      fillSelect($("#p-set"), sets, "alle sets", P.set, setShort);
      const prods = uniq(S.products.filter((p) => !P.set || p.set === P.set).map((p) => p.product)).sort();
      fillSelect($("#p-product"), prods, "alle producten", P.product);
    },
    render() {
      if (!this.built) this.build();
      readP(route().params);
      $("#p-q").value = P.q; $("#p-min").value = P.min; $("#p-max").value = P.max; $("#p-sort").value = P.sort;
      this.options();
      this.results();
    },
    results() {
      const shops = uniq(S.products.map((p) => p.shop)).sort((a, b) => a.localeCompare(b));
      $("#p-shops").innerHTML = shops.map((s) => `<span class="chip ${!P.shops.length || P.shops.includes(s) ? "on" : ""}" data-s="${esc(s)}">${esc(s)}</span>`).join("");
      document.querySelectorAll("#p-stock button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.stock));
      document.querySelectorAll("#p-view button").forEach((b) => b.classList.toggle("on", b.dataset.v === P.view));
      const list = filterProducts();
      const nShops = new Set(list.map((p) => p.shop)).size;
      $("#p-count").textContent = `${list.length} producten bij ${nShops} shops · ${list.filter((p) => p.stock === true).length} op voorraad`;
      activeCount("p-filters", [P.q, P.set, P.product, P.min, P.max, P.stock, P.shops.length]);
      const note = $("#p-note");
      note.hidden = P.view !== "cmp";
      note.textContent = "Vergelijken: per product alle shops naast elkaar, goedkoopste die op voorraad is bovenaan. Kies hierboven shops om alleen die te vergelijken.";
      $("#p-list").innerHTML = list.length ? (P.view === "cmp" ? this.compare(list) : this.table(list))
        : `<div class="empty"><h2>Niets gevonden</h2><p>Pas de filters aan, of klik bij shops op <b>alle</b>.</p></div>`;
    },
    table(list) {
      const rows = [...list].sort(SORTS[P.sort] || SORTS.stock);
      const shown = rows.slice(0, P.limit);
      return `<table class="table"><thead><tr><th>product</th><th>shop</th><th class="num">prijs</th><th>voorraad</th><th class="num">t.o.v. ref</th><th></th></tr></thead><tbody>
        ${shown.map((p) => `<tr class="${p.stock === true ? "" : "dim"}">
          <td data-l=""><div class="ttl"><a href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">${esc(p.product)}</a> <span class="badge set">${esc(setShort(p.set))}</span></div>
              <div class="sub2" title="${esc(p.title)}">${esc(p.title)}</div></td>
          <td data-l="shop">${esc(p.shop)}</td>
          <td class="num" data-l="prijs">${euro(p.price)}</td>
          <td data-l="voorraad">${stockPill(p.stock)}</td>
          <td class="num" data-l="t.o.v. ref">${diffHtml(p.price, p.ref, p.ref_own ? "jouw prijs" : "laagste ooit") || "—"}</td>
          <td class="num"><a class="go" href="${esc(safeUrl(p.url))}" target="_blank" rel="noopener">naar shop →</a></td></tr>`).join("")}
        </tbody></table>${rows.length > P.limit ? `<button class="more">Meer tonen (${rows.length - P.limit})</button>` : ""}`;
    },
    compare(list) {
      const groups = new Map();
      list.forEach((p) => {
        const k = histKey(p.set, p.product);
        if (!groups.has(k)) groups.set(k, { set: p.set, product: p.product, items: [] });
        groups.get(k).items.push(p);
      });
      const arr = [...groups.values()].map((g) => {
        g.items.sort((a, b) => (b.stock === true) - (a.stock === true) || priceKey(a) - priceKey(b));
        g.best = g.items.find((x) => x.stock === true && typeof x.price === "number") || null;
        return g;
      });
      if (["stock", "price", "price-desc"].includes(P.sort)) {
        const k = (g) => (g.best ? g.best.price : 1e9);
        arr.sort((a, b) => (P.sort === "price-desc" ? k(b) - k(a) : k(a) - k(b)));
      } else {
        arr.sort((a, b) => setOrder(a.set) - setOrder(b.set) || a.product.localeCompare(b.product));
      }
      const shown = arr.slice(0, Math.max(30, Math.round(P.limit / 5)));
      return shown.map((g) => {
        const max = Math.max(...g.items.map((x) => (typeof x.price === "number" ? x.price : 0)), 1);
        const h = HIST.get(histKey(g.set, g.product));
        const ref = g.items.find((x) => x.ref_own && typeof x.ref === "number")?.ref;
        const inN = g.items.filter((x) => x.stock === true).length;
        return `<div class="cmp">
          <div class="cmp-head"><div><div class="nm">${esc(g.product)}</div>
              <div class="m"><span class="badge set">${esc(setShort(g.set))}</span><span class="badge">${g.items.length} aanbiedingen · ${inN} op voorraad</span>
              ${h && h.low ? `<span class="badge">laagste ooit ${euro(h.low.price)} · ${esc(h.low.shop)}</span>` : ""}
              ${typeof ref === "number" ? `<span class="badge">jouw ref ${euro(ref)}</span>` : ""}</div></div>
            <div class="best">goedkoopst op voorraad${g.best ? `<b>${euro(g.best.price)}</b>${esc(g.best.shop)}` : `<b class="none">nergens</b>`}</div></div>
          ${g.items.map((x) => `<div class="cmp-row ${x.stock === true ? "in" : "out"} ${x === g.best ? "cheapest" : ""}">
              <span class="shopn" title="${esc(x.title)}">${esc(x.shop)}</span>
              <span class="bar"><i style="width:${typeof x.price === "number" ? Math.max(4, (x.price / max) * 100) : 0}%"></i></span>
              <span class="p">${euro(x.price)}</span>
              <span>${x.stock === true ? `<a class="go" href="${esc(safeUrl(x.url))}" target="_blank" rel="noopener">kopen →</a>` : stockPill(x.stock)}</span>
            </div>`).join("")}
        </div>`;
      }).join("") + (arr.length > shown.length ? `<button class="more">Meer tonen (${arr.length - shown.length})</button>` : "");
    },
  };

  // =========================================================== HISTORIE
  const H = { q: "", set: "", onlyNow: false, sort: "set" };
  VIEWS.historie = {
    built: false,
    build() {
      const el = $("#view-historie");
      el.innerHTML = `
        <p class="note">De laagste prijs die de monitor ooit zag voor een product dat <b>op voorraad</b> was, bij welke shop en wanneer,
          naast de goedkoopste aanbieding van nu. Zo zie je meteen of een prijs goed is.</p>
        <button class="filter-toggle" data-for="h-filters">Filters <span class="n"></span></button>
        <div class="filters collapsible" id="h-filters">
          <div><label for="h-q">zoeken</label><input type="search" id="h-q" placeholder="bv. etb"></div>
          <div><label for="h-set">set</label><select id="h-set"></select></div>
          <div><label for="h-sort">sorteren</label><select id="h-sort">
            <option value="set">set & product</option><option value="deal">beste deal nu (dichtst bij laagste)</option>
            <option value="low">laagste prijs ooit</option><option value="recent">laagste ooit: meest recent</option></select></div>
          <div><label>tonen</label><div class="chips"><span class="chip mini" id="h-now">alleen nu op voorraad</span></div></div>
        </div>
        <div class="toolbar"><span class="count" id="h-count"></span></div>
        <div id="h-list"></div>`;
      $("#h-q").addEventListener("input", (e) => { H.q = e.target.value; this.results(); });
      $("#h-set").addEventListener("change", (e) => { H.set = e.target.value; this.results(); });
      $("#h-sort").addEventListener("change", (e) => { H.sort = e.target.value; this.results(); });
      $("#h-now").addEventListener("click", () => { H.onlyNow = !H.onlyNow; this.results(); });
      this.built = true;
    },
    render() {
      if (!this.built) this.build();
      fillSelect($("#h-set"), uniq(S.history.map((x) => x.set)).sort((a, b) => setOrder(a) - setOrder(b)), "alle sets", H.set, setShort);
      this.results();
    },
    results() {
      $("#h-now").classList.toggle("on", H.onlyNow);
      const q = H.q.trim().toLowerCase();
      const rows = S.history.filter((x) => x.low && (!H.set || x.set === H.set) && (!H.onlyNow || x.now)
        && (!q || `${x.set} ${x.product} ${x.low.shop}`.toLowerCase().includes(q)));
      const deal = (x) => (x.now ? x.now.price / x.low.price : 1e9);
      const sorts = {
        set: (a, b) => setOrder(a.set) - setOrder(b.set) || a.product.localeCompare(b.product),
        deal: (a, b) => deal(a) - deal(b),
        low: (a, b) => a.low.price - b.low.price,
        recent: (a, b) => (b.low.date || "").localeCompare(a.low.date || ""),
      };
      rows.sort(sorts[H.sort] || sorts.set);
      $("#h-count").textContent = `${rows.length} producten`;
      activeCount("h-filters", [H.q, H.set, H.onlyNow]);
      $("#h-list").innerHTML = rows.length ? `<table class="table"><thead><tr><th>product</th><th class="num">laagste ooit</th><th>waar / wanneer</th>
          <th class="num">nu goedkoopst</th><th>waar</th><th class="num">verschil</th><th class="num">jouw ref.</th></tr></thead><tbody>
        ${rows.map((x) => {
          const atLow = x.now && x.now.price <= x.low.price + 0.005;
          return `<tr class="${x.now ? "" : "dim"}">
            <td data-l=""><div class="ttl">${esc(x.product)} <span class="badge set">${esc(setShort(x.set))}</span></div></td>
            <td class="num" data-l="laagste ooit"><b>${euro(x.low.price)}</b></td>
            <td data-l="waar"><div>${esc(x.low.shop)}</div><div class="sub2">${esc((x.low.date || "").slice(0, 10))}</div></td>
            <td class="num" data-l="nu">${x.now ? euro(x.now.price) : "—"}</td>
            <td data-l="nu bij">${x.now ? `${esc(x.now.shop)}${x.shops_now > 1 ? ` <span class="sub2" style="display:inline">+${x.shops_now - 1}</span>` : ""}` : `<span class="pill out">nergens op voorraad</span>`}</td>
            <td class="num" data-l="verschil">${atLow ? `<span class="pill low">laagste ooit!</span>` : x.now ? diffHtml(x.now.price, x.low.price, "laagste ooit") : "—"}</td>
            <td class="num" data-l="jouw ref.">${typeof x.ref === "number" ? euro(x.ref) : "—"}</td></tr>`;
        }).join("")}</tbody></table>`
        : `<div class="empty"><h2>Nog geen prijshistorie</h2><p>Die bouwt de monitor vanzelf op zodra producten op voorraad komen.</p></div>`;
    },
  };

  // ---------- kleine helpers ----------
  function activeCount(id, vals) {
    const n = vals.filter(Boolean).length;
    const b = document.querySelector(`.filter-toggle[data-for="${id}"] .n`);
    if (b) b.textContent = n ? `${n} actief` : "";
  }
  document.addEventListener("click", (e) => {
    const t = e.target.closest(".filter-toggle");
    if (t) document.getElementById(t.dataset.for).classList.toggle("open");
  });
  function uniq(a) { return [...new Set(a.filter((x) => x !== undefined && x !== null && x !== ""))]; }
  function fillSelect(sel, values, allLabel, current, labelFn = (x) => x) {
    const opts = [`<option value="">${esc(allLabel)}</option>`].concat(values.map((v) => `<option value="${esc(v)}">${esc(labelFn(v))}</option>`));
    if (current && !values.includes(current)) opts.push(`<option value="${esc(current)}">${esc(labelFn(current))}</option>`);
    sel.innerHTML = opts.join("");
    sel.value = current || "";
  }

  // ---------- starten en verversen ----------
  let dataAt = 0;
  async function refresh(full) {
    await loadStatus();
    if (full || Date.now() - dataAt > CFG.refreshDataSec * 1000) {
      await loadData();
      dataAt = Date.now();
    }
    renderHeader();
    const { tab } = route();
    if (full || tab === "home") show();
    else if (VIEWS[tab].built) VIEWS[tab].results ? VIEWS[tab].render() : null;
  }
  window.addEventListener("hashchange", show);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) refresh(false); });
  refresh(true);
  setInterval(() => refresh(false), CFG.refreshStatusSec * 1000);
})();
