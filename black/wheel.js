/* Roleta: desenha as fatias de bf_wheel() e gira até a fatia do prêmio já sorteado pelo servidor.
   Nada aqui decide o resultado. */

const SVGNS = "http://www.w3.org/2000/svg";
const R = 190;
const FILLS = [
  { bg: "#F3E6E0", fg: "#4A2C27" },
  { bg: "#D9A99E", fg: "#2E1A17" },
  { bg: "#EAD3CA", fg: "#4A2C27" },
  { bg: "#9A5446", fg: "#FBF7F4" }
];
const FALLBACK = { bg: "#FBF7F4", fg: "#6B524C" };

const pt = (r, deg) => { const a = deg * Math.PI / 180; return [r * Math.sin(a), -r * Math.cos(a)]; };
const el = (name, attrs) => { const n = document.createElementNS(SVGNS, name); for (const k in attrs) n.setAttribute(k, attrs[k]); return n; };

export function buildWheel(host, slices) {
  const n = slices.length;
  const step = 360 / n;
  host.innerHTML = "";
  const box = document.createElement("div"); box.className = "wheel-box";
  const disc = document.createElement("div"); disc.className = "wheel-disc";
  const svg = el("svg", { viewBox: "-200 -200 400 400", "aria-hidden": "true", focusable: "false" });
  slices.forEach((s, i) => {
    const a0 = i * step, a1 = (i + 1) * step;
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1);
    const fill = s.is_win ? FILLS[i % FILLS.length] : FALLBACK;
    const g = el("g", { "data-prize": s.prize_id });
    g.appendChild(el("path", { d: `M0 0 L${x0.toFixed(2)} ${y0.toFixed(2)} A${R} ${R} 0 ${step > 180 ? 1 : 0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`, fill: fill.bg, stroke: "#E2CCC3", "stroke-width": "1" }));
    const mid = a0 + step / 2;
    const label = s.label || s.name;
    const size = Math.max(11, Math.min(17, 118 / (label.length * 0.56)));
    // Metade esquerda: gira o texto 180 graus para que nenhum rótulo fique de cabeça para baixo na posição inicial.
    const left = mid > 180;
    const t = el("text", { x: left ? -(R - 18) : R - 18, y: 0, transform: `rotate(${left ? mid + 90 : mid - 90})`, "text-anchor": left ? "start" : "end", "dominant-baseline": "central", fill: fill.fg, "font-size": size.toFixed(1), "font-weight": "500", "letter-spacing": ".01em" });
    t.textContent = label;
    g.appendChild(t);
    svg.appendChild(g);
  });
  disc.appendChild(svg);

  const rim = el("svg", { viewBox: "-200 -200 400 400", class: "wheel-rim", "aria-hidden": "true", focusable: "false" });
  rim.appendChild(el("circle", { r: R + 6, fill: "none", stroke: "#9A5446", "stroke-width": "5" }));
  rim.appendChild(el("circle", { r: R + 1, fill: "none", stroke: "#FBF7F4", "stroke-width": "4" }));
  for (let i = 0; i < n; i++) { const [x, y] = pt(R + 6, i * step); rim.appendChild(el("circle", { cx: x.toFixed(2), cy: y.toFixed(2), r: "4.2", fill: "#FBF7F4", stroke: "#9A5446", "stroke-width": "1.5" })); }

  const hub = document.createElement("div"); hub.className = "wheel-hub"; hub.innerHTML = '<img src="img/divare-simbolo-256.webp" srcset="img/divare-simbolo-128.webp 128w, img/divare-simbolo-256.webp 256w, img/divare-simbolo-384.webp 384w, img/divare-simbolo-773.webp 773w" sizes="64px" width="773" height="514" alt="" decoding="async">';
  const ptr = document.createElement("div"); ptr.className = "wheel-pointer"; ptr.setAttribute("aria-hidden", "true");
  ptr.innerHTML = '<svg viewBox="0 0 40 52" focusable="false"><path d="M20 50 C20 50 3 32 3 18 A17 17 0 0 1 37 18 C37 32 20 50 20 50 Z" fill="#4A2C27" stroke="#FBF7F4" stroke-width="3"/><circle cx="20" cy="18" r="5.5" fill="#FBF7F4"/></svg>';
  box.append(disc, rim, hub, ptr);
  host.appendChild(box);

  let angle = 0;
  const reduce = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  function setAngle(a, ms) {
    angle = a;
    disc.style.transition = ms ? `transform ${ms}ms cubic-bezier(.12,.62,.1,1)` : "none";
    disc.style.transform = `rotate(${a}deg)`;
  }

  /* Ângulo (graus, no sentido horário a partir do topo) do ponto da roleta que está sob o ponteiro. */
  function underPointer() {
    const m = getComputedStyle(disc).transform;
    let theta = 0;
    if (m && m !== "none") { const v = m.match(/matrix\(([^)]+)\)/)[1].split(",").map(Number); theta = Math.atan2(v[1], v[0]) * 180 / Math.PI; }
    return (((-theta) % 360) + 360) % 360;
  }
  function landing() {
    const p = underPointer();
    const i = Math.floor(p / step);
    return { index: i, prize_id: slices[i].prize_id, offset: (p - i * step) / step };
  }

  /* Gira até a fatia do prêmio. Devolve uma promessa resolvida quando para. */
  function spinTo(prizeId) {
    const i = slices.findIndex(s => s.prize_id === prizeId);
    if (i < 0) return Promise.reject(new Error("prize_not_on_wheel"));
    const jitter = (Math.random() * 0.56 - 0.28) * step;           // fica dentro da fatia, longe da divisa
    const targetMod = (((-(i * step + step / 2 + jitter)) % 360) + 360) % 360;
    const curMod = ((angle % 360) + 360) % 360;
    const delta = ((targetMod - curMod) % 360 + 360) % 360;
    const turns = 5 + Math.floor(Math.random() * 3);
    const next = angle + turns * 360 + delta;
    if (reduce()) { setAngle(next, 0); return Promise.resolve(); }
    const ms = 4300 + Math.floor(Math.random() * 1500);              // 4,3 a 5,8 s
    return new Promise(resolve => {
      let done = false;
      const end = () => { if (done) return; done = true; disc.removeEventListener("transitionend", onEnd); resolve(); };
      const onEnd = (e) => { if (e.target === disc && e.propertyName === "transform") end(); };
      disc.addEventListener("transitionend", onEnd);
      requestAnimationFrame(() => requestAnimationFrame(() => setAngle(next, ms)));
      setTimeout(end, ms + 400);
    });
  }
  function highlight(prizeId) {
    svg.querySelectorAll("g").forEach(g => g.classList.toggle("won", g.getAttribute("data-prize") === prizeId));
  }
  return { el: box, spinTo, landing, highlight, slices };
}
