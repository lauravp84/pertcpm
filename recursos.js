/* Carga e nivelamento de recursos. Sem dependência do restante do app: recebe o resultado de calcular()
   (c.ordem, c.N, c.peso) e as demandas (id → unidades por período). Um só tipo de recurso.
   - rcPerfil: carga exata período a período (função em degraus).
   - rcAlisar: desloca atividades dentro da folga para suavizar a carga; o prazo não muda.
   - rcLimitar: respeita um limite de recursos adiando atividades; o prazo pode crescer. */
'use strict';
const RC_EPS = 1e-9;

/* itens: [{ s: início, d: duração, r: demanda }] → degraus [{ t0, t1, u }] ordenados, sem trechos vazios no meio */
function rcPerfil(itens) {
  const ev = new Map();
  itens.forEach(it => { if (it.r > 0 && it.d > RC_EPS) { ev.set(it.s, (ev.get(it.s) || 0) + it.r); ev.set(it.s + it.d, (ev.get(it.s + it.d) || 0) - it.r); } });
  const ts = Array.from(ev.keys()).sort((a, b) => a - b), seg = []; let u = 0;
  for (let i = 0; i < ts.length - 1; i++) {
    u += ev.get(ts[i]);
    const x = Math.abs(u) < RC_EPS ? 0 : u;
    if (ts[i + 1] - ts[i] > RC_EPS) {
      if (seg.length && Math.abs(seg[seg.length - 1].u - x) < RC_EPS && Math.abs(seg[seg.length - 1].t1 - ts[i]) < RC_EPS) seg[seg.length - 1].t1 = ts[i + 1];
      else seg.push({ t0: ts[i], t1: ts[i + 1], u: x });
    }
  }
  return seg;
}
const rcPico = seg => seg.reduce((m, g) => Math.max(m, g.u), 0);
const rcSoma2 = seg => seg.reduce((t, g) => t + g.u * g.u * (g.t1 - g.t0), 0);
const rcTotal = seg => seg.reduce((t, g) => t + g.u * (g.t1 - g.t0), 0);

function rcItens(c, rec, S) {
  return c.ordem.map(id => ({ id, s: S.get(id), d: c.N.get(id).dur, r: rec.get(id) || 0 }));
}
function rcInicioCedo(c) { const S = new Map(); c.ordem.forEach(id => S.set(id, c.N.get(id).ES)); return S; }

/* Alisamento: método do menor quadrado das cargas (Burgess), com a carga medida em células de 1 período.
   Só move atividade com folga e demanda; cada uma fica dentro de [início mais cedo, início mais tarde] e
   respeita as ligações com as vizinhas nas posições atuais. */
function rcAlisar(c, rec) {
  const S = rcInicioCedo(c);
  const H = Math.ceil(c.dur) + 2, carga = new Float64Array(H);
  const cel = (s, d, r, sinal) => {
    if (d <= RC_EPS || r <= 0) return;
    const k0 = Math.floor(s + RC_EPS), k1 = Math.min(H - 1, Math.ceil(s + d - RC_EPS) - 1);
    for (let k = k0; k <= k1; k++) { const ov = Math.min(s + d, k + 1) - Math.max(s, k); if (ov > 0) carga[k] += sinal * r * ov; }
  };
  const custo = (s, d, r) => {
    let t = 0; if (d <= RC_EPS || r <= 0) return 0;
    const k0 = Math.floor(s + RC_EPS), k1 = Math.min(H - 1, Math.ceil(s + d - RC_EPS) - 1);
    for (let k = k0; k <= k1; k++) { const ov = Math.min(s + d, k + 1) - Math.max(s, k); if (ov > 0) { const x = carga[k] + r * ov; t += x * x - carga[k] * carga[k]; } }
    return t;
  };
  c.ordem.forEach(id => cel(S.get(id), c.N.get(id).dur, rec.get(id) || 0, 1));
  const movel = c.ordem.filter(id => c.N.get(id).FT > RC_EPS && (rec.get(id) || 0) > 0 && c.N.get(id).dur > RC_EPS).reverse();
  for (let passada = 0; passada < 30; passada++) {
    let mudou = false;
    movel.forEach(id => {
      const n = c.N.get(id), r = rec.get(id), atual = S.get(id);
      let lo = n.ES, hi = n.LS;
      n.preds.forEach(p => { lo = Math.max(lo, S.get(p) + c.peso(c.N.get(p), n)); });
      n.succs.forEach(s => { hi = Math.min(hi, S.get(s) - c.peso(n, c.N.get(s))); });
      if (hi < lo - RC_EPS) return;
      cel(atual, n.dur, r, -1);
      const passo = Math.max(1, (hi - lo) / 400);
      let melhor = atual, melhorC = custo(atual, n.dur, r);
      const tenta = t => { const cc = custo(t, n.dur, r); if (cc < melhorC - 1e-9) { melhorC = cc; melhor = t; } };
      for (let t = lo; t <= hi + RC_EPS; t += passo) tenta(Math.min(t, hi));
      tenta(hi);
      cel(melhor, n.dur, r, 1);
      if (Math.abs(melhor - atual) > RC_EPS) { S.set(id, melhor); mudou = true; }
    });
    if (!mudou) break;
  }
  return { S };
}

/* Limite de recursos: geração serial de cronograma. Entre as atividades liberadas (todas as predecessoras já
   programadas), escolhe pela regra; cada uma começa no primeiro instante, a partir do que as ligações permitem,
   em que a carga mais a sua demanda não passa do limite durante toda a duração. */
function rcLimitar(c, rec, limite, regra) {
  for (const id of c.ordem) if ((rec.get(id) || 0) > limite + RC_EPS) return { erro: id, S: null };
  const S = new Map(), feito = [];
  const falta = new Map(); c.ordem.forEach(id => falta.set(id, c.N.get(id).preds.length));
  const livres = c.ordem.filter(id => falta.get(id) === 0), ordemIdx = new Map(); c.ordem.forEach((id, i) => ordemIdx.set(id, i));
  const chave = id => {
    const n = c.N.get(id);
    const base = regra === 'maior' ? [-n.dur, n.FT] : regra === 'recurso' ? [-(rec.get(id) || 0), n.FT] : [n.FT, n.ES];
    return base.concat([ordemIdx.get(id)]);
  };
  const menor = (a, b) => { const x = chave(a), y = chave(b); for (let i = 0; i < x.length; i++) { if (Math.abs(x[i] - y[i]) > RC_EPS) return x[i] < y[i]; } return false; };
  const uso = x => { let u = 0; for (const it of feito) if (it.r > 0 && it.s <= x + RC_EPS && x < it.s + it.d - RC_EPS) u += it.r; return u; };
  while (livres.length) {
    let bi = 0; for (let i = 1; i < livres.length; i++) if (menor(livres[i], livres[bi])) bi = i;
    const id = livres.splice(bi, 1)[0], n = c.N.get(id), r = rec.get(id) || 0;
    let lb = 0; n.preds.forEach(p => { lb = Math.max(lb, S.get(p) + c.peso(c.N.get(p), n)); });
    let t = lb;
    if (r > 0 && n.dur > RC_EPS) {
      const cand = [lb]; feito.forEach(it => { const e = it.s + it.d; if (e > lb + RC_EPS && it.r > 0) cand.push(e); });
      cand.sort((a, b) => a - b);
      t = null;
      for (const ct of cand) {
        let ok = uso(ct) + r <= limite + RC_EPS;
        if (ok) for (const it of feito) { if (it.r > 0 && it.s > ct + RC_EPS && it.s < ct + n.dur - RC_EPS && uso(it.s) + r > limite + RC_EPS) { ok = false; break; } }
        if (ok) { t = ct; break; }
      }
      if (t === null) t = cand[cand.length - 1];
    }
    S.set(id, t); feito.push({ s: t, d: n.dur, r });
    n.succs.forEach(s => { falta.set(s, falta.get(s) - 1); if (falta.get(s) === 0) livres.push(s); });
  }
  return { S };
}
function rcDuracao(c, S) { let d = 0; c.ordem.forEach(id => { d = Math.max(d, S.get(id) + c.N.get(id).dur); }); return d; }
