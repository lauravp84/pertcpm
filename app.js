/* ============================================================
   Calculadora PERT/CPM — @LMVN 2026
   Tudo roda no navegador. Sem dependências externas.
   ============================================================ */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const num = v => { const n = parseFloat(String(v == null ? '' : v).replace(',', '.')); return isFinite(n) ? n : 0; };
const r2 = x => Math.round(x * 100) / 100;
const fmt = x => { if (!isFinite(x)) return '—'; const v = r2(x); return (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(2).replace('.', ',')); };
const money = x => (isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—');
const EPS = 1e-7;

/* ---------- estado ---------- */
const novoAtv = (id, nome) => ({ id, nome: nome || '', d: 1, o: 1, m: 1, p: 1, preds: [], dmin: '', cc: '' });
let state = null, calcOut = null, passo = 0, animando = null;

function estadoVazio() {
  return {
    nome: 'Novo projeto', modo: 'cpm', inicio: '', unidade: 'd', uteis: 0,
    custoInd: '', custoDir: '',
    acts: [novoAtv('A'), novoAtv('B'), novoAtv('C')]
  };
}
function proxId(acts) {
  const usados = new Set(acts.map(a => a.id.toUpperCase()));
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
  if (!acts.length) return { vazio: true, erros: [], avisos: [], acts: [] };

  // nós de cálculo
  const N = new Map();
  for (const [id, a] of mapa) {
    const preds = (a.preds || []).map(p => String(p).trim().toUpperCase()).filter(Boolean);
    const ok = [];
    preds.forEach(p => {
      if (p === id) erros.push('<b>' + esc(id) + '</b> não pode ser predecessora de si mesma.');
      else if (!mapa.has(p)) erros.push('<b>' + esc(id) + '</b> depende de <b>' + esc(p) + '</b>, que não existe.');
      else if (ok.indexOf(p) < 0) ok.push(p);
    });
    const d = durOverride && durOverride.has(id) ? durOverride.get(id) : durDe(a);
    if (d < 0) erros.push('Duração negativa em <b>' + esc(id) + '</b>.');
    N.set(id, { id, nome: a.nome || '', dur: d, varia: varDe(a), preds: ok, succs: [], ref: a });
  }
  for (const n of N.values()) n.preds.forEach(p => { const x = N.get(p); if (x) x.succs.push(n.id); });

  // ordem topológica (Kahn)
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
    return { erros, avisos, acts: [], ciclo: true };
  }

  // forward
  ordem.forEach(id => {
    const n = N.get(id);
    n.ES = n.preds.length ? Math.max.apply(null, n.preds.map(p => N.get(p).EF)) : 0;
    n.EF = n.ES + n.dur;
  });
  const dur = N.size ? Math.max.apply(null, Array.from(N.values()).map(n => n.EF)) : 0;

  // backward
  for (let i = ordem.length - 1; i >= 0; i--) {
    const n = N.get(ordem[i]);
    n.LF = n.succs.length ? Math.min.apply(null, n.succs.map(s => N.get(s).LS)) : dur;
    n.LS = n.LF - n.dur;
  }
  // folgas
  N.forEach(n => {
    n.FT = n.LS - n.ES;
    n.FL = (n.succs.length ? Math.min.apply(null, n.succs.map(s => N.get(s).ES)) : dur) - n.EF;
    n.crit = Math.abs(n.FT) < EPS;
    if (n.FL < EPS) n.FL = Math.abs(n.FL) < EPS ? 0 : n.FL;
  });

  const iniciais = ordem.filter(id => !N.get(id).preds.length);
  const finais = ordem.filter(id => !N.get(id).succs.length);
  if (finais.length > 1) avisos.push('Há ' + finais.length + ' atividades sem sucessora (' + finais.join(', ') + '). Todas encerram o projeto — se não for isso, ligue-as a uma atividade final.');
  if (iniciais.length > 1) avisos.push('Há ' + iniciais.length + ' atividades sem predecessora (' + iniciais.join(', ') + '). Todas começam no instante zero.');

  // caminhos (com limite)
  const caminhos = []; let estourou = false;
  const LIM = 4000;
  const dfs = (id, acum, soma) => {
    if (caminhos.length >= LIM) { estourou = true; return; }
    const n = N.get(id); acum.push(id); soma += n.dur;
    if (!n.succs.length) caminhos.push({ ids: acum.slice(), dur: soma, crit: Math.abs(soma - dur) < EPS });
    else n.succs.forEach(s => dfs(s, acum, soma));
    acum.pop();
  };
  iniciais.forEach(id => dfs(id, [], 0));
  caminhos.sort((a, b) => b.dur - a.dur);
  if (estourou) avisos.push('A rede tem mais de ' + LIM + ' caminhos; a lista mostra apenas os primeiros encontrados.');

  // caminho crítico de maior variância (para o PERT)
  let critVar = 0, critSeq = [];
  {
    const best = new Map(), from = new Map();
    ordem.forEach(id => {
      const n = N.get(id);
      if (!n.crit) return;
      let b = -1, f = null;
      n.preds.forEach(p => {
        const pn = N.get(p);
        if (pn.crit && Math.abs(pn.EF - n.ES) < EPS && best.has(p) && best.get(p) > b) { b = best.get(p); f = p; }
      });
      if (b < 0) b = 0;
      best.set(id, b + n.varia); from.set(id, f);
    });
    let fim = null;
    best.forEach((v, id) => { if (N.get(id).crit && Math.abs(N.get(id).EF - dur) < EPS && (fim === null || v > best.get(fim))) fim = id; });
    if (fim !== null) {
      critVar = best.get(fim);
      let cur = fim; while (cur) { critSeq.unshift(cur); cur = from.get(cur); }
    }
  }

  const lista = ordem.map(id => N.get(id));
  return {
    erros, avisos, dur, N, ordem, acts: lista, caminhos, iniciais, finais,
    criticas: lista.filter(n => n.crit), critVar, critSeq,
    sigma: Math.sqrt(critVar)
  };
}

/* ---------- estatística ---------- */
function erf(x) {
  const s = x < 0 ? -1 : 1; x = Math.abs(x);
  const a1 = .254829592, a2 = -.284496736, a3 = 1.421413741, a4 = -1.453152027, a5 = 1.061405429, pp = .3275911;
  const t = 1 / (1 + pp * x);
  const y = 1 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);
  return s * y;
}
const phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
function zInv(p) {
  if (p <= 0) return -Infinity; if (p >= 1) return Infinity;
  const a = [-3.969683028665376e+01, 2.209460984245205e+02, -2.759285104469687e+02, 1.383577518672690e+02, -3.066479806614716e+01, 2.506628277459239e+00];
  const b = [-5.447609879822406e+01, 1.615858368580409e+02, -1.556989798598866e+02, 6.680131188771972e+01, -1.328068155288572e+01];
  const c = [-7.784894002430293e-03, -3.223964580411365e-01, -2.400758277161838e+00, -2.549732539343734e+00, 4.374664141464968e+00, 2.938163982698783e+00];
  const d = [7.784695709041462e-03, 3.224671290700398e-01, 2.445134137142996e+00, 3.754408661907416e+00];
  const pl = 0.02425; let q, x;
  if (p < pl) { q = Math.sqrt(-2 * Math.log(p)); x = (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  else if (p <= 1 - pl) { q = p - 0.5; const rr = q * q; x = (((((a[0] * rr + a[1]) * rr + a[2]) * rr + a[3]) * rr + a[4]) * rr + a[5]) * q / (((((b[0] * rr + b[1]) * rr + b[2]) * rr + b[3]) * rr + b[4]) * rr + 1); }
  else { q = Math.sqrt(-2 * Math.log(1 - p)); x = -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1); }
  return x;
}

/* ---------- cores para o SVG (precisam ser literais p/ exportar PNG) ---------- */
let CORES = {};
function lerCores() {
  const cs = getComputedStyle(document.documentElement);
  const g = n => (cs.getPropertyValue(n) || '').trim() || '#888';
  CORES = {
    ink: g('--ink'), muted: g('--muted'), faint: g('--faint'), line: g('--line'), line2: g('--line-2'),
    card: g('--card'), card2: g('--card-2'), azul: g('--azul-2'), azulPale: g('--azul-pale'),
    crit: g('--crit'), critPale: g('--crit-pale'), warn: g('--warn'), ok: g('--ok'), bg: g('--bg')
  };
}

/* ============================================================
   RENDER — DADOS
   ============================================================ */
function renderDados() {
  const t = $('#tblDados'); const pert = state.modo === 'pert';
  let h = '<thead><tr><th style="width:34px"></th><th class="w-id">Cód.</th><th>Atividade</th>';
  h += pert
    ? '<th class="w-num">Otim. (o)</th><th class="w-num">Prov. (m)</th><th class="w-num">Pess. (p)</th><th class="w-num">te</th>'
    : '<th class="w-num">Duração</th>';
  h += '<th class="w-pred">Predecessoras</th><th style="width:38px"></th></tr></thead><tbody>';
  state.acts.forEach((a, i) => {
    h += '<tr data-i="' + i + '">';
    h += '<td class="hint num" style="text-align:center">' + (i + 1) + '</td>';
    h += '<td class="c-id"><input data-f="id" value="' + esc(a.id) + '" maxlength="6"></td>';
    h += '<td><input data-f="nome" value="' + esc(a.nome) + '" placeholder="descrição da atividade"></td>';
    if (pert) {
      h += '<td class="c-n"><input data-f="o" inputmode="decimal" value="' + esc(a.o) + '"></td>';
      h += '<td class="c-n"><input data-f="m" inputmode="decimal" value="' + esc(a.m) + '"></td>';
      h += '<td class="c-n"><input data-f="p" inputmode="decimal" value="' + esc(a.p) + '"></td>';
      h += '<td class="n" data-te="' + i + '">' + fmt((num(a.o) + 4 * num(a.m) + num(a.p)) / 6) + '</td>';
    } else {
      h += '<td class="c-n"><input data-f="d" inputmode="decimal" value="' + esc(a.d) + '"></td>';
    }
    h += '<td><input data-f="preds" value="' + esc((a.preds || []).join(', ')) + '" placeholder="—"></td>';
    h += '<td><button class="rowbtn" data-del="' + i + '" title="Remover">×</button></td></tr>';
  });
  h += '</tbody>';
  t.innerHTML = h;
}

function lerCampo(i, f, v) {
  const a = state.acts[i]; if (!a) return;
  if (f === 'preds') a.preds = String(v).split(/[,;/]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
  else if (f === 'id') a.id = String(v).trim().toUpperCase();
  else a[f] = v;
}

/* ============================================================
   RENDER — RESULTADOS
   ============================================================ */
function renderAvisos() {
  const c = calcOut, box = $('#avisos'); let h = '';
  if (c.erros && c.erros.length) {
    h += '<div class="alert err"><b>Corrija antes de continuar</b><ul>' + c.erros.map(e => '<li>' + e + '</li>').join('') + '</ul></div>';
  }
  if (c.avisos && c.avisos.length) {
    h += '<div class="alert warn"><b>Confira a estrutura da rede</b><ul>' + c.avisos.map(e => '<li>' + esc(e) + '</li>').join('') + '</ul></div>';
  }
  box.innerHTML = h;
}

function renderResultados() {
  const c = calcOut;
  const kp = $('#kpis');
  if (!c.acts.length) { kp.innerHTML = ''; $('#tblResult').innerHTML = ''; $('#listaCaminhos').innerHTML = '<p class="hint">Sem atividades válidas.</p>'; return; }
  const pert = state.modo === 'pert';
  let k = '';
  k += kpi('Duração do projeto', fmt(c.dur), uni(c.dur), true);
  k += kpi('Atividades', String(c.acts.length), c.criticas.length + ' críticas');
  k += kpi('Caminho crítico', c.critSeq.join(' → ') || '—', 'sequência sem folga');
  const folgaTotal = c.acts.reduce((s, n) => s + n.FT, 0);
  k += kpi('Folga acumulada', fmt(folgaTotal), uni(folgaTotal) + ' somando todas');
  if (pert) {
    k += kpi('Desvio-padrão', fmt(c.sigma), 'σ do caminho crítico');
    k += kpi('Faixa ~95%', fmt(c.dur - 2 * c.sigma) + ' – ' + fmt(c.dur + 2 * c.sigma), 'média ± 2σ');
  }
  kp.innerHTML = k;

  let h = '<thead><tr><th>Cód.</th><th>Atividade</th><th>Dur.</th><th>ES</th><th>EF</th><th>LS</th><th>LF</th><th>Folga total</th><th>Folga livre</th><th>Situação</th></tr></thead><tbody>';
  c.acts.forEach(n => {
    h += '<tr class="' + (n.crit ? 'crit' : '') + '">';
    h += '<td class="n"><b>' + esc(n.id) + '</b></td><td>' + esc(n.nome) + '</td>';
    h += '<td class="n">' + fmt(n.dur) + '</td><td class="n">' + fmt(n.ES) + '</td><td class="n">' + fmt(n.EF) + '</td>';
    h += '<td class="n">' + fmt(n.LS) + '</td><td class="n">' + fmt(n.LF) + '</td>';
    h += '<td class="n"><b>' + fmt(n.FT) + '</b></td><td class="n">' + fmt(n.FL) + '</td>';
    h += '<td>' + (n.crit ? '<span class="tag crit">crítica</span>' : '<span class="tag ok">folga ' + fmt(n.FT) + '</span>') + '</td></tr>';
  });
  $('#tblResult').innerHTML = h + '</tbody>';

  const so = $('#soCriticos').checked;
  const cams = (c.caminhos || []).filter(p => !so || p.crit);
  $('#listaCaminhos').innerHTML = cams.length
    ? cams.slice(0, 200).map(p => '<div class="path ' + (p.crit ? 'crit' : '') + '"><span>' + p.ids.map(esc).join(' → ') + '</span><span>' + fmt(p.dur) + ' ' + uni(p.dur) + (p.crit ? ' · CRÍTICO' : ' · folga ' + fmt(c.dur - p.dur)) + '</span></div>').join('')
    : '<p class="hint">Nenhum caminho para mostrar.</p>';
}
function kpi(l, v, s, crit) {
  return '<div class="kpi' + (crit ? ' crit' : '') + '"><div class="l">' + esc(l) + '</div><div class="v">' + esc(v) + '</div><div class="s">' + esc(s || '') + '</div></div>';
}

/* ============================================================
   RENDER — DIAGRAMA DE REDE (AON)
   ============================================================ */
function renderRede() {
  const c = calcOut, box = $('#stageRede');
  if (!c.acts || !c.acts.length) { box.innerHTML = '<p class="hint" style="padding:20px">Sem rede para desenhar.</p>'; $('#passoTexto').innerHTML = ''; return; }

  // camadas
  const camada = new Map();
  c.acts.forEach(n => {
    camada.set(n.id, n.preds.length ? 1 + Math.max.apply(null, n.preds.map(p => camada.get(p))) : 1);
  });
  const maxC = Math.max.apply(null, Array.from(camada.values()));
  const cols = []; for (let i = 0; i <= maxC + 1; i++) cols.push([]);
  c.acts.forEach(n => cols[camada.get(n.id)].push(n));
  cols[0] = [{ id: '__ini', fake: true, nome: 'Início' }];
  cols[maxC + 1] = [{ id: '__fim', fake: true, nome: 'Fim' }];

  const W = 156, H = 76, GX = 62, GY = 20, PAD = 26, WF = 62;
  const larg = cols.reduce((s, col, i) => s + (i === 0 || i === maxC + 1 ? WF : W) + GX, 0) - GX + PAD * 2;
  const altura = PAD * 2 + Math.max.apply(null, cols.map(col => col.length * (H + GY) - GY));

  const pos = new Map(); let x = PAD;
  cols.forEach((col, i) => {
    const w = (i === 0 || i === maxC + 1) ? WF : W;
    const hTot = col.length * (H + GY) - GY;
    let y = (altura - hTot) / 2;
    col.forEach(n => { pos.set(n.id, { x, y, w, h: (i === 0 || i === maxC + 1) ? 54 : H, fake: !!n.fake }); y += H + GY; });
    x += w + GX;
  });
  // centra verticalmente os nós fictícios
  ['__ini', '__fim'].forEach(id => { const p = pos.get(id); p.y = (altura - p.h) / 2; });

  const seta = (x1, y1, x2, y2, cor, tracejado) => {
    const mx = (x1 + x2) / 2;
    return '<path d="M' + x1 + ',' + y1 + ' C' + mx + ',' + y1 + ' ' + mx + ',' + y2 + ' ' + (x2 - 7) + ',' + y2 +
      '" fill="none" stroke="' + cor + '" stroke-width="' + (tracejado ? 1.3 : 1.8) + '"' + (tracejado ? ' stroke-dasharray="4 3"' : '') + ' marker-end="url(#mk' + (tracejado ? 'F' : (cor === CORES.crit ? 'C' : 'N')) + ')"/>';
  };

  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(larg) + '" height="' + Math.round(altura) + '" viewBox="0 0 ' + Math.round(larg) + ' ' + Math.round(altura) + '" font-family="Inter Tight, sans-serif">';
  s += '<defs>';
  ['N|' + CORES.azul, 'C|' + CORES.crit, 'F|' + CORES.faint].forEach(d => {
    const [k, cor] = d.split('|');
    s += '<marker id="mk' + k + '" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="' + cor + '"/></marker>';
  });
  s += '</defs><rect width="100%" height="100%" fill="' + CORES.card2 + '"/>';

  // arestas
  c.acts.forEach(n => {
    const pn = pos.get(n.id);
    n.preds.forEach(p => {
      const pp = pos.get(p), np = c.N.get(p);
      const critAresta = n.crit && np.crit && Math.abs(np.EF - n.ES) < EPS;
      s += seta(pp.x + pp.w, pp.y + pp.h / 2, pn.x, pn.y + pn.h / 2, critAresta ? CORES.crit : CORES.azul, false);
    });
    if (!n.preds.length) { const pi = pos.get('__ini'); s += seta(pi.x + pi.w, pi.y + pi.h / 2, pn.x, pn.y + pn.h / 2, CORES.faint, true); }
    if (!n.succs.length) { const pf = pos.get('__fim'); s += seta(pn.x + pn.w, pn.y + pn.h / 2, pf.x, pf.y + pf.h / 2, CORES.faint, true); }
  });

  // nós fictícios
  [['__ini', 'INÍCIO'], ['__fim', 'FIM']].forEach(([id, rot]) => {
    const p = pos.get(id);
    s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="27" fill="' + CORES.card + '" stroke="' + CORES.faint + '" stroke-width="1.2" stroke-dasharray="4 3"/>';
    s += '<text x="' + (p.x + p.w / 2) + '" y="' + (p.y + p.h / 2 + 4) + '" text-anchor="middle" font-size="11" font-weight="700" fill="' + CORES.muted + '" letter-spacing="0.5">' + rot + '</text>';
  });

  // caixas
  const mostraF = passo === 0 || passo >= 1, mostraB = passo === 0 || passo >= 2, mostraS = passo === 0 || passo >= 3;
  c.acts.forEach(n => {
    const p = pos.get(n.id);
    const cor = (mostraS && n.crit) ? CORES.crit : CORES.azul;
    const fundo = (mostraS && n.crit) ? CORES.critPale : CORES.card;
    s += '<g>';
    s += '<rect x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="10" fill="' + fundo + '" stroke="' + cor + '" stroke-width="' + ((mostraS && n.crit) ? 2.2 : 1.3) + '"/>';
    s += '<line x1="' + p.x + '" y1="' + (p.y + 22) + '" x2="' + (p.x + p.w) + '" y2="' + (p.y + 22) + '" stroke="' + CORES.line + '"/>';
    s += '<line x1="' + p.x + '" y1="' + (p.y + p.h - 22) + '" x2="' + (p.x + p.w) + '" y2="' + (p.y + p.h - 22) + '" stroke="' + CORES.line + '"/>';
    s += '<line x1="' + (p.x + p.w - 42) + '" y1="' + p.y + '" x2="' + (p.x + p.w - 42) + '" y2="' + (p.y + 22) + '" stroke="' + CORES.line + '"/>';
    s += '<line x1="' + (p.x + p.w - 42) + '" y1="' + (p.y + p.h - 22) + '" x2="' + (p.x + p.w - 42) + '" y2="' + (p.y + p.h) + '" stroke="' + CORES.line + '"/>';
    const mono = ' font-family="IBM Plex Mono, monospace" font-size="11.5" font-variant-numeric="tabular-nums"';
    const rot = (tx, ty, txt, cor2, anchor) => '<text x="' + tx + '" y="' + ty + '" text-anchor="' + (anchor || 'middle') + '"' + mono + ' fill="' + cor2 + '">' + esc(txt) + '</text>';
    // linha de cima: ES | EF | dur
    s += rot(p.x + (p.w - 42) / 4, p.y + 15, mostraF ? fmt(n.ES) : '?', mostraF ? CORES.ink : CORES.faint);
    s += rot(p.x + (p.w - 42) * 3 / 4, p.y + 15, mostraF ? fmt(n.EF) : '?', mostraF ? CORES.ink : CORES.faint);
    s += rot(p.x + p.w - 21, p.y + 15, fmt(n.dur), CORES.muted);
    // miolo
    s += '<text x="' + (p.x + p.w / 2) + '" y="' + (p.y + 39) + '" text-anchor="middle" font-size="14" font-weight="800" fill="' + cor + '">' + esc(n.id) + '</text>';
    const nm = n.nome.length > 22 ? n.nome.slice(0, 21) + '…' : n.nome;
    s += '<text x="' + (p.x + p.w / 2) + '" y="' + (p.y + 50) + '" text-anchor="middle" font-size="10" fill="' + CORES.muted + '">' + esc(nm) + '</text>';
    // linha de baixo: LS | LF | folga
    s += rot(p.x + (p.w - 42) / 4, p.y + p.h - 7, mostraB ? fmt(n.LS) : '?', mostraB ? CORES.ink : CORES.faint);
    s += rot(p.x + (p.w - 42) * 3 / 4, p.y + p.h - 7, mostraB ? fmt(n.LF) : '?', mostraB ? CORES.ink : CORES.faint);
    s += rot(p.x + p.w - 21, p.y + p.h - 7, mostraS ? fmt(n.FT) : '?', mostraS ? (n.crit ? CORES.crit : CORES.ok) : CORES.faint);
    s += '</g>';
  });
  s += '</svg>';
  box.innerHTML = s;

  const textos = [
    '',
    '<div class="alert info"><b>Passo 1 · Caminho de ida</b>Da esquerda para a direita: ES = maior EF das predecessoras, EF = ES + duração. O maior EF da rede é a duração do projeto (' + fmt(c.dur) + ' ' + uni(c.dur) + ').</div>',
    '<div class="alert info"><b>Passo 2 · Caminho de volta</b>Da direita para a esquerda: LF da última = ' + fmt(c.dur) + '; nas demais, LF = menor LS das sucessoras e LS = LF − duração.</div>',
    '<div class="alert info"><b>Passo 3 · Folgas e caminho crítico</b>Folga total = LS − ES. Quem tem folga zero não pode atrasar um único ' + UNI[state.unidade][0] + ': ' + (c.critSeq.join(' → ') || '—') + '.</div>'
  ];
  $('#passoTexto').innerHTML = textos[passo] || '';
}

/* ============================================================
   RENDER — GANTT
   ============================================================ */
function diasData(base, k) {
  const d = new Date(base.getTime()); let add = 0, passos = 0;
  if (!Number(state.uteis)) { d.setDate(d.getDate() + Math.round(k)); return d; }
  while (passos < Math.round(k)) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) passos++; add++; if (add > 5000) break; }
  return d;
}
function renderGantt() {
  const c = calcOut, box = $('#stageGantt');
  if (!c.acts || !c.acts.length) { box.innerHTML = '<p class="hint" style="padding:20px">Sem atividades.</p>'; return; }
  const setas = $('#gSetas').checked, vFolga = $('#gFolga').checked, vTarde = $('#gTarde').checked;
  const LBL = 190, PADT = 44, RH = 30, BH = 17, PADB = 26, PADR = 26;
  const areaW = Math.max(520, Math.min(1500, c.dur * 46 + 60));
  const W = LBL + areaW + PADR;
  const linhas = c.acts.slice().sort((a, b) => a.ES - b.ES || a.EF - b.EF || a.id.localeCompare(b.id));
  const H = PADT + linhas.length * RH + PADB;
  const sx = v => LBL + (v / (c.dur || 1)) * areaW;
  const yOf = id => PADT + linhas.findIndex(n => n.id === id) * RH + RH / 2;

  // escala
  let passoT = 1; const alvo = c.dur / 12;
  [1, 2, 5, 7, 10, 14, 20, 30, 50, 100].forEach(p => { if (alvo > p) passoT = p; });
  const base = state.inicio ? new Date(state.inicio + 'T12:00:00') : null;

  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W) + '" height="' + Math.round(H) + '" viewBox="0 0 ' + Math.round(W) + ' ' + Math.round(H) + '" font-family="Inter Tight, sans-serif">';
  s += '<defs><marker id="gk" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M0,0 L10,5 L0,10 z" fill="' + CORES.faint + '"/></marker></defs>';
  s += '<rect width="100%" height="100%" fill="' + CORES.card2 + '"/>';
  for (let t = 0; t <= c.dur + 1e-9; t += passoT) {
    const x = sx(t);
    s += '<line x1="' + x + '" y1="' + (PADT - 16) + '" x2="' + x + '" y2="' + (H - PADB + 4) + '" stroke="' + CORES.line2 + '"/>';
    const rotulo = base ? diasData(base, t).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) : fmt(t);
    s += '<text x="' + x + '" y="' + (PADT - 22) + '" text-anchor="middle" font-size="10" fill="' + CORES.faint + '" font-family="IBM Plex Mono, monospace">' + rotulo + '</text>';
  }
  // marco final
  s += '<line x1="' + sx(c.dur) + '" y1="' + (PADT - 16) + '" x2="' + sx(c.dur) + '" y2="' + (H - PADB + 4) + '" stroke="' + CORES.crit + '" stroke-width="1.4" stroke-dasharray="5 3"/>';

  linhas.forEach((n, i) => {
    const y = PADT + i * RH, yc = y + RH / 2, cor = n.crit ? CORES.crit : CORES.azul;
    if (i % 2) s += '<rect x="0" y="' + y + '" width="' + W + '" height="' + RH + '" fill="' + CORES.card + '" opacity="0.55"/>';
    const nm = n.nome ? (n.nome.length > 22 ? n.nome.slice(0, 21) + '…' : n.nome) : '';
    s += '<text x="12" y="' + (yc + 4) + '" font-size="12" fill="' + CORES.ink + '"><tspan font-weight="800" font-family="IBM Plex Mono, monospace">' + esc(n.id) + '</tspan><tspan fill="' + CORES.muted + '">  ' + esc(nm) + '</tspan></text>';
    const x1 = sx(n.ES), x2 = sx(n.EF);
    if (vFolga && n.FT > EPS) {
      s += '<rect x="' + x1 + '" y="' + (yc - BH / 2) + '" width="' + Math.max(1, sx(n.LF) - x1) + '" height="' + BH + '" rx="4" fill="none" stroke="' + CORES.muted + '" stroke-width="1.2" stroke-dasharray="4 3"/>';
    }
    if (vTarde && n.FT > EPS) {
      s += '<rect x="' + sx(n.LS) + '" y="' + (yc - BH / 2) + '" width="' + Math.max(2, sx(n.LF) - sx(n.LS)) + '" height="' + BH + '" rx="4" fill="' + CORES.warn + '" opacity="0.25"/>';
    }
    s += '<rect x="' + x1 + '" y="' + (yc - BH / 2) + '" width="' + Math.max(2, x2 - x1) + '" height="' + BH + '" rx="4" fill="' + cor + '"/>';
    s += '<text x="' + (x2 + 6) + '" y="' + (yc + 4) + '" font-size="10.5" font-family="IBM Plex Mono, monospace" fill="' + CORES.muted + '">' + fmt(n.dur) + (n.FT > EPS ? ' · folga ' + fmt(n.FT) : '') + '</text>';
  });
  if (setas) {
    linhas.forEach(n => n.preds.forEach(p => {
      const y1 = yOf(p), y2 = yOf(n.id), x1 = sx(c.N.get(p).EF), x2 = sx(n.ES);
      const mx = Math.max(x1 + 9, x2 - 9);
      s += '<path d="M' + x1 + ',' + y1 + ' L' + mx + ',' + y1 + ' L' + mx + ',' + y2 + ' L' + (x2 - 2) + ',' + y2 + '" fill="none" stroke="' + CORES.faint + '" stroke-width="1.1" marker-end="url(#gk)" opacity="0.8"/>';
    }));
  }
  s += '</svg>';
  box.innerHTML = s;
}

/* ============================================================
   RENDER — PERT / PROBABILIDADE
   ============================================================ */
function renderPert() {
  const c = calcOut;
  if (state.modo !== 'pert') {
    $('#pertAviso').innerHTML = '<div class="alert warn"><b>Ative o modo PERT</b>A análise de probabilidade precisa das três estimativas (otimista, mais provável e pessimista). Volte à aba <b>Dados</b> e escolha “PERT · 3 estimativas”.</div>';
    $('#kpisPert').innerHTML = ''; $('#saidaProb').innerHTML = ''; $('#saidaConf').innerHTML = '';
    $('#tblPert').innerHTML = ''; $('#tblConf').innerHTML = ''; $('#stageNormal').innerHTML = '';
    return;
  }
  $('#pertAviso').innerHTML = '';
  if (!c.acts.length) return;
  const mu = c.dur, sg = c.sigma;
  $('#kpisPert').innerHTML =
    kpi('Duração esperada', fmt(mu), uni(mu) + ' (soma dos te críticos)', true) +
    kpi('Variância do projeto', fmt(c.critVar), 'soma das variâncias críticas') +
    kpi('Desvio-padrão σ', fmt(sg), uni(sg)) +
    kpi('Faixa ~95%', fmt(mu - 2 * sg) + ' – ' + fmt(mu + 2 * sg), 'média ± 2σ');

  if (!$('#prazoX').value) $('#prazoX').value = r2(mu + sg);
  const X = num($('#prazoX').value);
  const z = sg > EPS ? (X - mu) / sg : (X >= mu ? 9 : -9);
  const P = phi(z);
  $('#saidaProb').innerHTML =
    '<div class="alert ' + (P >= .8 ? 'info' : P >= .5 ? 'warn' : 'err') + '"><b>Z = (' + fmt(X) + ' − ' + fmt(mu) + ') ÷ ' + fmt(sg) + ' = ' + (isFinite(z) ? fmt(z) : '—') + '</b>' +
    'Probabilidade de concluir em até <b>' + fmt(X) + ' ' + uni(X) + '</b>: <b class="num" style="font-size:20px">' + (P * 100).toFixed(1).replace('.', ',') + '%</b>' +
    (sg <= EPS ? '<br><span class="hint">Sem variabilidade no caminho crítico (o = m = p): a duração é determinística.</span>' : '') + '</div>';
  desenhaNormal(mu, sg, X);

  const conf = Math.min(99.9, Math.max(0.1, num($('#confP').value) || 95)) / 100;
  const Xc = mu + zInv(conf) * sg;
  $('#saidaConf').innerHTML = '<div class="alert info"><b>Prometa ' + fmt(Xc) + ' ' + uni(Xc) + '</b>Com ' + fmt(conf * 100) + '% de confiança (z = ' + fmt(zInv(conf)) + '), é preciso reservar ' + fmt(Xc - mu) + ' ' + uni(Xc - mu) + ' além da duração esperada.</div>';
  let tc = '<thead><tr><th>Confiança</th><th>z</th><th>Prazo</th><th>Reserva</th></tr></thead><tbody>';
  [50, 75, 80, 90, 95, 99].forEach(pc => {
    const zz = zInv(pc / 100), xx = mu + zz * sg;
    tc += '<tr><td class="n">' + pc + '%</td><td class="n">' + fmt(zz) + '</td><td class="n"><b>' + fmt(xx) + '</b></td><td class="n">' + fmt(xx - mu) + '</td></tr>';
  });
  $('#tblConf').innerHTML = tc + '</tbody>';

  let h = '<thead><tr><th>Cód.</th><th>Atividade</th><th>o</th><th>m</th><th>p</th><th>te</th><th>σ²</th><th>σ</th><th>No crítico</th></tr></thead><tbody>';
  c.acts.forEach(n => {
    h += '<tr class="' + (n.crit ? 'crit' : '') + '"><td class="n"><b>' + esc(n.id) + '</b></td><td>' + esc(n.nome) + '</td>' +
      '<td class="n">' + fmt(num(n.ref.o)) + '</td><td class="n">' + fmt(num(n.ref.m)) + '</td><td class="n">' + fmt(num(n.ref.p)) + '</td>' +
      '<td class="n"><b>' + fmt(n.dur) + '</b></td><td class="n">' + fmt(n.varia) + '</td><td class="n">' + fmt(Math.sqrt(n.varia)) + '</td>' +
      '<td>' + (c.critSeq.indexOf(n.id) >= 0 ? '<span class="tag crit">sim</span>' : '<span class="hint">—</span>') + '</td></tr>';
  });
  $('#tblPert').innerHTML = h + '</tbody>';
}

function desenhaNormal(mu, sg, X) {
  const W = 520, H = 190, PADX = 26, PADB = 28, PADT = 14;
  if (sg <= EPS) { $('#stageNormal').innerHTML = ''; return; }
  const a = mu - 3.6 * sg, b = mu + 3.6 * sg;
  const sx = v => PADX + (v - a) / (b - a) * (W - PADX * 2);
  const f = v => Math.exp(-0.5 * Math.pow((v - mu) / sg, 2));
  const sy = v => PADT + (1 - f(v)) * (H - PADT - PADB);
  let d = '', area = '';
  for (let i = 0; i <= 200; i++) { const v = a + (b - a) * i / 200; d += (i ? 'L' : 'M') + sx(v).toFixed(1) + ',' + sy(v).toFixed(1) + ' '; }
  const lim = Math.min(b, Math.max(a, X));
  area = 'M' + sx(a) + ',' + (H - PADB) + ' ';
  for (let i = 0; i <= 200; i++) { const v = a + (lim - a) * i / 200; area += 'L' + sx(v).toFixed(1) + ',' + sy(v).toFixed(1) + ' '; }
  area += 'L' + sx(lim) + ',' + (H - PADB) + ' Z';
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Inter Tight, sans-serif">';
  s += '<rect width="100%" height="100%" fill="' + CORES.card2 + '"/>';
  s += '<path d="' + area + '" fill="' + CORES.azul + '" opacity="0.22"/>';
  s += '<path d="' + d + '" fill="none" stroke="' + CORES.azul + '" stroke-width="2"/>';
  s += '<line x1="' + PADX + '" y1="' + (H - PADB) + '" x2="' + (W - PADX) + '" y2="' + (H - PADB) + '" stroke="' + CORES.line + '"/>';
  s += '<line x1="' + sx(mu) + '" y1="' + PADT + '" x2="' + sx(mu) + '" y2="' + (H - PADB) + '" stroke="' + CORES.muted + '" stroke-dasharray="4 3"/>';
  s += '<line x1="' + sx(lim) + '" y1="' + PADT + '" x2="' + sx(lim) + '" y2="' + (H - PADB) + '" stroke="' + CORES.crit + '" stroke-width="1.8"/>';
  const mono = ' font-family="IBM Plex Mono, monospace" font-size="10.5"';
  [-3, -2, -1, 0, 1, 2, 3].forEach(k => {
    const v = mu + k * sg;
    s += '<text x="' + sx(v) + '" y="' + (H - PADB + 14) + '" text-anchor="middle"' + mono + ' fill="' + CORES.faint + '">' + fmt(v) + '</text>';
  });
  s += '<text x="' + sx(lim) + '" y="' + (PADT + 10) + '" text-anchor="middle"' + mono + ' fill="' + CORES.crit + '" font-weight="700">prazo ' + fmt(X) + '</text>';
  s += '</svg>';
  $('#stageNormal').innerHTML = s;
}

/* ============================================================
   COMPRESSÃO (CRASHING)
   ============================================================ */
function renderCrashTabela() {
  let h = '<thead><tr><th>Cód.</th><th>Atividade</th><th>Duração normal</th><th>Duração mínima</th><th>Custo por período acelerado</th><th>Redução máx.</th></tr></thead><tbody>';
  state.acts.forEach((a, i) => {
    if (!String(a.id).trim()) return;
    const dn = durDe(a), dm = a.dmin === '' ? dn : num(a.dmin);
    h += '<tr data-i="' + i + '"><td class="n"><b>' + esc(a.id) + '</b></td><td>' + esc(a.nome) + '</td>' +
      '<td class="n">' + fmt(dn) + '</td>' +
      '<td class="c-n" style="width:110px"><input data-cf="dmin" inputmode="decimal" value="' + esc(a.dmin) + '" placeholder="' + fmt(dn) + '"></td>' +
      '<td class="c-n" style="width:130px"><input data-cf="cc" inputmode="decimal" value="' + esc(a.cc) + '" placeholder="—"></td>' +
      '<td class="n">' + fmt(Math.max(0, dn - dm)) + '</td></tr>';
  });
  $('#tblCrash').innerHTML = h + '</tbody>';
}

function combinacoesCorte(criticos, caminhosCrit) {
  // conjuntos de 1 ou 2 atividades que interceptam TODOS os caminhos críticos
  const cobre = set => caminhosCrit.every(p => p.ids.some(id => set.indexOf(id) >= 0));
  const saida = [];
  for (let i = 0; i < criticos.length; i++) {
    if (cobre([criticos[i]])) saida.push([criticos[i]]);
  }
  if (!saida.length) {
    for (let i = 0; i < criticos.length; i++)
      for (let j = i + 1; j < criticos.length; j++)
        if (cobre([criticos[i], criticos[j]])) saida.push([criticos[i], criticos[j]]);
  }
  if (!saida.length) {
    for (let i = 0; i < criticos.length; i++)
      for (let j = i + 1; j < criticos.length; j++)
        for (let k = j + 1; k < criticos.length; k++)
          if (cobre([criticos[i], criticos[j], criticos[k]])) saida.push([criticos[i], criticos[j], criticos[k]]);
  }
  return saida;
}

function rodarCrash() {
  const base = calcular();
  if (base.erros.length || !base.acts.length) { alerta('Corrija os erros dos dados antes de comprimir.'); return; }
  const dmin = new Map(), custo = new Map(), dur = new Map();
  state.acts.forEach(a => {
    const id = String(a.id).trim().toUpperCase(); if (!id) return;
    const dn = durDe(a);
    dur.set(id, dn);
    dmin.set(id, a.dmin === '' ? dn : Math.max(0, num(a.dmin)));
    custo.set(id, a.cc === '' ? Infinity : num(a.cc));
  });
  const cInd = num($('#custoInd2').value || state.custoInd || 0);
  const cDir0 = num($('#custoDir').value || state.custoDir || 0);
  const alvoRaw = $('#prazoAlvo').value;
  const alvo = alvoRaw === '' ? -Infinity : num(alvoRaw);

  const passos = [];
  let cur = calcular(dur), acumulado = 0, guarda = 0;
  passos.push({ dur: cur.dur, quem: '—', cUnit: 0, dir: cDir0, ind: cInd * cur.dur, tot: cDir0 + cInd * cur.dur, nota: 'Situação normal' });

  while (guarda++ < 400) {
    if (cur.dur <= alvo + EPS) break;
    const camCrit = cur.caminhos.filter(p => p.crit);
    const criticos = cur.criticas.map(n => n.id).filter(id => dur.get(id) - dmin.get(id) > EPS && isFinite(custo.get(id)));
    if (!criticos.length) break;
    const combos = combinacoesCorte(criticos, camCrit);
    if (!combos.length) break;
    let melhor = null;
    combos.forEach(cb => {
      const c = cb.reduce((s, id) => s + custo.get(id), 0);
      if (!melhor || c < melhor.c - EPS) melhor = { ids: cb, c };
    });
    // quanto dá para comprimir de uma vez (1 período por iteração mantém a leitura didática)
    const passoRed = Math.min.apply(null, melhor.ids.map(id => dur.get(id) - dmin.get(id)).concat([1]));
    melhor.ids.forEach(id => dur.set(id, dur.get(id) - passoRed));
    const novo = calcular(dur);
    const ganho = cur.dur - novo.dur;
    if (ganho <= EPS) { // comprimiu mas não encurtou: desfaz e para
      melhor.ids.forEach(id => dur.set(id, dur.get(id) + passoRed));
      break;
    }
    acumulado += melhor.c * passoRed;
    const dirTot = cDir0 + acumulado, indTot = cInd * novo.dur;
    passos.push({
      dur: novo.dur, quem: melhor.ids.join(' + '), cUnit: melhor.c, red: passoRed,
      dir: dirTot, ind: indTot, tot: dirTot + indTot,
      nota: camCrit.length > 1 ? camCrit.length + ' caminhos críticos' : ''
    });
    cur = novo;
  }

  const temCusto = cInd > 0 || cDir0 > 0 || passos.some(p => p.cUnit > 0);
  let iOt = 0; passos.forEach((p, i) => { if (p.tot < passos[iOt].tot - EPS) iOt = i; });

  let h = '<thead><tr><th>Passo</th><th>Comprimir</th><th>Custo/período</th><th>Duração</th><th>Custo direto</th><th>Custo indireto</th><th>Custo total</th><th></th></tr></thead><tbody>';
  passos.forEach((p, i) => {
    const ot = temCusto && i === iOt;
    h += '<tr' + (ot ? ' class="crit"' : '') + '><td class="n">' + i + '</td><td class="n"><b>' + esc(p.quem) + '</b></td>' +
      '<td class="n">' + (p.cUnit ? money(p.cUnit) : '—') + '</td><td class="n"><b>' + fmt(p.dur) + '</b></td>' +
      '<td class="n">' + money(p.dir) + '</td><td class="n">' + money(p.ind) + '</td><td class="n"><b>' + money(p.tot) + '</b></td>' +
      '<td>' + (ot ? '<span class="tag crit">ótimo</span>' : (p.nota ? '<span class="hint">' + esc(p.nota) + '</span>' : '')) + '</td></tr>';
  });
  $('#tblCrashOut').innerHTML = h + '</tbody>';
  $('#tagOtimo').textContent = temCusto
    ? 'Prazo de menor custo: ' + fmt(passos[iOt].dur) + ' ' + uni(passos[iOt].dur) + ' · ' + money(passos[iOt].tot)
    : 'Duração mínima possível: ' + fmt(passos[passos.length - 1].dur) + ' ' + uni(passos[passos.length - 1].dur);
  $('#cardCrashOut').style.display = '';
  desenhaCusto(passos, temCusto, iOt);
  $('#cardCrashOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function desenhaCusto(passos, temCusto, iOt) {
  const box = $('#stageCusto');
  if (!temCusto || passos.length < 2) { box.innerHTML = '<p class="hint" style="padding:14px">Informe o custo direto normal e o custo indireto por período para ver a curva de custo total.</p>'; return; }
  const W = 620, H = 260, L = 64, R = 20, T = 18, B = 40;
  const xs = passos.map(p => p.dur), ys = passos.map(p => p.tot).concat(passos.map(p => p.dir)).concat(passos.map(p => p.ind));
  const x0 = Math.min.apply(null, xs), x1 = Math.max.apply(null, xs);
  const y1 = Math.max.apply(null, ys), y0 = 0;
  const sx = v => L + (x1 === x0 ? .5 : (v - x0) / (x1 - x0)) * (W - L - R);
  const sy = v => T + (1 - (v - y0) / (y1 - y0 || 1)) * (H - T - B);
  const linha = (key, cor) => {
    let d = passos.map((p, i) => (i ? 'L' : 'M') + sx(p.dur).toFixed(1) + ',' + sy(p[key]).toFixed(1)).join(' ');
    let pts = passos.map(p => '<circle cx="' + sx(p.dur).toFixed(1) + '" cy="' + sy(p[key]).toFixed(1) + '" r="3" fill="' + cor + '"/>').join('');
    return '<path d="' + d + '" fill="none" stroke="' + cor + '" stroke-width="2.2"/>' + pts;
  };
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + W + '" height="' + H + '" viewBox="0 0 ' + W + ' ' + H + '" font-family="Inter Tight, sans-serif">';
  s += '<rect width="100%" height="100%" fill="' + CORES.card2 + '"/>';
  for (let i = 0; i <= 4; i++) {
    const v = y0 + (y1 - y0) * i / 4, y = sy(v);
    s += '<line x1="' + L + '" y1="' + y + '" x2="' + (W - R) + '" y2="' + y + '" stroke="' + CORES.line2 + '"/>';
    s += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end" font-size="10" font-family="IBM Plex Mono, monospace" fill="' + CORES.faint + '">' + money(Math.round(v)) + '</text>';
  }
  passos.forEach(p => {
    s += '<text x="' + sx(p.dur) + '" y="' + (H - B + 16) + '" text-anchor="middle" font-size="10" font-family="IBM Plex Mono, monospace" fill="' + CORES.faint + '">' + fmt(p.dur) + '</text>';
  });
  s += '<line x1="' + sx(passos[iOt].dur) + '" y1="' + T + '" x2="' + sx(passos[iOt].dur) + '" y2="' + (H - B) + '" stroke="' + CORES.crit + '" stroke-dasharray="5 3"/>';
  s += linha('dir', CORES.azul) + linha('ind', CORES.warn) + linha('tot', CORES.crit);
  s += '<text x="' + (W / 2) + '" y="' + (H - 6) + '" text-anchor="middle" font-size="11" fill="' + CORES.muted + '">duração do projeto (' + UNI[state.unidade][1] + ')</text>';
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
function exportarCSV() {
  const c = calcOut; if (!c.acts.length) return;
  const pert = state.modo === 'pert';
  const cab = ['Codigo', 'Atividade'].concat(pert ? ['o', 'm', 'p', 'te'] : ['Duracao']).concat(['Predecessoras', 'ES', 'EF', 'LS', 'LF', 'Folga total', 'Folga livre', 'Critica']);
  const linhas = [cab.join(';')];
  c.acts.forEach(n => {
    const l = [n.id, n.nome];
    if (pert) l.push(fmt(num(n.ref.o)), fmt(num(n.ref.m)), fmt(num(n.ref.p)), fmt(n.dur)); else l.push(fmt(n.dur));
    l.push(n.preds.join(' '), fmt(n.ES), fmt(n.EF), fmt(n.LS), fmt(n.LF), fmt(n.FT), fmt(n.FL), n.crit ? 'SIM' : '');
    linhas.push(l.map(x => '"' + String(x).replace(/"/g, '""') + '"').join(';'));
  });
  linhas.push('');
  linhas.push('"Duracao do projeto";"' + fmt(c.dur) + '"');
  linhas.push('"Caminho critico";"' + c.critSeq.join(' > ') + '"');
  if (pert) { linhas.push('"Variancia";"' + fmt(c.critVar) + '"'); linhas.push('"Desvio padrao";"' + fmt(c.sigma) + '"'); }
  baixar(nomeArquivo() + '.csv', '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
}
const nomeArquivo = () => (state.nome || 'projeto').replace(/[^\w\dÀ-ÿ -]/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'projeto';

function svgParaPNG(svgEl, nome) {
  if (!svgEl) return;
  const s = new XMLSerializer().serializeToString(svgEl);
  const escala = 2;
  const w = svgEl.viewBox.baseVal.width || svgEl.width.baseVal.value;
  const h = svgEl.viewBox.baseVal.height || svgEl.height.baseVal.value;
  const img = new Image();
  const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(s);
  img.onload = () => {
    const cv = document.createElement('canvas');
    cv.width = w * escala; cv.height = h * escala;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = CORES.card; ctx.fillRect(0, 0, cv.width, cv.height);
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
  img.src = url;
}

/* ============================================================
   PROJETOS SALVOS / JSON / EXEMPLOS
   ============================================================ */
const CHAVE = 'pertcpm.geo.projetos';
const lerProjetos = () => { try { return JSON.parse(localStorage.getItem(CHAVE) || '[]'); } catch (e) { return []; } };
const gravarProjetos = l => { try { localStorage.setItem(CHAVE, JSON.stringify(l)); } catch (e) { alerta('Não consegui salvar (armazenamento do navegador indisponível).'); } };

function salvarProjeto() {
  state.nome = $('#projName').value.trim() || 'Sem nome';
  const l = lerProjetos();
  const i = l.findIndex(p => p.nome === state.nome);
  const reg = JSON.parse(JSON.stringify(state)); reg.quando = Date.now();
  if (i >= 0) l[i] = reg; else l.unshift(reg);
  gravarProjetos(l);
  toast('Projeto “' + state.nome + '” salvo neste aparelho.');
}

function dlgProjetos() {
  const l = lerProjetos();
  abrirDlg('Meus projetos',
    (l.length ? l.map((p, i) =>
      '<div class="list-item"><div class="t"><b>' + esc(p.nome) + '</b><span>' + p.acts.length + ' atividades · ' + (p.modo === 'pert' ? 'PERT' : 'CPM') + ' · ' + new Date(p.quando || Date.now()).toLocaleDateString('pt-BR') + '</span></div>' +
      '<button class="btn sm" data-abrir="' + i + '">Abrir</button><button class="btn sm danger" data-apagar="' + i + '">Apagar</button></div>').join('')
      : '<p class="hint">Nenhum projeto salvo ainda. Use o botão <b>Salvar</b> no topo.</p>'),
    [['Exportar JSON', () => baixar(nomeArquivo() + '.json', JSON.stringify(state, null, 2), 'application/json')],
    ['Importar JSON', importarJSON],
    ['Fechar', () => $('#dlg').close(), true]]);
  $('#dlgCorpo').onclick = e => {
    const ab = e.target.getAttribute('data-abrir'), ap = e.target.getAttribute('data-apagar');
    if (ab !== null) { const l2 = lerProjetos(); carregar(l2[+ab]); $('#dlg').close(); }
    if (ap !== null) { const l2 = lerProjetos(); l2.splice(+ap, 1); gravarProjetos(l2); dlgProjetos(); }
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

const EXEMPLOS = [
  {
    nome: 'Construção de uma casa (CPM · 12 atividades)', modo: 'cpm', unidade: 'd',
    acts: [
      ['A', 'Projeto e licenças', 10, []], ['B', 'Terraplanagem', 4, ['A']], ['C', 'Fundação', 8, ['B']],
      ['D', 'Estrutura', 12, ['C']], ['E', 'Alvenaria', 10, ['D']], ['F', 'Cobertura', 6, ['D']],
      ['G', 'Instalação elétrica', 7, ['E']], ['H', 'Instalação hidráulica', 6, ['E']],
      ['I', 'Esquadrias', 5, ['F', 'E']], ['J', 'Reboco e pintura', 9, ['G', 'H']],
      ['K', 'Piso e acabamento', 8, ['J', 'I']], ['L', 'Limpeza e entrega', 3, ['K']]
    ]
  },
  {
    nome: 'Lançamento de produto (PERT · 3 estimativas)', modo: 'pert', unidade: 's',
    acts: [
      ['A', 'Pesquisa de mercado', [2, 3, 6], []], ['B', 'Conceito do produto', [1, 2, 4], ['A']],
      ['C', 'Protótipo', [3, 5, 10], ['B']], ['D', 'Testes com usuários', [2, 3, 5], ['C']],
      ['E', 'Ajustes de engenharia', [1, 3, 8], ['D']], ['F', 'Plano de marketing', [2, 3, 4], ['B']],
      ['G', 'Produção do lote piloto', [2, 4, 7], ['E']], ['H', 'Treinamento da equipe', [1, 2, 3], ['F']],
      ['I', 'Lançamento', [1, 1, 2], ['G', 'H']]
    ]
  },
  {
    nome: 'Reforma de loja com compressão (crashing)', modo: 'cpm', unidade: 'd', custoDir: 50000, custoInd: 1200,
    acts: [
      ['A', 'Projeto', 6, [], 4, 800], ['B', 'Demolição', 4, ['A'], 2, 500],
      ['C', 'Elétrica e hidráulica', 8, ['B'], 5, 900], ['D', 'Gesso e forro', 6, ['B'], 4, 400],
      ['E', 'Pintura', 5, ['C', 'D'], 3, 300], ['F', 'Mobiliário', 7, ['C'], 4, 1100],
      ['G', 'Vitrine e comunicação', 3, ['E', 'F'], 2, 600]
    ]
  }
];
function dlgExemplos() {
  abrirDlg('Exemplos prontos',
    EXEMPLOS.map((e, i) => '<div class="list-item"><div class="t"><b>' + esc(e.nome) + '</b><span>' + e.acts.length + ' atividades</span></div><button class="btn sm primary" data-ex="' + i + '">Carregar</button></div>').join('') +
    '<p class="hint" style="margin-top:10px">Carregar um exemplo substitui os dados atuais da tela (projetos salvos não são afetados).</p>',
    [['Fechar', () => $('#dlg').close(), true]]);
  $('#dlgCorpo').onclick = e => {
    const i = e.target.getAttribute('data-ex'); if (i === null) return;
    const ex = EXEMPLOS[+i];
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
    carregar(st); $('#dlg').close();
  };
}

function dlgColar() {
  abrirDlg('Colar do Excel ou Google Sheets',
    '<p class="hint">Cole as colunas na ordem <b>código · nome · duração · predecessoras</b> (ou <b>código · nome · o · m · p · predecessoras</b> no modo PERT). Uma atividade por linha, colunas separadas por tabulação, ponto e vírgula ou vírgula.</p>' +
    '<textarea class="ta" id="taColar" placeholder="A&#9;Projeto&#9;10&#9;&#10;B&#9;Fundação&#9;8&#9;A"></textarea>' +
    '<label class="hint"><input type="checkbox" id="chkSubstituir" checked> substituir as atividades atuais</label>',
    [['Importar', () => { colar($('#taColar').value, $('#chkSubstituir').checked); $('#dlg').close(); }, true], ['Cancelar', () => $('#dlg').close()]]);
  setTimeout(() => $('#taColar').focus(), 60);
}
function colar(txt, substituir) {
  const linhas = String(txt).split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  if (!linhas.length) return;
  const novas = [];
  const pert = state.modo === 'pert';
  linhas.forEach((l, i) => {
    const col = l.split(/\t|;|,(?![^(]*\))/).map(s => s.trim());
    if (!col.length || !col[0]) return;
    if (i === 0 && /c[oó]d|atividade|tarefa|dura/i.test(col[0] + col[1])) return; // cabeçalho
    const a = novoAtv(col[0].toUpperCase(), col[1] || '');
    if (pert) { a.o = num(col[2]); a.m = num(col[3]); a.p = num(col[4]); a.preds = (col[5] || '').split(/[ ,;/]+/).map(s => s.trim().toUpperCase()).filter(Boolean); }
    else { a.d = num(col[2]); a.preds = (col[3] || '').split(/[ ,;/]+/).map(s => s.trim().toUpperCase()).filter(Boolean); }
    novas.push(a);
  });
  if (!novas.length) { alerta('Não identifiquei nenhuma atividade no texto colado.'); return; }
  state.acts = substituir ? novas : state.acts.concat(novas);
  renderDados(); renderCrashTabela(); recalcular();
  toast(novas.length + ' atividades importadas.');
}

/* ============================================================
   DIÁLOGOS / TOAST
   ============================================================ */
function abrirDlg(titulo, corpo, botoes) {
  $('#dlgTitulo').textContent = titulo;
  $('#dlgCorpo').innerHTML = corpo;
  $('#dlgCorpo').onclick = null;
  const rod = $('#dlgRodape'); rod.innerHTML = '';
  (botoes || []).forEach(([rot, fn, primario]) => {
    const b = document.createElement('button');
    b.className = 'btn' + (primario ? ' primary' : '') + ' sm';
    b.textContent = rot; b.onclick = fn; rod.appendChild(b);
  });
  if (!$('#dlg').open) $('#dlg').showModal();
}
const alerta = msg => abrirDlg('Atenção', '<p>' + esc(msg) + '</p>', [['Entendi', () => $('#dlg').close(), true]]);
let toastT = null;
function toast(msg) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:22px;transform:translateX(-50%);background:var(--ink);color:var(--card);padding:10px 16px;border-radius:10px;font-size:13.5px;font-weight:600;z-index:99;box-shadow:0 8px 30px rgba(0,0,0,.25);opacity:0;transition:.2s';
    document.body.appendChild(el);
  }
  el.textContent = msg; el.style.opacity = '1';
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = '0'; }, 2600);
}

/* ============================================================
   CICLO PRINCIPAL
   ============================================================ */
function recalcular() {
  calcOut = calcular();
  renderAvisos();
  if (state.modo === 'pert') $$('#tblDados td[data-te]').forEach(td => {
    const a = state.acts[+td.getAttribute('data-te')];
    td.textContent = fmt((num(a.o) + 4 * num(a.m) + num(a.p)) / 6);
  });
  if (calcOut.ciclo || !calcOut.acts.length) {
    ['#stageRede', '#stageGantt'].forEach(s => { $(s).innerHTML = '<p class="hint" style="padding:20px">Sem rede válida para desenhar.</p>'; });
    $('#kpis').innerHTML = ''; $('#tblResult').innerHTML = '';
    return;
  }
  renderResultados(); renderRede(); renderGantt(); renderPert();
}
function carregar(novo) {
  state = Object.assign(estadoVazio(), novo);
  state.acts = (state.acts || []).map(a => Object.assign(novoAtv('A'), a));
  $('#projName').value = state.nome;
  $('#segModo').querySelectorAll('button').forEach(b => b.classList.toggle('on', b.dataset.m === state.modo));
  $('#dtInicio').value = state.inicio || '';
  $('#unidade').value = state.unidade || 'd';
  $('#uteis').value = String(state.uteis || 0);
  $('#custoInd').value = state.custoInd || '';
  $('#custoInd2').value = state.custoInd || '';
  $('#custoDir').value = state.custoDir || '';
  $('#prazoX').value = '';
  renderDados(); renderCrashTabela(); recalcular();
}

function ligar() {
  lerCores();

  // abas
  $('#tabs').addEventListener('click', e => {
    const b = e.target.closest('.tab'); if (!b) return;
    $$('#tabs .tab').forEach(t => t.classList.toggle('on', t === b));
    $$('.panel').forEach(p => p.classList.toggle('on', p.id === 'p-' + b.dataset.p));
    if (b.dataset.p === 'crash') renderCrashTabela();
  });

  // tabela de dados
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
    a[e.target.dataset.cf] = e.target.value;
  });

  $('#btnAdd').onclick = () => { state.acts.push(novoAtv(proxId(state.acts))); renderDados(); recalcular(); };
  $('#btnAdd5').onclick = () => { for (let i = 0; i < 5; i++) state.acts.push(novoAtv(proxId(state.acts))); renderDados(); recalcular(); };
  $('#btnLimpar').onclick = () => abrirDlg('Limpar tudo', '<p>Isso apaga as atividades da tela. Projetos salvos continuam guardados.</p>',
    [['Apagar', () => { carregar(estadoVazio()); $('#dlg').close(); }, true], ['Cancelar', () => $('#dlg').close()]]);
  $('#btnColar').onclick = dlgColar;

  $('#segModo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    state.modo = b.dataset.m;
    $('#segModo').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
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
  $('#custoDir').addEventListener('input', () => { state.custoDir = $('#custoDir').value; });
  $('#custoInd2').addEventListener('input', () => { state.custoInd = $('#custoInd2').value; $('#custoInd').value = state.custoInd; });

  $('#soCriticos').onchange = renderResultados;
  ['gSetas', 'gFolga', 'gTarde'].forEach(id => { $('#' + id).onchange = renderGantt; });
  $('#prazoX').addEventListener('input', renderPert);
  $('#confP').addEventListener('input', renderPert);

  $('#segPasso').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    pararAnimacao(); passo = +b.dataset.s;
    $('#segPasso').querySelectorAll('button').forEach(x => x.classList.toggle('on', x === b));
    renderRede();
  });
  $('#btnPlay').onclick = () => {
    if (animando) { pararAnimacao(); return; }
    let k = 0; $('#btnPlay').textContent = '⏸ Parar';
    const marca = () => $('#segPasso').querySelectorAll('button').forEach(x => x.classList.toggle('on', +x.dataset.s === passo));
    passo = 1; marca(); renderRede();
    animando = setInterval(() => {
      k++;
      if (k > 2) { pararAnimacao(); passo = 0; marca(); renderRede(); return; }
      passo = k + 1; marca(); renderRede();
    }, 2200);
  };
  $('#btnPNGrede').onclick = () => svgParaPNG($('#stageRede svg'), nomeArquivo() + '-rede');
  $('#btnPNGgantt').onclick = () => svgParaPNG($('#stageGantt svg'), nomeArquivo() + '-gantt');
  $('#btnCSV').onclick = exportarCSV;
  $('#btnImprimir').onclick = () => window.print();
  $('#btnCrash').onclick = rodarCrash;

  $('#projName').addEventListener('input', () => { state.nome = $('#projName').value; });
  $('#btnSalvar').onclick = salvarProjeto;
  $('#btnProjetos').onclick = dlgProjetos;
  $('#btnExemplos').onclick = dlgExemplos;
  $('#btnTema').onclick = () => {
    const atual = document.documentElement.getAttribute('data-theme');
    const escuro = atual ? atual === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
    document.documentElement.setAttribute('data-theme', escuro ? 'light' : 'dark');
    try { localStorage.setItem('pertcpm.tema', escuro ? 'light' : 'dark'); } catch (e) { }
    lerCores(); renderRede(); renderGantt(); renderPert();
  };
  matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { lerCores(); recalcular(); });

  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); salvarProjeto(); }
  });
}
function pararAnimacao() { if (animando) { clearInterval(animando); animando = null; } $('#btnPlay').textContent = '▶ Animar'; }

/* ---------- arranque ---------- */
(function () {
  try { const t = localStorage.getItem('pertcpm.tema'); if (t) document.documentElement.setAttribute('data-theme', t); } catch (e) { }
  ligar();
  let inicial = null;
  try { const u = localStorage.getItem('pertcpm.ultimo'); if (u) inicial = JSON.parse(u); } catch (e) { }
  carregar(inicial || estadoVazio());
  addEventListener('beforeunload', () => { try { localStorage.setItem('pertcpm.ultimo', JSON.stringify(state)); } catch (e) { } });
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
