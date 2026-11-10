/* Único ponto de contato com o banco. A tela chama só `api.*`.
   Duas implementações com os mesmos formatos e códigos de erro do CONTRATO.md:
   - real: supabase.rpc (supabase-js v2 local em vendor/)
   - simulada: memória do navegador (?mock=1)
   Para trocar, mude a última linha deste arquivo. */

export const MOCK = new URLSearchParams(location.search).get("mock") === "1";

export class ApiError extends Error {
  constructor(code, detail) { super(code); this.code = code; this.detail = detail; }
}

/* ---------------------------------------------------------------- real */
let sbPromise = null;
function loadSupabase() {
  if (sbPromise) return sbPromise;
  sbPromise = new Promise((resolve, reject) => {
    const cfg = window.BF_CONFIG;
    const s = document.createElement("script");
    s.src = cfg.vendor;
    s.onload = () => resolve(window.supabase.createClient(cfg.url, cfg.key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false }
    }));
    s.onerror = () => { sbPromise = null; reject(new ApiError("network")); };
    document.head.appendChild(s);
  });
  return sbPromise;
}

function toCode(error) {
  const m = String(error && error.message || "");
  const known = /not_staff|not_admin|expired|invalid_name|invalid_cpf|below_minimum|invalid_date|outside_campaign|duplicate_visit|visit_not_found|visit_voided|no_spins_left|result_not_found|already_redeemed|not_a_win|has_redeemed_prize|invalid_prize|reason_required/.exec(m);
  if (known) return known[0];
  if (/failed to fetch|network|load failed|fetch/i.test(m)) return "network";
  return "unknown";
}

async function rpc(fn, args) {
  const sb = await loadSupabase();
  let res;
  try { res = await sb.rpc(fn, args || {}); }
  catch (e) { throw new ApiError("network"); }
  if (res.error) throw new ApiError(toCode(res.error), res.error.message);
  return res.data;
}

const realApi = {
  mode: "real",
  async session() {
    const sb = await loadSupabase();
    const { data } = await sb.auth.getSession();
    return data && data.session ? { email: data.session.user.email } : null;
  },
  async signIn(email, password) {
    const sb = await loadSupabase();
    let res;
    try { res = await sb.auth.signInWithPassword({ email, password }); }
    catch (e) { throw new ApiError("network"); }
    if (res.error) {
      if (/invalid login|credentials|invalid/i.test(res.error.message)) throw new ApiError("invalid_login");
      throw new ApiError(toCode(res.error));
    }
    return { email: res.data.user.email };
  },
  async signOut() { const sb = await loadSupabase(); await sb.auth.signOut(); },
  me: () => rpc("bf_me"),
  wheel: () => rpc("bf_wheel"),
  registerVisit: (name, cpf, amountCents, visitDate, requestId) =>
    rpc("bf_register_visit", { p_name: name, p_cpf: cpf, p_amount_cents: amountCents, p_visit_date: visitDate, p_request_id: requestId }),
  visit: (visitId) => rpc("bf_visit", { p_visit_id: visitId }),
  openVisits: (cpf) => rpc("bf_open_visits", { p_cpf: cpf }),
  spin: (visitId, requestId) => rpc("bf_spin", { p_visit_id: visitId, p_request_id: requestId }),
  findResults: (query) => rpc("bf_find_results", { p_query: query }),
  redeem: (resultId) => rpc("bf_redeem", { p_result_id: resultId }),
  adminSummary: () => rpc("bf_admin_summary"),
  adminVisits: (search, limit, offset) => rpc("bf_admin_visits", { p_search: search, p_limit: limit, p_offset: offset }),
  adminPrizes: () => rpc("bf_admin_prizes"),
  adminSavePrize: (prize) => rpc("bf_admin_save_prize", { p_prize: prize }),
  adminVoidVisit: (visitId, reason) => rpc("bf_admin_void_visit", { p_visit_id: visitId, p_reason: reason }),
  adminUnredeem: (resultId, reason) => rpc("bf_admin_unredeem", { p_result_id: resultId, p_reason: reason })
};

/* ------------------------------------------------------------ simulada */
const TODAY = "2026-11-14";
const STARTS = "2026-11-11", ENDS = "2026-11-30";
const USERS = {
  "staff@divare.test": { password: "divare123", name: "Camila (recepção)", role: "staff" },
  "admin@divare.test": { password: "divare123", name: "Renata (administração)", role: "admin" }
};
const SEED_PRIZES = [
  ["Não foi desta vez", "Não foi", "Quem sabe no próximo giro.", false, true, 70, 0],
  ["5% de desconto", "5% OFF", "Desconto de 5% em um próximo atendimento.", true, false, 60, 30],
  ["Ampola de tratamento", "Ampola", "Uma ampola de tratamento aplicada em um atendimento de cabelo.", true, false, 30, 30],
  ["10% de desconto", "10% OFF", "Desconto de 10% em um próximo atendimento.", true, false, 45, 30],
  ["Hidratação express", "Hidratação", "Hidratação express em um atendimento de cabelo.", true, false, 20, 30],
  ["Mão tradicional", "Mão", "Um serviço de mão tradicional.", true, false, 13, 30],
  ["Faça um serviço e ganhe outro", "Leve outro", "Na compra de um serviço, o segundo sai por conta do salão.", true, false, 10, 30],
  ["Serviço completo especial", "Especial", "Um serviço completo à escolha do salão.", true, false, 2, 15]
];

function uuid() {
  if (crypto.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16); });
}
function validCpf(c) {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (let t = 9; t < 11; t++) {
    let s = 0; for (let i = 0; i < t; i++) s += +c[i] * (t + 1 - i);
    if (((s * 10) % 11) % 10 !== +c[t]) return false;
  }
  return true;
}
const digits = (s) => String(s || "").replace(/\D/g, "");
const addDays = (iso, n) => { const d = new Date(iso + "T12:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const nowIso = () => new Date().toISOString();
const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clone = (o) => JSON.parse(JSON.stringify(o));

function freshDb() {
  return {
    prizes: SEED_PRIZES.map((p, i) => ({ prize_id: "p" + (i + 1), name: p[0], label: p[1], description: p[2], is_win: p[3], is_fallback: p[4], total: p[5], awarded: 0, valid_days: p[6], redeem_rules: p[3] ? "Apresente o código na recepção. Não acumula com outras ofertas." : "", active: true, position: i + 1 })),
    clients: {}, visits: [], results: [], audit: []
  };
}
let db = null, user = null;
const SKEY = "bf-mock-db", UKEY = "bf-mock-user";
function loadDb() {
  if (db) return db;
  try { db = JSON.parse(sessionStorage.getItem(SKEY)); } catch (e) { db = null; }
  if (!db) db = freshDb();
  try { user = JSON.parse(sessionStorage.getItem(UKEY)); } catch (e) { user = null; }
  return db;
}
function save() { try { sessionStorage.setItem(SKEY, JSON.stringify(db)); } catch (e) {} }
function saveUser() { try { user ? sessionStorage.setItem(UKEY, JSON.stringify(user)) : sessionStorage.removeItem(UKEY); } catch (e) {} }

/* Ganchos de teste (só na simulação) */
const hooks = { failNext: 0, forced: [], latency: 220, log: [], expire(resultId) { loadDb(); const r = db.results.find(x => x.result_id === resultId); if (r) { r.valid_until = "2026-11-01"; save(); } } };
window.__bfMock = hooks;

async function guard(role) {
  loadDb();
  await sleep(hooks.latency);
  if (hooks.failNext > 0 && role !== "auth") { hooks.failNext--; throw new ApiError("network"); }
  if (!user) throw new ApiError("not_staff");
  if (role === "admin" && user.role !== "admin") throw new ApiError("not_admin");
}
const codeAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function newCode() { let s = ""; for (let i = 0; i < 6; i++) s += codeAlphabet[Math.floor(Math.random() * codeAlphabet.length)]; return s; }
const mask = (cpf) => "***.***.***-" + cpf.slice(-2);

function visitView(v, withResults) {
  const c = db.clients[v.cpf];
  const o = { voided_at: v.voided_at || null, void_reason: v.void_reason || null, visit_id: v.visit_id, client_name: c.name, cpf_masked: mask(v.cpf), visit_date: v.visit_date, amount_cents: v.amount_cents, spins_granted: v.spins_granted, spins_left: v.spins_granted - v.spins_used, returning_client: v.returning };
  if (withResults) o.results = resultsOf(v.visit_id).map(resultView);
  return o;
}
const resultsOf = (id) => db.results.filter(r => r.visit_id === id && !r.cancelled).sort((a, b) => a.spin_number - b.spin_number);
function resultView(r) {
  const p = db.prizes.find(x => x.prize_id === r.prize_id);
  return { result_id: r.result_id, spin_number: r.spin_number, prize_id: r.prize_id, prize_name: p.name, is_win: p.is_win, description: p.description, redeem_code: p.is_win ? r.redeem_code : null, valid_until: p.is_win ? r.valid_until : null, redeemed_at: r.redeemed_at, created_at: r.created_at };
}
function inCampaign() { return TODAY >= STARTS && TODAY <= ENDS; }

const mockApi = {
  mode: "mock",
  async session() { loadDb(); await sleep(80); return user ? { email: user.email } : null; },
  async signIn(email, password) {
    loadDb(); await sleep(hooks.latency);
    const u = USERS[String(email).trim().toLowerCase()];
    if (!u || u.password !== password) throw new ApiError("invalid_login");
    user = { email: String(email).trim().toLowerCase(), name: u.name, role: u.role }; saveUser();
    return { email: user.email };
  },
  async signOut() { loadDb(); user = null; saveUser(); },
  async me() {
    await guard();
    return { name: user.name, role: user.role, campaign: { starts_on: STARTS, ends_on: ENDS, today: TODAY, active: inCampaign() } };
  },
  async wheel() {
    await guard();
    return db.prizes.filter(p => p.active).sort((a, b) => a.position - b.position).map(p => ({ prize_id: p.prize_id, label: p.label, name: p.name, is_win: p.is_win, position: p.position }));
  },
  async registerVisit(name, cpf, amountCents, visitDate, requestId) {
    hooks.log.push({ fn: "register", requestId });
    await guard();
    const prev = db.visits.find(v => v.request_id === requestId);
    if (prev) return visitView(prev);
    name = String(name || "").trim().replace(/\s+/g, " ");
    if (name.split(" ").filter(Boolean).length < 2 || name.length < 5) throw new ApiError("invalid_name");
    cpf = digits(cpf);
    if (!validCpf(cpf)) throw new ApiError("invalid_cpf");
    if (!inCampaign()) throw new ApiError("outside_campaign");
    if (!Number.isInteger(amountCents) || amountCents < 10000) throw new ApiError("below_minimum");
    if (!visitDate || visitDate < STARTS || visitDate > TODAY) throw new ApiError("invalid_date");
    if (db.visits.some(v => v.cpf === cpf && v.visit_date === visitDate && v.amount_cents === amountCents && !v.voided_at)) throw new ApiError("duplicate_visit");
    const returning = !!db.clients[cpf];
    db.clients[cpf] = { name };
    const v = { visit_id: uuid(), cpf, visit_date: visitDate, amount_cents: amountCents, spins_granted: Math.min(5, Math.floor(amountCents / 10000)), spins_used: 0, registered_by: user.name, request_id: requestId, created_at: nowIso(), voided_at: null, void_reason: null, returning };
    db.visits.push(v); db.audit.push({ at: nowIso(), by: user.name, action: "register_visit", target: v.visit_id });
    save();
    return visitView(v);
  },
  async visit(visitId) {
    await guard();
    const v = db.visits.find(x => x.visit_id === visitId);
    if (!v) throw new ApiError("visit_not_found");
    return visitView(v, true);
  },
  async openVisits(cpf) {
    await guard();
    cpf = digits(cpf);
    if (!validCpf(cpf)) throw new ApiError("invalid_cpf");
    return db.visits.filter(v => v.cpf === cpf && !v.voided_at && v.spins_granted - v.spins_used > 0)
      .map(v => ({ visit_id: v.visit_id, client_name: db.clients[v.cpf].name, visit_date: v.visit_date, amount_cents: v.amount_cents, spins_left: v.spins_granted - v.spins_used }));
  },
  async spin(visitId, requestId) {
    hooks.log.push({ fn: "spin", requestId });
    await guard();
    const prior = db.results.find(r => r.request_id === requestId);
    if (prior) { const v0 = db.visits.find(x => x.visit_id === prior.visit_id); return { ...resultView(prior), spins_left: v0.spins_granted - v0.spins_used }; }
    const v = db.visits.find(x => x.visit_id === visitId);
    if (!v) throw new ApiError("visit_not_found");
    if (v.voided_at) throw new ApiError("visit_voided");
    if (!inCampaign()) throw new ApiError("outside_campaign");
    if (v.spins_used >= v.spins_granted) throw new ApiError("no_spins_left");
    const active = db.prizes.filter(p => p.active);
    let prize = null;
    if (hooks.forced.length) { const fid = hooks.forced.shift(); prize = active.find(p => p.prize_id === fid) || null; }
    if (!prize) {
      const pool = active.filter(p => p.total - p.awarded > 0);
      const sum = pool.reduce((s, p) => s + (p.total - p.awarded), 0);
      if (sum <= 0) prize = active.find(p => p.is_fallback);
      else { let t = Math.random() * sum; for (const p of pool) { t -= (p.total - p.awarded); if (t < 0) { prize = p; break; } } if (!prize) prize = pool[pool.length - 1]; }
    }
    prize.awarded += 1; v.spins_used += 1;
    const r = { result_id: uuid(), visit_id: v.visit_id, spin_number: v.spins_used, prize_id: prize.prize_id, redeem_code: prize.is_win ? newCode() : null, valid_until: prize.is_win ? addDays(TODAY, prize.valid_days) : null, redeemed_at: null, redeemed_by: null, created_at: nowIso(), request_id: requestId, cancelled: false };
    db.results.push(r); save();
    return { ...resultView(r), spins_left: v.spins_granted - v.spins_used };
  },
  async findResults(query) {
    await guard();
    const q = String(query || "").trim();
    if (!q) return [];
    const qd = digits(q), ql = q.toLowerCase(), qc = q.toUpperCase();
    const out = db.results.filter(r => {
      if (r.cancelled) return false;
      const p = db.prizes.find(x => x.prize_id === r.prize_id); if (!p.is_win) return false;
      const v = db.visits.find(x => x.visit_id === r.visit_id); if (v.voided_at) return false;
      const c = db.clients[v.cpf];
      return (qd.length === 11 && v.cpf === qd) || r.redeem_code === qc || c.name.toLowerCase().includes(ql);
    }).sort((a, b) => b.created_at.localeCompare(a.created_at));
    return out.map(r => { const v = db.visits.find(x => x.visit_id === r.visit_id); const p = db.prizes.find(x => x.prize_id === r.prize_id); return { result_id: r.result_id, client_name: db.clients[v.cpf].name, cpf_masked: mask(v.cpf), prize_name: p.name, redeem_code: r.redeem_code, valid_until: r.valid_until, redeemed_at: r.redeemed_at, created_at: r.created_at }; });
  },
  async redeem(resultId) {
    await guard();
    const r = db.results.find(x => x.result_id === resultId);
    if (!r || r.cancelled) throw new ApiError("result_not_found");
    const p = db.prizes.find(x => x.prize_id === r.prize_id);
    if (!p.is_win) throw new ApiError("not_a_win");
    if (r.redeemed_at) throw new ApiError("already_redeemed");
    if (r.valid_until && r.valid_until < TODAY) throw new ApiError("expired");
    r.redeemed_at = nowIso(); r.redeemed_by = user.name;
    db.audit.push({ at: nowIso(), by: user.name, action: "redeem", target: r.result_id }); save();
    const v = db.visits.find(x => x.visit_id === r.visit_id);
    return { result_id: r.result_id, client_name: db.clients[v.cpf].name, cpf_masked: mask(v.cpf), prize_name: p.name, redeem_code: r.redeem_code, valid_until: r.valid_until, redeemed_at: r.redeemed_at, created_at: r.created_at };
  },
  async adminSummary() {
    await guard("admin");
    const vs = db.visits.filter(v => !v.voided_at);
    const rs = db.results.filter(r => !r.cancelled && vs.some(v => v.visit_id === r.visit_id));
    return {
      visits: vs.length, spins_granted: vs.reduce((s, v) => s + v.spins_granted, 0), spins_used: vs.reduce((s, v) => s + v.spins_used, 0),
      wins: rs.filter(r => db.prizes.find(p => p.prize_id === r.prize_id).is_win).length, redeemed: rs.filter(r => r.redeemed_at).length,
      amount_cents: vs.reduce((s, v) => s + v.amount_cents, 0),
      by_prize: db.prizes.map(p => ({ prize_id: p.prize_id, name: p.name, total: p.total, awarded: rs.filter(r => r.prize_id === p.prize_id).length, redeemed: rs.filter(r => r.prize_id === p.prize_id && r.redeemed_at).length }))
    };
  },
  async adminVisits(search, limit, offset) {
    await guard("admin");
    const q = String(search || "").trim().toLowerCase(), qd = digits(search);
    let rows = db.visits.filter(v => !q || db.clients[v.cpf].name.toLowerCase().includes(q) || (qd.length >= 2 && v.cpf.endsWith(qd)) || (qd.length === 11 && v.cpf === qd))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
    const total = rows.length;
    rows = rows.slice(offset || 0, (offset || 0) + (limit || 10)).map(v => ({
      visit_id: v.visit_id, client_name: db.clients[v.cpf].name, cpf_masked: mask(v.cpf), visit_date: v.visit_date, amount_cents: v.amount_cents,
      spins_granted: v.spins_granted, spins_used: v.spins_used, registered_by: v.registered_by, created_at: v.created_at, voided_at: v.voided_at, void_reason: v.void_reason,
      results: db.results.filter(r => r.visit_id === v.visit_id && !r.cancelled).sort((a, b) => a.spin_number - b.spin_number).map(resultView)
    }));
    return { total, rows };
  },
  async adminPrizes() { await guard("admin"); return clone(db.prizes.slice().sort((a, b) => a.position - b.position)); },
  async adminSavePrize(prize) {
    await guard("admin");
    let p = prize.prize_id ? db.prizes.find(x => x.prize_id === prize.prize_id) : null;
    if (prize.prize_id && !p) throw new ApiError("invalid_prize");
    const creating = !p;
    if (creating) p = { prize_id: uuid(), is_win: prize.is_win !== false, is_fallback: false, awarded: 0, position: Math.max(0, ...db.prizes.map(x => x.position)) + 1 };
    const total = Number(prize.total);
    if (!String(prize.name || "").trim() || !String(prize.label || "").trim() || !Number.isInteger(total) || total < p.awarded || (prize.valid_days != null && (!Number.isInteger(Number(prize.valid_days)) || Number(prize.valid_days) < 0))) throw new ApiError("invalid_prize");
    if (p.is_fallback && prize.active === false) throw new ApiError("invalid_prize");
    Object.assign(p, { name: String(prize.name).trim(), label: String(prize.label).trim(), description: prize.description || "", total, valid_days: Number(prize.valid_days) || 0, redeem_rules: prize.redeem_rules || "", active: prize.active !== false });
    if (creating) db.prizes.push(p);
    db.audit.push({ at: nowIso(), by: user.name, action: "save_prize", target: p.prize_id }); save();
    return clone(p);
  },
  async adminVoidVisit(visitId, reason) {
    await guard("admin");
    if (!String(reason || "").trim()) throw new ApiError("reason_required");
    const v = db.visits.find(x => x.visit_id === visitId);
    if (!v) throw new ApiError("visit_not_found");
    if (v.voided_at) throw new ApiError("visit_voided");
    const rs = db.results.filter(r => r.visit_id === visitId && !r.cancelled);
    if (rs.some(r => r.redeemed_at)) throw new ApiError("has_redeemed_prize");
    rs.forEach(r => { r.cancelled = true; const p = db.prizes.find(x => x.prize_id === r.prize_id); p.awarded = Math.max(0, p.awarded - 1); });
    v.voided_at = nowIso(); v.void_reason = String(reason).trim();
    db.audit.push({ at: nowIso(), by: user.name, action: "void_visit", target: visitId, reason }); save();
    return visitView(v);
  },
  async adminUnredeem(resultId, reason) {
    await guard("admin");
    if (!String(reason || "").trim()) throw new ApiError("reason_required");
    const r = db.results.find(x => x.result_id === resultId);
    if (!r || r.cancelled) throw new ApiError("result_not_found");
    r.redeemed_at = null; r.redeemed_by = null;
    db.audit.push({ at: nowIso(), by: user.name, action: "unredeem", target: resultId, reason }); save();
    return resultView(r);
  }
};

export const api = MOCK ? mockApi : realApi;
export { validCpf };
