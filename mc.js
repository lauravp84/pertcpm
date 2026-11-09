/* Simulação de Monte Carlo do prazo do projeto. Sem dependência do restante do app: recebe o resultado
   de calcular() e devolve estatísticas. Cada atividade sorteia a duração numa distribuição beta-PERT
   (a mesma ideia do PERT: o, m, p, com o "mais provável" pesando 4). */
'use strict';

function mcRng(seed) {                                   /* mulberry32: rápido e reproduzível */
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function mcNormal(r) {
  let u = 0; while (u === 0) u = r();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * r());
}
function mcGamma(r, k) {                                 /* Marsaglia-Tsang, k >= 1 */
  const d = k - 1 / 3, c = 1 / Math.sqrt(9 * d);
  for (;;) {
    let x, v;
    do { x = mcNormal(r); v = 1 + c * x; } while (v <= 0);
    v = v * v * v;
    const u = r();
    if (u < 1 - 0.0331 * x * x * x * x) return d * v;
    if (Math.log(u) < 0.5 * x * x + d * (1 - v + Math.log(v))) return d * v;
  }
}
function mcBetaPert(r, o, m, p) {
  if (!(p - o > 1e-12)) return o;
  const a = 1 + 4 * (m - o) / (p - o), b = 1 + 4 * (p - m) / (p - o);
  const x = mcGamma(r, a), y = mcGamma(r, b);
  return o + (x / (x + y)) * (p - o);
}

/* Modelo enxuto da rede: vetores em vez de objetos, para rodar milhares de vezes. */
function mcModelo(c) {
  const ids = c.ordem, n = ids.length, idx = new Map(); ids.forEach((id, i) => idx.set(id, i));
  const m = { n, ids, o: new Float64Array(n), mo: new Float64Array(n), p: new Float64Array(n), preds: [], tipo: [], lag: [], succs: [], dEsp: new Float64Array(n) };
  ids.forEach((id, i) => {
    const nd = c.N.get(id), ref = nd.ref;
    m.o[i] = +ref.o; m.mo[i] = +ref.m; m.p[i] = +ref.p; m.dEsp[i] = nd.dur;
    m.preds.push(nd.preds.map(p => idx.get(p)));
    m.tipo.push(nd.preds.map(p => { const r = nd.rel.get(p); return r ? r.t : 'TI'; }));
    m.lag.push(nd.preds.map(p => { const r = nd.rel.get(p); return r ? r.lag : 0; }));
    m.succs.push([]);
  });
  m.preds.forEach((ps, i) => ps.forEach((p, k) => m.succs[p].push([i, m.tipo[i][k], m.lag[i][k]])));
  return m;
}
function mcPeso(t, lag, dp, ds) {
  return t === 'II' ? lag : t === 'TT' ? dp + lag - ds : t === 'IT' ? lag - ds : dp + lag;
}
/* Uma rodada: dadas as durações, devolve a duração do projeto e marca as atividades críticas em `crit`. */
function mcPassar(m, d, ES, LS, crit) {
  const n = m.n; let dur = 0;
  for (let i = 0; i < n; i++) {
    let es = 0; const ps = m.preds[i], ts = m.tipo[i], lg = m.lag[i];
    for (let k = 0; k < ps.length; k++) { const v = ES[ps[k]] + mcPeso(ts[k], lg[k], d[ps[k]], d[i]); if (v > es) es = v; }
    ES[i] = es; if (es + d[i] > dur) dur = es + d[i];
  }
  if (crit) {
    for (let i = n - 1; i >= 0; i--) {
      let ls = dur - d[i]; const ss = m.succs[i];
      for (let k = 0; k < ss.length; k++) { const s = ss[k]; const v = LS[s[0]] - mcPeso(s[1], s[2], d[i], d[s[0]]); if (v < ls) ls = v; }
      LS[i] = ls; if (ls - ES[i] < 1e-9) crit[i]++;
    }
  }
  return dur;
}
function mcSimular(c, N, seed) {
  const m = mcModelo(c), r = mcRng(seed), n = m.n;
  const d = new Float64Array(n), ES = new Float64Array(n), LS = new Float64Array(n), crit = new Float64Array(n);
  const res = new Float64Array(N);
  for (let k = 0; k < N; k++) {
    for (let i = 0; i < n; i++) d[i] = mcBetaPert(r, m.o[i], m.mo[i], m.p[i]);
    res[k] = mcPassar(m, d, ES, LS, crit);
  }
  const ord = Float64Array.from(res).sort();
  let soma = 0; for (let k = 0; k < N; k++) soma += res[k];
  const media = soma / N; let v = 0; for (let k = 0; k < N; k++) v += (res[k] - media) * (res[k] - media);
  const pct = q => ord[Math.min(N - 1, Math.max(0, Math.ceil(q * N) - 1))];
  const ate = x => { let lo = 0, hi = N; while (lo < hi) { const mid = (lo + hi) >> 1; if (ord[mid] <= x + 1e-9) lo = mid + 1; else hi = mid; } return lo / N; };
  return { N, seed, media, dp: Math.sqrt(v / N), min: ord[0], max: ord[N - 1], pct, ate, ord, ids: m.ids, indiceCrit: Array.from(crit, x => x / N) };
}
