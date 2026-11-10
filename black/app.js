import { api, ApiError, MOCK } from "./api.js";
import { buildWheel } from "./wheel.js";

/* ---------------------------------------------------------- utilidades */
const $ = (s, r = document) => r.querySelector(s);
function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const k in (attrs || {})) {
    const v = attrs[k];
    if (v == null || v === false) continue;
    if (k === "class") e.className = v;
    else if (k.startsWith("on")) e.addEventListener(k.slice(2), v);
    else if (k === "html") e.innerHTML = v;
    else if (v === true) e.setAttribute(k, "");
    else e.setAttribute(k, v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(c));
  return e;
}
const digits = (s) => String(s || "").replace(/\D/g, "");
const money = (c) => (c / 100).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
const fmtDate = (iso) => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) + "/" + iso.slice(0, 4) : "";
const fmtDM = (iso) => iso ? iso.slice(8, 10) + "/" + iso.slice(5, 7) : "";
const fmtDT = (iso) => { if (!iso) return ""; const d = new Date(iso); const p = (n) => String(n).padStart(2, "0"); return `${p(d.getDate())}/${p(d.getMonth() + 1)} às ${p(d.getHours())}:${p(d.getMinutes())}`; };
const maskCpf = (d) => { d = d.slice(0, 11); return d.replace(/^(\d{3})(\d)/, "$1.$2").replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3").replace(/\.(\d{3})(\d)/, ".$1-$2"); };
const spinsFor = (cents) => Math.min(5, Math.floor(cents / 10000));
const uuid = () => crypto.randomUUID ? crypto.randomUUID() : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

const MESSAGES = {
  invalid_login: "E-mail ou senha incorretos.",
  not_staff: "Esta conta não tem acesso à recepção. Fale com a administração.",
  not_admin: "Só a administração pode fazer isso.",
  invalid_name: "Informe o nome completo da cliente.",
  invalid_cpf: "CPF inválido. Confira os números.",
  below_minimum: "O atendimento precisa ter, no mínimo, R$ 100 para gerar giros.",
  invalid_date: "Data inválida. Use uma data de 11/11/2026 até hoje.",
  outside_campaign: "A campanha vai de 11/11 a 30/11. Fora desse período não dá para registrar nem girar.",
  duplicate_visit: "Este atendimento já foi registrado com este CPF, nesta data e com este valor.",
  visit_not_found: "Não encontramos este atendimento.",
  visit_voided: "Este atendimento foi anulado.",
  no_spins_left: "Este atendimento não tem mais giros.",
  result_not_found: "Não encontramos este prêmio.",
  already_redeemed: "Este prêmio já foi resgatado.",
  expired: "Este prêmio está vencido e não pode mais ser resgatado.",
  not_a_win: "Este resultado não é um prêmio.",
  has_redeemed_prize: "Não dá para anular: um prêmio deste atendimento já foi resgatado. Desfaça o resgate antes.",
  invalid_prize: "Confira os dados do prêmio. O estoque não pode ficar abaixo do que já foi dado.",
  reason_required: "Escreva o motivo.",
  network: "Sem conexão com o servidor. Confira a internet e tente de novo.",
  unknown: "Algo deu errado. Tente de novo."
};
const msg = (e, extra) => (extra && extra[e.code]) || MESSAGES[e.code] || MESSAGES.unknown;

/* ---------------------------------------------------------------- estado */
const S = { me: null, session: null, slices: null };
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };
const app = $("#app");
const live = $("#live");
const announce = (t) => { live.textContent = ""; setTimeout(() => { live.textContent = t; }, 40); };

function setView(node, title) {
  app.replaceChildren(node);
  document.title = (title ? title + " · " : "") + "Roleta Divare";
  const hd = node.querySelector("h1");
  if (hd) { hd.setAttribute("tabindex", "-1"); hd.focus({ preventScroll: true }); }
  window.scrollTo(0, 0);
}
function stateBox(kind, text, retry) {
  return h("div", { class: "state state-" + kind, role: kind === "error" ? "alert" : "status" },
    kind === "loading" ? h("span", { class: "spinner", "aria-hidden": "true" }) : null,
    h("p", null, text),
    retry ? h("button", { type: "button", class: "btn btn-line", onclick: retry }, "Tentar de novo") : null);
}
function loading(text) { setView(h("section", { class: "shell narrow" }, stateBox("loading", text || "Carregando…"))); }

/* ---------------------------------------------------------------- cabeçalho */
const top = $("#top");
function renderTop() {
  const nav = $("#nav"), who = $("#who");
  if (!S.session || !S.me) { top.hidden = true; return; }
  top.hidden = false;
  const hash = location.hash || "#/novo";
  const links = [["#/novo", "Novo atendimento"], ["#/premios", "Prêmios"]];
  if (S.me.role === "admin") links.push(["#/admin", "Administração"]);
  nav.replaceChildren(...links.map(([href, label]) => h("a", { href, class: "tab", "aria-current": (hash.startsWith(href) || (href === "#/novo" && hash.startsWith("#/roleta"))) ? "page" : null }, label)));
  who.replaceChildren(h("span", { class: "who-name" }, S.me.name), h("button", { type: "button", class: "btn-text", onclick: logout }, "Sair"));
}
async function logout() {
  try { await api.signOut(); } catch (e) {}
  S.session = null; S.me = null; S.slices = null;
  go("#/entrar");
}

/* ---------------------------------------------------------------- diálogo */
const dlg = $("#dlg");
function dialog({ title, body, confirm = "Confirmar", cancel = "Cancelar", reason, danger }) {
  return new Promise(resolve => {
    let ta = null, err = h("p", { class: "field-error", role: "alert" });
    if (reason) ta = h("textarea", { id: "dlg-reason", rows: "3", required: true, maxlength: "300", placeholder: "Escreva o motivo" });
    const form = h("form", { method: "dialog", class: "dlg-form" },
      h("h2", { id: "dlg-title" }, title),
      body ? h("p", { class: "dlg-body" }, body) : null,
      reason ? h("div", { class: "field" }, h("label", { for: "dlg-reason" }, reason), ta, err) : null,
      h("div", { class: "dlg-actions" },
        h("button", { type: "button", class: "btn btn-line", onclick: () => { dlg.close("cancel"); } }, cancel),
        h("button", { type: "submit", class: "btn " + (danger ? "btn-danger" : "btn-solid"), value: "ok" }, confirm)));
    form.addEventListener("submit", (ev) => {
      ev.preventDefault();
      if (reason && !ta.value.trim()) { err.textContent = MESSAGES.reason_required; ta.focus(); return; }
      dlg.close("ok");
    });
    dlg.replaceChildren(form);
    dlg.onclose = () => resolve({ ok: dlg.returnValue === "ok", reason: ta ? ta.value.trim() : "" });
    dlg.returnValue = "";
    dlg.showModal();
    (ta || form.querySelector(".btn-solid, .btn-danger")).focus();
  });
}
dlg.addEventListener("click", (e) => { if (e.target === dlg) dlg.close("cancel"); });

/* ---------------------------------------------------------------- entrar */
function viewLogin() {
  let busy = false;
  const err = h("p", { class: "field-error", role: "alert" });
  const email = h("input", { id: "email", type: "email", autocomplete: "username", required: true, inputmode: "email", autocapitalize: "none", spellcheck: "false" });
  const pass = h("input", { id: "senha", type: "password", autocomplete: "current-password", required: true });
  const btn = h("button", { type: "submit", class: "btn btn-solid btn-lg" }, "Entrar");
  const form = h("form", { class: "card login-card", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); if (busy) return;
    err.textContent = "";
    if (!email.value.trim() || !pass.value) { err.textContent = "Preencha o e-mail e a senha."; return; }
    busy = true; btn.disabled = true; btn.textContent = "Entrando…";
    try {
      S.session = await api.signIn(email.value.trim(), pass.value);
      S.me = await api.me();
      go("#/novo");
    } catch (ex) { err.textContent = msg(ex); busy = false; btn.disabled = false; btn.textContent = "Entrar"; pass.select(); }
  } },
    h("div", { class: "field" }, h("label", { for: "email" }, "E-mail"), email),
    h("div", { class: "field" }, h("label", { for: "senha" }, "Senha"), pass),
    err, btn);
  return h("section", { class: "login" },
    h("div", { class: "login-arch", "aria-hidden": "true" }),
    h("div", { class: "login-in" },
      h("img", { class: "login-logo", src: "img/divare-simbolo-384.webp", srcset: "img/divare-simbolo-256.webp 256w, img/divare-simbolo-384.webp 384w, img/divare-simbolo-773.webp 773w", sizes: "132px", width: "773", height: "514", alt: "Divare Lounge Beauty", decoding: "async" }),
      h("p", { class: "eyebrow" }, "Divare Lounge Beauty"),
      h("h1", null, "Roleta ", h("em", null, "Black Friday")),
      h("p", { class: "lede" }, "Acesso da equipe da recepção."),
      form,
      MOCK ? h("p", { class: "mock-note" }, "Modo simulação. Recepção: staff@divare.test. Administração: admin@divare.test. Senha: divare123.") : null));
}

/* ------------------------------------------------------- novo atendimento */
function viewNew() {
  const campaign = S.me.campaign;
  const today = campaign.today;
  const st = { name: "", cpf: "", cents: 0, date: today, req: null, busy: false, open: [], openFor: "" };

  const name = h("input", { id: "nome", type: "text", autocomplete: "off", autocapitalize: "words", required: true, maxlength: "80" });
  const cpf = h("input", { id: "cpf", type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "000.000.000-00", maxlength: "14", "aria-describedby": "cpf-msg" });
  const amount = h("input", { id: "valor", type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "R$ 0,00", "aria-describedby": "valor-msg" });
  const date = h("input", { id: "data", type: "text", inputmode: "numeric", autocomplete: "off", placeholder: "dd/mm/aaaa", maxlength: "10", value: fmtDate(today), "aria-describedby": "data-msg" });
  const dateMsg = h("p", { id: "data-msg", class: "hint", "aria-live": "polite" });
  const cpfMsg = h("p", { id: "cpf-msg", class: "hint", "aria-live": "polite" });
  const spinsMsg = h("p", { id: "valor-msg", class: "spins-msg", "aria-live": "polite" });
  const dots = h("div", { class: "dots", "aria-hidden": "true" }, [1, 2, 3, 4, 5].map(() => h("span")));
  const openBox = h("div", { class: "open-box", "aria-live": "polite" });
  const err = h("p", { class: "field-error", role: "alert" });
  const btn = h("button", { type: "submit", class: "btn btn-solid btn-lg", disabled: true }, "Registrar e abrir a roleta");

  const touch = () => { st.req = null; err.textContent = ""; };
  const ready = () => st.name.trim().split(/\s+/).filter(Boolean).length >= 2 && st.cpf.length === 11 && st.cents >= 10000 && !!st.date && !st.busy;
  const refresh = () => {
    btn.disabled = !ready();
    const n = spinsFor(st.cents);
    dots.querySelectorAll("span").forEach((s, i) => s.classList.toggle("on", i < n));
    if (st.cents === 0) spinsMsg.textContent = "A partir de R$ 100";
    else if (st.cents < 10000) spinsMsg.textContent = "Este atendimento dá 0 giros. A partir de R$ 100";
    else spinsMsg.textContent = `Este atendimento dá ${n} ${n === 1 ? "giro" : "giros"}`;
    spinsMsg.classList.toggle("ok", n > 0);
  };

  name.addEventListener("input", () => { st.name = name.value; touch(); refresh(); });
  cpf.addEventListener("input", async () => {
    st.cpf = digits(cpf.value).slice(0, 11); cpf.value = maskCpf(st.cpf); touch(); refresh();
    cpfMsg.textContent = ""; cpf.removeAttribute("aria-invalid");
    if (st.cpf.length < 11) { st.open = []; st.openFor = ""; renderOpen(); return; }
    const mine = st.cpf; st.openFor = mine;
    try {
      const list = await api.openVisits(mine);
      if (st.openFor !== mine) return;
      st.open = list; renderOpen();
    } catch (ex) {
      if (st.openFor !== mine) return;
      st.open = []; renderOpen();
      if (ex.code === "invalid_cpf") { cpfMsg.textContent = MESSAGES.invalid_cpf; cpfMsg.classList.add("bad"); cpf.setAttribute("aria-invalid", "true"); }
      else if (ex.code === "network") { cpfMsg.textContent = ""; }
    }
  });
  amount.addEventListener("input", () => { st.cents = parseInt(digits(amount.value) || "0", 10); amount.value = st.cents ? money(st.cents) : ""; touch(); refresh(); });
  const maskDate = (d) => d.slice(0, 8).replace(/^(\d{2})(\d)/, "$1/$2").replace(/^(\d{2})\/(\d{2})(\d)/, "$1/$2/$3");
  function checkDate(final) {
    const d = digits(date.value);
    dateMsg.classList.remove("bad"); date.removeAttribute("aria-invalid"); dateMsg.textContent = ""; st.date = "";
    const bad = (t) => { dateMsg.textContent = t; dateMsg.classList.add("bad"); date.setAttribute("aria-invalid", "true"); };
    if (d.length < 8) { if (final && d.length) bad("Digite a data completa, como " + fmtDate(today) + "."); return; }
    const dd = +d.slice(0, 2), mm = +d.slice(2, 4), yy = +d.slice(4, 8);
    const t = new Date(Date.UTC(yy, mm - 1, dd));
    if (t.getUTCFullYear() !== yy || t.getUTCMonth() !== mm - 1 || t.getUTCDate() !== dd) { bad("Esta data não existe. Confira o dia e o mês."); return; }
    const iso = `${String(yy).padStart(4, "0")}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
    if (iso < campaign.starts_on) { bad("Use uma data a partir de " + fmtDate(campaign.starts_on) + "."); return; }
    if (iso > today) { bad("A data não pode ser depois de hoje (" + fmtDate(today) + ")."); return; }
    st.date = iso;
  }
  date.addEventListener("input", () => { date.value = maskDate(digits(date.value)); checkDate(false); touch(); refresh(); });
  date.addEventListener("blur", () => { checkDate(true); refresh(); });

  function renderOpen() {
    openBox.replaceChildren();
    if (!st.open.length) return;
    openBox.append(h("p", { class: "open-title" }, "Esta cliente tem giros sobrando:"),
      ...st.open.map(o => h("button", { type: "button", class: "btn btn-line open-btn", onclick: () => { location.hash = "#/roleta/" + o.visit_id; } },
        `Retomar giros de ${fmtDM(o.visit_date)} (${o.spins_left} ${o.spins_left === 1 ? "restante" : "restantes"})`)));
  }

  const form = h("form", { class: "card form-card", novalidate: true, onsubmit: async (e) => {
    e.preventDefault(); if (!ready()) return;
    st.busy = true; refresh(); btn.textContent = "Registrando…"; err.textContent = "";
    if (!st.req) st.req = uuid();                         // um por envio; reaproveitado na nova tentativa
    try {
      const v = await api.registerVisit(st.name.trim(), st.cpf, st.cents, st.date, st.req);
      location.hash = "#/roleta/" + v.visit_id;
    } catch (ex) {
      const dup = st.date === today ? "Este atendimento já foi registrado hoje com este valor." : MESSAGES.duplicate_visit;
      err.textContent = msg(ex, { duplicate_visit: dup });
      if (ex.code !== "network") st.req = null;           // erro de regra: nova tentativa já é outro envio
      st.busy = false; btn.textContent = ex.code === "network" ? "Tentar de novo" : "Registrar e abrir a roleta"; refresh();
    }
  } },
    h("div", { class: "field" }, h("label", { for: "nome" }, "Nome completo da cliente"), name),
    h("div", { class: "grid2" },
      h("div", { class: "field" }, h("label", { for: "cpf" }, "CPF"), cpf, cpfMsg),
      h("div", { class: "field" }, h("label", { for: "data" }, "Data do atendimento"), date, dateMsg)),
    openBox,
    h("div", { class: "field" }, h("label", { for: "valor" }, "Valor total pago"), amount),
    h("div", { class: "spins" }, dots, spinsMsg),
    err, btn);

  const aside = h("aside", { class: "aside-card" },
    h("div", { class: "aside-arch", "aria-hidden": "true" }),
    h("h2", null, "Um giro a cada R$ 100"),
    h("p", null, "Até 5 giros por atendimento. O valor é o total pago pela cliente."),
    h("ul", { class: "tiers" }, [["R$ 100 a R$ 199,99", 1], ["R$ 200 a R$ 299,99", 2], ["R$ 300 a R$ 399,99", 3], ["R$ 400 a R$ 499,99", 4], ["R$ 500 ou mais", 5]].map(([r, n]) => h("li", null, h("span", null, r), h("b", null, `${n} ${n === 1 ? "giro" : "giros"}`)))));

  const banner = !campaign.active ? h("p", { class: "banner", role: "status" }, `A campanha vai de ${fmtDate(campaign.starts_on)} a ${fmtDate(campaign.ends_on)}. Fora desse período não dá para registrar atendimentos.`) : null;
  refresh();
  return h("section", { class: "shell" },
    h("header", { class: "page-head" }, h("p", { class: "eyebrow" }, "Recepção"), h("h1", null, "Novo atendimento"), h("p", { class: "lede" }, "Preencha ao fim do atendimento. A cliente gira a roleta em seguida.")),
    banner,
    h("div", { class: "cols" }, form, aside));
}

/* ------------------------------------------------------------------ roleta */
async function viewWheel(visitId) {
  loading("Abrindo a roleta…");
  let visit, slices;
  try {
    [visit, slices] = await Promise.all([api.visit(visitId), S.slices ? Promise.resolve(S.slices) : api.wheel()]);
    S.slices = slices;
  } catch (ex) {
    setView(h("section", { class: "shell narrow" }, stateBox("error", msg(ex), () => viewWheel(visitId)), h("a", { class: "btn btn-line", href: "#/novo" }, "Novo atendimento")), "Roleta");
    return;
  }
  if (visit.voided_at) {
    setView(h("section", { class: "shell narrow voided-view" },
      h("p", { class: "eyebrow" }, "Cliente"),
      h("h1", null, "Atendimento anulado"),
      h("p", { class: "meta" }, visit.client_name),
      h("p", { class: "meta" }, `Atendimento de ${fmtDate(visit.visit_date)} · ${money(visit.amount_cents)}`),
      h("div", { class: "void-box", role: "status" }, h("span", null, "Motivo"), h("p", null, visit.void_reason || "Não informado.")),
      h("p", { class: "lede" }, "Não é possível girar a roleta neste atendimento."),
      h("a", { class: "btn btn-solid btn-lg", href: "#/novo" }, "Novo atendimento")), "Atendimento anulado");
    return;
  }
  const PKEY = "bf-pending-" + visitId;
  const st = { left: visit.spins_left, results: visit.results.slice(), busy: false, shown: null };
  const stage = h("div", { class: "stage" });
  const wheel = buildWheel(stage, slices);
  const counter = h("p", { class: "counter" });
  const btn = h("button", { type: "button", class: "btn btn-solid btn-xl", id: "girar" }, "Girar");
  const err = h("p", { class: "field-error", role: "alert" });
  const resultBox = h("div", { class: "result-box", "aria-live": "polite" });
  const listBox = h("div", { class: "won-list" });
  const next = h("a", { class: "btn btn-line btn-lg", href: "#/novo" }, "Novo atendimento");

  function renderCounter() {
    counter.replaceChildren("Giros restantes: ", h("b", null, String(st.left)));
    btn.hidden = st.left <= 0; next.hidden = st.left > 0;
  }
  function renderList() {
    const done = st.results.slice().sort((a, b) => a.spin_number - b.spin_number);
    listBox.replaceChildren();
    if (!done.length) return;
    listBox.append(h("h2", null, st.left > 0 ? "Resultados deste atendimento" : "Prêmios deste atendimento"),
      h("ul", null, done.map(r => h("li", { class: r.is_win ? "win" : "miss" },
        h("span", { class: "n" }, String(r.spin_number)),
        h("span", { class: "t" }, r.prize_name),
        r.is_win ? h("code", null, r.redeem_code) : null,
        r.is_win ? h("small", null, r.redeemed_at ? "Resgatado" : "Válido até " + fmtDate(r.valid_until)) : null))));
  }
  function showResult(r, left) {
    resultBox.replaceChildren();
    if (r.is_win) {
      resultBox.append(h("article", { class: "result win" },
        h("p", { class: "eyebrow" }, "Você ganhou"),
        h("h2", null, r.prize_name),
        r.description ? h("p", { class: "desc" }, r.description) : null,
        h("div", { class: "code-block" }, h("span", null, "Código de resgate"), h("code", { "aria-label": "Código " + r.redeem_code.split("").join(" ") }, r.redeem_code)),
        h("p", { class: "valid" }, "Válido até " + fmtDate(r.valid_until))));
      announce(`Você ganhou: ${r.prize_name}. Código ${r.redeem_code.split("").join(" ")}.`);
    } else {
      resultBox.append(h("article", { class: "result miss" },
        h("p", { class: "eyebrow" }, "Não foi desta vez"),
        h("h2", null, left > 0 ? "Que pena! Ainda tem giro." : "Obrigada por participar."),
        h("p", { class: "desc" }, left > 0 ? "Toque em Girar para tentar outra vez." : "Volte sempre ao Divare.")));
      announce(left > 0 ? "Não foi desta vez. Você ainda tem giros." : "Não foi desta vez. Obrigada por participar.");
    }
  }

  btn.addEventListener("click", async () => {
    if (st.busy || st.left <= 0) return;
    st.busy = true; btn.disabled = true; err.textContent = ""; resultBox.replaceChildren();
    btn.textContent = "Girando…";
    wheel.highlight(null);
    let req = sessionStorage.getItem(PKEY);
    if (!req) { req = uuid(); sessionStorage.setItem(PKEY, req); }      // mesmo request_id até o giro ser confirmado
    let r;
    try { r = await api.spin(visitId, req); }
    catch (ex) {
      err.textContent = msg(ex);
      st.busy = false; btn.disabled = false;
      btn.textContent = ex.code === "network" ? "Tentar de novo" : "Girar";
      if (ex.code === "no_spins_left" || ex.code === "visit_voided") { sessionStorage.removeItem(PKEY); st.left = 0; renderCounter(); }
      return;
    }
    sessionStorage.removeItem(PKEY);
    try { await wheel.spinTo(r.prize_id); }
    catch (ex) { err.textContent = "O prêmio saiu, mas não está na roleta. Veja a lista abaixo."; }
    wheel.highlight(r.prize_id);
    st.left = r.spins_left;
    if (!st.results.some(x => x.result_id === r.result_id)) st.results.push(r);
    st.busy = false; btn.disabled = false; btn.textContent = "Girar";
    renderCounter(); renderList(); showResult(r, st.left);
    window.__bfLast = { prize_id: r.prize_id, landing: wheel.landing() };
  });

  renderCounter(); renderList();
  if (st.results.length && !sessionStorage.getItem(PKEY)) {
    resultBox.append(h("p", { class: "recovered" }, "Estes resultados já foram sorteados. Nenhum giro foi repetido."));
  }
  const left = h("div", { class: "wheel-col" }, h("div", { class: "arch-frame", "aria-hidden": "true" }), stage);
  const head = h("div", { class: "wheel-head" },
    h("p", { class: "eyebrow" }, "Cliente"),
    h("h1", null, visit.client_name),
    h("p", { class: "meta" }, h("span", { class: "nb" }, `Atendimento de ${fmtDate(visit.visit_date)}`), " · ", h("span", { class: "nb" }, money(visit.amount_cents)), h("br"), h("span", { class: "nb" }, `CPF ${visit.cpf_masked}`)));
  const right = h("div", { class: "panel-col" }, counter, btn, next, err, resultBox, listBox);
  setView(h("section", { class: "shell wheel-view" }, head, left, right), visit.client_name);
  window.__bfWheel = wheel;
}

/* ------------------------------------------------------------------ prêmios */
function viewPrizes() {
  const q = h("input", { id: "busca", type: "search", placeholder: "CPF, código ou nome", autocomplete: "off", enterkeyhint: "search" });
  const out = h("div", { class: "results", "aria-live": "polite" }, stateBox("empty", "Digite um CPF, o código de resgate ou parte do nome da cliente."));
  async function run(ev) {
    ev && ev.preventDefault();
    const term = q.value.trim();
    if (!term) { out.replaceChildren(stateBox("empty", "Digite um CPF, o código de resgate ou parte do nome da cliente.")); return; }
    out.replaceChildren(stateBox("loading", "Buscando…"));
    try {
      const list = await api.findResults(digits(term).length === 11 ? digits(term) : term);
      if (!list.length) { out.replaceChildren(stateBox("empty", "Nenhum prêmio encontrado para esta busca.")); return; }
      out.replaceChildren(h("p", { class: "count" }, `${list.length} ${list.length === 1 ? "prêmio" : "prêmios"}`), ...list.map(prizeCard));
    } catch (ex) { out.replaceChildren(stateBox("error", msg(ex), run)); }
  }
  function status(r) {
    if (r.redeemed_at) return { k: "done", t: "Resgatado em " + fmtDT(r.redeemed_at) };
    if (r.valid_until && r.valid_until < S.me.campaign.today) return { k: "expired", t: "Vencido em " + fmtDate(r.valid_until) };
    return { k: "open", t: "A resgatar" };
  }
  function prizeCard(r) {
    const s = status(r);
    const msgBox = h("p", { class: "field-error", role: "alert" });
    const badge = h("span", { class: "badge " + s.k }, s.t);
    const btn = h("button", { type: "button", class: "btn btn-solid", disabled: s.k !== "open", onclick: async () => {
      const d = await dialog({ title: "Confirmar resgate", body: `${r.prize_name} para ${r.client_name} (${r.cpf_masked}), código ${r.redeem_code}. Esta ação fica registrada.`, confirm: "Confirmar resgate" });
      if (!d.ok) return;
      btn.disabled = true; btn.textContent = "Confirmando…"; msgBox.textContent = "";
      try {
        const u = await api.redeem(r.result_id);
        const ns = status(u); badge.className = "badge " + ns.k; badge.textContent = ns.t; btn.remove();
        announce("Resgate confirmado.");
      } catch (ex) { msgBox.textContent = msg(ex); btn.disabled = false; btn.textContent = "Confirmar resgate"; }
    } }, "Confirmar resgate");
    return h("article", { class: "prize-card " + s.k },
      h("div", { class: "pc-main" },
        h("h3", null, r.prize_name),
        h("p", { class: "pc-who" }, `${r.client_name} · ${r.cpf_masked}`),
        h("p", { class: "pc-when" }, "Sorteado em " + fmtDT(r.created_at) + (r.valid_until ? " · válido até " + fmtDate(r.valid_until) : ""))),
      h("div", { class: "pc-side" }, h("code", null, r.redeem_code), badge, btn, msgBox));
  }
  return h("section", { class: "shell" },
    h("header", { class: "page-head" }, h("p", { class: "eyebrow" }, "Recepção"), h("h1", null, "Prêmios"), h("p", { class: "lede" }, "Procure o prêmio da cliente e confirme o resgate quando ela retirar.")),
    h("form", { class: "searchbar", role: "search", onsubmit: run }, h("label", { for: "busca", class: "sr" }, "Buscar prêmio"), q, h("button", { type: "submit", class: "btn btn-solid" }, "Buscar")),
    out);
}

/* ------------------------------------------------------------ administração */
function viewAdmin() {
  const tabs = [["resumo", "Resumo"], ["historico", "Histórico"], ["premios", "Prêmios"]];
  let cur = (location.hash.split("/")[2]) || "resumo";
  if (!tabs.some(t => t[0] === cur)) cur = "resumo";
  const body = h("div", { class: "admin-body" });
  const tabBar = h("div", { class: "subtabs", role: "tablist" }, tabs.map(([k, l]) => h("a", { href: "#/admin/" + k, role: "tab", "aria-selected": k === cur ? "true" : "false", class: "subtab" }, l)));
  ({ resumo: adminSummary, historico: adminHistory, premios: adminPrizes })[cur](body);
  return h("section", { class: "shell" },
    h("header", { class: "page-head" }, h("p", { class: "eyebrow" }, "Administração"), h("h1", null, "Campanha Black Friday")),
    tabBar, body);
}
async function adminSummary(body) {
  const load = async () => {
    body.replaceChildren(stateBox("loading", "Carregando indicadores…"));
    try {
      const s = await api.adminSummary();
      const stat = (v, l) => h("div", { class: "stat" }, h("b", null, String(v)), h("span", null, l));
      body.replaceChildren(
        h("div", { class: "stats" }, stat(s.visits, "Atendimentos"), stat(`${s.spins_used} de ${s.spins_granted}`, "Giros realizados"), stat(s.wins, "Prêmios sorteados"), stat(s.redeemed, "Resgates confirmados"), stat(money(s.amount_cents), "Valor dos atendimentos")),
        h("h2", { class: "sect" }, "Prêmios por categoria"),
        s.by_prize.length ? h("div", { class: "table-wrap" }, h("table", null,
          h("thead", null, h("tr", null, ["Prêmio", "Sorteados", "Resgatados", "Estoque"].map(t => h("th", { scope: "col" }, t)))),
          h("tbody", null, s.by_prize.map(p => h("tr", null, h("th", { scope: "row" }, p.name), h("td", null, String(p.awarded)), h("td", null, String(p.redeemed)), h("td", null, `${Math.max(0, p.total - p.awarded)} de ${p.total}`)))))) : stateBox("empty", "Nenhum prêmio cadastrado."));
    } catch (ex) { body.replaceChildren(stateBox("error", msg(ex), load)); }
  };
  load();
}
function adminHistory(body) {
  const LIMIT = 10; let offset = 0, term = "";
  const q = h("input", { type: "search", id: "hbusca", placeholder: "Nome ou final do CPF", autocomplete: "off" });
  const list = h("div", { class: "hist", "aria-live": "polite" });
  const pager = h("div", { class: "pager" });
  async function load() {
    list.replaceChildren(stateBox("loading", "Carregando atendimentos…")); pager.replaceChildren();
    try {
      const r = await api.adminVisits(term, LIMIT, offset);
      if (!r.rows.length) { list.replaceChildren(stateBox("empty", term ? "Nenhum atendimento para esta busca." : "Ainda não há atendimentos registrados.")); return; }
      list.replaceChildren(...r.rows.map(visitRow));
      const to = Math.min(offset + LIMIT, r.total);
      pager.append(h("span", null, `Mostrando ${offset + 1} a ${to} de ${r.total}`),
        h("button", { type: "button", class: "btn btn-line", disabled: offset === 0, onclick: () => { offset = Math.max(0, offset - LIMIT); load(); } }, "Anterior"),
        h("button", { type: "button", class: "btn btn-line", disabled: to >= r.total, onclick: () => { offset += LIMIT; load(); } }, "Próxima"));
    } catch (ex) { list.replaceChildren(stateBox("error", msg(ex), load)); }
  }
  function visitRow(v) {
    const e = h("p", { class: "field-error", role: "alert" });
    const anyRedeemed = v.results.some(r => r.redeemed_at);
    const resList = v.results.length ? h("ul", { class: "hres" }, v.results.map(r => {
      const re = h("p", { class: "field-error", role: "alert" });
      return h("li", null,
        h("span", { class: "t" }, `${r.spin_number}. ${r.prize_name}`), r.is_win ? h("code", null, r.redeem_code) : null,
        r.is_win ? h("small", null, r.redeemed_at ? "Resgatado em " + fmtDT(r.redeemed_at) : "A resgatar") : null,
        r.redeemed_at && !v.voided_at ? h("button", { type: "button", class: "btn-text", onclick: async () => {
          const d = await dialog({ title: "Desfazer resgate", body: `${r.prize_name}, código ${r.redeem_code}.`, reason: "Motivo", confirm: "Desfazer resgate", danger: true });
          if (!d.ok) return;
          try { await api.adminUnredeem(r.result_id, d.reason); load(); } catch (ex) { re.textContent = msg(ex); }
        } }, "Desfazer resgate") : null, re);
    })) : h("p", { class: "muted" }, "Nenhum giro feito ainda.");
    return h("article", { class: "hrow" + (v.voided_at ? " voided" : "") },
      h("div", { class: "hhead" },
        h("h3", null, v.client_name),
        v.voided_at ? h("span", { class: "badge expired" }, "Anulado") : null),
      h("p", { class: "hmeta" }, `${v.cpf_masked} · ${fmtDate(v.visit_date)} · ${money(v.amount_cents)} · giros ${v.spins_used} de ${v.spins_granted} · registrado por ${v.registered_by}`),
      v.voided_at ? h("p", { class: "void-reason" }, "Motivo da anulação: " + v.void_reason) : null,
      resList,
      !v.voided_at ? h("button", { type: "button", class: "btn btn-line btn-sm", onclick: async () => {
        const d = await dialog({ title: "Anular atendimento", body: anyRedeemed ? "Há prêmio já resgatado neste atendimento. Desfaça o resgate antes de anular." : `${v.client_name}, ${fmtDate(v.visit_date)}, ${money(v.amount_cents)}. Os prêmios não resgatados voltam ao estoque e os códigos deixam de valer.`, reason: "Motivo da anulação", confirm: "Anular atendimento", danger: true });
        if (!d.ok) return;
        try { await api.adminVoidVisit(v.visit_id, d.reason); load(); } catch (ex) { e.textContent = msg(ex); }
      } }, "Anular atendimento") : null, e);
  }
  body.append(h("form", { class: "searchbar", role: "search", onsubmit: (ev) => { ev.preventDefault(); term = q.value.trim(); offset = 0; load(); } }, h("label", { for: "hbusca", class: "sr" }, "Buscar atendimento"), q, h("button", { class: "btn btn-solid", type: "submit" }, "Buscar")), list, pager);
  load();
}
const pct = (x) => (x * 100).toLocaleString("pt-BR", { minimumFractionDigits: 1, maximumFractionDigits: 1 }) + "%";
const remaining = (p) => Math.max(0, p.total - p.awarded);
const inWheel = (p) => p.active && remaining(p) > 0;
function adminPrizes(body) {
  let all = [];
  async function load() {
    body.replaceChildren(stateBox("loading", "Carregando prêmios…"));
    try {
      all = await api.adminPrizes();
      const sum = all.filter(inWheel).reduce((t, p) => t + remaining(p), 0);
      const chip = (p) => inWheel(p) ? h("span", { class: "pz-chance" }, pct(remaining(p) / sum)) : h("span", { class: "pz-chance off" }, "Fora da roleta");
      body.replaceChildren(
        h("p", { class: "pz-intro" }, "A chance de cada prêmio vem da quantidade que ainda resta dele: quanto mais sobra, mais chance. Prêmio sem estoque ou desativado fica fora da roleta."),
        h("div", { class: "pz-bar" }, h("button", { type: "button", class: "btn btn-solid", onclick: () => edit(null) }, "Novo prêmio")),
        h("div", { class: "pz-list" }, all.map(p => h("article", { class: "pz" + (p.active ? "" : " off") },
          h("div", { class: "pz-main" }, h("h3", null, p.name), h("p", { class: "muted" }, `Rótulo "${p.label}" · ${p.is_fallback ? "sem prêmio" : "prêmio"}${p.active ? "" : " · desativado"}`)),
          h("div", { class: "pz-nums" }, chip(p), h("span", null, `${remaining(p)} de ${p.total} em estoque`)),
          h("button", { type: "button", class: "btn btn-line", onclick: () => edit(p) }, "Editar")))),
        h("div", { class: "pz-total" }, h("span", null, `Total em estoque na roleta: ${sum}`), h("b", null, sum > 0 ? "100,0%" : "0,0%")));
    } catch (ex) { body.replaceChildren(stateBox("error", msg(ex), load)); }
  }
  async function edit(p) {
    const isNew = !p;
    const cur = p || { prize_id: null, name: "", label: "", description: "", total: 10, awarded: 0, valid_days: 30, redeem_rules: "", active: true, is_fallback: false };
    const f = {};
    const field = (id, label, input) => h("div", { class: "field" }, h("label", { for: "pz-" + id }, label), input);
    f.name = h("input", { id: "pz-name", value: cur.name, required: true, maxlength: "60" });
    f.label = h("input", { id: "pz-label", value: cur.label, required: true, maxlength: "16" });
    f.description = h("textarea", { id: "pz-description", rows: "2", maxlength: "200" }, cur.description || "");
    f.total = h("input", { id: "pz-total", type: "number", min: String(cur.awarded), step: "1", value: String(cur.total), inputmode: "numeric" });
    f.valid_days = h("input", { id: "pz-valid", type: "number", min: "0", step: "1", value: String(cur.valid_days), inputmode: "numeric" });
    f.redeem_rules = h("textarea", { id: "pz-rules", rows: "2", maxlength: "300" }, cur.redeem_rules || "");
    f.active = h("input", { id: "pz-active", type: "checkbox", checked: cur.active, disabled: cur.is_fallback });
    const err = h("p", { class: "field-error", role: "alert" });
    const preview = h("p", { class: "pz-preview", "aria-live": "polite" });
    function update() {
      const t = parseInt(f.total.value, 10);
      const total = Number.isInteger(t) ? t : cur.total;
      const me = { ...cur, total, active: f.active.checked };
      const others = all.filter(x => x.prize_id !== cur.prize_id && inWheel(x)).reduce((s, x) => s + remaining(x), 0);
      const mine = inWheel(me) ? remaining(me) : 0;
      const chance = mine > 0 ? pct(mine / (others + mine)) : null;
      preview.replaceChildren(h("b", null, chance ? `Chance com este estoque: ${chance}` : "Com esta configuração, o prêmio fica fora da roleta."), h("span", null, " As chances dos outros prêmios mudam junto."));
    }
    f.total.addEventListener("input", update); f.active.addEventListener("change", update); update();
    const form = h("form", { method: "dialog", class: "dlg-form wide" },
      h("h2", null, isNew ? "Novo prêmio" : "Editar prêmio"),
      field("name", "Nome", f.name), field("label", "Rótulo na roleta (curto)", f.label), field("description", "Descrição", f.description),
      h("div", { class: "grid2" }, field("total", `Estoque total (já sorteados: ${cur.awarded})`, f.total), field("valid", "Validade (dias)", f.valid_days)),
      preview,
      field("rules", "Regras de resgate", f.redeem_rules),
      h("label", { class: "check" }, f.active, h("span", null, cur.is_fallback ? "Ativo (este prêmio é obrigatório)" : "Ativo na roleta")),
      err,
      h("div", { class: "dlg-actions" }, h("button", { type: "button", class: "btn btn-line", onclick: () => dlg.close("cancel") }, "Cancelar"), h("button", { type: "submit", class: "btn btn-solid" }, isNew ? "Criar prêmio" : "Salvar")));
    form.addEventListener("submit", async (ev) => {
      ev.preventDefault(); err.textContent = "";
      try {
        await api.adminSavePrize({ prize_id: cur.prize_id, name: f.name.value.trim(), label: f.label.value.trim(), description: f.description.value.trim(), total: parseInt(f.total.value, 10), valid_days: parseInt(f.valid_days.value, 10) || 0, redeem_rules: f.redeem_rules.value.trim(), active: f.active.checked });
        S.slices = null; dlg.close("ok"); load();
      } catch (ex) { err.textContent = msg(ex); }
    });
    dlg.replaceChildren(form); dlg.onclose = null; dlg.returnValue = ""; dlg.showModal(); f.name.focus();
  }
  load();
}

/* ------------------------------------------------------------------ rotas */
async function route() {
  const hash = location.hash || "";
  try {
    if (!S.session) { S.session = await api.session(); }
    if (S.session && !S.me) { S.me = await api.me(); }
  } catch (ex) {
    if (ex.code === "not_staff") { try { await api.signOut(); } catch (e) {} S.session = null; S.me = null; setView(viewLogin(), "Entrar"); $(".login .field-error").textContent = MESSAGES.not_staff; return; }
    S.session = null; S.me = null;
  }
  if (!S.session) { renderTop(); if (hash !== "#/entrar") history.replaceState(null, "", "#/entrar"); setView(viewLogin(), "Entrar"); return; }
  if (hash === "#/entrar" || hash === "" || hash === "#") { history.replaceState(null, "", "#/novo"); }
  const hh = location.hash;
  renderTop();
  if (hh.startsWith("#/roleta/")) { await viewWheel(hh.split("/")[2]); return; }
  if (hh.startsWith("#/premios")) { setView(viewPrizes(), "Prêmios"); return; }
  if (hh.startsWith("#/admin")) {
    if (S.me.role !== "admin") { setView(h("section", { class: "shell narrow" }, stateBox("error", MESSAGES.not_admin), h("a", { class: "btn btn-solid", href: "#/novo" }, "Novo atendimento")), "Administração"); return; }
    setView(viewAdmin(), "Administração"); return;
  }
  setView(viewNew(), "Novo atendimento");
}
window.addEventListener("hashchange", route);
if (MOCK) document.documentElement.setAttribute("data-mock", "");
route();
