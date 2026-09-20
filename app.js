/* ============================================================
   Calculadora PERT/CPM — @LMVN 2026
   Roda inteira no navegador, sem dependência externa.
   ============================================================ */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
const CASAS = 2;
const r2 = x => Math.round(x * Math.pow(10, CASAS)) / Math.pow(10, CASAS);
const fmt = x => { if (!isFinite(x)) return '—'; const v = r2(x); return (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(CASAS).replace('.', ',')); };
const money = x => (isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—');
const EPS = 1e-9;
const TETO_CAMINHOS = 300;
const TETO_PASSOS = 200;
const TETO_COMBOS = 4000;

/* ---------- estado ---------- */
const novoAtv = (id, nome) => ({ id, nome: nome || '', d: 1, o: 1, m: 1, p: 1, preds: [], dmin: '', cc: '' });
let state = null, calcOut = null, passo = 3, animando = null;

function estadoVazio() {
  return {
    nome: 'Novo projeto', modo: 'cpm', inicio: '', unidade: 'd', uteis: 0,
    custoInd: '', custoDir: '', prazoAlvo: '',
    aba: 'dados', soCriticos: false, gFolga: true, gTarde: false, gSetas: true,
    acts: [novoAtv('A'), novoAtv('B'), novoAtv('C')]
  };
}
function proxId(acts) {
  const usados = new Set(acts.map(a => String(a.id).toUpperCase()));
  for (let i = 0; i < 26; i++) { const c = String.fromCharCode(65 + i); if (!usados.has(c)) return c; }
  for (let i = 1; i < 500; i++) { const c = 'A' + i; if (!usados.has(c)) return c; }
  return 'X' + acts.length;
}
const UNI = { d: ['dia', 'dias'], s: ['semana', 'semanas'], m: ['mês', 'meses'] };
const uni = n => (Math.abs(n) === 1 ? UNI[state.unidade][0] : UNI[state.unidade][1]);

/* ============================================================
   MOTOR DE CÁLCULO
   ============================================================ */
function durDe(a) {
  if (state.modo === 'pert') return (num(a.o) + 4 * num(a.m) + num(a.p)) / 6;
  return num(a.d);
}
function varDe(a) {
  if (state.modo !== 'pert') return 0;
  const s = (num(a.p) - num(a.o)) / 6; return s * s;
}

function calcular(durOverride) {
  const acts = state.acts.filter(a => String(a.id).trim() !== '');
  const erros = [], avisos = [];
  const mapa = new Map();
  acts.forEach(a => {
    const id = String(a.id).trim().toUpperCase();
    if (mapa.has(id)) erros.push('Código repetido: <b>' + esc(id) + '</b>.');
    else mapa.set(id, a);
  });
  if (!acts.length) return { vazio: true, erros: [], avisos: [], acts: [], caminhos: [], criticas: [], critSeq: [], dur: 0 };

  const N = new Map();
  for (const [id, a] of mapa) {
    const preds = (a.preds || []).map(p => String(p).trim().toUpperCase()).filter(Boolean);
    const ok = [];
    preds.forEach(p => {
      if (p === id) erros.push('<b>' + esc(id) + '</b> não pode ser predecessora de si mesma.');
      else if (!mapa.has(p)) erros.push('<b>' + esc(id) + '</b> depende de <b>' + esc(p) + '</b>, que não existe.');
      else if (ok.indexOf(p) < 0) ok.push(p);
    });
    if (state.modo === 'pert' && num(a.p) < num(a.o)) erros.push('Em <b>' + esc(id) + '</b>, o tempo pessimista é menor que o otimista.');
    const d = durOverride && durOverride.has(id) ? durOverride.get(id) : durDe(a);
    if (d < 0) erros.push('Duração negativa em <b>' + esc(id) + '</b>.');
    N.set(id, { id, nome: a.nome || '', dur: d, varia: varDe(a), preds: ok, succs: [], ref: a });
  }
  for (const n of N.values()) n.preds.forEach(p => { const x = N.get(p); if (x) x.succs.push(n.id); });

  /* ordenação topológica (Kahn) */
  const indeg = new Map(); N.forEach(n => indeg.set(n.id, n.preds.length));
  const fila = []; const ordem = [];
  Array.from(N.keys()).forEach(id => { if (indeg.get(id) === 0) fila.push(id); });
  while (fila.length) {
    const id = fila.shift(); ordem.push(id);
    N.get(id).succs.forEach(s => { indeg.set(s, indeg.get(s) - 1); if (indeg.get(s) === 0) fila.push(s); });
  }
  if (ordem.length < N.size) {
    const presos = Array.from(N.keys()).filter(id => ordem.indexOf(id) < 0);
    erros.push('Há dependência circular entre: <b>' + presos.map(esc).join(', ') + '</b>. A rede precisa fluir só para a frente.');
    return { erros, avisos, acts: [], caminhos: [], criticas: [], critSeq: [], dur: 0, ciclo: true };
  }

  ordem.forEach(id => {
    const n = N.get(id);
    n.ES = n.preds.length ? Math.max.apply(null, n.preds.map(p => N.get(p).EF)) : 0;
    n.EF = n.ES + n.dur;
  });
  const dur = N.size ? Math.max.apply(null, Array.from(N.values()).map(n => n.EF)) : 0;

  for (let i = ordem.length - 1; i >= 0; i--) {
    const n = N.get(ordem[i]);
    n.LF = n.succs.length ? Math.min.apply(null, n.succs.map(s => N.get(s).LS)) : dur;
    n.LS = n.LF - n.dur;
  }
  N.forEach(n => {
    n.FT = n.LS - n.ES;
    n.FL = (n.succs.length ? Math.min.apply(null, n.succs.map(s => N.get(s).ES)) : dur) - n.EF;
    n.crit = Math.abs(n.FT) < EPS;
  });

  const iniciais = ordem.filter(id => !N.get(id).preds.length);
  const finais = ordem.filter(id => !N.get(id).succs.length);
  if (finais.length > 1) avisos.push('Há ' + finais.length + ' atividades sem sucessora (' + finais.join(', ') + '). Todas encerram o projeto — se não for isso, ligue-as a uma atividade final.');
  if (iniciais.length > 1) avisos.push('Há ' + iniciais.length + ' atividades sem predecessora (' + iniciais.join(', ') + '). Todas começam no instante zero.');

  /* caminhos, com teto */
  const caminhos = []; let estourou = false;
  const dfs = (id, acum, soma, vari) => {
    if (caminhos.length >= TETO_CAMINHOS) { estourou = true; return; }
    const n = N.get(id); acum.push(id); soma += n.dur; vari += n.varia;
    if (!n.succs.length) caminhos.push({ ids: acum.slice(), dur: soma, varia: vari, crit: Math.abs(soma - dur) < EPS });
    else n.succs.forEach(s => dfs(s, acum, soma, vari));
    acum.pop();
  };
  iniciais.forEach(id => dfs(id, [], 0, 0));
  caminhos.sort((a, b) => b.dur - a.dur);
  if (estourou) avisos.push('A rede tem mais de ' + TETO_CAMINHOS + ' caminhos; a lista mostra apenas os primeiros encontrados.');

  /* caminho crítico de maior variância — é dele que sai o sigma */
  let critVar = 0, critSeq = [];
  const criticos = caminhos.filter(c => c.crit);
  if (criticos.length) {
    let melhor = criticos[0];
    criticos.forEach(c => { if (c.varia > melhor.varia) melhor = c; });
    critVar = melhor.varia; critSeq = melhor.ids.slice();
  }

  const lista = ordem.map(id => N.get(id));
  return {
    erros, avisos, dur, N, ordem, acts: lista, caminhos, iniciais, finais,
    criticas: lista.filter(n => n.crit), critVar, critSeq, sigma: Math.sqrt(critVar)
  };
}

/* ---------- estatística ---------- */
function phi(z) {
  /* Zelen & Severo */
  const s = z < 0 ? -1 : 1; const x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + s * y);
}
function zInv(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; let q, x, rr;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { q = p - 0.5; rr = q * q; x = (((((a[0] * rr + a[1]) * rr + a[2]) * rr + a[3]) * rr + a[4]) * rr + a[5]) * q / (((((b[0] * rr + b[1]) * rr + b[2]) * rr + b[3]) * rr + b[4]) * rr + 1); }
  else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  return x;
}

/* ---------- datas ---------- */
function dataDe(instante) {
  if (!state.inicio) return null;
  const base = new Date(state.inicio + 'T12:00:00');
  if (isNaN(base.getTime())) return null;
  const k = Math.round(instante);
  const d = new Date(base.getTime());
  if (state.unidade === 'm') { d.setMonth(d.getMonth() + k); return d; }
  const dias = state.unidade === 's' ? k * 7 : k;
  if (!Number(state.uteis) || state.unidade === 's') { d.setDate(d.getDate() + dias); return d; }
  let falta = dias, guarda = 0;
  while (falta > 0 && guarda++ < 9999) { d.setDate(d.getDate() + 1); const w = d.getDay(); if (w !== 0 && w !== 6) falta--; }
  return d;
}
const rotuloData = i => { const d = dataDe(i); return d ? d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : fmt(i); };

/* ---------- cores literais (o SVG precisa delas para virar PNG) ---------- */
let C = {};
function lerCores() {
  const cs = getComputedStyle(document.documentElement);
  const g = n => (cs.getPropertyValue(n) || '').trim() || '#888';
  C = {
    papel: g('--papel'), sup: g('--superficie'), sup2: g('--superficie-2'),
    borda: g('--borda'), bordaInt: g('--borda-int'),
    tinta: g('--tinta'), tinta2: g('--tinta-2'), apagado: g('--apagado'), apagadinho: g('--apagadinho'),
    navy: g('--navy'), navyEsc: g('--navy-escuro'), sobreNavy: g('--sobre-navy'),
    critico: g('--critico'), criticoFundo: g('--critico-fundo'),
    folga: g('--folga'), folgaFundo: g('--folga-fundo'),
    fantasmaBorda: g('--fantasma-borda'), fantasmaFundo: g('--fantasma-fundo'),
    neutro: g('--neutro'), aresta: g('--aresta')
  };
}

/* ============================================================
   1 · DADOS
   ============================================================ */
function renderDados() {
  const t = $('#tblDados'); const pert = state.modo === 'pert';
  let h = '<thead><tr><th class="w-cod">Código</th>';
  h += pert
    ? '<th class="w-num">o</th><th class="w-num">m</th><th class="w-num">p</th><th class="w-num">te</th>'
    : '<th class="w-dur">Duração</th>';
  h += '<th>Predecessoras</th><th class="w-x noprint"></th></tr></thead><tbody>';
  state.acts.forEach((a, i) => {
    h += '<tr data-i="' + i + '">';
    h += '<td><input class="cod" data-f="id" value="' + esc(a.id) + '" maxlength="6" aria-label="Código"></td>';
    if (pert) {
      h += '<td><input data-f="o" inputmode="decimal" value="' + esc(a.o) + '" aria-label="Otimista"></td>';
      h += '<td><input data-f="m" inputmode="decimal" value="' + esc(a.m) + '" aria-label="Mais provável"></td>';
      h += '<td><input data-f="p" inputmode="decimal" value="' + esc(a.p) + '" aria-label="Pessimista"></td>';
      h += '<td class="te" data-te="' + i + '">' + fmt((num(a.o) + 4 * num(a.m) + num(a.p)) / 6) + '</td>';
    } else {
      h += '<td><input data-f="d" inputmode="decimal" value="' + esc(a.d) + '" aria-label="Duração"></td>';
    }
    h += '<td><input class="pred" data-f="preds" value="' + esc((a.preds || []).join(', ')) + '" placeholder="—" aria-label="Predecessoras"></td>';
    h += '<td class="noprint"><button class="remover" data-del="' + i + '" title="Remover" aria-label="Remover">×</button></td></tr>';
  });
  t.innerHTML = h + '</tbody>';
}

function lerCampo(i, f, v) {
  const a = state.acts[i]; if (!a) return;
  if (f === 'preds') a.preds = String(v).split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  else if (f === 'id') a.id = String(v).trim().toUpperCase();
  else a[f] = v;
}

/* ============================================================
   FAIXA DE RESUMO E AVISOS
   ============================================================ */
function renderResumo() {
  const c = calcOut;
  const vazio = !c.acts || !c.acts.length;
  $('#rDur').textContent = vazio ? '—' : fmt(c.dur);
  $('#rAtiv').textContent = vazio ? '—' : String(c.acts.length);
  $('#rCrit').textContent = vazio ? '—' : (c.critSeq.join(' → ') || '—');
  if (vazio) { $('#rFim').textContent = '—'; return; }
  const d = dataDe(c.dur);
  $('#rFim').textContent = d ? d.toLocaleDateString('pt-BR') : fmt(c.dur) + ' ' + uni(c.dur);
}

function renderAvisos() {
  const c = calcOut; let h = '';
  if (c.erros && c.erros.length) h += '<div class="faixa-erro"><b>Corrija antes de continuar</b><ul>' + c.erros.map(e => '<li>' + e + '</li>').join('') + '</ul></div>';
  if (c.avisos && c.avisos.length) h += '<div class="nota"><b>Confira a estrutura da rede</b><ul style="margin:4px 0 0;padding-left:18px">' + c.avisos.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
  $('#avisos').innerHTML = h;
}

/* ============================================================
   2 · RESULTADOS
   ============================================================ */
function renderResultados() {
  const c = calcOut;
  if (!c.acts.length) { $('#tblResult').innerHTML = ''; $('#listaCaminhos').innerHTML = '<p class="hint">Sem atividades válidas.</p>'; return; }
  let h = '<thead><tr><th>Atividade</th><th class="dir">Dur.</th><th class="dir">ES</th><th class="dir">EF</th><th class="dir">LS</th><th class="dir">LF</th><th class="dir">FT</th><th class="dir">FL</th><th>Situação</th></tr></thead><tbody>';
  c.acts.forEach(n => {
    h += '<tr class="' + (n.crit ? 'crit' : '') + '">';
    h += '<td class="cod"><b>' + esc(n.id) + '</b>' + (n.nome ? ' <span class="txt" style="color:var(--apagado)">' + esc(n.nome) + '</span>' : '') + '</td>';
    h += '<td class="dir">' + fmt(n.dur) + '</td><td class="dir">' + fmt(n.ES) + '</td><td class="dir">' + fmt(n.EF) + '</td>';
    h += '<td class="dir">' + fmt(n.LS) + '</td><td class="dir">' + fmt(n.LF) + '</td>';
    h += '<td class="dir ft"><b>' + fmt(n.FT) + '</b></td><td class="dir">' + fmt(n.FL) + '</td>';
    h += '<td class="sit txt">' + (n.crit ? 'Crítica' : 'Folga de ' + fmt(n.FT)) + '</td></tr>';
  });
  $('#tblResult').innerHTML = h + '</tbody>';

  const so = $('#soCriticos').checked;
  const cams = (c.caminhos || []).filter(p => !so || p.crit).slice(0, 60);
  $('#listaCaminhos').innerHTML = cams.length
    ? cams.map(p => '<div class="caminho ' + (p.crit ? 'crit' : '') + '"><span>' + p.ids.map(esc).join(' → ') + '</span>' +
      '<span class="total">' + fmt(p.dur) + ' ' + uni(p.dur) + '</span>' +
      (p.crit ? '<span class="tag">crítico</span>' : '<span class="hint" style="font-family:var(--texto)">folga ' + fmt(c.dur - p.dur) + '</span>') + '</div>').join('')
    : '<p class="hint">Nenhum caminho para mostrar.</p>';
}

/* ============================================================
   3 · DIAGRAMA DE REDE (AON)
   ============================================================ */
function renderRede() {
  const c = calcOut, box = $('#stageRede');
  if (!c.acts || !c.acts.length) { box.innerHTML = '<p class="hint" style="padding:24px">Sem rede para desenhar.</p>'; $('#passoTexto').innerHTML = ''; return; }

  const NL = 176, NA = 88, GX = 64, GY = 26, PAD = 30, WF = 96, HF = 54;
  const camada = new Map();
  c.acts.forEach(n => camada.set(n.id, n.preds.length ? 1 + Math.max.apply(null, n.preds.map(p => camada.get(p))) : 1));
  const maxC = Math.max.apply(null, Array.from(camada.values()));
  const cols = []; for (let i = 0; i <= maxC + 1; i++) cols.push([]);
  c.acts.forEach(n => cols[camada.get(n.id)].push(n));

  const alturas = cols.map((col, i) => (i === 0 || i === maxC + 1) ? HF : Math.max(HF, col.length * (NA + GY) - GY));
  const altura = PAD * 2 + Math.max.apply(null, alturas);
  const larg = PAD * 2 + WF * 2 + GX * 2 + (maxC * (NL + GX)) - GX;

  const pos = new Map(); let x = PAD;
  pos.set('__ini', { x, y: (altura - HF) / 2, w: WF, h: HF });
  x += WF + GX;
  for (let i = 1; i <= maxC; i++) {
    const col = cols[i]; const hTot = col.length * (NA + GY) - GY;
    let y = (altura - hTot) / 2;
    col.forEach(n => { pos.set(n.id, { x, y, w: NL, h: NA }); y += NA + GY; });
    x += NL + GX;
  }
  pos.set('__fim', { x, y: (altura - HF) / 2, w: WF, h: HF });

  const mostraF = passo >= 1, mostraB = passo >= 2, mostraS = passo >= 3;
  const seta = (x1, y1, x2, y2, crit, fantasma) => {
    const cor = fantasma ? C.fantasmaBorda : (crit ? C.critico : C.aresta);
    return '<path d="M' + x1 + ',' + y1 + ' C' + (x1 + 40) + ',' + y1 + ' ' + (x2 - 40) + ',' + y2 + ' ' + (x2 - 2) + ',' + y2 + '" fill="none" stroke="' + cor + '" stroke-width="' + (crit ? 2.2 : 1.3) + '"' + (fantasma ? ' stroke-dasharray="5 4"' : '') + ' marker-end="url(#' + (fantasma ? 'arf' : (crit ? 'arc' : 'ar')) + ')"/>';
  };

  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(larg) + '" height="' + Math.round(altura) + '" viewBox="0 0 ' + Math.round(larg) + ' ' + Math.round(altura) + '" font-family="IBM Plex Sans, sans-serif">';
  s += '<defs>';
  [['ar', C.aresta], ['arc', C.critico], ['arf', C.fantasmaBorda]].forEach(par => {
    s += '<marker id="' + par[0] + '" viewBox="0 0 9 9" refX="8" refY="4.5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="' + par[1] + '"/></marker>';
  });
  s += '</defs><rect width="100%" height="100%" fill="' + C.sup + '"/>';

  c.acts.forEach(n => {
    const pn = pos.get(n.id);
    n.preds.forEach(p => {
      const pp = pos.get(p), np = c.N.get(p);
      const critA = n.crit && np.crit && Math.abs(np.EF - n.ES) < EPS;
      s += seta(pp.x + pp.w, pp.y + pp.h / 2, pn.x, pn.y + pn.h / 2, critA, false);
    });
    if (!n.preds.length) { const pi = pos.get('__ini'); s += seta(pi.x + pi.w, pi.y + pi.h / 2, pn.x, pn.y + pn.h / 2, n.crit, true); }
    if (!n.succs.length) { const pf = pos.get('__fim'); s += seta(pn.x + pn.w, pn.y + pn.h / 2, pf.x, pf.y + pf.h / 2, n.crit, true); }
  });

  [['__ini', 'INÍCIO'], ['__fim', 'FIM']].forEach(par => {
    const p = pos.get(par[0]);
    s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="4" fill="' + C.fantasmaFundo + '" stroke="' + C.fantasmaBorda + '" stroke-width="1.5" stroke-dasharray="5 4"/>';
    s += '<text x="' + (p.x + p.w / 2) + '" y="' + (p.y + p.h / 2 + 4) + '" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" letter-spacing="1.5" fill="' + C.apagado + '">' + par[1] + '</text>';
  });

  c.acts.forEach(n => {
    const p = pos.get(n.id);
    const corB = n.crit ? C.critico : C.neutro;
    const fundo = n.crit ? C.criticoFundo : '#FFFFFF';
    const mono = ' font-family="IBM Plex Mono, monospace" font-variant-numeric="tabular-nums"';
    s += '<g>';
    s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="4" fill="' + fundo + '" stroke="' + corB + '" stroke-width="1.5"/>';
    s += '<rect x="' + (p.x + 1) + '" y="' + (p.y + 1) + '" width="' + (p.w - 2) + '" height="23" fill="rgba(0,0,0,.025)"/>';
    s += '<rect x="' + (p.x + 1) + '" y="' + (p.y + p.h - 24) + '" width="' + (p.w - 2) + '" height="23" fill="rgba(0,0,0,.025)"/>';
    s += '<line x1="' + p.x + '" y1="' + (p.y + 24) + '" x2="' + (p.x + p.w) + '" y2="' + (p.y + 24) + '" stroke="' + C.bordaInt + '"/>';
    s += '<line x1="' + p.x + '" y1="' + (p.y + p.h - 24) + '" x2="' + (p.x + p.w) + '" y2="' + (p.y + p.h - 24) + '" stroke="' + C.bordaInt + '"/>';
    const cel = (tx, ty, txt, anchor) => '<text x="' + tx + '" y="' + ty + '" text-anchor="' + anchor + '"' + mono + ' font-size="12.5" fill="' + C.apagado + '">' + esc(txt) + '</text>';
    s += cel(p.x + 9, p.y + 16, mostraF ? fmt(n.ES) : '·', 'start');
    s += cel(p.x + p.w - 9, p.y + 16, mostraF ? fmt(n.EF) : '·', 'end');
    s += cel(p.x + 9, p.y + p.h - 8, mostraB ? fmt(n.LS) : '·', 'start');
    s += cel(p.x + p.w - 9, p.y + p.h - 8, mostraB ? fmt(n.LF) : '·', 'end');
    const cy = p.y + p.h / 2 + 4;
    s += '<text x="' + (p.x + 14) + '" y="' + cy + '"' + mono + ' font-size="19" font-weight="600" fill="' + (n.crit ? C.critico : C.tinta) + '">' + esc(n.id) + '</text>';
    s += '<text x="' + (p.x + 16 + 12 * String(n.id).length) + '" y="' + cy + '"' + mono + ' font-size="12.5" fill="' + C.apagado + '">· ' + fmt(n.dur) + '</text>';
    if (n.nome) {
      const nm = n.nome.length > 18 ? n.nome.slice(0, 17) + '…' : n.nome;
      s += '<text x="' + (p.x + 14) + '" y="' + (cy + 13) + '" font-size="10.5" fill="' + C.apagadinho + '">' + esc(nm) + '</text>';
    }
    if (mostraS) {
      const rot = fmt(n.FT);
      const bw = 12 + rot.length * 7;
      s += '<rect x="' + (p.x + p.w - 6 - bw) + '" y="' + (p.y + 30) + '" width="' + bw + '" height="17" rx="3" fill="' + (n.crit ? C.critico : C.folgaFundo) + '"/>';
      s += '<text x="' + (p.x + p.w - 6 - bw / 2) + '" y="' + (p.y + 42) + '" text-anchor="middle"' + mono + ' font-size="11.5" fill="' + (n.crit ? '#FFFFFF' : C.folga) + '">' + rot + '</text>';
    }
    s += '</g>';
  });
  s += '</svg>';
  box.innerHTML = s;

  const textos = {
    0: '',
    1: '<div class="nota"><b>Passo 1 · Caminho de ida</b>Da esquerda para a direita: ES = maior EF das predecessoras, EF = ES + duração. O maior EF da rede é a duração do projeto (' + fmt(c.dur) + ' ' + uni(c.dur) + ').</div>',
    2: '<div class="nota"><b>Passo 2 · Caminho de volta</b>Da direita para a esquerda: LF da última = ' + fmt(c.dur) + '; nas demais, LF = menor LS das sucessoras e LS = LF − duração.</div>',
    3: ''
  };
  $('#passoTexto').innerHTML = textos[passo] || '';
  $$('#segPasso .bt').forEach(b => b.classList.toggle('on', +b.dataset.s === passo));
}

/* ============================================================
   4 · GANTT
   ============================================================ */
function renderGantt() {
  const c = calcOut, box = $('#stageGantt');
  if (!c.acts || !c.acts.length) { box.innerHTML = '<p class="hint" style="padding:24px">Sem atividades.</p>'; return; }
  const LBL = 120, GAP = 10, PADR = 34, PADT = 40, RH = 30, PADB = 20;
  const areaW = Math.max(460, Math.min(1400, c.dur * 46 + 40));
  const W = LBL + GAP + areaW + PADR;
  const linhas = c.acts.slice().sort((a, b) => a.ES - b.ES || a.EF - b.EF || a.id.localeCompare(b.id));
  const H = PADT + linhas.length * RH + PADB;
  const x0 = LBL + GAP;
  const sx = v => x0 + (v / (c.dur || 1)) * areaW;
  const yOf = id => PADT + linhas.findIndex(n => n.id === id) * RH + RH / 2;
  const mono = ' font-family="IBM Plex Mono, monospace" font-variant-numeric="tabular-nums"';

  const marcas = Math.min(12, Math.max(2, Math.round(c.dur)));
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W) + '" height="' + Math.round(H) + '" viewBox="0 0 ' + Math.round(W) + ' ' + Math.round(H) + '" font-family="IBM Plex Sans, sans-serif">';
  s += '<defs><marker id="gs" viewBox="0 0 9 9" refX="8" refY="4.5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="' + C.aresta + '"/></marker></defs>';
  s += '<rect width="100%" height="100%" fill="' + C.sup + '"/>';

  for (let i = 0; i <= marcas; i++) {
    const v = (c.dur * i) / marcas, x = sx(v);
    s += '<line x1="' + x + '" y1="' + (PADT - 14) + '" x2="' + x + '" y2="' + (H - PADB + 2) + '" stroke="#EFEBE3"/>';
    s += '<text x="' + x + '" y="' + (PADT - 20) + '" text-anchor="middle"' + mono + ' font-size="11" fill="' + C.apagadinho + '">' + esc(rotuloData(v)) + '</text>';
  }
  s += '<line x1="' + x0 + '" y1="' + (PADT - 14) + '" x2="' + (W - PADR) + '" y2="' + (PADT - 14) + '" stroke="' + C.borda + '"/>';
  s += '<line x1="' + sx(c.dur) + '" y1="' + (PADT - 14) + '" x2="' + sx(c.dur) + '" y2="' + (H - PADB + 2) + '" stroke="' + C.critico + '" stroke-width="1.4" stroke-dasharray="5 4"/>';

  linhas.forEach((n, i) => {
    const y = PADT + i * RH, yc = y + RH / 2, cor = n.crit ? C.critico : C.navy;
    s += '<text x="' + (LBL - 4) + '" y="' + (yc + (state.inicio ? -1 : 5)) + '" text-anchor="end"' + mono + ' font-size="15" font-weight="600" fill="' + (n.crit ? C.critico : C.tinta) + '">' + esc(n.id) + '</text>';
    if (state.inicio) s += '<text x="' + (LBL - 4) + '" y="' + (yc + 12) + '" text-anchor="end"' + mono + ' font-size="11.5" fill="' + C.apagadinho + '">' + esc(rotuloData(n.ES)) + '–' + esc(rotuloData(n.EF)) + '</text>';
    if (state.gFolga && n.FT > EPS) s += '<rect x="' + sx(n.EF) + '" y="' + (y + 4) + '" width="' + Math.max(2, sx(n.EF + n.FT) - sx(n.EF)) + '" height="8" rx="2" fill="none" stroke="' + C.folga + '" stroke-width="1.2" stroke-dasharray="4 3"/>';
    if (state.gTarde && n.FT > EPS) s += '<rect x="' + sx(n.LS) + '" y="' + (y + 16) + '" width="' + Math.max(2, sx(n.LF) - sx(n.LS)) + '" height="5" rx="2" fill="' + C.neutro + '"/>';
    const bw = Math.max(3, sx(n.EF) - sx(n.ES));
    s += '<rect x="' + sx(n.ES) + '" y="' + (y + 5) + '" width="' + bw + '" height="19" rx="3" fill="' + cor + '"/>';
    if (bw > 26) s += '<text x="' + (sx(n.ES) + 7) + '" y="' + (y + 18) + '"' + mono + ' font-size="11.5" fill="#FFFFFF">' + fmt(n.dur) + '</text>';
    else s += '<text x="' + (sx(n.EF) + 6) + '" y="' + (y + 18) + '"' + mono + ' font-size="11.5" fill="' + C.apagado + '">' + fmt(n.dur) + '</text>';
  });

  if (state.gSetas) {
    linhas.forEach(n => n.preds.forEach(p => {
      const y1 = yOf(p), y2 = yOf(n.id), xa = sx(c.N.get(p).EF), xb = sx(n.ES);
      const mx = Math.max(xa + 8, xb - 8);
      s += '<path d="M' + xa + ',' + y1 + ' L' + mx + ',' + y1 + ' L' + mx + ',' + y2 + ' L' + (xb - 2) + ',' + y2 + '" fill="none" stroke="' + C.aresta + '" stroke-width="1.1" marker-end="url(#gs)" opacity="0.75"/>';
    }));
  }
  s += '</svg>';
  box.innerHTML = s;
}

/* ============================================================
   5 · PROBABILIDADE
   ============================================================ */
function renderPert() {
  const c = calcOut;
  const cpm = state.modo !== 'pert';
  $('#pertAviso').innerHTML = cpm
    ? '<div class="nota"><b>Informe as três estimativas no modo PERT para ter variabilidade.</b>No modo CPM a duração é determinística: não há distribuição de probabilidade a calcular.</div>'
    : '';
  if (!c.acts.length) return;
  const mu = c.dur, sg = c.sigma;

  if (!$('#prazoX').value) $('#prazoX').value = r2(mu + (sg > EPS ? sg : Math.max(1, mu * 0.1)));
  const X = num($('#prazoX').value);
  const z = sg > EPS ? (X - mu) / sg : (X >= mu ? Infinity : -Infinity);
  const P = sg > EPS ? phi(z) : (X >= mu ? 1 : 0);
  $('#saidaProb').innerHTML =
    '<div class="kpis">' +
    '<div class="kpi"><div class="olho">Z</div><div class="v">' + (isFinite(z) ? fmt(z) : '—') + '</div></div>' +
    '<div class="kpi"><div class="olho">Probabilidade</div><div class="v navy">' + (P * 100).toFixed(1).replace('.', ',') + '%</div></div>' +
    '<div class="kpi"><div class="olho">σ do caminho</div><div class="v">' + fmt(sg) + '</div></div>' +
    '</div>' +
    '<p class="hint" style="font-family:var(--mono)">Z = (' + fmt(X) + ' − ' + fmt(mu) + ') ÷ ' + fmt(sg) + '</p>';
  desenhaNormal(mu, sg, X);

  const conf = Math.min(99.9, Math.max(0.1, num($('#confP').value) || 95)) / 100;
  const zc = zInv(conf), Xc = mu + zc * sg;
  $('#saidaConf').innerHTML = '<div class="bloco-navy"><div class="olho">Prazo a prometer</div>' +
    '<div class="grande">' + fmt(Xc) + ' ' + uni(Xc) + '</div>' +
    '<div class="nota-z">z = ' + fmt(zc) + ' · te + z·σ = ' + fmt(mu) + ' + ' + fmt(zc) + '×' + fmt(sg) + '</div></div>';
  let tc = '<thead><tr><th>Confiança</th><th class="dir">z</th><th class="dir">Prazo</th><th class="dir">Reserva</th></tr></thead><tbody>';
  [50, 75, 80, 90, 95, 99].forEach(pc => {
    const zz = zInv(pc / 100), xx = mu + zz * sg;
    tc += '<tr><td>' + pc + '%</td><td class="dir">' + fmt(zz) + '</td><td class="dir"><b>' + fmt(xx) + '</b></td><td class="dir">' + fmt(xx - mu) + '</td></tr>';
  });
  $('#tblConf').innerHTML = tc + '</tbody>';

  let h = '<thead><tr><th>Atividade</th><th class="dir">o</th><th class="dir">m</th><th class="dir">p</th><th class="dir">te</th><th class="dir">σ²</th><th>No caminho crítico</th></tr></thead><tbody>';
  c.acts.forEach(n => {
    h += '<tr class="' + (n.crit ? 'crit' : '') + '"><td class="cod"><b>' + esc(n.id) + '</b></td>' +
      '<td class="dir">' + fmt(num(n.ref.o)) + '</td><td class="dir">' + fmt(num(n.ref.m)) + '</td><td class="dir">' + fmt(num(n.ref.p)) + '</td>' +
      '<td class="dir"><b>' + fmt(n.dur) + '</b></td><td class="dir">' + fmt(n.varia) + '</td>' +
      '<td class="txt">' + (c.critSeq.indexOf(n.id) >= 0 ? 'sim' : '—') + '</td></tr>';
  });
  $('#tblPert').innerHTML = h + '</tbody>';
}

function desenhaNormal(mu, sg, X) {
  const box = $('#stageNormal');
  if (sg <= EPS) { box.innerHTML = ''; return; }
  const W = 320, H = 110, PX = 22, PB = 22, PT = 8;
  const a = mu - 3.6 * sg, b = mu + 3.6 * sg;
  const sx = v => PX + (v - a) / (b - a) * (W - PX * 2);
  const f = v => Math.exp(-0.5 * Math.pow((v - mu) / sg, 2));
  const sy = v => PT + (1 - f(v)) * (H - PT - PB);
  let d = '', area = '';
  for (let i = 0; i <= 160; i++) { const v = a + (b - a) * i / 160; d += (i ? 'L' : 'M') + sx(v).toFixed(1) + ',' + sy(v).toFixed(1) + ' '; }
  const lim = Math.min(b, Math.max(a, X));
  area = 'M' + sx(a).toFixed(1) + ',' + (H - PB) + ' ';
  for (let i = 0; i <= 160; i++) { const v = a + (lim - a) * i / 160; area += 'L' + sx(v).toFixed(1) + ',' + sy(v).toFixed(1) + ' '; }
  area += 'L' + sx(lim).toFixed(1) + ',' + (H - PB) + ' Z';
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" font-family="IBM Plex Mono, monospace">';
  s += '<path d="' + area + '" fill="' + C.navy + '" opacity="0.16"/>';
  s += '<path d="' + d + '" fill="none" stroke="' + C.navy + '" stroke-width="1.6"/>';
  s += '<line x1="' + PX + '" y1="' + (H - PB) + '" x2="' + (W - PX) + '" y2="' + (H - PB) + '" stroke="' + C.borda + '"/>';
  s += '<line x1="' + sx(lim) + '" y1="' + PT + '" x2="' + sx(lim) + '" y2="' + (H - PB) + '" stroke="' + C.critico + '" stroke-width="1.4" stroke-dasharray="4 3"/>';
  [-2, -1, 0, 1, 2].forEach(k => {
    const v = mu + k * sg;
    s += '<text x="' + sx(v) + '" y="' + (H - PB + 14) + '" text-anchor="middle" font-size="10" fill="' + C.apagadinho + '">' + fmt(v) + '</text>';
  });
  s += '</svg>';
  box.innerHTML = s;
}

/* ============================================================
   6 · COMPRESSÃO
   ============================================================ */
function renderCrashTabela() {
  let h = '<thead><tr><th>Atividade</th><th class="dir">Duração normal</th><th>Duração mínima</th><th>Custo / período acelerado</th></tr></thead><tbody>';
  state.acts.forEach((a, i) => {
    if (!String(a.id).trim()) return;
    const dn = durDe(a);
    h += '<tr data-i="' + i + '"><td class="cod"><b>' + esc(a.id) + '</b>' + (a.nome ? ' <span class="txt" style="color:var(--apagado)">' + esc(a.nome) + '</span>' : '') + '</td>' +
      '<td class="dir">' + fmt(dn) + '</td>' +
      '<td style="width:150px"><input data-cf="dmin" inputmode="decimal" value="' + esc(a.dmin) + '" placeholder="' + fmt(dn) + '" aria-label="Duração mínima"></td>' +
      '<td style="width:190px"><input data-cf="cc" inputmode="decimal" value="' + esc(a.cc) + '" placeholder="—" aria-label="Custo por período"></td></tr>';
  });
  $('#tblCrash').innerHTML = h + '</tbody>';
}

function rodarCrash() {
  const base = calcular();
  if (base.erros.length || !base.acts.length) { alerta('Corrija os erros dos dados antes de comprimir.'); return; }
  const dur = new Map(), dmin = new Map(), custo = new Map();
  state.acts.forEach(a => {
    const id = String(a.id).trim().toUpperCase(); if (!id) return;
    const dn = durDe(a);
    dur.set(id, dn);
    dmin.set(id, a.dmin === '' ? dn : Math.max(0, num(a.dmin)));
    custo.set(id, a.cc === '' ? Infinity : num(a.cc));
  });
  const ind = num($('#custoInd2').value || state.custoInd || 0);
  let direto = num($('#custoDir').value || state.custoDir || 0);
  const alvoRaw = $('#prazoAlvo').value;
  const alvo = alvoRaw === '' ? NaN : num(alvoRaw);

  let s = calcular(dur);
  const passos = [{ quem: 'normal', dur: s.dur, add: 0, dir: direto, ind: s.dur * ind, tot: direto + s.dur * ind }];

  for (let it = 1; it < TETO_PASSOS; it++) {
    if (!isNaN(alvo) && s.dur <= alvo + EPS) break;
    const cps = s.caminhos.filter(p => p.crit);
    if (!cps.length) break;
    const conjuntos = cps.map(p => p.ids.filter(id => dur.get(id) - dmin.get(id) > EPS && isFinite(custo.get(id))));
    if (conjuntos.some(x => !x.length)) break;
    /* produto cartesiano das alternativas de cada caminho crítico, com teto */
    let combos = [[]];
    for (let i = 0; i < conjuntos.length; i++) {
      const prox = [];
      for (const comb of combos) {
        for (const id of conjuntos[i]) {
          if (comb.indexOf(id) >= 0) prox.push(comb); else prox.push(comb.concat([id]));
          if (prox.length > TETO_COMBOS) break;
        }
        if (prox.length > TETO_COMBOS) break;
      }
      combos = prox.slice(0, TETO_COMBOS);
    }
    let melhor = null;
    combos.forEach(comb => {
      const chaves = Array.from(new Set(comb));
      if (!chaves.length) return;
      const custoTot = chaves.reduce((t, k) => t + custo.get(k), 0);
      if (!melhor || custoTot < melhor.custo - EPS) melhor = { chaves: chaves, custo: custoTot };
    });
    if (!melhor || !isFinite(melhor.custo)) break;
    melhor.chaves.forEach(k => dur.set(k, Math.max(dmin.get(k), dur.get(k) - 1)));
    const novo = calcular(dur);
    if (novo.dur >= s.dur - EPS) break;
    s = novo;
    direto += melhor.custo;
    passos.push({ quem: melhor.chaves.join(' + '), dur: s.dur, add: melhor.custo, dir: direto, ind: s.dur * ind, tot: direto + s.dur * ind });
    if (s.dur <= 0) break;
  }

  const temCusto = ind > 0 || passos.some(p => p.add > 0);
  let iOt = 0; passos.forEach((p, i) => { if (p.tot < passos[iOt].tot - EPS) iOt = i; });
  const economia = passos[0].tot - passos[iOt].tot;

  $('#crashKpis').innerHTML =
    '<div class="c navy"><div class="olho">Prazo ótimo</div><div class="v">' + fmt(passos[iOt].dur) + ' ' + uni(passos[iOt].dur) + '</div></div>' +
    '<div class="c"><div class="olho">Custo total mínimo</div><div class="v">' + money(passos[iOt].tot) + '</div></div>' +
    '<div class="c"><div class="olho">Economia vs. normal</div><div class="v folga">' + money(economia) + '</div></div>';

  let h = '<thead><tr><th class="dir">Passo</th><th>Comprimir</th><th class="dir">Prazo</th><th class="dir">+ Custo</th><th class="dir">Custo direto</th><th class="dir">Custo indireto</th><th class="dir">Custo total</th></tr></thead><tbody>';
  passos.forEach((p, i) => {
    const ot = temCusto && i === iOt;
    h += '<tr' + (ot ? ' style="background:#E8F0F2"' : '') + '><td class="dir">' + i + '</td>' +
      '<td' + (i ? ' style="color:var(--critico);font-weight:600"' : ' class="txt"') + '>' + esc(p.quem) + '</td>' +
      '<td class="dir"><b>' + fmt(p.dur) + '</b></td><td class="dir">' + (p.add ? money(p.add) : '—') + '</td>' +
      '<td class="dir">' + money(p.dir) + '</td><td class="dir">' + money(p.ind) + '</td><td class="dir"><b>' + money(p.tot) + '</b></td></tr>';
  });
  $('#tblCrashOut').innerHTML = h + '</tbody>';
  $('#cardCrashOut').hidden = false;
  desenhaCusto(passos, temCusto, iOt);
  $('#cardCrashOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function desenhaCusto(passos, temCusto, iOt) {
  const box = $('#stageCusto');
  if (!temCusto || passos.length < 2) { box.innerHTML = '<p class="hint" style="padding:12px 0">Informe o custo direto normal e o custo indireto por período para ver a curva de custo total.</p>'; return; }
  const W = 640, H = 260, L = 84, R = 24, T = 20, B = 46;
  const xs = passos.map(p => p.dur);
  const ys = passos.map(p => p.tot).concat(passos.map(p => p.dir)).concat(passos.map(p => p.ind));
  const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  const y1 = Math.max.apply(null, ys);
  const sx = v => L + (x1 === x0 ? .5 : (v - x0) / (x1 - x0)) * (W - L - R);
  const sy = v => T + (1 - v / (y1 || 1)) * (H - T - B);
  const mono = ' font-family="IBM Plex Mono, monospace"';
  const linha = (chave, cor, largura) =>
    '<path d="' + passos.map((p, i) => (i ? 'L' : 'M') + sx(p.dur).toFixed(1) + ',' + sy(p[chave]).toFixed(1)).join(' ') + '" fill="none" stroke="' + cor + '" stroke-width="' + largura + '"/>';
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="100%" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" preserveAspectRatio="xMidYMid meet" font-family="IBM Plex Sans, sans-serif">';
  s += '<rect width="100%" height="100%" fill="' + C.sup + '"/>';
  for (let i = 0; i <= 4; i++) {
    const v = (y1 * i) / 4, y = sy(v);
    s += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="' + C.bordaInt + '"/>';
    s += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end"' + mono + ' font-size="10.5" fill="' + C.apagadinho + '">' + money(Math.round(v)) + '</text>';
  }
  passos.forEach(p => { s += '<text x="' + sx(p.dur) + '" y="' + (H - B + 16) + '" text-anchor="middle"' + mono + ' font-size="10.5" fill="' + C.apagadinho + '">' + fmt(p.dur) + '</text>'; });
  s += linha('dir', C.critico, 2) + linha('ind', C.folga, 2) + linha('tot', C.navy, 2.6);
  s += '<circle cx="' + sx(passos[iOt].dur) + '" cy="' + sy(passos[iOt].tot) + '" r="5" fill="' + C.navy + '"/>';
  s += '<text x="' + sx(passos[iOt].dur) + '" y="' + (sy(passos[iOt].tot) - 11) + '" text-anchor="middle" font-size="11" font-weight="600" fill="' + C.navy + '">ótimo</text>';
  s += '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="' + C.borda + '"/>';
  s += '<text x="' + (W - R) + '" y="' + (H - 12) + '" text-anchor="end" font-size="11.5" fill="' + C.apagado + '">duração do projeto →</text>';
  s += '</svg>';
  box.innerHTML = s;
}

/* ============================================================
   EXPORTAÇÕES
   ============================================================ */
function baixar(nomeArq, conteudo, tipo) {
  const blob = new Blob([conteudo], { type: tipo || 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = nomeArq;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}
const nomeArquivo = () => (state.nome || 'projeto').replace(/[^\w\dÀ-ÿ -]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'projeto';

function exportarCSV() {
  const c = calcOut; if (!c.acts.length) return;
  const linhas = ['Atividade;Duracao;ES;EF;LS;LF;FT;FL;Critica'];
  c.acts.forEach(n => {
    linhas.push([n.id, fmt(n.dur), fmt(n.ES), fmt(n.EF), fmt(n.LS), fmt(n.LF), fmt(n.FT), fmt(n.FL), n.crit ? 'Critica' : 'Folga de ' + fmt(n.FT)].join(';'));
  });
  baixar(nomeArquivo() + '.csv', '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
}

function svgParaPNG(svgEl, nome) {
  if (!svgEl) return;
  const s = new XMLSerializer().serializeToString(svgEl);
  const escala = 2;
  const w = svgEl.viewBox.baseVal.width || svgEl.width.baseVal.value;
  const h = svgEl.viewBox.baseVal.height || svgEl.height.baseVal.value;
  const img = new Image();
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = w * escala; cv.height = h * escala;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = C.sup; ctx.fillRect(0, 0, cv.width, cv.height);
    ctx.setTransform(escala, 0, 0, escala, 0, 0);
    ctx.drawImage(img, 0, 0);
    cv.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = nome + '.png';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    });
  };
  img.onerror = () => alerta('Não consegui gerar o PNG neste navegador. Use “Imprimir / PDF”.');
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
}

/* ============================================================
   PROJETOS SALVOS (pertcpm.v2 / pertcpm.projects)
   ============================================================ */
const CHAVE_ESTADO = 'pertcpm.v2';
const CHAVE_PROJETOS = 'pertcpm.projects';

function lerProjetos() {
  try {
    const novo = localStorage.getItem(CHAVE_PROJETOS);
    if (novo) return JSON.parse(novo);
    /* migração da chave antiga, sem apagar o que estava lá */
    const velho = localStorage.getItem('pertcpm.geo.projetos');
    if (velho) {
      const lista = JSON.parse(velho), obj = {};
      (lista || []).forEach(p => { if (p && p.nome) obj[p.nome] = p; });
      localStorage.setItem(CHAVE_PROJETOS, JSON.stringify(obj));
      return obj;
    }
  } catch (e) { }
  return {};
}
const gravarProjetos = o => { try { localStorage.setItem(CHAVE_PROJETOS, JSON.stringify(o)); } catch (e) { alerta('Não consegui salvar (armazenamento do navegador indisponível).'); } };
function gravarEstado() { try { localStorage.setItem(CHAVE_ESTADO, JSON.stringify(state)); } catch (e) { } }
function lerEstado() {
  try {
    const novo = localStorage.getItem(CHAVE_ESTADO);
    if (novo) return JSON.parse(novo);
    const velho = localStorage.getItem('pertcpm.ultimo');
    if (velho) return JSON.parse(velho);
  } catch (e) { }
  return null;
}

function dlgSalvar() {
  abrirDlg('Salvar projeto',
    '<div class="campo"><label for="nomeProj">Nome do projeto</label><input id="nomeProj" value="' + esc(state.nome || '') + '" style="font-family:var(--texto)"></div>' +
    '<p class="hint" style="margin-bottom:0">Fica guardado neste aparelho, no próprio navegador.</p>',
    [['Cancelar', () => $('#dlg').close()],
    ['Salvar', () => {
      const nome = ($('#nomeProj').value || '').trim() || 'Sem nome';
      state.nome = nome;
      const l = lerProjetos();
      l[nome] = JSON.parse(JSON.stringify(state)); l[nome].quando = Date.now();
      gravarProjetos(l); $('#dlg').close(); toast('Projeto “' + nome + '” salvo.');
    }, true]]);
  setTimeout(() => { const i = $('#nomeProj'); if (i) { i.focus(); i.select(); } }, 60);
}

function dlgProjetos() {
  const l = lerProjetos();
  const nomes = Object.keys(l).sort();
  abrirDlg('Meus projetos',
    (nomes.length ? nomes.map(n =>
      '<div class="item"><div class="t"><b>' + esc(n) + '</b><span>' + ((l[n].acts || []).length) + ' atividades · ' + (l[n].modo === 'pert' ? 'PERT' : 'CPM') + (l[n].quando ? ' · ' + new Date(l[n].quando).toLocaleDateString('pt-BR') : '') + '</span></div>' +
      '<button class="bt mini" data-abrir="' + esc(n) + '">Abrir</button><button class="bt mini perigo" data-apagar="' + esc(n) + '">Apagar</button></div>').join('')
      : '<p class="hint">Nenhum projeto salvo ainda. Use o botão <b>Salvar projeto</b> no topo.</p>'),
    [['Exportar JSON', () => baixar(nomeArquivo() + '.json', JSON.stringify(state, null, 2), 'application/json')],
    ['Importar JSON', importarJSON],
    ['Fechar', () => $('#dlg').close(), true]]);
  $('#dlgCorpo').onclick = e => {
    const ab = e.target.getAttribute('data-abrir'), ap = e.target.getAttribute('data-apagar');
    const l2 = lerProjetos();
    if (ab) { carregar(l2[ab]); $('#dlg').close(); toast('Projeto “' + ab + '” aberto.'); }
    if (ap) {
      abrirDlg('Apagar projeto', '<p>Apagar <b>' + esc(ap) + '</b>? Isso não pode ser desfeito.</p>',
        [['Cancelar', dlgProjetos], ['Apagar', () => { const l3 = lerProjetos(); delete l3[ap]; gravarProjetos(l3); dlgProjetos(); }, true]]);
    }
  };
}
function importarJSON() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.json,application/json';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => {
      try { const o = JSON.parse(fr.result); if (!o.acts) throw 0; carregar(o); $('#dlg').close(); toast('Projeto importado.'); }
      catch (e) { alerta('Arquivo JSON inválido.'); }
    };
    fr.readAsText(f);
  };
  inp.click();
}

/* ---------- exemplos ---------- */
const EXEMPLOS = [
  {
    nome: 'CPM clássico (6 atividades)', modo: 'cpm', unidade: 'd',
    acts: [['A', 'Projeto', 6, []], ['B', 'Fundação', 8, ['A']], ['C', 'Instalações', 5, ['A']],
    ['D', 'Estrutura', 7, ['B']], ['E', 'Acabamento', 4, ['C']], ['F', 'Entrega', 3, ['D', 'E']]]
  },
  {
    nome: 'PERT com 3 estimativas', modo: 'pert', unidade: 's',
    acts: [['A', 'Pesquisa de mercado', [2, 3, 6], []], ['B', 'Protótipo', [3, 5, 10], ['A']],
    ['C', 'Plano de marketing', [2, 3, 4], ['A']], ['D', 'Testes com usuários', [2, 4, 7], ['B']],
    ['E', 'Treinamento', [1, 2, 3], ['C']], ['F', 'Lançamento', [1, 1, 2], ['D', 'E']]]
  },
  {
    nome: 'Projeto para compressão', modo: 'cpm', unidade: 'd', custoDir: 12000, custoInd: 500,
    acts: [['A', 'Projeto', 6, [], 4, 800], ['B', 'Fundação', 8, ['A'], 5, 900],
    ['C', 'Instalações', 5, ['A'], 3, 400], ['D', 'Estrutura', 7, ['B'], 4, 1100],
    ['E', 'Acabamento', 4, ['C'], 3, 300], ['F', 'Entrega', 3, ['D', 'E'], 2, 600]]
  }
];
function carregarExemplo(i) {
  const ex = EXEMPLOS[i]; if (!ex) return;
  const st = estadoVazio();
  st.nome = ex.nome; st.modo = ex.modo; st.unidade = ex.unidade || 'd';
  st.custoDir = ex.custoDir || ''; st.custoInd = ex.custoInd || '';
  st.acts = ex.acts.map(a => {
    const o = novoAtv(a[0], a[1]);
    if (ex.modo === 'pert') { o.o = a[2][0]; o.m = a[2][1]; o.p = a[2][2]; o.d = a[2][1]; }
    else { o.d = a[2]; o.o = a[2]; o.m = a[2]; o.p = a[2]; }
    o.preds = a[3].slice();
    if (a.length > 4) { o.dmin = a[4]; o.cc = a[5]; }
    return o;
  });
  carregar(st);
}

/* ---------- colar do Excel ---------- */
function colar(txt, substituir) {
  const linhas = String(txt).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return;
  const novas = [];
  const pert = state.modo === 'pert';
  linhas.forEach((l, i) => {
    const col = l.split(/\t|;|\s{2,}/).map(s => s.trim());
    if (!col.length || !col[0]) return;
    if (i === 0 && /c[oó]d|atividade|tarefa|dura/i.test(col.join(' '))) return;
    const a = novoAtv(String(col[0]).toUpperCase(), '');
    if (pert) { a.o = num(col[1]); a.m = num(col[2]); a.p = num(col[3]); a.preds = (col[4] || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean); }
    else { a.d = num(col[1]); a.preds = (col[2] || '').split(/[,;\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean); }
    novas.push(a);
  });
  if (!novas.length) { alerta('Não identifiquei nenhuma atividade no texto colado.'); return; }
  state.acts = substituir ? novas : state.acts.concat(novas);
  renderDados(); renderCrashTabela(); recalcular();
  $('#painelColar').hidden = true;
  toast(novas.length + ' atividades importadas.');
}

/* ============================================================
   MODAIS E AVISOS
   ============================================================ */
function abrirDlg(titulo, corpo, botoes) {
  $('#dlgTitulo').textContent = titulo;
  $('#dlgCorpo').innerHTML = corpo;
  $('#dlgCorpo').onclick = null;
  const rod = $('#dlgRodape'); rod.innerHTML = '';
  (botoes || []).forEach(b => {
    const el = document.createElement('button');
    el.className = 'bt' + (b[2] ? ' primario' : '') + ' mini';
    el.textContent = b[0]; el.onclick = b[1]; rod.appendChild(el);
  });
  if (!$('#dlg').open) $('#dlg').showModal();
}
const alerta = msg => abrirDlg('Atenção', '<p>' + esc(msg) + '</p>', [['Entendi', () => $('#dlg').close(), true]]);
let toastT = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#16243B;color:#F1EEE8;padding:12px 18px;border-radius:4px;font-size:14px;z-index:99;opacity:0;transition:.2s;max-width:90vw';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}

/* ============================================================
   ASSISTENTE
   ============================================================ */
const AG_EXEMPLOS = [
  'Reforma de uma cafeteria de 60 m², do projeto à inauguração',
  'Lançamento de um aplicativo de delivery, da pesquisa ao lançamento',
  'Organização de um congresso acadêmico para 300 pessoas',
  'Implantação de um ERP numa fábrica de móveis'
];
let agProposta = null;

function agenteLocal(texto, modo) {
  const linhas = String(texto).split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 2);
  if (linhas.length < 2) return null;
  const atividades = [];
  const porNome = new Map();
  linhas.forEach((l, i) => {
    const limpa = l.replace(/^[-*•\d]+[).\s]*/, '').trim();
    if (!limpa) return;
    const mDur = limpa.match(/(\d+(?:[.,]\d+)?)\s*(dias?|semanas?|meses|m[êe]s|d|s|m)\b/i);
    const dur = mDur ? num(mDur[1]) : 1;
    const mDep = limpa.match(/\b(?:depois de|ap[óo]s|precisa de|depende de)\s+(.+)$/i);
    let nome = limpa;
    if (mDep) nome = limpa.slice(0, mDep.index);
    if (mDur) nome = nome.replace(mDur[0], '');
    nome = nome.replace(/\s*[,;·|]+\s*/g, ' ').replace(/[\s,;·|–-]+$/, '').replace(/\s{2,}/g, ' ').trim().slice(0, 60) || ('Atividade ' + (i + 1));
    const id = proxId(atividades);
    const a = novoAtv(id, nome);
    if (modo === 'pert') { a.o = Math.max(0, r2(dur * 0.8)); a.m = dur; a.p = r2(dur * 1.4); }
    else a.d = dur;
    if (mDep) {
      mDep[1].split(/,| e |;/).forEach(t => {
        const chave = t.trim().toLowerCase().slice(0, 60);
        for (const par of porNome) { if (chave && (par[0].indexOf(chave) >= 0 || chave.indexOf(par[0]) >= 0)) { if (a.preds.indexOf(par[1]) < 0) a.preds.push(par[1]); break; } }
      });
    } else if (atividades.length) a.preds = [atividades[atividades.length - 1].id];
    porNome.set(nome.toLowerCase(), id);
    atividades.push(a);
  });
  return atividades.length >= 2 ? { atividades: atividades } : null;
}

function agenteAbrir() {
  $('#agChips').innerHTML = AG_EXEMPLOS.map(e => '<button class="bt mini" data-ex-ag="' + esc(e) + '">' + esc(e) + '</button>').join('');
  $('#agModo').value = state.modo;
  $('#agUnidade').value = state.unidade;
  $('#agSaida').innerHTML = ''; $('#agAviso').textContent = '';
  agProposta = null;
  $('#dlgAgente').showModal();
  setTimeout(() => $('#agTexto').focus(), 60);
}

async function agenteGerar() {
  const texto = $('#agTexto').value.trim();
  const modo = $('#agModo').value;
  if (texto.length < 10) { $('#agSaida').innerHTML = '<div class="nota">Escreva um pouco mais sobre o projeto.</div>'; return; }
  const btn = $('#agGerar'); btn.disabled = true; btn.textContent = 'Pensando…';
  $('#agSaida').innerHTML = '<div class="nota">Montando a rede do projeto…</div>';
  let dados = null, viaIA = false, motivo = '';
  try {
    const r = await fetch('/api/agente', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ texto: texto, modo: modo }) });
    const j = await r.json();
    if (j && j.ok) { dados = j; viaIA = true; } else motivo = (j && j.motivo) || 'falha';
  } catch (e) { motivo = 'rede'; }
  if (!dados) {
    const local = agenteLocal(texto, modo);
    if (local) dados = { atividades: local.atividades, unidade: $('#agUnidade').value, observacoes: '' };
  }
  btn.disabled = false; btn.textContent = 'Gerar atividades';

  if (!dados) {
    const recado = {
      sem_chave: 'A assistente com IA ainda não está ligada neste site. Enquanto isso, escreva uma atividade por linha — por exemplo: <span class="mono">Fundação, 8 dias, depois de Projeto</span> — que eu monto a rede a partir da sua lista.',
      texto_curto: 'Descreva o projeto com um pouco mais de detalhe.',
      resposta_invalida: 'A resposta veio fora do formato esperado. Tente reescrever a descrição.',
      falha_api: 'Não consegui falar com o modelo agora. Tente de novo em instantes.',
      rede: 'Sem conexão com o servidor. A calculadora continua funcionando offline.'
    }[motivo] || 'Não consegui montar a lista desta vez.';
    $('#agSaida').innerHTML = '<div class="faixa-erro">' + recado + '</div>';
    return;
  }

  agProposta = { modo: modo, unidade: dados.unidade || $('#agUnidade').value, atividades: dados.atividades };
  let h = '<div class="nota"><b>' + (viaIA ? dados.atividades.length + ' atividades propostas' : 'Montado a partir da sua lista (sem IA)') + '</b>' +
    esc(viaIA ? (dados.observacoes || '') : 'Confira as precedências: assumi a ordem em que você escreveu quando não estava explícito.') + '</div>';
  h += '<div class="rolar"><table class="tab"><thead><tr><th>Atividade</th>' +
    (modo === 'pert' ? '<th class="dir">o</th><th class="dir">m</th><th class="dir">p</th>' : '<th class="dir">Duração</th>') + '<th>Predecessoras</th></tr></thead><tbody>';
  dados.atividades.forEach(a => {
    h += '<tr><td><b>' + esc(a.id) + '</b> <span class="txt" style="color:var(--apagado)">' + esc(a.nome) + '</span></td>';
    h += modo === 'pert'
      ? '<td class="dir">' + fmt(num(a.o)) + '</td><td class="dir">' + fmt(num(a.m)) + '</td><td class="dir">' + fmt(num(a.p)) + '</td>'
      : '<td class="dir">' + fmt(num(a.d)) + '</td>';
    h += '<td>' + (a.preds && a.preds.length ? esc(a.preds.join(', ')) : '—') + '</td></tr>';
  });
  h += '</tbody></table></div>';
  h += '<div style="display:flex;gap:8px;margin-top:14px;flex-wrap:wrap">' +
    '<button class="bt primario" id="agAplicar">Aplicar na calculadora</button>' +
    '<button class="bt" id="agAdicionar">Acrescentar às atuais</button></div>';
  $('#agSaida').innerHTML = h;
  $('#agAplicar').onclick = () => agenteAplicar(true);
  $('#agAdicionar').onclick = () => agenteAplicar(false);
}

function agenteAplicar(substituir) {
  if (!agProposta) return;
  const novas = agProposta.atividades.map(a => {
    const o = novoAtv(a.id, a.nome);
    if (agProposta.modo === 'pert') { o.o = a.o; o.m = a.m; o.p = a.p; o.d = a.m; }
    else { o.d = a.d; o.o = a.d; o.m = a.d; o.p = a.d; }
    o.preds = (a.preds || []).slice();
    return o;
  });
  state.modo = agProposta.modo;
  state.unidade = agProposta.unidade || state.unidade;
  state.acts = substituir ? novas : state.acts.concat(novas);
  $('#unidade').value = state.unidade;
  $$('#segModo button').forEach(b => b.classList.toggle('on', b.dataset.m === state.modo));
  renderDados(); renderCrashTabela(); recalcular();
  $('#dlgAgente').close();
  toast(novas.length + ' atividades ' + (substituir ? 'aplicadas' : 'acrescentadas') + '. Confira antes de usar.');
  irPara('dados');
}

/* ============================================================
   CONTADOR DE VISITAS
   ============================================================ */
function contarVisita() {
  try { fetch('/api/hit?p=/', { cache: 'no-store', keepalive: true }).catch(() => { }); } catch (e) { }
  fetch('/api/stats', { cache: 'no-store' })
    .then(r => r.json())
    .then(d => {
      if (!d || !d.configurado || !d.total) return;
      const el = $('#visitas'); if (!el) return;
      el.querySelector('b').textContent = Number(d.total).toLocaleString('pt-BR');
      const rot = $('#visitasRot'); if (rot) rot.textContent = Number(d.total) === 1 ? ' visita' : ' visitas';
      el.hidden = false;
    })
    .catch(() => { });
}

/* ============================================================
   CICLO PRINCIPAL
   ============================================================ */
function irPara(p) {
  state.aba = p;
  $$('#tabs .aba').forEach(t => t.classList.toggle('on', t.dataset.p === p));
  $$('.painel').forEach(x => x.classList.toggle('on', x.id === 'p-' + p));
  if (p === 'crash') renderCrashTabela();
  gravarEstado();
}

function recalcular() {
  calcOut = calcular();
  renderAvisos(); renderResumo();
  if (state.modo === 'pert') $$('#tblDados td[data-te]').forEach(td => {
    const a = state.acts[+td.getAttribute('data-te')];
    td.textContent = fmt((num(a.o) + 4 * num(a.m) + num(a.p)) / 6);
  });
  if (calcOut.ciclo || !calcOut.acts.length) {
    ['#stageRede', '#stageGantt'].forEach(s => { $(s).innerHTML = '<p class="hint" style="padding:24px">Sem rede válida para desenhar.</p>'; });
    $('#tblResult').innerHTML = ''; $('#listaCaminhos').innerHTML = '';
    gravarEstado();
    return;
  }
  renderResultados(); renderRede(); renderGantt(); renderPert();
  gravarEstado();
}

function carregar(novo) {
  state = Object.assign(estadoVazio(), novo || {});
  state.acts = (state.acts || []).map(a => Object.assign(novoAtv('A'), a));
  $('#dtInicio').value = state.inicio || '';
  $('#unidade').value = state.unidade || 'd';
  $('#uteis').value = String(state.uteis || 0);
  $('#custoInd').value = state.custoInd || '';
  $('#custoInd2').value = state.custoInd || '';
  $('#custoDir').value = state.custoDir || '';
  $('#prazoAlvo').value = state.prazoAlvo || '';
  $('#prazoX').value = '';
  $('#soCriticos').checked = !!state.soCriticos;
  $('#gFolga').classList.toggle('on', state.gFolga !== false);
  $('#gTarde').classList.toggle('on', !!state.gTarde);
  $('#gSetas').classList.toggle('on', state.gSetas !== false);
  $$('#segModo button').forEach(b => b.classList.toggle('on', b.dataset.m === state.modo));
  $('#cardCrashOut').hidden = true;
  renderDados(); renderCrashTabela(); recalcular();
  irPara(state.aba || 'dados');
}

function ligar() {
  lerCores();

  $('#selExemplos').innerHTML = '<option value="">Exemplos…</option>' +
    EXEMPLOS.map((e, i) => '<option value="' + i + '">' + esc(e.nome) + '</option>').join('');

  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('.aba'); if (!b) return;
    irPara(b.dataset.p);
  });

  $('#tblDados').addEventListener('input', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    lerCampo(+tr.dataset.i, e.target.dataset.f, e.target.value);
    recalcular();
  });
  $('#tblDados').addEventListener('click', e => {
    const d = e.target.getAttribute('data-del'); if (d === null) return;
    state.acts.splice(+d, 1);
    renderDados(); renderCrashTabela(); recalcular();
  });
  $('#tblCrash').addEventListener('input', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const a = state.acts[+tr.dataset.i]; if (!a) return;
    a[e.target.dataset.cf] = e.target.value; gravarEstado();
  });

  $('#btnAdd').onclick = () => { state.acts.push(novoAtv(proxId(state.acts))); renderDados(); recalcular(); };
  $('#btnAdd5').onclick = () => { for (let i = 0; i < 5; i++) state.acts.push(novoAtv(proxId(state.acts))); renderDados(); recalcular(); };
  $('#btnLimpar').onclick = () => abrirDlg('Limpar tudo', '<p>Isso apaga as atividades da tela. Projetos salvos continuam guardados.</p>',
    [['Cancelar', () => $('#dlg').close()], ['Apagar', () => { carregar(estadoVazio()); $('#dlg').close(); }, true]]);
  $('#btnColar').onclick = () => { const p = $('#painelColar'); p.hidden = !p.hidden; if (!p.hidden) $('#taColar').focus(); };
  $('#btnImportar').onclick = () => colar($('#taColar').value, $('#chkSubstituir').checked);

  $('#segModo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.modo = b.dataset.m;
    $$('#segModo button').forEach(x => x.classList.toggle('on', x === b));
    renderDados(); renderCrashTabela(); recalcular();
  });

  ['dtInicio', 'unidade', 'uteis', 'custoInd'].forEach(id => {
    $('#' + id).addEventListener('change', () => {
      state.inicio = $('#dtInicio').value; state.unidade = $('#unidade').value;
      state.uteis = +$('#uteis').value; state.custoInd = $('#custoInd').value;
      $('#custoInd2').value = state.custoInd;
      recalcular();
    });
  });
  $('#custoDir').addEventListener('input', () => { state.custoDir = $('#custoDir').value; gravarEstado(); });
  $('#prazoAlvo').addEventListener('input', () => { state.prazoAlvo = $('#prazoAlvo').value; gravarEstado(); });
  $('#custoInd2').addEventListener('input', () => { state.custoInd = $('#custoInd2').value; $('#custoInd').value = state.custoInd; gravarEstado(); });

  $('#soCriticos').onchange = () => { state.soCriticos = $('#soCriticos').checked; renderResultados(); gravarEstado(); };
  [['gFolga', 'gFolga'], ['gTarde', 'gTarde'], ['gSetas', 'gSetas']].forEach(par => {
    $('#' + par[0]).onclick = () => {
      state[par[1]] = !state[par[1]];
      $('#' + par[0]).classList.toggle('on', state[par[1]]);
      renderGantt(); gravarEstado();
    };
  });
  $('#prazoX').addEventListener('input', renderPert);
  $('#confP').addEventListener('input', renderPert);

  $('#segPasso').addEventListener('click', e => {
    const b = e.target.closest('.bt'); if (!b) return;
    pararAnimacao(); passo = +b.dataset.s; renderRede();
  });
  $('#btnPlay').onclick = () => {
    if (animando) { pararAnimacao(); return; }
    $('#btnPlay').textContent = '⏸ Parar';
    passo = 0; renderRede();
    animando = setInterval(() => {
      passo++;
      renderRede();
      if (passo >= 3) pararAnimacao();
    }, 900);
  };
  $('#btnPNGrede').onclick = () => svgParaPNG($('#stageRede svg'), nomeArquivo() + '-rede');
  $('#btnPNGgantt').onclick = () => svgParaPNG($('#stageGantt svg'), nomeArquivo() + '-gantt');
  $('#btnCSV').onclick = exportarCSV;
  $('#btnImprimir').onclick = () => window.print();
  $('#btnCrash').onclick = rodarCrash;

  $('#selExemplos').onchange = e => { const v = e.target.value; if (v !== '') carregarExemplo(+v); e.target.value = ''; };
  $('#btnSalvar').onclick = dlgSalvar;
  $('#btnProjetos').onclick = dlgProjetos;

  $('#btnAgente').onclick = agenteAbrir;
  $('#agGerar').onclick = agenteGerar;
  $('#agFechar').onclick = () => $('#dlgAgente').close();
  $('#agChips').addEventListener('click', e => {
    const b = e.target.closest('[data-ex-ag]'); if (!b) return;
    $('#agTexto').value = b.getAttribute('data-ex-ag'); $('#agTexto').focus();
  });
  $('#agTexto').addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') { e.preventDefault(); agenteGerar(); }
  });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); dlgSalvar(); }
  });
}
function pararAnimacao() { if (animando) { clearInterval(animando); animando = null; } $('#btnPlay').textContent = '▶ Animar'; }

/* ---------- arranque ---------- */
(function () {
  ligar();
  carregar(lerEstado() || estadoVazio());
  addEventListener('beforeunload', gravarEstado);
  contarVisita();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
