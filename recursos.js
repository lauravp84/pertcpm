/* Carga e nivelamento de recursos, com até 3 tipos de recurso ao mesmo tempo.
   Funções de cálculo não dependem do app; as de tela (renderRec, recRodar) usam os globais do app na hora da chamada.
   - rcPerfil: carga exata período a período (função em degraus), para um recurso.
   - rcAlisar: desloca atividades dentro da folga para suavizar a carga de todos os recursos; o prazo não muda.
   - rcLimitar: respeita um limite por recurso adiando atividades; o prazo pode crescer. */
'use strict';
const RC_EPS = 1e-9, RC_MAX = 3;

/* itens: [{ s: início, d: duração, r: demanda }] → degraus [{ t0, t1, u }] */
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

/* rec: Map id → [r1, r2, r3]; k = índice do recurso */
function rcItens(c, rec, S, k) { return c.ordem.map(id => ({ id, s: S.get(id), d: c.N.get(id).dur, r: (rec.get(id) || [])[k || 0] || 0 })); }
function rcInicioCedo(c) { const S = new Map(); c.ordem.forEach(id => S.set(id, c.N.get(id).ES)); return S; }
function rcK(rec) { let K = 1; rec.forEach(v => { for (let k = 1; k < v.length; k++) if (v[k] > 0) K = Math.max(K, k + 1); }); return K; }

/* Alisamento (Burgess, menor soma dos quadrados), carga medida em células de 1 período, somada sobre os recursos
   (cada recurso pesado pelo inverso do quadrado do seu pico inicial, para que recursos de escala diferente contem igual). */
function rcAlisar(c, rec) {
  const S = rcInicioCedo(c), K = rcK(rec);
  const H = Math.ceil(c.dur) + 2, carga = []; for (let k = 0; k < K; k++) carga.push(new Float64Array(H));
  const peso = []; for (let k = 0; k < K; k++) { const p = rcPico(rcPerfil(rcItens(c, rec, S, k))); peso.push(p > 0 ? 1 / (p * p) : 0); }
  const dem = id => rec.get(id) || [];
  const cel = (s, d, rs, sinal) => {
    if (d <= RC_EPS) return;
    const k0 = Math.floor(s + RC_EPS), k1 = Math.min(H - 1, Math.ceil(s + d - RC_EPS) - 1);
    for (let k = 0; k < K; k++) { const r = rs[k] || 0; if (r <= 0) continue; for (let t = k0; t <= k1; t++) { const ov = Math.min(s + d, t + 1) - Math.max(s, t); if (ov > 0) carga[k][t] += sinal * r * ov; } }
  };
  const custo = (s, d, rs) => {
    let tot = 0; if (d <= RC_EPS) return 0;
    const k0 = Math.floor(s + RC_EPS), k1 = Math.min(H - 1, Math.ceil(s + d - RC_EPS) - 1);
    for (let k = 0; k < K; k++) { const r = rs[k] || 0; if (r <= 0) continue; for (let t = k0; t <= k1; t++) { const ov = Math.min(s + d, t + 1) - Math.max(s, t); if (ov > 0) { const x = carga[k][t] + r * ov; tot += peso[k] * (x * x - carga[k][t] * carga[k][t]); } } }
    return tot;
  };
  c.ordem.forEach(id => cel(S.get(id), c.N.get(id).dur, dem(id), 1));
  const movel = c.ordem.filter(id => c.N.get(id).FT > RC_EPS && dem(id).some(x => x > 0) && c.N.get(id).dur > RC_EPS).reverse();
  for (let passada = 0; passada < 30; passada++) {
    let mudou = false;
    movel.forEach(id => {
      const n = c.N.get(id), rs = dem(id), atual = S.get(id);
      let lo = n.ES, hi = n.LS;
      n.preds.forEach(p => { lo = Math.max(lo, S.get(p) + c.peso(c.N.get(p), n)); });
      n.succs.forEach(s => { hi = Math.min(hi, S.get(s) - c.peso(n, c.N.get(s))); });
      if (hi < lo - RC_EPS) return;
      cel(atual, n.dur, rs, -1);
      const passo = Math.max(1, (hi - lo) / 400);
      let melhor = atual, melhorC = custo(atual, n.dur, rs);
      const tenta = t => { const cc = custo(t, n.dur, rs); if (cc < melhorC - 1e-9) { melhorC = cc; melhor = t; } };
      for (let t = lo; t <= hi + RC_EPS; t += passo) tenta(Math.min(t, hi));
      tenta(hi);
      cel(melhor, n.dur, rs, 1);
      if (Math.abs(melhor - atual) > RC_EPS) { S.set(id, melhor); mudou = true; }
    });
    if (!mudou) break;
  }
  return { S };
}

/* Limite por recurso: geração serial de cronograma. limites: [L1, L2, L3] (Infinity = sem limite). */
function rcLimitar(c, rec, limites, regra) {
  const K = rcK(rec), lim = k => (limites[k] == null || !(limites[k] > 0)) ? Infinity : limites[k];
  for (const id of c.ordem) { const rs = rec.get(id) || []; for (let k = 0; k < K; k++) if ((rs[k] || 0) > lim(k) + RC_EPS) return { erro: id, k, S: null }; }
  const S = new Map(), feito = [];
  const falta = new Map(); c.ordem.forEach(id => falta.set(id, c.N.get(id).preds.length));
  const livres = c.ordem.filter(id => falta.get(id) === 0), ordemIdx = new Map(); c.ordem.forEach((id, i) => ordemIdx.set(id, i));
  const demTot = id => (rec.get(id) || []).reduce((t, x, k) => t + (lim(k) < Infinity ? x / lim(k) : x), 0);
  const chave = id => {
    const n = c.N.get(id);
    const base = regra === 'maior' ? [-n.dur, n.FT] : regra === 'recurso' ? [-demTot(id), n.FT] : [n.FT, n.ES];
    return base.concat([ordemIdx.get(id)]);
  };
  const menor = (a, b) => { const x = chave(a), y = chave(b); for (let i = 0; i < x.length; i++) { if (Math.abs(x[i] - y[i]) > RC_EPS) return x[i] < y[i]; } return false; };
  const uso = x => { const u = new Array(K).fill(0); for (const it of feito) if (it.s <= x + RC_EPS && x < it.s + it.d - RC_EPS) for (let k = 0; k < K; k++) u[k] += it.rs[k] || 0; return u; };
  const cabe = (u, rs) => { for (let k = 0; k < K; k++) if (u[k] + (rs[k] || 0) > lim(k) + RC_EPS) return false; return true; };
  while (livres.length) {
    let bi = 0; for (let i = 1; i < livres.length; i++) if (menor(livres[i], livres[bi])) bi = i;
    const id = livres.splice(bi, 1)[0], n = c.N.get(id), rs = rec.get(id) || [];
    let lb = 0; n.preds.forEach(p => { lb = Math.max(lb, S.get(p) + c.peso(c.N.get(p), n)); });
    let t = lb;
    if (rs.some(x => x > 0) && n.dur > RC_EPS) {
      const cand = [lb]; feito.forEach(it => { const e = it.s + it.d; if (e > lb + RC_EPS) cand.push(e); });
      cand.sort((a, b) => a - b);
      t = null;
      for (const ct of cand) {
        let ok = cabe(uso(ct), rs);
        if (ok) for (const it of feito) { if (it.s > ct + RC_EPS && it.s < ct + n.dur - RC_EPS && !cabe(uso(it.s), rs)) { ok = false; break; } }
        if (ok) { t = ct; break; }
      }
      if (t === null) t = cand[cand.length - 1];
    }
    S.set(id, t); feito.push({ s: t, d: n.dur, rs });
    n.succs.forEach(s => { falta.set(s, falta.get(s) - 1); if (falta.get(s) === 0) livres.push(s); });
  }
  return { S };
}
function rcDuracao(c, S) { let d = 0; c.ordem.forEach(id => { d = Math.max(d, S.get(id) + c.N.get(id).dur); }); return d; }

/* ============================ tela ============================ */
let rcRes = null, rcSig = '';
const REC_CAMPOS = ['rec', 'rec2', 'rec3'], REC_LIMS = ['recLim', 'recLim2', 'recLim3'];
const recNome = k => (state.recNomes && String(state.recNomes[k] || '').trim()) || ('Recurso ' + (k + 1));
const recAtivos = () => { let K = 1; for (let k = 1; k < RC_MAX; k++) if ((state.recNomes && String(state.recNomes[k] || '').trim()) || state.acts.some(a => num(a[REC_CAMPOS[k]]) > 0)) K = k + 1; return K; };
const recMapa = () => { const K = recAtivos(), m = new Map(); state.acts.forEach(a => { const id = String(a.id).trim().toUpperCase(); if (!id) return; const v = []; for (let k = 0; k < K; k++) v.push(Math.max(0, num(a[REC_CAMPOS[k]]))); m.set(id, v); }); return m; };
const recLimites = () => { const K = recAtivos(), L = []; for (let k = 0; k < K; k++) { const v = num(state[REC_LIMS[k]]); L.push(String(state[REC_LIMS[k]] == null ? '' : state[REC_LIMS[k]]).trim() !== '' && v > 0 ? v : Infinity); } return L; };
const rcAssinatura = () => JSON.stringify([state.modo, state.recModo, state.recLim, state.recLim2, state.recLim3, state.recRegra, state.recNomes, state.acts.map(a => [a.id, a.d, a.o, a.m, a.p, a.preds, a.rel, a.rec, a.rec2, a.rec3])]);

function rcGrafico(seg, tmax, lim, rotulo) {
  const W = 360, H = 170, PX = 14, PB = 24, PT = 12;
  const pico = Math.max(rcPico(seg), lim > 0 && lim < Infinity ? lim : 0, 1e-9), fim = Math.max(tmax, 1e-9);
  const sx = t => PX + t / fim * (W - PX * 2), sy = u => PT + (1 - u / pico) * (H - PT - PB);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:560px;display:block" font-family="IBM Plex Mono, monospace" role="img" aria-label="' + esc(rotulo) + '">';
  seg.forEach(g => { if (g.u > 0) s += '<rect x="' + sx(g.t0).toFixed(1) + '" y="' + sy(g.u).toFixed(1) + '" width="' + Math.max(1, sx(g.t1) - sx(g.t0) - 0.6).toFixed(1) + '" height="' + (H - PB - sy(g.u)).toFixed(1) + '" fill="' + (lim < Infinity && g.u > lim + 1e-9 ? C.critico : C.navy) + '" opacity="0.6"/><text x="' + ((sx(g.t0) + sx(g.t1)) / 2).toFixed(1) + '" y="' + (sy(g.u) - 3).toFixed(1) + '" text-anchor="middle" font-size="12" fill="' + C.tinta2 + '">' + fmt(g.u) + '</text>'; });
  s += '<line x1="' + PX + '" y1="' + (H - PB) + '" x2="' + (W - PX) + '" y2="' + (H - PB) + '" stroke="' + C.borda + '"/>';
  if (lim > 0 && lim < Infinity) s += '<line x1="' + PX + '" y1="' + sy(lim).toFixed(1) + '" x2="' + (W - PX) + '" y2="' + sy(lim).toFixed(1) + '" stroke="' + C.critico + '" stroke-width="1.5" stroke-dasharray="5 3"/>';
  [[0, 'start'], [fim / 2, 'middle'], [fim, 'end']].forEach(t => { s += '<text x="' + (t[1] === 'start' ? PX : t[1] === 'end' ? W - PX : W / 2) + '" y="' + (H - PB + 16) + '" text-anchor="' + t[1] + '" font-size="12" fill="' + C.apagadinho + '">' + fmt(t[0]) + '</text>'; });
  return s + '</svg>';
}
function rcGantt(c, S0, S1) {
  const L = 130, W = 360, PR = 12, lh = 22, H = 20 + c.ordem.length * lh + 22, fim = Math.max(rcDuracao(c, S1), c.dur, 1e-9);
  const sx = t => L + t / fim * (W - L - PR);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:680px;display:block" font-family="IBM Plex Sans, sans-serif" role="img" aria-label="Cronograma nivelado">';
  c.ordem.forEach((id, i) => {
    const n = c.N.get(id), y = 10 + i * lh, a = S0.get(id), b = S1.get(id), mexeu = Math.abs(a - b) > 1e-9;
    s += '<text x="' + (L - 6) + '" y="' + (y + 14) + '" text-anchor="end" font-size="12" fill="' + C.tinta + '">' + esc(id) + (n.nome ? ' ' + esc(n.nome.slice(0, 13)) : '') + '</text>';
    if (mexeu) s += '<rect x="' + sx(a).toFixed(1) + '" y="' + (y + 3) + '" width="' + Math.max(2, sx(a + n.dur) - sx(a)).toFixed(1) + '" height="14" fill="none" stroke="' + C.apagado + '" stroke-dasharray="3 2"/>';
    s += '<rect x="' + sx(b).toFixed(1) + '" y="' + (y + 3) + '" width="' + Math.max(2, sx(b + n.dur) - sx(b)).toFixed(1) + '" height="14" rx="2" fill="' + (mexeu ? C.folga : (n.crit ? C.critico : C.navy)) + '"/>';
  });
  const yb = 10 + c.ordem.length * lh;
  s += '<line x1="' + L + '" y1="' + yb + '" x2="' + (W - PR) + '" y2="' + yb + '" stroke="' + C.borda + '"/>';
  [[0, 'start'], [fim / 2, 'middle'], [fim, 'end']].forEach(t => { s += '<text x="' + (t[1] === 'start' ? L : t[1] === 'end' ? W - PR : (L + W - PR) / 2) + '" y="' + (yb + 15) + '" text-anchor="' + t[1] + '" font-size="12" fill="' + C.apagadinho + '">' + fmt(t[0]) + '</text>'; });
  return s + '</svg>';
}
function renderRec() {
  const t = $('#tblRec'); if (!t) return;
  const c = calcOut, K = recAtivos();
  $('#recModo').value = state.recModo; $('#recRegra').value = state.recRegra;
  /* nomes e limites dos recursos */
  const campos = $('#recTipos');
  if (campos && !campos.contains(document.activeElement)) {
    let h = '';
    for (let k = 0; k < RC_MAX; k++) {
      const nome = state.recNomes ? state.recNomes[k] || '' : '';
      h += '<div class="campo"><label for="recNome' + k + '">Recurso ' + (k + 1) + (k ? ' (opcional)' : '') + '</label><input id="recNome' + k + '" data-rec-nome="' + k + '" value="' + esc(nome) + '" placeholder="' + (k === 0 ? 'ex.: pedreiros' : k === 1 ? 'ex.: guindaste' : 'ex.: engenheiro') + '" maxlength="24"></div>';
    }
    campos.innerHTML = h;
  }
  const lims = $('#recLimites');
  if (lims && !lims.contains(document.activeElement)) {
    let h = ''; for (let k = 0; k < K; k++) h += '<div class="campo"><label for="recLimK' + k + '">Limite: ' + esc(recNome(k)) + '</label><input type="number" id="recLimK' + k + '" data-rec-lim="' + k + '" min="0" step="any" value="' + esc(state[REC_LIMS[k]]) + '" placeholder="sem limite"></div>';
    lims.innerHTML = h;
  }
  $('#recCampoLim').style.display = $('#recCampoRegra').style.display = state.recModo === 'limite' ? '' : 'none';
  $('#btnRec').textContent = state.recModo === 'limite' ? 'Nivelar respeitando os limites' : 'Alisar dentro da folga';
  if (!c || c.vazio || c.ciclo || (c.erros && c.erros.length) || !c.acts.length) { t.innerHTML = ''; $('#recSaida').innerHTML = '<p class="hint">Corrija os erros da aba Dados para ver a carga de recursos.</p>'; return; }
  if (!t.contains(document.activeElement)) {
    let h = '<thead><tr><th>Atividade</th><th class="dir">Duração</th><th class="dir"><span class="sg" data-s="ES"></span></th><th class="dir">Folga</th>';
    for (let k = 0; k < K; k++) h += '<th class="w-num">' + esc(recNome(k)) + ' / período</th>';
    h += '</tr></thead><tbody>';
    c.acts.forEach(n => {
      const i = state.acts.indexOf(n.ref);
      h += '<tr class="' + (n.crit ? 'crit' : '') + '"><td class="cod"><b>' + esc(n.id) + '</b>' + (n.nome ? ' <span style="color:var(--apagado)">' + esc(n.nome) + '</span>' : '') + '</td><td class="dir">' + fmt(n.dur) + '</td><td class="dir">' + fmt(n.ES) + '</td><td class="dir">' + fmt(n.FT) + '</td>';
      for (let k = 0; k < K; k++) h += '<td><input data-rec="' + i + '" data-k="' + k + '" inputmode="decimal" value="' + esc(n.ref[REC_CAMPOS[k]]) + '" placeholder="0" aria-label="' + esc(recNome(k)) + ' em ' + esc(n.id) + '"></td>';
      h += '</tr>';
    });
    t.innerHTML = h + '</tbody>'; aplicaNotacao();
  }
  if (rcRes && rcSig !== rcAssinatura()) rcRes = null;
  const rec = recMapa(), S0 = rcInicioCedo(c), limites = recLimites();
  const segs0 = []; for (let k = 0; k < K; k++) segs0.push(rcPerfil(rcItens(c, rec, S0, k)));
  const temDemanda = segs0.some(s => rcTotal(s) > 0);
  if (!temDemanda) { $('#recSaida').innerHTML = '<p class="hint" style="margin:0">Preencha a demanda por período para ver a carga. Para testar, carregue o exemplo “Recursos (nivelamento)” em Exemplos.</p>'; return; }
  const limK = k => state.recModo === 'limite' ? limites[k] : Infinity;
  const bloco = (S, titulo) => {
    let h = '<h3 style="font-size:19px;margin:16px 0 6px">' + titulo + '</h3>';
    for (let k = 0; k < K; k++) {
      const seg = rcPerfil(rcItens(c, rec, S, k)); if (rcTotal(seg) <= 0) continue;
      h += '<div style="margin-top:' + (k ? 14 : 0) + 'px"><div class="kpis"><div class="kpi"><div class="olho">' + esc(recNome(k)) + ' · pico</div><div class="v">' + fmt(rcPico(seg)) + '</div></div><div class="kpi"><div class="olho">Total (unid. × período)</div><div class="v">' + fmt(rcTotal(seg)) + '</div></div><div class="kpi"><div class="olho">Média por período</div><div class="v">' + fmt(rcTotal(seg) / Math.max(rcDuracao(c, S), 1e-9)) + '</div></div></div>' + rcGrafico(seg, Math.max(rcDuracao(c, S), c.dur), limK(k), 'Carga de ' + recNome(k)) + '</div>';
    }
    return h;
  };
  let h = bloco(S0, 'Carga com todas as atividades o mais cedo possível');
  if (state.recModo === 'limite' && limites.some(l => l < Infinity)) h += '<p class="hint">Linha tracejada = limite. Barras vermelhas passam do limite.</p>';
  if (rcRes) {
    const r = rcRes, dur1 = rcDuracao(c, r.S);
    h += '<div class="sec" style="margin-top:22px"><h3>Depois do nivelamento</h3></div>';
    h += '<div class="kpis"><div class="kpi"><div class="olho">Prazo do projeto</div><div class="v ' + (dur1 > c.dur + 1e-9 ? 'crit' : '') + '">' + fmt(dur1) + ' ' + uni(dur1) + '</div></div><div class="kpi"><div class="olho">Variação do prazo</div><div class="v">' + (dur1 - c.dur > 1e-9 ? '+' : '') + fmt(dur1 - c.dur) + '</div></div></div>';
    h += bloco(r.S, 'Carga nivelada');
    const mexidas = c.ordem.filter(id => Math.abs(r.S.get(id) - S0.get(id)) > 1e-9);
    const picos = []; for (let k = 0; k < K; k++) { const p0 = rcPico(segs0[k]), p1 = rcPico(rcPerfil(rcItens(c, rec, r.S, k))); if (rcTotal(segs0[k]) > 0) picos.push(esc(recNome(k)) + ': ' + fmt(p0) + ' → ' + fmt(p1)); }
    const frase = state.recModo === 'limite'
      ? (dur1 > c.dur + 1e-9 ? 'Para caber nos limites, o projeto passou de <b>' + fmt(c.dur) + '</b> para <b>' + fmt(dur1) + ' ' + uni(dur1) + '</b>: esse é o preço do limite de recursos. ' : 'Os limites couberam sem atrasar o projeto (<b>' + fmt(c.dur) + ' ' + uni(c.dur) + '</b>). ')
      : (mexidas.length ? 'Deslocar atividades dentro da folga mudou os picos (' + picos.join('; ') + ') sem mexer no prazo (<b>' + fmt(c.dur) + ' ' + uni(c.dur) + '</b>). ' : 'Não há folga suficiente para reduzir os picos sem atrasar o projeto. ');
    h += '<p class="ler interp"><b class="t">O que o resultado diz:</b> ' + frase + (mexidas.length ? 'Atividades deslocadas: <b>' + mexidas.map(esc).join(', ') + '</b>.' : 'Nenhuma atividade precisou mudar de lugar.') + '</p>';
    h += '<h3 style="font-size:19px;margin:16px 0 6px">Cronograma nivelado</h3><p class="hint" style="margin:0 0 8px">Barra cheia = início depois do nivelamento; contorno tracejado = início mais cedo original; verde = atividade deslocada.</p>' + rcGantt(c, S0, r.S);
    h += '<div class="rolar" style="margin-top:12px"><table class="tab"><thead><tr><th>Atividade</th><th class="dir">Início original</th><th class="dir">Início nivelado</th><th class="dir">Deslocamento</th></tr></thead><tbody>';
    c.ordem.forEach(id => { const d = r.S.get(id) - S0.get(id); h += '<tr class="' + (Math.abs(d) > 1e-9 ? 'crit' : '') + '"><td class="cod"><b>' + esc(id) + '</b></td><td class="dir">' + fmt(S0.get(id)) + '</td><td class="dir"><b>' + fmt(r.S.get(id)) + '</b></td><td class="dir">' + (Math.abs(d) > 1e-9 ? '+' + fmt(d) : '—') + '</td></tr>'; });
    h += '</tbody></table></div>';
  }
  $('#recSaida').innerHTML = h;
}
function recRodar() {
  const c = calcOut;
  if (!c || c.erros.length || !c.acts.length) { alerta('Corrija os erros dos dados antes de nivelar.'); return; }
  const rec = recMapa();
  if (!Array.from(rec.values()).some(v => v.some(x => x > 0))) { alerta('Informe a demanda de recurso de pelo menos uma atividade.'); return; }
  let r;
  if (state.recModo === 'limite') {
    const L = recLimites();
    if (!L.some(l => l < Infinity)) { alerta('Informe o limite de pelo menos um recurso (um número maior que zero).'); return; }
    r = rcLimitar(c, rec, L, state.recRegra);
    if (r.erro) { alerta('A atividade ' + r.erro + ' precisa de ' + fmt(rec.get(r.erro)[r.k]) + ' de ' + recNome(r.k) + ' por período, mais que o limite de ' + fmt(L[r.k]) + '. Aumente o limite ou reduza a demanda dela.'); return; }
  } else r = rcAlisar(c, rec);
  rcRes = r; rcSig = rcAssinatura(); renderRec();
}
function ligarRecursos() {
  if (!$('#btnRec')) return;
  $('#btnRec').onclick = recRodar;
  $('#recModo').onchange = e => { state.recModo = e.target.value; rcRes = null; renderRec(); gravarEstado(); };
  $('#recRegra').onchange = e => { state.recRegra = e.target.value; rcRes = null; renderRec(); gravarEstado(); };
  $('#recLimites').addEventListener('input', e => { const k = e.target.getAttribute('data-rec-lim'); if (k === null) return; state[REC_LIMS[+k]] = e.target.value; rcRes = null; renderRec(); gravarEstado(); });
  $('#recTipos').addEventListener('input', e => { const k = e.target.getAttribute('data-rec-nome'); if (k === null) return; state.recNomes = state.recNomes || ['', '', '']; state.recNomes[+k] = e.target.value.slice(0, 24); rcRes = null; renderRec(); gravarEstado(); });
  $('#tblRec').addEventListener('input', e => { const i = e.target.getAttribute('data-rec'); if (i === null || !state.acts[+i]) return; state.acts[+i][REC_CAMPOS[+e.target.dataset.k || 0]] = e.target.value; renderRec(); gravarEstado(); });
}
