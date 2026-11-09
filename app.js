/* ============================================================
   Calculadora PERT/CPM — @LMVN 2026
   Roda inteira no navegador, sem dependência externa.
   ============================================================ */
'use strict';

const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
/* Lê número no formato brasileiro: "12.000" = doze mil, "1.200,50" = 1200,5, "R$ 1.500" = 1500.
   Antes, "12.000" virava 12 — justo o formato em que a própria calculadora exibe os custos. */
const num = v => {
  let t = String(v == null ? '' : v).trim().replace(/R\$|\s/g, '');
  if (t.indexOf(',') >= 0) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^-?\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  const n = parseFloat(t); return isFinite(n) ? n : 0;
};
const CASAS = 2;
const r2 = x => Math.round(x * Math.pow(10, CASAS)) / Math.pow(10, CASAS);
const fmt = x => { if (!isFinite(x)) return '—'; const v = r2(x); return (Math.abs(v - Math.round(v)) < 1e-9 ? String(Math.round(v)) : v.toFixed(CASAS).replace('.', ',')); };
const money = x => (isFinite(x) ? x.toLocaleString('pt-BR', { maximumFractionDigits: 2 }) : '—');
const EPS = 1e-9;
const TETO_CAMINHOS = 300;
const TETO_PASSOS = 5000;   /* trava de segurança; na prática a compressão para quando não há mais o que comprimir */
const MAX_ATIV = 500;       /* acima disso o recálculo a cada tecla fica lento */
const cabeMais = n => { if (state.acts.length + n <= MAX_ATIV) return true; alerta('O limite é de ' + MAX_ATIV + ' atividades por projeto (hoje: ' + state.acts.length + ').'); return false; };
const TETO_COMBOS = 4000;

/* ---------- estado ---------- */
const novoAtv = (id, nome) => ({ id, nome: nome || '', d: 1, o: 1, m: 1, p: 1, preds: [], dmin: '', cc: '' });
let state = null, calcOut = null, passo = 3, animando = null;
let redeLarg = 0;
let zoomRede = (typeof innerWidth === 'number' && innerWidth < 700) ? 1.1 : 1.4;   /* o diagrama aparece maior; A− e A+ ajustam */

function estadoVazio() {
  return {
    nome: 'Novo projeto', modo: 'cpm', inicio: '', unidade: 'd', uteis: 0,
    custoInd: '', custoDir: '', prazoAlvo: '',
    notacao: 'disc', recModo: 'alisar', recLim: '', recLim2: '', recLim3: '', recRegra: 'folga', recNomes: ['', '', ''],
    statusT: '', marcos: [], baseline: null, ccCorte: 50, ccMetodo: 'metade', ccAvanco: '', ccConsumo: '', mcDist: 'beta',
    aba: 'inicio', soCriticos: false, gFolga: true, gTarde: false, gSetas: true,
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

/* Notação das datas. O padrão é o da disciplina (PDI/PDT/UDI/UDT, como no deck de aula);
   a internacional (ES/EF/LS/LF) fica à escolha. Também evita a colisão de "ES", que na
   disciplina é estoque de segurança (MRP). O motor continua usando ES/EF/LS/LF por dentro. */
const SIGLAS = { disc: { ES: 'PDI', EF: 'PDT', LS: 'UDI', LF: 'UDT' }, intl: { ES: 'ES', EF: 'EF', LS: 'LS', LF: 'LF' } };
const NOMES = { disc: { ES: 'primeira data de início', EF: 'primeira data de término', LS: 'última data de início', LF: 'última data de término' }, intl: { ES: 'início mais cedo', EF: 'término mais cedo', LS: 'início mais tarde', LF: 'término mais tarde' } };
const NOMES_ART = { disc: { ES: 'a primeira data de início', EF: 'a primeira data de término', LS: 'a última data de início', LF: 'a última data de término' }, intl: { ES: 'o início mais cedo', EF: 'o término mais cedo', LS: 'o início mais tarde', LF: 'o término mais tarde' } };
const sg = k => (SIGLAS[state && state.notacao] || SIGLAS.disc)[k];
const sgNome = k => (NOMES[state && state.notacao] || NOMES.disc)[k];
const sgArt = k => (NOMES_ART[state && state.notacao] || NOMES_ART.disc)[k];
function aplicaNotacao() {
  $$('.sg').forEach(e => { e.textContent = sg(e.dataset.s); });
  $$('.sgn').forEach(e => { e.textContent = sgNome(e.dataset.s); });
  $$('.sga').forEach(e => { e.textContent = sgArt(e.dataset.s); });
  const l = $('#legendaRes');
  if (l) l.textContent = ['ES', 'EF', 'LS', 'LF'].map(k => sg(k) + ' = ' + sgNome(k)).join(' · ') + ' · FT = folga total · FL = folga livre.';
}

/* ============================================================
   MOTOR DE CÁLCULO
   ============================================================ */
const REL0 = { t: 'TI', lag: 0 };
function leRel(a, p) {
  const r = a.rel && Object.prototype.hasOwnProperty.call(a.rel, p) ? a.rel[p] : null;
  if (!r) return REL0;
  const t = REL_ALIAS[String(r.t).toUpperCase()], lag = Number(r.lag);
  return { t: t || 'TI', lag: isFinite(lag) && Math.abs(lag) <= 1e6 ? lag : 0 };
}
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
  /* Linha com dados mas sem código não entra no cálculo: antes sumia em silêncio e o resumo mudava sem explicação. */
  const linhaTemDados = x => String(x.nome || '').trim() !== '' || (x.preds || []).length > 0 ||
    (state.modo === 'pert' ? !(num(x.o) === 1 && num(x.m) === 1 && num(x.p) === 1) : (String(x.d).trim() !== '' && num(x.d) !== 1));
  state.acts.forEach((x, i) => { if (String(x.id).trim() === '' && linhaTemDados(x)) erros.push('A linha ' + (i + 1) + ' tem dados mas não tem código, então não entra no cálculo. Dê um código a ela (A, B, C…) ou apague a linha.'); });
  const mapa = new Map();
  acts.forEach(a => {
    const id = String(a.id).trim().toUpperCase();
    if (!/^[A-Z0-9_-]+$/.test(id)) erros.push('Código <b>' + esc(id) + '</b> inválido: use só letras, números, - ou _ (sem espaço, vírgula ou ponto e vírgula).');
    if (mapa.has(id)) erros.push('Código repetido: <b>' + esc(id) + '</b>. Cada atividade precisa de um código único: troque um dos dois.');
    else mapa.set(id, a);
  });
  if (!acts.length) return { vazio: true, erros, avisos, acts: [], caminhos: [], caminhosCriticos: [], criticas: [], critSeq: [], dur: 0 };

  const N = new Map();
  for (const [id, a] of mapa) {
    const preds = (a.preds || []).map(p => String(p).trim().toUpperCase()).filter(Boolean);
    const ok = [], relMap = new Map();
    preds.forEach(p => {
      if (p === id) erros.push('<b>' + esc(id) + '</b> não pode ser predecessora de si mesma. Tire ' + esc(id) + ' da lista de predecessoras de ' + esc(id) + '.');
      else if (!mapa.has(p)) erros.push('<b>' + esc(id) + '</b> depende de <b>' + esc(p) + '</b>, mas não existe atividade com esse código. Códigos existentes: ' + Array.from(mapa.keys()).map(esc).join(', ') + '. Corrija a predecessora de ' + esc(id) + ' ou crie a atividade ' + esc(p) + '.');
      else if (ok.indexOf(p) < 0) { ok.push(p); relMap.set(p, leRel(a, p)); }
    });
    if (state.modo === 'pert' && num(a.p) < num(a.o)) erros.push('Em <b>' + esc(id) + '</b>, o tempo pessimista é menor que o otimista. A ordem esperada é o ≤ m ≤ p.');
    else if (state.modo === 'pert' && (num(a.m) < num(a.o) || num(a.m) > num(a.p))) erros.push('Em <b>' + esc(id) + '</b>, o mais provável (m) precisa ficar entre o otimista (o) e o pessimista (p): o ≤ m ≤ p.');
    const ehNumero = v => /^\s*[-+]?(R\$)?\s*\d[\d.,]*\s*$/.test(String(v == null ? '' : v)) || /^\s*[-+]?[.,]\d+\s*$/.test(String(v));
    if (state.modo === 'pert') {
      [['o', 'otimista'], ['m', 'mais provável'], ['p', 'pessimista']].forEach(par => {
        const v = a[par[0]];
        if (String(v == null ? '' : v).trim() === '') erros.push('O tempo ' + par[1] + ' de <b>' + esc(id) + '</b> está em branco. Preencha o, m e p.');
        else if (!ehNumero(v)) erros.push('O tempo ' + par[1] + ' de <b>' + esc(id) + '</b> não é um número (“' + esc(String(v).slice(0, 12)) + '”). Use só algarismos, por exemplo 4 ou 2,5.');
      });
    } else if (!(durOverride && durOverride.has(id))) {
      if (String(a.d == null ? '' : a.d).trim() === '') erros.push('A duração de <b>' + esc(id) + '</b> está em branco. Informe um número (0 ou mais).');
      else if (!ehNumero(a.d)) erros.push('A duração de <b>' + esc(id) + '</b> não é um número (“' + esc(String(a.d).slice(0, 12)) + '”). Use só algarismos, por exemplo 4 ou 2,5.');
    }
    const d = durOverride && durOverride.has(id) ? durOverride.get(id) : durDe(a);
    if (d < 0) erros.push('Duração negativa em <b>' + esc(id) + '</b>. Use um valor igual ou maior que zero.');
    N.set(id, { id, nome: a.nome || '', dur: d, varia: varDe(a), preds: ok, rel: relMap, succs: [], ref: a });
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
    /* Sobram o ciclo e o que depende dele; descarta quem só está "a jusante" do ciclo
       (não tem sucessora entre as que sobraram) para nomear apenas as atividades em ciclo. */
    const resto = new Set(Array.from(N.keys()).filter(id => ordem.indexOf(id) < 0));
    for (let mudou = true; mudou;) { mudou = false; resto.forEach(id => { if (!N.get(id).succs.some(x => resto.has(x))) { resto.delete(id); mudou = true; } }); }
    let dica = '';
    for (const id of resto) { const p = N.get(id).preds.find(x => resto.has(x)); if (p) { dica = ' Para desfazer, tire ' + esc(p) + ' das predecessoras de ' + esc(id) + ' (ou revise essa ligação).'; break; } }
    erros.push('Há dependência circular entre: <b>' + Array.from(resto).map(esc).join(', ') + '</b>. A rede precisa fluir só para a frente.' + dica);
    return { erros, avisos, acts: [], caminhos: [], caminhosCriticos: [], criticas: [], critSeq: [], dur: 0, ciclo: true };
  }

  /* Cada ligação p → s vira uma restrição ES(s) ≥ ES(p) + w. Com término-início sem atraso, w = duração de p
     (o cálculo clássico). II: w = atraso. TT: w = dur(p) + atraso − dur(s). IT: w = atraso − dur(s). */
  const peso = (p, s) => {
    const r = s.rel.get(p.id) || REL0;
    switch (r.t) {
      case 'II': return r.lag;
      case 'TT': return p.dur + r.lag - s.dur;
      case 'IT': return r.lag - s.dur;
      default: return p.dur + r.lag;
    }
  };
  const aperta = (pid, sid) => { const p = N.get(pid), s = N.get(sid); return Math.abs(s.ES - p.ES - peso(p, s)) < EPS; };
  ordem.forEach(id => {
    const n = N.get(id);
    n.ES = Math.max.apply(null, [0].concat(n.preds.map(p => N.get(p).ES + peso(N.get(p), n))));
    n.EF = n.ES + n.dur;
  });
  const dur = N.size ? Math.max.apply(null, Array.from(N.values()).map(n => n.EF)) : 0;

  for (let i = ordem.length - 1; i >= 0; i--) {
    const n = N.get(ordem[i]);
    n.LS = Math.min.apply(null, [dur - n.dur].concat(n.succs.map(s => N.get(s).LS - peso(n, N.get(s)))));
    n.LF = n.LS + n.dur;
  }
  N.forEach(n => {
    n.FT = n.LS - n.ES;
    n.FL = Math.min.apply(null, [dur - n.EF].concat(n.succs.map(s => N.get(s).ES - n.ES - peso(n, N.get(s)))));
    n.crit = Math.abs(n.FT) < EPS;
  });
  const temRelEsp = Array.from(N.values()).some(n => Array.from(n.rel.values()).some(r => r.t !== 'TI'));
  const temAtraso = Array.from(N.values()).some(n => Array.from(n.rel.values()).some(r => r.lag));

  const iniciais = ordem.filter(id => !N.get(id).preds.length);
  const finais = ordem.filter(id => !N.get(id).succs.length);
  const algumaLigacao = Array.from(N.values()).some(n => n.preds.length);   /* sem ligação nenhuma, o aluno ainda nem começou: sem aviso */
  if (algumaLigacao && finais.length > 1) avisos.push('Há ' + finais.length + ' atividades sem sucessora (' + finais.join(', ') + '). Todas encerram o projeto — se não for isso, ligue-as a uma atividade final.');
  if (algumaLigacao && iniciais.length > 1) avisos.push('Há ' + iniciais.length + ' atividades sem predecessora (' + iniciais.join(', ') + '). Todas começam no instante zero.');

  /* Subgrafo crítico: só as atividades sem folga e as ligações em que uma começa
     exatamente quando a outra termina. É por ele — e não pela lista geral de caminhos,
     que tem teto — que se acha o caminho crítico, o sigma e a compressão. Toda atividade
     crítica que não é a última tem uma sucessora crítica começando no seu EF, então a
     busca sempre chega ao fim. */
  const critSucc = id => N.get(id).succs.filter(s => N.get(s).crit && aperta(id, s));
  const caminhosCriticos = []; let critEstourou = false;
  const dfsC = (id, acum, soma, vari) => {
    if (caminhosCriticos.length >= TETO_CAMINHOS) { critEstourou = true; return; }
    const n = N.get(id); acum.push(id); vari += n.varia;
    const cs = critSucc(id);
    if (!cs.length) caminhosCriticos.push({ ids: acum.slice(), dur: soma + n.dur, varia: vari, crit: true });
    else cs.forEach(s => dfsC(s, acum, soma + peso(n, N.get(s)), vari));
    acum.pop();
  };
  ordem.filter(id => N.get(id).crit && !N.get(id).preds.some(p => N.get(p).crit && aperta(p, id))).forEach(id => dfsC(id, [], 0, 0));

  /* Caminho crítico de maior variância (é dele que sai o sigma), por programação
     dinâmica: exato mesmo que existam milhares de caminhos críticos. */
  let critVar = 0, critSeq = [];
  {
    const melhor = new Map(), veio = new Map();
    ordem.forEach(id => {
      const n = N.get(id); if (!n.crit) return;
      let b = 0, de = null;
      n.preds.forEach(p => {
        const pn = N.get(p);
        if (pn.crit && aperta(p, id) && melhor.has(p) && (de === null || melhor.get(p) > b)) { b = melhor.get(p); de = p; }
      });
      melhor.set(id, b + n.varia); veio.set(id, de);
    });
    let ult = null;
    melhor.forEach((v, id) => { if (!critSucc(id).length && (ult === null || v > melhor.get(ult))) ult = id; });
    if (ult !== null) { critVar = melhor.get(ult); for (let cur = ult; cur; cur = veio.get(cur)) critSeq.unshift(cur); }
  }

  /* Lista geral de caminhos (para exibir), com teto. Os críticos entram sempre,
     mesmo que o teto tenha cortado a busca antes de chegar neles. */
  const caminhos = []; let estourou = false;
  const dfs = (id, acum, soma, vari) => {
    if (caminhos.length >= TETO_CAMINHOS) { estourou = true; return; }
    const n = N.get(id); acum.push(id); vari += n.varia;
    if (!n.succs.length) caminhos.push({ ids: acum.slice(), dur: soma + n.dur, varia: vari, crit: Math.abs(soma + n.dur - dur) < EPS });
    else n.succs.forEach(s => dfs(s, acum, soma + peso(n, N.get(s)), vari));
    acum.pop();
  };
  iniciais.forEach(id => dfs(id, [], 0, 0));
  const jaTem = new Set(caminhos.map(p => p.ids.join('>')));
  caminhosCriticos.forEach(p => { if (!jaTem.has(p.ids.join('>'))) caminhos.push(p); });
  caminhos.sort((a, b) => b.dur - a.dur);
  if (estourou) avisos.push('A rede tem mais de ' + TETO_CAMINHOS + ' caminhos; a lista mostra uma amostra deles. Os caminhos críticos aparecem sempre.');
  if (critEstourou) avisos.push('Há mais de ' + TETO_CAMINHOS + ' caminhos críticos; mostrando ' + TETO_CAMINHOS + '.');

  const lista = ordem.map(id => N.get(id));
  return {
    erros, avisos, dur, N, ordem, acts: lista, caminhos, caminhosCriticos, iniciais, finais, peso, aperta, temRelEsp, temAtraso,
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
/* Convenção: o período k (0 = primeiro) é um dia, semana ou mês do calendário. Uma atividade
   com ES = 0 e EF = 5 ocupa os períodos 0 a 4: começa no 1º e TERMINA no 5º — não no 6º.
   Antes, o término mostrava o dia seguinte ao fim (no 5/7, uma sexta virava segunda). */
const diaUtil = d => d.getDay() !== 0 && d.getDay() !== 6;
function baseData() {
  if (!state.inicio) return null;
  const b = new Date(state.inicio + 'T12:00:00');
  return isNaN(b.getTime()) ? null : b;
}
function somaMeses(d, k) {
  const x = new Date(d.getTime()), dia = x.getDate();
  x.setDate(1); x.setMonth(x.getMonth() + k);
  x.setDate(Math.min(dia, new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate()));   /* 31/01 + 1 mês = 28/02 */
  return x;
}
/* Primeiro dia de calendário do período k. No 5/7, começa no primeiro dia útil a partir do início. */
function diaDoPeriodo(k) {
  const b = baseData(); if (!b) return null;
  if (state.unidade === 'm') return somaMeses(b, k);
  const d = new Date(b.getTime());
  if (state.unidade === 's') { d.setDate(d.getDate() + 7 * k); return d; }
  if (!Number(state.uteis)) { d.setDate(d.getDate() + k); return d; }
  while (!diaUtil(d)) d.setDate(d.getDate() + 1);
  for (let falta = k, g = 0; falta > 0 && g < 20000; g++) { d.setDate(d.getDate() + 1); if (diaUtil(d)) falta--; }
  return d;
}
const dataInicio = es => diaDoPeriodo(Math.max(0, Math.floor(es + 1e-9)));
function dataFim(ef) {
  const b = baseData(); if (!b) return null;
  if (ef <= 1e-9) return dataInicio(0);
  const k = Math.ceil(ef - 1e-9);                     /* períodos ocupados */
  if (state.unidade === 'm') { const d = somaMeses(b, k); d.setDate(d.getDate() - 1); return d; }
  if (state.unidade === 's') { const d = new Date(b.getTime()); d.setDate(d.getDate() + 7 * k - 1); return d; }
  return diaDoPeriodo(k - 1);                         /* último dia trabalhado */
}
const dataDe = dataInicio;
const fmtData = d => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
const rotuloData = i => { const d = dataInicio(i); return d ? fmtData(d) : fmt(i); };
function faixaDatas(n) {
  const a = dataInicio(n.ES); if (!a) return '';
  return n.dur <= EPS ? fmtData(a) : fmtData(a) + '–' + fmtData(dataFim(n.EF));
}

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
  let h = '<thead><tr><th class="w-cod">Código</th><th>Atividade</th>';
  h += pert
    ? '<th class="w-num">o</th><th class="w-num">m</th><th class="w-num">p</th><th class="w-num">te</th>'
    : '<th class="w-dur">Duração</th>';
  h += '<th title="Atividades que precisam terminar antes desta. Com mais de uma, separe por vírgula: A, B">Predecessoras</th><th class="w-x noprint"></th></tr></thead><tbody>';
  state.acts.forEach((a, i) => {
    h += '<tr data-i="' + i + '">';
    h += '<td><input class="cod" data-f="id" value="' + esc(a.id) + '" maxlength="6" aria-label="Código"></td>';
    h += '<td><input data-f="nome" value="' + esc(a.nome) + '" maxlength="120" placeholder="descrição" aria-label="Atividade" style="font-family:var(--texto)"></td>';
    if (pert) {
      h += '<td><input data-f="o" inputmode="decimal" value="' + esc(a.o) + '" aria-label="Otimista"></td>';
      h += '<td><input data-f="m" inputmode="decimal" value="' + esc(a.m) + '" aria-label="Mais provável"></td>';
      h += '<td><input data-f="p" inputmode="decimal" value="' + esc(a.p) + '" aria-label="Pessimista"></td>';
      h += '<td class="te" data-te="' + i + '">' + fmt((num(a.o) + 4 * num(a.m) + num(a.p)) / 6) + '</td>';
    } else {
      h += '<td><input data-f="d" inputmode="decimal" value="' + esc(a.d) + '" aria-label="Duração"></td>';
    }
    h += '<td><input class="pred" data-f="preds" value="' + esc(textoPreds(a)) + '" placeholder="ex.: A, B ou A(II+2)" title="Atividades que precisam terminar antes desta, separadas por vírgula. Em branco = esta atividade começa o projeto. Relação diferente de término-início: A(II), A(TT), A(IT); com atraso: A(II+2), A(+1)." aria-label="Predecessoras"></td>';
    h += '<td class="noprint"><button class="remover" data-del="' + i + '" title="Remover" aria-label="Remover">×</button></td></tr>';
  });
  t.innerHTML = h + '</tbody>';
}

/* Lê o texto de predecessoras e devolve a lista de códigos. Vírgula, ponto e vírgula e espaço
   separam. Traço (-, – ou —), barra, "+" e "&" também são aceitos como separador: quem escreve
   "A-B" quer dizer "A, B". Exceção: se o trecho inteiro (ex.: "A-1") é o código de uma
   atividade que existe, ele é mantido. */
const SEP_ALT = /[-–—\/+&]+/;
/* Tipos de relação (PDM): TI término-início (padrão), II início-início, TT término-término, IT início-término.
   Aceita também os nomes em inglês FS, SS, FF, SF. O texto fica "B(II+2)": predecessora B, relação II, atraso de 2. */
const REL_ALIAS = { TI: 'TI', FS: 'TI', II: 'II', SS: 'II', TT: 'TT', FF: 'TT', IT: 'IT', SF: 'IT' };
function parseRel(txt) {
  if (txt == null) return null;
  const m = /^\s*(TI|II|TT|IT|FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+(?:[.,]\d+)?))?\s*$/i.exec(String(txt));
  if (!m) return null;
  let lag = m[3] ? parseFloat(m[3].replace(',', '.')) * (m[2] === '-' ? -1 : 1) : 0;
  if (!isFinite(lag) || Math.abs(lag) > 1e6) lag = 0;
  return { t: m[1] ? REL_ALIAS[m[1].toUpperCase()] : 'TI', lag };
}
function leiaPredsRel(texto, codigos) {
  const preds = [], rel = {};
  const s = String(texto == null ? '' : texto);
  const re = /([^,;\s()]+)\s*(?:\(([^)]*)\))?/g; let m;
  while ((m = re.exec(s))) {
    const t = m[1].trim().toUpperCase(); if (!t) continue;
    const partes = (codigos && codigos.has(t)) ? [t] : t.split(SEP_ALT);
    const sp = parseRel(m[2]);
    partes.forEach((p, k) => {
      p = p.trim(); if (!p) return;
      if (preds.indexOf(p) < 0) preds.push(p);
      if (sp && k === partes.length - 1 && !(sp.t === 'TI' && !sp.lag)) rel[p] = sp;
    });
  }
  return { preds, rel };
}
const leiaPreds = (texto, codigos) => leiaPredsRel(texto, codigos).preds;
function textoPreds(a) {
  return (a.preds || []).map(p => {
    const r = a.rel && Object.prototype.hasOwnProperty.call(a.rel, p) ? a.rel[p] : null;
    if (!r) return p;
    return p + '(' + (r.t === 'TI' ? '' : r.t) + (r.lag ? (r.lag > 0 ? '+' : '-') + String(Math.abs(r.lag)).replace('.', ',') : '') + ')';
  }).join(', ');
}
const codigosAtuais = () => new Set(state.acts.map(x => String(x.id).trim().toUpperCase()));

function lerCampo(i, f, v) {
  const a = state.acts[i]; if (!a) return;
  if (f === 'preds') { const r = leiaPredsRel(v, codigosAtuais()); a.preds = r.preds; a.rel = r.rel; }
  else if (f === 'id') a.id = String(v).trim().toUpperCase();
  else a[f] = v;
}

/* ============================================================
   FAIXA DE RESUMO E AVISOS
   ============================================================ */
function renderResumo() {
  const c = calcOut;
  const vazio = !c.acts || !c.acts.length;
  const poe = (sel, txt) => { const el = $(sel); if (el.textContent !== txt) { el.textContent = txt; el.classList.remove('muda'); void el.offsetWidth; el.classList.add('muda'); } };
  poe('#rDur', vazio ? '—' : fmt(c.dur));
  poe('#rAtiv', vazio ? '—' : String(c.acts.length));
  poe('#rCrit', vazio ? '—' : (c.critSeq.join(' → ') || '—'));
  if (vazio) { $('#rFim').textContent = '—'; return; }
  const d = dataFim(c.dur);
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
function interpResultados(c) {
  const t = fmt(c.dur) + ' ' + uni(c.dur);
  let s = '<b class="t">O que o resultado diz:</b> o projeto dura <b>' + t + '</b>. ';
  const ncp = c.caminhosCriticos.length;
  s += ncp <= 1
    ? 'O caminho crítico é <b>' + c.critSeq.join(' → ') + '</b>: atraso em qualquer uma dessas atividades atrasa o projeto inteiro. '
    : 'Há <b>' + ncp + ' caminhos críticos</b> (um deles: ' + c.critSeq.join(' → ') + '): atraso em qualquer atividade crítica atrasa o projeto inteiro. ';
  const folgas = c.acts.filter(n => !n.crit);
  if (!folgas.length) return s + 'Todas as atividades são críticas: nenhuma tem folga.';
  const lista = folgas.slice(0, 5).map(n => '<b>' + esc(n.id) + '</b> (' + fmt(n.FT) + ')').join(', ');
  return s + 'Têm folga: ' + lista + (folgas.length > 5 ? ' e mais ' + (folgas.length - 5) : '') + '. Cada uma pode atrasar até esse valor sem afetar o prazo, mas a folga é compartilhada entre as atividades de um mesmo caminho: se uma usa a folga, a outra perde.';
}

function renderResultados() {
  const c = calcOut;
  if (!c.acts.length) { $('#tblResult').innerHTML = ''; $('#interpRes').innerHTML = ''; $('#listaCaminhos').innerHTML = '<p class="hint">Sem atividades válidas.</p>'; return; }
  let h = '<thead><tr><th>Atividade</th><th class="dir">Dur.</th><th class="dir">' + sg('ES') + '</th><th class="dir">' + sg('EF') + '</th><th class="dir">' + sg('LS') + '</th><th class="dir">' + sg('LF') + '</th><th class="dir">FT</th><th class="dir">FL</th><th>Situação</th></tr></thead><tbody>';
  c.acts.forEach(n => {
    h += '<tr class="' + (n.crit ? 'crit' : '') + ' clicavel" data-id="' + esc(n.id) + '" title="Clique para ver como estes números foram calculados">';
    h += '<td class="cod"><b>' + esc(n.id) + '</b>' + (n.nome ? ' <span class="txt" style="color:var(--apagado)">' + esc(n.nome) + '</span>' : '') + '</td>';
    h += '<td class="dir">' + fmt(n.dur) + '</td><td class="dir">' + fmt(n.ES) + '</td><td class="dir">' + fmt(n.EF) + '</td>';
    h += '<td class="dir">' + fmt(n.LS) + '</td><td class="dir">' + fmt(n.LF) + '</td>';
    h += '<td class="dir ft"><b>' + fmt(n.FT) + '</b></td><td class="dir">' + fmt(n.FL) + '</td>';
    h += '<td class="sit txt">' + (n.crit ? 'Crítica' : 'Folga de ' + fmt(n.FT)) + '</td></tr>';
  });
  $('#tblResult').innerHTML = h + '</tbody>';
  $('#interpRes').innerHTML = interpResultados(c);

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

  const NL = 176, NA = 88, GX = 64, GY = 26, PAD = 30, WF = 96, HF = 54, HP = 10;
  /* nível = 1 + maior nível das predecessoras */
  const nivel = new Map([['__ini', 0]]);
  c.acts.forEach(n => nivel.set(n.id, n.preds.length ? 1 + Math.max.apply(null, n.preds.map(p => nivel.get(p))) : 1));
  const maxC = Math.max.apply(null, c.acts.map(n => nivel.get(n.id)));
  nivel.set('__fim', maxC + 1);

  const arestas = [];
  c.acts.forEach(n => {
    n.preds.forEach(p => { const np = c.N.get(p); const r = n.rel.get(p), cr = n.crit && np.crit && c.aperta(p, n.id); arestas.push({ de: p, para: n.id, crit: cr, tip: tipLigacao(p, n.id, r || REL0, cr), fantasma: false, rot: r && (r.t !== 'TI' || r.lag) ? (r.t === 'TI' ? '' : r.t) + (r.lag ? (r.lag > 0 ? '+' : '-') + Math.abs(r.lag) : '') : '' }); });
    if (!n.preds.length) arestas.push({ de: '__ini', para: n.id, crit: n.crit, fantasma: true });
    if (!n.succs.length) arestas.push({ de: n.id, para: '__fim', crit: n.crit, fantasma: true });
  });

  /* Seta que pula colunas ganha um ponto de passagem em cada coluna do meio, com lugar
     próprio entre as caixas — antes ela passava por trás das caixas e parecia ligar
     atividades que não têm relação nenhuma. */
  const cols = []; for (let i = 0; i <= maxC + 1; i++) cols.push([]);
  cols[0].push('__ini'); cols[maxC + 1].push('__fim');
  c.acts.forEach(n => cols[nivel.get(n.id)].push(n.id));
  const cima = new Map(), baixo = new Map();
  const add = (m, a, b) => { if (!m.has(a)) m.set(a, []); m.get(a).push(b); };
  arestas.forEach((ar, k) => {
    ar.cadeia = [ar.de];
    for (let L = nivel.get(ar.de) + 1; L < nivel.get(ar.para); L++) { const pid = '~' + k + '~' + L; cols[L].push(pid); ar.cadeia.push(pid); }
    ar.cadeia.push(ar.para);
    for (let i = 0; i + 1 < ar.cadeia.length; i++) { add(baixo, ar.cadeia[i], ar.cadeia[i + 1]); add(cima, ar.cadeia[i + 1], ar.cadeia[i]); }
  });
  /* menos cruzamentos: cada coluna ordenada pela posição média dos vizinhos (empate mantém a ordem digitada) */
  const ordem = new Map(); cols.forEach(col => col.forEach((id, i) => ordem.set(id, i)));
  const ordena = (k, viz) => {
    const bar = id => { const v = viz.get(id) || []; return v.length ? v.reduce((t, x) => t + ordem.get(x), 0) / v.length : ordem.get(id); };
    cols[k] = cols[k].map((id, i) => ({ id, b: bar(id), i })).sort((a, b) => a.b - b.b || a.i - b.i).map(o => o.id);
    cols[k].forEach((id, i) => ordem.set(id, i));
  };
  for (let volta = 0; volta < 2; volta++) { for (let k = 1; k <= maxC; k++) ordena(k, cima); for (let k = maxC; k >= 1; k--) ordena(k, baixo); }

  const alt = id => (id === '__ini' || id === '__fim') ? HF : (id.charAt(0) === '~' ? HP : NA);
  const hCol = col => col.reduce((t, id) => t + alt(id), 0) + GY * Math.max(0, col.length - 1);
  const altura = PAD * 2 + Math.max.apply(null, cols.map(hCol));
  const larg = PAD * 2 + WF * 2 + GX * 2 + maxC * (NL + GX) - GX;
  redeLarg = larg;
  const pos = new Map(); let x = PAD;
  cols.forEach((col, k) => {
    const w = (k === 0 || k === maxC + 1) ? WF : NL;
    let y = (altura - hCol(col)) / 2;
    col.forEach(id => { pos.set(id, { x, y, w, h: alt(id) }); y += alt(id) + GY; });
    x += w + GX;
  });

  const mostraF = passo >= 1, mostraB = passo >= 2, mostraS = passo >= 3;
  const curva = (x1, y1, x2, y2) => ' C' + (x1 + 40) + ',' + y1 + ' ' + (x2 - 40) + ',' + y2 + ' ' + x2 + ',' + y2;
  const desenhaAresta = ar => {
    const cor = ar.fantasma ? C.fantasmaBorda : (ar.crit ? C.critico : C.aresta);
    const a = pos.get(ar.cadeia[0]);
    let x1 = a.x + a.w, y1 = a.y + a.h / 2, d = 'M' + x1 + ',' + y1;
    for (let i = 1; i < ar.cadeia.length; i++) {
      const b = pos.get(ar.cadeia[i]), yb = b.y + b.h / 2, ultimo = i === ar.cadeia.length - 1;
      d += curva(x1, y1, ultimo ? b.x - 2 : b.x, yb);
      if (!ultimo) { d += ' L' + (b.x + b.w) + ',' + yb; x1 = b.x + b.w; y1 = yb; }
    }
    const ult = pos.get(ar.cadeia[ar.cadeia.length - 1]);
    const rot = ar.rot ? '<text x="' + (ult.x - 8) + '" y="' + (ult.y + ult.h / 2 - 7) + '" text-anchor="end" font-family="IBM Plex Mono, monospace" font-size="12" font-weight="600" fill="' + cor + '" stroke="' + C.sup + '" stroke-width="3" paint-order="stroke">' + esc(ar.rot) + '</text>' : '';
    return '<path d="' + d + '" fill="none" stroke="' + cor + '" stroke-width="' + (ar.crit ? 2.2 : 1.3) + '"' + (ar.fantasma ? ' stroke-dasharray="5 4"' : '') + ' marker-end="url(#' + (ar.fantasma ? 'arf' : (ar.crit ? 'arc' : 'ar')) + ')"/>' + rot +
      (ar.tip ? '<path d="' + d + '" fill="none" stroke="transparent" stroke-width="14" data-tip="' + esc(ar.tip) + '"/>' : '');
  };

  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(larg * zoomRede * (document.body.classList.contains('projetor') ? 1.35 : 1)) + '" height="' + Math.round(altura * zoomRede * (document.body.classList.contains('projetor') ? 1.35 : 1)) + '" viewBox="0 0 ' + Math.round(larg) + ' ' + Math.round(altura) + '" font-family="IBM Plex Sans, sans-serif">';
  s += '<defs>';
  [['ar', C.aresta], ['arc', C.critico], ['arf', C.fantasmaBorda]].forEach(par => {
    s += '<marker id="' + par[0] + '" viewBox="0 0 9 9" refX="8" refY="4.5" markerWidth="9" markerHeight="9" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="' + par[1] + '"/></marker>';
  });
  s += '</defs><rect width="100%" height="100%" fill="' + C.sup + '"/>';
  arestas.filter(a => !a.crit).forEach(a => { s += desenhaAresta(a); });
  arestas.filter(a => a.crit).forEach(a => { s += desenhaAresta(a); });   /* críticas por cima */

  [['__ini', 'INÍCIO'], ['__fim', 'FIM']].forEach(par => {
    const p = pos.get(par[0]);
    s += '<rect data-tip="' + esc(par[0] === '__ini' ? 'INÍCIO: marcador do começo do projeto. As atividades ligadas a ele não têm predecessora e começam no instante zero.' : 'FIM: marcador do término do projeto. As atividades ligadas a ele não têm sucessora; a mais demorada define a duração do projeto.') + '" x="' + p.x + '" y="' + p.y + '" width="' + p.w + '" height="' + p.h + '" rx="4" fill="' + C.fantasmaFundo + '" stroke="' + C.fantasmaBorda + '" stroke-width="1.5" stroke-dasharray="5 4"/>';
    s += '<text x="' + (p.x + p.w / 2) + '" y="' + (p.y + p.h / 2 + 4) + '" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="12" letter-spacing="1.5" fill="' + C.apagado + '">' + par[1] + '</text>';
  });

  const mono = ' font-family="IBM Plex Mono, monospace" font-variant-numeric="tabular-nums"';
  c.acts.forEach(n => {
    const p = pos.get(n.id);
    const corB = n.crit ? C.critico : C.neutro;
    const fundo = n.crit ? C.criticoFundo : '#FFFFFF';
    s += '<g data-id="' + esc(n.id) + '" class="no">';
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
    /* Código e duração precisam caber antes do selo da folga: se não cabem em 19px,
       o código diminui; se nem assim, a duração desce para a linha do nome. */
    const rot = fmt(n.FT), bw = 12 + rot.length * 7, durTxt = '· ' + fmt(n.dur);
    const limite = (mostraS ? p.w - 6 - bw - 6 : p.w - 10) - 14;
    const len = String(n.id).length;
    let fs = 13, cabe = false;
    for (const t of [19, 16, 13]) { if (t * 0.6 * len + 5 + 7.5 * durTxt.length <= limite) { fs = t; cabe = true; break; } }
    const cy = p.y + p.h / 2 + 4;
    s += '<text x="' + (p.x + 14) + '" y="' + cy + '"' + mono + ' font-size="' + fs + '" font-weight="600" fill="' + (n.crit ? C.critico : C.tinta) + '">' + esc(n.id) + '</text>';
    if (cabe) s += '<text x="' + (p.x + 14 + fs * 0.6 * len + 5) + '" y="' + cy + '"' + mono + ' font-size="12.5" fill="' + C.apagado + '">' + esc(durTxt) + '</text>';
    const linha2 = (cabe ? '' : durTxt + '  ') + (n.nome || '');
    if (linha2) {
      const nm = linha2.length > 22 ? linha2.slice(0, 21) + '…' : linha2;
      s += '<text x="' + (p.x + 14) + '" y="' + (cy + 12) + '" font-size="12" fill="' + C.apagadinho + '">' + esc(nm) + '</text>';
    }
    if (mostraS) {
      s += '<rect x="' + (p.x + p.w - 6 - bw) + '" y="' + (p.y + 30) + '" width="' + bw + '" height="17" rx="3" fill="' + (n.crit ? C.critico : C.folgaFundo) + '"/>';
      s += '<text x="' + (p.x + p.w - 6 - bw / 2) + '" y="' + (p.y + 42) + '" text-anchor="middle"' + mono + ' font-size="12" fill="' + (n.crit ? '#FFFFFF' : C.folga) + '">' + rot + '</text>';
    }
    /* explicação curta em cima de cada número: passe o mouse (ou toque) */
    const hit = (hx, hy, hw, hh, txt) => '<rect x="' + hx + '" y="' + hy + '" width="' + hw + '" height="' + hh + '" fill="transparent" data-tip="' + esc(txt) + '"/>';
    const meio = p.w / 2;
    s += hit(p.x, p.y, meio, 24, sg('ES') + ' = ' + fmt(n.ES) + ' · ' + sgNome('ES') + '\n' + 'O mais cedo que ' + n.id + ' pode começar.');
    s += hit(p.x + meio, p.y, meio, 24, sg('EF') + ' = ' + fmt(n.EF) + ' · ' + sgNome('EF') + '\n' + 'O mais cedo que ' + n.id + ' pode terminar (' + sg('ES') + ' + duração).');
    s += hit(p.x, p.y + p.h - 24, meio, 24, sg('LS') + ' = ' + fmt(n.LS) + ' · ' + sgNome('LS') + '\n' + 'O mais tarde que ' + n.id + ' pode começar sem atrasar o projeto.');
    s += hit(p.x + meio, p.y + p.h - 24, meio, 24, sg('LF') + ' = ' + fmt(n.LF) + ' · ' + sgNome('LF') + '\n' + 'O mais tarde que ' + n.id + ' pode terminar sem atrasar o projeto.');
    s += hit(p.x, p.y + 24, p.w - (mostraS ? 12 + rot.length * 7 + 12 : 0), p.h - 48, n.id + (n.nome ? ' · ' + n.nome : '') + '\n' + 'Dura ' + fmt(n.dur) + ' ' + uni(n.dur) + '. ' + (n.preds.length ? 'Depende de ' + n.preds.join(', ') + '.' : 'Começa o projeto.'));
    if (mostraS) s += hit(p.x + p.w - 6 - bw, p.y + 28, bw + 6, 22, n.crit ? 'Folga total 0: atividade crítica.\nUm atraso aqui atrasa o projeto inteiro.' : 'Folga total ' + fmt(n.FT) + ' ' + uni(n.FT) + '.\n' + n.id + ' pode atrasar esse tempo sem atrasar o projeto.');
    s += '</g>';
  });
  s += '</svg>';
  box.innerHTML = s;

  const textos = {
    0: '',
    1: '<div class="nota"><b>Passo 1 · Caminho de ida</b>Da esquerda para a direita: ' + sg('ES') + ' = maior ' + sg('EF') + ' das predecessoras, ' + sg('EF') + ' = ' + sg('ES') + ' + duração. O maior ' + sg('EF') + ' da rede é a duração do projeto (' + fmt(c.dur) + ' ' + uni(c.dur) + ').</div>',
    2: '<div class="nota"><b>Passo 2 · Caminho de volta</b>Da direita para a esquerda: ' + sg('LF') + ' da última = ' + fmt(c.dur) + '; nas demais, ' + sg('LF') + ' = menor ' + sg('LS') + ' das sucessoras e ' + sg('LS') + ' = ' + sg('LF') + ' − duração.</div>',
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
  const LBL = c.acts.some(n => n.nome) ? 215 : 120, GAP = 10, PADR = 34, PADT = 40, RH = 30, PADB = 20;
  const areaW = Math.max(460, Math.min(1400, c.dur * 46 + 40));
  const W = LBL + GAP + areaW + PADR;
  const linhas = c.acts.slice().sort((a, b) => a.ES - b.ES || a.EF - b.EF || a.id.localeCompare(b.id));
  const H = PADT + linhas.length * RH + PADB;
  const x0 = LBL + GAP;
  const sx = v => x0 + (v / (c.dur || 1)) * areaW;
  const yOf = id => PADT + linhas.findIndex(n => n.id === id) * RH + RH / 2;
  const mono = ' font-family="IBM Plex Mono, monospace" font-variant-numeric="tabular-nums"';

  /* passo inteiro e redondo (1, 2, 5, 10...), no máximo 12 marcas: antes saíam 2,08 · 4,17 · 6,25 */
  const passoR = [1, 2, 5, 10, 20, 25, 50, 100, 200, 500, 1000].find(p => c.dur / p <= 12) || Math.ceil(c.dur / 12);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W) + '" height="' + Math.round(H) + '" viewBox="0 0 ' + Math.round(W) + ' ' + Math.round(H) + '" font-family="IBM Plex Sans, sans-serif">';
  s += '<defs><marker id="gs" viewBox="0 0 9 9" refX="8" refY="4.5" markerWidth="7" markerHeight="7" orient="auto"><path d="M0,0 L9,4.5 L0,9 z" fill="' + C.aresta + '"/></marker></defs>';
  s += '<rect width="100%" height="100%" fill="' + C.sup + '"/>';

  for (let v = 0; v <= c.dur + 1e-9; v += passoR) {
    const x = sx(v);
    s += '<line x1="' + x + '" y1="' + (PADT - 14) + '" x2="' + x + '" y2="' + (H - PADB + 2) + '" stroke="#EFEBE3"/>';
    s += '<text x="' + x + '" y="' + (PADT - 20) + '" text-anchor="middle"' + mono + ' font-size="12" fill="' + C.apagadinho + '">' + esc(rotuloData(v)) + '</text>';
  }
  s += '<line x1="' + x0 + '" y1="' + (PADT - 14) + '" x2="' + (W - PADR) + '" y2="' + (PADT - 14) + '" stroke="' + C.borda + '"/>';
  s += '<line x1="' + sx(c.dur) + '" y1="' + (PADT - 14) + '" x2="' + sx(c.dur) + '" y2="' + (H - PADB + 2) + '" stroke="' + C.critico + '" stroke-width="1.4" stroke-dasharray="5 4"/>';
  if (ganttT !== null && ganttT <= c.dur + 1e-9) {   /* linha do tempo escolhida no controle deslizante */
    s += '<rect x="' + x0 + '" y="' + (PADT - 14) + '" width="' + Math.max(0, sx(ganttT) - x0) + '" height="' + (H - PADT + 14 - PADB + 2) + '" fill="' + C.navy + '" opacity="0.06"/>';
    s += '<line x1="' + sx(ganttT) + '" y1="' + (PADT - 14) + '" x2="' + sx(ganttT) + '" y2="' + (H - PADB + 2) + '" stroke="' + C.navy + '" stroke-width="2"/>';
    s += '<text x="' + (sx(ganttT) + 5) + '" y="' + (PADT - 2) + '"' + mono + ' font-size="12" font-weight="600" fill="' + C.navy + '">t = ' + fmt(ganttT) + '</text>';
  }

  linhas.forEach((n, i) => {
    const y = PADT + i * RH, yc = y + RH / 2, cor = n.crit ? C.critico : C.navy;
    s += '<text x="' + (LBL - 4) + '" y="' + (yc + (state.inicio ? -1 : 5)) + '" text-anchor="end"' + mono + ' font-size="15" font-weight="600" fill="' + (n.crit ? C.critico : C.tinta) + '">' + esc(n.id) + '</text>';
    if (n.nome) s += '<text x="' + (LBL - 4 - 12 - 9 * String(n.id).length) + '" y="' + (yc + (state.inicio ? -1 : 5)) + '" text-anchor="end" font-size="12" fill="' + C.apagado + '">' + esc(n.nome.length > 19 ? n.nome.slice(0, 18) + '…' : n.nome) + '</text>';
    if (state.inicio) s += '<text x="' + (LBL - 4) + '" y="' + (yc + 12) + '" text-anchor="end"' + mono + ' font-size="12" fill="' + C.apagadinho + '">' + esc(faixaDatas(n)) + '</text>';
    if (state.gFolga && n.FT > EPS) s += '<rect data-tip="' + esc('Folga total de ' + fmt(n.FT) + ' ' + uni(n.FT) + ' de ' + n.id + ': a barra tracejada mostra até onde ela pode escorregar sem atrasar o projeto.') + '" x="' + sx(n.EF) + '" y="' + (y + 4) + '" width="' + Math.max(2, sx(n.EF + n.FT) - sx(n.EF)) + '" height="8" rx="2" fill="none" stroke="' + C.folga + '" stroke-width="1.2" stroke-dasharray="4 3"/>';
    if (state.gTarde && n.FT > EPS) s += '<rect x="' + sx(n.LS) + '" y="' + (y + 16) + '" width="' + Math.max(2, sx(n.LF) - sx(n.LS)) + '" height="5" rx="2" fill="' + C.neutro + '"/>';
    const bw = Math.max(3, sx(n.EF) - sx(n.ES));
    s += '<rect data-id="' + esc(n.id) + '" data-tip="' + esc(tipAtiv(n)) + '" x="' + sx(n.ES) + '" y="' + (y + 5) + '" width="' + bw + '" height="19" rx="3" fill="' + cor + '"/>';
    if (bw > 26) s += '<text x="' + (sx(n.ES) + 7) + '" y="' + (y + 18) + '"' + mono + ' font-size="12" fill="#FFFFFF">' + fmt(n.dur) + '</text>';
    else s += '<text x="' + (sx(n.EF) + 6) + '" y="' + (y + 18) + '"' + mono + ' font-size="12" fill="' + C.apagado + '">' + fmt(n.dur) + '</text>';
  });

  if (state.gSetas) {
    linhas.forEach(n => n.preds.forEach(p => {
      const r = n.rel.get(p) || REL0, pn = c.N.get(p);
      const y1 = yOf(p), y2 = yOf(n.id), xa = sx(r.t === 'II' || r.t === 'IT' ? pn.ES : pn.EF), xb = sx(r.t === 'TT' || r.t === 'IT' ? n.EF : n.ES);
      const mx = Math.max(xa + 8, xb - 8), volta = xb < mx;
      s += '<path d="M' + xa + ',' + y1 + ' L' + mx + ',' + y1 + ' L' + mx + ',' + y2 + ' L' + (volta ? xb + 2 : xb - 2) + ',' + y2 + '" fill="none" stroke="' + C.aresta + '" stroke-width="1.1" marker-end="url(#gs)" opacity="0.75"/>' +
        '<path d="M' + xa + ',' + y1 + ' L' + mx + ',' + y1 + ' L' + mx + ',' + y2 + ' L' + (volta ? xb + 2 : xb - 2) + ',' + y2 + '" fill="none" stroke="transparent" stroke-width="12" data-tip="' + esc(tipLigacao(p, n.id, r, n.crit && pn.crit && c.aperta(p, n.id))) + '"/>';
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
  const ip = $('#interpPert'); ip.hidden = cpm; if (cpm) ip.innerHTML = '';
  if (!c.acts.length) { renderMC(); return; }
  const mu = c.dur, sgm = c.sigma;

  if (!$('#prazoX').value) $('#prazoX').value = r2(mu + (sgm > EPS ? sgm : Math.max(1, mu * 0.1)));
  const X = num($('#prazoX').value);
  const pr = $('#prazoXr'); if (pr) { const lo = Math.max(0, mu - 4 * (sgm > EPS ? sgm : mu * 0.2)), hi = mu + 4 * (sgm > EPS ? sgm : mu * 0.2); pr.min = Math.floor(lo); pr.max = Math.ceil(hi); pr.step = (hi - lo) > 40 ? 1 : (hi - lo) > 8 ? 0.5 : 0.1; if (document.activeElement !== pr) pr.value = X; }
  const z = sgm > EPS ? (X - mu) / sgm : (X >= mu ? Infinity : -Infinity);
  const P = sgm > EPS ? phi(z) : (X >= mu ? 1 : 0);
  $('#saidaProb').innerHTML =
    '<div class="kpis">' +
    '<div class="kpi"><div class="olho">Z</div><div class="v">' + (isFinite(z) ? fmt(z) : '—') + '</div></div>' +
    '<div class="kpi"><div class="olho">Probabilidade</div><div class="v navy">' + (P * 100).toFixed(1).replace('.', ',') + '%</div></div>' +
    '<div class="kpi"><div class="olho">σ do caminho</div><div class="v">' + fmt(sgm) + '</div></div>' +
    '</div>' +
    '<p class="hint" style="font-family:var(--mono)">Z = (' + fmt(X) + ' − ' + fmt(mu) + ') ÷ ' + fmt(sgm) + '</p>';
  desenhaNormal(mu, sgm, X);

  const cTxt = String($('#confP').value).trim();
  const conf = Math.min(99.9, Math.max(0.1, cTxt === '' ? 95 : num(cTxt))) / 100;
  const zc = zInv(conf), Xc = mu + zc * sgm;
  $('#saidaConf').innerHTML = '<div class="bloco-navy"><div class="olho">Prazo a prometer</div>' +
    '<div class="grande">' + fmt(Xc) + ' ' + uni(Xc) + '</div>' +
    '<div class="nota-z">z = ' + fmt(zc) + ' · te + z·σ = ' + fmt(mu) + ' + ' + fmt(zc) + '×' + fmt(sgm) + '</div></div>';
  let tc = '<thead><tr><th>Confiança</th><th class="dir">z</th><th class="dir">Prazo</th><th class="dir">Reserva</th></tr></thead><tbody>';
  [50, 75, 80, 90, 95, 99].forEach(pc => {
    const zz = zInv(pc / 100), xx = mu + zz * sgm;
    tc += '<tr><td>' + pc + '%</td><td class="dir">' + fmt(zz) + '</td><td class="dir"><b>' + fmt(xx) + '</b></td><td class="dir">' + fmt(xx - mu) + '</td></tr>';
  });
  $('#tblConf').innerHTML = tc + '</tbody>';
  ip.innerHTML = sgm <= EPS
    ? '<b class="t">O que o resultado diz:</b> as estimativas das atividades críticas não variam (o = m = p), então o prazo esperado, <b>' + fmt(mu) + ' ' + uni(mu) + '</b>, é também o prazo certo.'
    : '<b class="t">O que o resultado diz:</b> em cada 100 projetos como este, cerca de <b>' + Math.round(P * 100) + '</b> terminariam em até <b>' + fmt(X) + ' ' + uni(X) + '</b>. Para ter <b>' + fmt(conf * 100) + '%</b> de segurança, prometa <b>' + fmt(Xc) + ' ' + uni(Xc) + '</b>: uma reserva de ' + fmt(Xc - mu) + ' ' + uni(Xc - mu) + ' sobre o prazo esperado (' + fmt(mu) + ').';

  if ($('#tblPert').contains(document.activeElement)) { renderMC(); return; }
  let h = '<thead><tr><th>Atividade</th><th class="dir">o</th><th class="dir">m</th><th class="dir">p</th><th class="dir">te</th><th class="dir">σ²</th><th>No caminho crítico</th><th class="w-num" title="Ramo probabilístico: chance de a atividade acontecer (GERT simplificado). Vale só na simulação.">Chance de ocorrer (%)</th></tr></thead><tbody>';
  c.acts.forEach(n => {
    h += '<tr class="' + (n.crit ? 'crit' : '') + '"><td class="cod"><b>' + esc(n.id) + '</b></td>' +
      '<td class="dir">' + fmt(num(n.ref.o)) + '</td><td class="dir">' + fmt(num(n.ref.m)) + '</td><td class="dir">' + fmt(num(n.ref.p)) + '</td>' +
      '<td class="dir"><b>' + fmt(n.dur) + '</b></td><td class="dir">' + fmt(n.varia) + '</td>' +
      '<td class="txt">' + (c.critSeq.indexOf(n.id) >= 0 ? 'sim' : '—') + '</td>' +
      '<td><input data-prob="' + state.acts.indexOf(n.ref) + '" inputmode="decimal" value="' + esc(n.ref.prob) + '" placeholder="100" aria-label="Chance de ' + esc(n.id) + ' ocorrer"></td></tr>';
  });
  $('#tblPert').innerHTML = h + '</tbody>';
  renderMC();
}

/* ============================================================
   EXPLICAÇÕES AO PASSAR O MOUSE (diagrama de rede e Gantt)
   ============================================================ */
const REL_FRASE = {
  TI: ['término-início', 'só começa depois que {de} terminar'], II: ['início-início', 'só começa depois que {de} começar'],
  TT: ['término-término', 'só termina depois que {de} terminar'], IT: ['início-término', 'só termina depois que {de} começar']
};
function tipLigacao(de, para, r, crit) {
  const f = REL_FRASE[r.t] || REL_FRASE.TI;
  let s = de + ' → ' + para + ' (' + f[0] + '): ' + para + ' ' + f[1].replace('{de}', de) + '.';
  if (r.lag > 0) s += ' Com espera obrigatória de ' + fmt(r.lag) + ' ' + uni(r.lag) + '.';
  else if (r.lag < 0) s += ' Com antecipação de ' + fmt(-r.lag) + ' ' + uni(-r.lag) + '.';
  return s + (crit ? ' Ligação crítica: sem folga, um atraso em ' + de + ' atrasa ' + para + ' e o projeto.' : ' Há folga nesta ligação: ' + para + ' pode esperar sem atrasar o projeto.');
}
function tipAtiv(n) {
  const L = [];
  L.push(n.id + (n.nome ? ' · ' + n.nome : '') + ': dura ' + fmt(n.dur) + ' ' + uni(n.dur) + '.');
  L.push(sg('ES') + ' ' + fmt(n.ES) + ' e ' + sg('EF') + ' ' + fmt(n.EF) + ' (' + sgNome('ES') + ' e ' + sgNome('EF') + '): o mais cedo que ela pode começar e terminar.');
  L.push(sg('LS') + ' ' + fmt(n.LS) + ' e ' + sg('LF') + ' ' + fmt(n.LF) + ' (' + sgNome('LS') + ' e ' + sgNome('LF') + '): o mais tarde que pode começar e terminar sem atrasar o projeto.');
  L.push(n.crit ? 'Folga total 0: atividade CRÍTICA. Qualquer atraso nela atrasa o projeto inteiro.' : 'Folga total ' + fmt(n.FT) + ': pode atrasar até ' + fmt(n.FT) + ' ' + uni(n.FT) + ' sem atrasar o projeto.');
  L.push(n.preds.length ? 'Depende de: ' + n.preds.join(', ') + '.' : 'Não tem predecessora: começa o projeto.');
  return L.join('\n');
}
function ligaTips() {
  const tip = $('#tip'); if (!tip) return;
  const mostra = (txt, x, y) => {
    tip.textContent = txt; tip.hidden = false;
    const w = tip.offsetWidth, h = tip.offsetHeight;
    let px = Math.min(Math.max(8, x - w / 2), innerWidth - w - 8), py = y - h - 16;   /* acima do ponteiro; se não couber, abaixo */
    if (py < 8) py = Math.min(y + 22, innerHeight - h - 8);
    tip.style.left = px + 'px'; tip.style.top = py + 'px';
  };
  const alvo = e => e.target && e.target.closest ? e.target.closest('[data-tip]') : null;
  document.addEventListener('mouseover', e => { const t = alvo(e); if (t) mostra(t.getAttribute('data-tip'), e.clientX, e.clientY); else tip.hidden = true; });
  document.addEventListener('mousemove', e => { if (tip.hidden) return; const t = alvo(e); if (t) mostra(t.getAttribute('data-tip'), e.clientX, e.clientY); else tip.hidden = true; });
  document.addEventListener('mouseout', e => { if (!e.relatedTarget) tip.hidden = true; });
  document.addEventListener('click', e => { const t = alvo(e); if (t) mostra(t.getAttribute('data-tip'), e.clientX, e.clientY); else tip.hidden = true; });   /* toque no celular */
  document.addEventListener('keydown', e => { if (e.key === 'Escape') tip.hidden = true; });
}

/* ---------- sequência dos passos: botões Voltar / Próximo no fim de cada aba ---------- */
const PASSOS = [['inicio', 'Início'], ['dados', 'Dados'], ['calend', 'Calendário e custos'], ['result', 'Resultados'], ['rede', 'Diagrama de rede'], ['gantt', 'Gantt'], ['pert', 'Probabilidade'], ['crash', 'Compressão'], ['recursos', 'Recursos'], ['ccpm', 'Corrente crítica'], ['controle', 'Controle'], ['pratica', 'Praticar']];
const PASSO_PROX = { result: 'Ver o diagrama de rede', rede: 'Ver o Gantt', gantt: 'Probabilidade de prazo', pert: 'Compressão de prazo', crash: 'Recursos', recursos: 'Corrente crítica', ccpm: 'Controle do projeto', controle: 'Praticar' };
function montaPassos() {
  ['result', 'rede', 'gantt', 'pert', 'crash', 'recursos', 'ccpm', 'controle', 'pratica'].forEach(p => {
    const painel = $('#p-' + p); if (!painel || painel.querySelector('.passos')) return;
    const i = PASSOS.findIndex(x => x[0] === p), ant = PASSOS[i - 1], prox = PASSOS[i + 1];
    let h = '<div class="passos noprint">';
    if (ant) h += '<button class="bt" data-ir="' + ant[0] + '">← Voltar: ' + ant[1] + '</button>';
    if (prox) h += '<button class="bt primario" data-ir="' + prox[0] + '">Próximo passo: ' + (PASSO_PROX[p] || prox[1]) + ' →</button>';
    painel.insertAdjacentHTML('beforeend', h + '</div>');
  });
}

/* Aviso com um botão de ação (ex.: Desfazer). Fica 8 s. */
function toastAcao(msg, rotulo, fn) {
  toast(msg + ' ', true);
  const el = $('#toast'); if (!el) return;
  el.style.pointerEvents = 'auto';
  const b = document.createElement('button');
  b.textContent = rotulo; b.className = 'bt mini'; b.style.cssText = 'margin-left:10px;background:#F1EEE8;color:#16243B;border-color:#F1EEE8';
  b.onclick = () => { el.style.opacity = '0'; fn(); };
  el.appendChild(b);
  clearTimeout(toastT); toastT = setTimeout(() => { el.style.opacity = '0'; }, 8000);
}

/* ============================================================
   SIMULAÇÃO DE MONTE CARLO (aba Probabilidade, só no modo PERT)
   ============================================================ */
let mcRes = null, mcSig = '';
const mcAssinatura = () => JSON.stringify([state.modo, state.mcDist, state.acts.map(a => [a.id, a.o, a.m, a.p, a.preds, a.rel, a.prob])]);
function mcPct(x) { return (x * 100).toFixed(1).replace('.', ',') + '%'; }
function mcHistograma(r, mu, sg, X) {
  const W = 360, H = 200, PX = 14, PB = 26, PT = 10, NB = 26;
  const a = r.min, b = r.max > r.min ? r.max : r.min + 1, bw = (b - a) / NB;
  const cont = new Array(NB).fill(0);
  for (let k = 0; k < r.N; k++) { let i = Math.floor((r.ord[k] - a) / bw); if (i >= NB) i = NB - 1; cont[i]++; }
  const dens = cont.map(c => c / r.N / bw);
  const dn = v => sg > EPS ? Math.exp(-0.5 * Math.pow((v - mu) / sg, 2)) / (sg * Math.sqrt(2 * Math.PI)) : 0;
  let topo = Math.max.apply(null, dens);
  if (sg > EPS) topo = Math.max(topo, dn(mu));
  const sx = v => PX + (v - a) / (b - a) * (W - PX * 2), sy = d => PT + (1 - d / topo) * (H - PT - PB);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:560px;display:block" font-family="IBM Plex Mono, monospace" role="img" aria-label="Histograma da duração do projeto nas rodadas simuladas">';
  dens.forEach((d, i) => {
    const x = sx(a + i * bw), w = Math.max(1, sx(a + (i + 1) * bw) - x - 1);
    s += '<rect x="' + x.toFixed(1) + '" y="' + sy(d).toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + (H - PB - sy(d)).toFixed(1) + '" fill="' + C.navy + '" opacity="0.55"/>';
  });
  if (sg > EPS) {
    let d = '';
    for (let i = 0; i <= 120; i++) { const v = a + (b - a) * i / 120; d += (i ? 'L' : 'M') + sx(v).toFixed(1) + ',' + sy(dn(v)).toFixed(1) + ' '; }
    s += '<path d="' + d + '" fill="none" stroke="' + C.tinta2 + '" stroke-width="1.5" stroke-dasharray="5 3"/>';
  }
  s += '<line x1="' + PX + '" y1="' + (H - PB) + '" x2="' + (W - PX) + '" y2="' + (H - PB) + '" stroke="' + C.borda + '"/>';
  if (X >= a && X <= b) s += '<line x1="' + sx(X).toFixed(1) + '" y1="' + PT + '" x2="' + sx(X).toFixed(1) + '" y2="' + (H - PB) + '" stroke="' + C.critico + '" stroke-width="1.6"/>';
  [[a, 'start'], [(a + b) / 2, 'middle'], [b, 'end']].forEach(t => {
    s += '<text x="' + (t[1] === 'start' ? PX : t[1] === 'end' ? W - PX : W / 2) + '" y="' + (H - PB + 16) + '" text-anchor="' + t[1] + '" font-size="12" fill="' + C.apagadinho + '">' + fmt(t[0]) + '</text>';
  });
  return s + '</svg>';
}
function renderMC() {
  const bloco = $('#mcBloco'); if (!bloco) return;
  const cpm = state.modo !== 'pert';
  bloco.hidden = cpm;
  if (cpm) return;
  if (mcRes && mcSig !== mcAssinatura()) { mcRes = null; }
  const box = $('#mcSaida');
  const sd = $('#mcDist'); if (sd) sd.value = state.mcDist;
  if (!mcRes) { box.innerHTML = '<p class="hint" style="margin:0">Clique em <b>Simular</b> para sortear as durações e ver a distribuição do prazo. Se mudar as estimativas, simule de novo.</p>'; return; }
  const r = mcRes, c = calcOut, mu = c.dur, sg = c.sigma;
  const X = num($('#prazoX').value), pMC = r.ate(X), pN = sg > EPS ? phi((X - mu) / sg) : (X >= mu ? 1 : 0);
  let h = '<div class="kpis">' +
    '<div class="kpi"><div class="olho">Prazo médio simulado</div><div class="v">' + fmt(r.media) + '</div></div>' +
    '<div class="kpi"><div class="olho">Desvio padrão</div><div class="v">' + fmt(r.dp) + '</div></div>' +
    '<div class="kpi"><div class="olho">Chance de até ' + fmt(X) + '</div><div class="v navy">' + mcPct(pMC) + '</div></div>' +
    '</div>';
  h += '<div style="margin-top:12px">' + mcHistograma(r, mu, sg, X) + '</div>';
  h += '<p class="hint">' + r.N.toLocaleString('pt-BR') + ' rodadas · distribuição ' + (MC_DIST_NOME[r.dist] || r.dist) + ' · semente ' + r.seed + (r.temRamo ? ' · com ramos probabilísticos (atividades que podem não ocorrer)' : '') + ' · barras = simulação · tracejado = aproximação normal do PERT · linha vermelha = prazo desejado (' + fmt(X) + ')</p>';
  const dif = r.media - mu;
  h += '<p class="ler interp"><b class="t">O que o resultado diz:</b> em ' + r.N.toLocaleString('pt-BR') + ' rodadas, <b>' + mcPct(pMC) + '</b> terminaram em até <b>' + fmt(X) + ' ' + uni(X) + '</b>; a aproximação normal do PERT dá <b>' + mcPct(pN) + '</b>.' +
    (dif > Math.max(0.01 * mu, 0.05) ? ' O prazo médio simulado (<b>' + fmt(r.media) + '</b>) ficou acima do prazo esperado do PERT (<b>' + fmt(mu) + '</b>): com caminhos quase tão longos quanto o crítico, o projeto atrasa quando <i>qualquer</i> deles atrasa, e o PERT clássico só olha o caminho crítico esperado.' : ' O prazo médio simulado (<b>' + fmt(r.media) + '</b>) ficou próximo do esperado do PERT (<b>' + fmt(mu) + '</b>): o caminho crítico domina a rede.') + '</p>';
  h += '<div class="rolar" style="margin-top:12px"><table class="tab"><thead><tr><th>Confiança</th><th class="dir">Simulação</th><th class="dir">Normal (PERT)</th></tr></thead><tbody>';
  [50, 75, 80, 90, 95, 99].forEach(q => { h += '<tr><td>' + q + '%</td><td class="dir"><b>' + fmt(r.pct(q / 100)) + '</b></td><td class="dir">' + (sg > EPS ? fmt(mu + zInv(q / 100) * sg) : fmt(mu)) + '</td></tr>'; });
  h += '</tbody></table></div>';
  const ordem = r.ids.map((id, i) => [id, r.indiceCrit[i], r.ocorreu[i]]).sort((x, y) => y[1] - x[1]);
  h += '<h3 style="font-size:19px;margin:18px 0 6px">Índice de criticidade</h3><p class="hint" style="margin:0 0 8px">Em quantas rodadas a atividade esteve no caminho crítico.</p><div class="rolar"><table class="tab"><thead><tr><th>Atividade</th><th class="dir">Criticidade</th>' + (r.temRamo ? '<th class="dir">Ocorreu</th>' : '') + '<th style="width:50%"></th></tr></thead><tbody>';
  ordem.forEach(o => { const n = c.N.get(o[0]); h += '<tr class="' + (o[1] > 0.995 ? 'crit' : '') + '"><td class="cod"><b>' + esc(o[0]) + '</b>' + (n && n.nome ? ' <span style="color:var(--apagado)">' + esc(n.nome) + '</span>' : '') + '</td><td class="dir">' + mcPct(o[1]) + '</td>' + (r.temRamo ? '<td class="dir">' + mcPct(o[2]) + '</td>' : '') + '<td><div style="height:10px;background:var(--navy);opacity:.6;border-radius:2px;width:' + (o[1] * 100).toFixed(1) + '%"></div></td></tr>'; });
  box.innerHTML = h + '</tbody></table></div>';
}
function mcRodar() {
  const c = calcOut;
  if (!c || c.erros.length || !c.acts.length) { alerta('Corrija os erros dos dados antes de simular.'); return; }
  const N = Math.min(50000, Math.max(100, parseInt($('#mcN').value, 10) || 10000));
  $('#mcSaida').innerHTML = '<p class="hint" style="margin:0">Simulando…</p>';
  setTimeout(() => {
    try {
      mcRes = mcSimular(c, N, 1 + Math.floor(Math.random() * 2147483646), { dist: state.mcDist }); mcSig = mcAssinatura();
    } catch (e) { mcRes = null; alerta('Não consegui simular esta rede.'); }
    renderMC();
  }, 30);
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
  [-2, 0, 2].forEach(k => {
    const v = mu + k * sg;
    s += '<text x="' + sx(v) + '" y="' + (H - PB + 15) + '" text-anchor="middle" font-size="13.5" fill="' + C.apagadinho + '">' + fmt(v) + '</text>';
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

/* Corte mínimo no subgrafo crítico: o conjunto de atividades de menor custo que, encurtadas,
   encurtam TODOS os caminhos críticos de uma vez. Fluxo máximo (Edmonds-Karp), com cada
   atividade dividida em entrada → saída de capacidade igual ao custo por período.
   Exato e sem enumerar caminhos: antes, com mais de 300 caminhos críticos, a compressão só
   via os 300 primeiros, comprimia esses, o projeto não encurtava e ela parava cedo. */
function corteMinimo(s, dur, dmin, custo) {
  const crit = s.acts.filter(n => n.crit);
  if (!crit.length) return null;
  const GRANDE = 1e15, idx = new Map();
  crit.forEach((n, i) => idx.set(n.id, 2 + 2 * i));          /* 0 = fonte, 1 = sumidouro */
  const V = 2 + 2 * crit.length, cap = new Map(), adj = Array.from({ length: V }, () => []);
  const k = (u, v) => u * V + v;
  const liga = (u, v, c) => {
    if (!cap.has(k(u, v))) { adj[u].push(v); adj[v].push(u); cap.set(k(u, v), 0); if (!cap.has(k(v, u))) cap.set(k(v, u), 0); }
    cap.set(k(u, v), cap.get(k(u, v)) + c);
  };
  crit.forEach(n => {
    const i = idx.get(n.id);
    const pode = dur.get(n.id) - dmin.get(n.id) > EPS && isFinite(custo.get(n.id));
    liga(i, i + 1, pode ? custo.get(n.id) : GRANDE);
    /* começa o caminho crítico: quem começa no instante 0 (inclusive preso ali por antecipação, com predecessoras) */
    if (n.ES < EPS) liga(0, i, GRANDE);
    /* termina o caminho crítico: acaba junto com o projeto, mesmo tendo sucessoras */
    if (Math.abs(n.EF - s.dur) < EPS) liga(i + 1, 1, GRANDE);
    n.succs.forEach(x => { const m = s.N.get(x); if (m.crit && s.aperta(n.id, x)) liga(i + 1, idx.get(x), GRANDE); });
  });
  let fluxo = 0;
  for (;;) {
    const pai = new Array(V).fill(-1); pai[0] = 0; const fila = [0];
    while (fila.length && pai[1] < 0) { const u = fila.shift(); adj[u].forEach(v => { if (pai[v] < 0 && cap.get(k(u, v)) > 1e-12) { pai[v] = u; fila.push(v); } }); }
    if (pai[1] < 0) break;
    let f = Infinity; for (let v = 1; v !== 0; v = pai[v]) f = Math.min(f, cap.get(k(pai[v], v)));
    for (let v = 1; v !== 0; v = pai[v]) { cap.set(k(pai[v], v), cap.get(k(pai[v], v)) - f); cap.set(k(v, pai[v]), cap.get(k(v, pai[v])) + f); }
    fluxo += f;
    if (fluxo >= GRANDE / 2) return null;                    /* todo corte passa por atividade incomprimível */
  }
  const alcanca = new Array(V).fill(false); alcanca[0] = true; const fila = [0];
  while (fila.length) { const u = fila.shift(); adj[u].forEach(v => { if (!alcanca[v] && cap.get(k(u, v)) > 1e-12) { alcanca[v] = true; fila.push(v); } }); }
  const ids = crit.filter(n => alcanca[idx.get(n.id)] && !alcanca[idx.get(n.id) + 1]).map(n => n.id);
  return ids.length ? { ids, custo: ids.reduce((t, x) => t + custo.get(x), 0) } : null;
}

function rodarCrash() {
  const base = calcular();
  if (base.erros.length || !base.acts.length) { alerta('Corrija os erros dos dados antes de comprimir.'); return; }
  if (base.temRelEsp) { alerta('A compressão só funciona com relações de término-início (TI), com ou sem atraso. Esta rede usa relações II, TT ou IT: troque-as por término-início ou use as outras abas, que aceitam todas as relações.'); return; }
  const neg = state.acts.filter(a => String(a.id).trim() && a.cc !== '' && num(a.cc) < 0).map(a => a.id);
  if (neg.length) { alerta('Custo por período negativo em ' + neg.join(', ') + '. Acelerar custa — informe um valor positivo (ou deixe em branco se a atividade não pode ser acelerada).'); return; }
  const dur = new Map(), dmin = new Map(), custo = new Map();
  state.acts.forEach(a => {
    const id = String(a.id).trim().toUpperCase(); if (!id) return;
    const dn = durDe(a);
    dur.set(id, dn);
    dmin.set(id, a.dmin === '' ? dn : Math.min(dn, Math.max(0, num(a.dmin))));
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
    const corte = corteMinimo(s, dur, dmin, custo);
    if (!corte) break;
    /* Encurta 1 período por passo — menos, se alguma atividade escolhida só tem fração
       até a duração mínima, ou se outro caminho fica crítico antes: o custo é proporcional. */
    const folgaMin = Math.min.apply(null, s.acts.filter(n => !n.crit).map(n => n.FT).concat([Infinity]));
    const delta = Math.min(1, folgaMin, ...corte.ids.map(x => dur.get(x) - dmin.get(x)));
    if (!(delta > EPS)) break;
    corte.ids.forEach(x => dur.set(x, dur.get(x) - delta));
    const novo = calcular(dur);
    if (novo.dur >= s.dur - EPS) break;
    s = novo;
    const add = corte.custo * delta;
    direto += add;
    passos.push({ quem: corte.ids.join(' + ') + (delta < 1 - EPS ? ' (−' + fmt(delta) + ')' : ''), dur: s.dur, add: add, dir: direto, ind: s.dur * ind, tot: direto + s.dur * ind });
    if (s.dur <= 0) break;
  }

  const temCusto = ind > 0 || passos.some(p => p.add > 0);
  let iOt = 0; passos.forEach((p, i) => { if (p.tot < passos[iOt].tot - EPS) iOt = i; });
  const economia = passos[0].tot - passos[iOt].tot;
  {
    const p0 = passos[0], pm = passos[iOt], pf = passos[passos.length - 1];
    let tx;
    if (!temCusto) tx = 'sem custos informados, a compressão só mostra como o prazo encurta: de <b>' + fmt(p0.dur) + '</b> até o mínimo de <b>' + fmt(pf.dur) + ' ' + uni(pf.dur) + '</b>. Informe o custo direto, o custo por período acelerado e o custo indireto para descobrir o prazo de menor custo.';
    else if (iOt === 0) tx = 'comprimir não compensa: o que se economiza de custo indireto é menor que o custo de acelerar as atividades. O melhor prazo é o normal, <b>' + fmt(p0.dur) + ' ' + uni(p0.dur) + '</b>.';
    else tx = 'o prazo de menor custo total é <b>' + fmt(pm.dur) + ' ' + uni(pm.dur) + '</b>, ' + fmt(p0.dur - pm.dur) + ' ' + uni(p0.dur - pm.dur) + ' a menos que o normal (' + fmt(p0.dur) + '). Acelerar acrescenta <b>' + money(pm.dir - p0.dir) + '</b> ao custo direto, mas o custo indireto cai <b>' + money(p0.ind - pm.ind) + '</b>: o custo total vai de ' + money(p0.tot) + ' para <b>' + money(pm.tot) + '</b>.';
    $('#interpCrash').innerHTML = '<b class="t">O que o resultado diz:</b> ' + tx;
  }

  $('#crashKpis').innerHTML =
    '<div class="c navy"><div class="olho">Prazo ótimo</div><div class="v">' + fmt(passos[iOt].dur) + ' ' + uni(passos[iOt].dur) + '</div></div>' +
    '<div class="c"><div class="olho">Custo total mínimo</div><div class="v">' + money(passos[iOt].tot) + '</div></div>' +
    '<div class="c"><div class="olho">Economia vs. normal</div><div class="v folga">' + money(economia) + '</div></div>';

  let h = '<thead><tr><th class="dir">Passo</th><th>Comprimir</th><th class="dir">Prazo</th><th class="dir">+ Custo</th><th class="dir" title="Custo de encurtar 1 período neste passo: a inclinação da curva tempo-custo">Custo marginal / período</th><th class="dir">Custo direto</th><th class="dir">Custo indireto</th><th class="dir">Custo total</th></tr></thead><tbody>';
  passos.forEach((p, i) => {
    const ot = temCusto && i === iOt;
    h += '<tr' + (ot ? ' style="background:#E8F0F2"' : '') + '><td class="dir">' + i + '</td>' +
      '<td' + (i ? ' style="color:var(--critico);font-weight:600"' : ' class="txt"') + '>' + esc(p.quem) + '</td>' +
      '<td class="dir"><b>' + fmt(p.dur) + '</b></td><td class="dir">' + (p.add ? money(p.add) : '—') + '</td>' +
      '<td class="dir">' + (i && passos[i - 1].dur - p.dur > EPS ? money(p.add / (passos[i - 1].dur - p.dur)) : '—') + '</td>' +
      '<td class="dir">' + money(p.dir) + '</td><td class="dir">' + money(p.ind) + '</td><td class="dir"><b>' + money(p.tot) + '</b></td></tr>';
  });
  $('#tblCrashOut').innerHTML = h + '</tbody>';
  $('#cardCrashOut').hidden = false;
  desenhaCusto(passos, temCusto, iOt);
  $('#cardCrashOut').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* Resultado da compressão vale para os dados de quando foi calculado: se algo muda, some
   (antes continuava na tela, com números que já não correspondiam à rede). */
function invalidaCompressao() { const c = $('#cardCrashOut'); if (c) c.hidden = true; }

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
    s += '<text x="' + (L - 8) + '" y="' + (y + 4) + '" text-anchor="end"' + mono + ' font-size="12" fill="' + C.apagadinho + '">' + money(Math.round(v)) + '</text>';
  }
  /* no máximo ~9 rótulos no eixo (com muitos passos eles se sobrepunham); o ótimo e o último sempre aparecem */
  const cada = Math.ceil(passos.length / 9);
  passos.forEach((p, i) => { if (i % cada === 0 || i === iOt || i === passos.length - 1) s += '<text x="' + sx(p.dur) + '" y="' + (H - B + 17) + '" text-anchor="middle"' + mono + ' font-size="12" fill="' + C.apagadinho + '">' + fmt(p.dur) + '</text>'; });
  s += linha('dir', C.critico, 2) + linha('ind', C.folga, 2) + linha('tot', C.navy, 2.6);
  s += '<circle cx="' + sx(passos[iOt].dur) + '" cy="' + sy(passos[iOt].tot) + '" r="5" fill="' + C.navy + '"/>';
  s += '<text x="' + sx(passos[iOt].dur) + '" y="' + (sy(passos[iOt].tot) - 11) + '" text-anchor="middle" font-size="12" font-weight="600" fill="' + C.navy + '">ótimo</text>';
  s += '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="' + C.borda + '"/>';
  s += '<text x="' + (W - R) + '" y="' + (H - 12) + '" text-anchor="end" font-size="12" fill="' + C.apagado + '">duração do projeto →</text>';
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

const csvCampo = v => { const t = String(v); return /[;"\r\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };

function exportarCSV() {
  const c = calcOut; if (!c.acts.length) return;
  const linhas = ['Atividade;Duracao;' + [sg('ES'), sg('EF'), sg('LS'), sg('LF')].join(';') + ';FT;FL;Critica;Predecessoras'];
  c.acts.forEach(n => {
    linhas.push([n.id, fmt(n.dur), fmt(n.ES), fmt(n.EF), fmt(n.LS), fmt(n.LF), fmt(n.FT), fmt(n.FL), n.crit ? 'Critica' : 'Folga de ' + fmt(n.FT), textoPreds(n.ref)].map(csvCampo).join(';'));
  });
  baixar(nomeArquivo() + '.csv', '﻿' + linhas.join('\r\n'), 'text/csv;charset=utf-8');
}

/* Um SVG desenhado como imagem não enxerga as fontes da página: o PNG saía com a fonte
   genérica. As fontes usadas nos desenhos vão embutidas no próprio SVG. */
let cssFontesPNG = null;
async function fontesParaPNG() {
  if (cssFontesPNG !== null) return cssFontesPNG;
  const lista = [['IBM Plex Mono', 400, 'IBMPlexMono-400'], ['IBM Plex Mono', 600, 'IBMPlexMono-600'],
    ['IBM Plex Sans', 400, 'IBMPlexSans-400'], ['IBM Plex Sans', 600, 'IBMPlexSans-600']];
  try {
    const regras = await Promise.all(lista.map(async f => {
      const u = new Uint8Array(await (await fetch('fontes/' + f[2] + '-latin.woff2')).arrayBuffer());
      let bin = ''; for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
      return "@font-face{font-family:'" + f[0] + "';font-weight:" + f[1] + ";src:url(data:font/woff2;base64," + btoa(bin) + ") format('woff2');}";
    }));
    cssFontesPNG = regras.join('');
  } catch (e) { cssFontesPNG = ''; }
  return cssFontesPNG;
}
async function rasterizaSVG(svgEl, escala) {
  const clone = svgEl.cloneNode(true);
  const css = await fontesParaPNG();
  if (css) { const st = document.createElementNS('http://www.w3.org/2000/svg', 'style'); st.textContent = css; clone.insertBefore(st, clone.firstChild); }
  const w = svgEl.viewBox.baseVal.width || svgEl.width.baseVal.value;
  const h = svgEl.viewBox.baseVal.height || svgEl.height.baseVal.value;
  clone.setAttribute('width', w); clone.setAttribute('height', h);
  const img = new Image();
  await new Promise((ok, erro) => { img.onload = ok; img.onerror = erro; img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)); });
  try { await img.decode(); } catch (e) { }
  await new Promise(r => setTimeout(r, 60));
  const cv = document.createElement('canvas');
  cv.width = w * escala; cv.height = h * escala;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = C.sup; ctx.fillRect(0, 0, cv.width, cv.height);
  ctx.setTransform(escala, 0, 0, escala, 0, 0);
  ctx.drawImage(img, 0, 0, w, h);
  return cv;
}
async function svgParaPNG(svgEl, nome) {
  if (!svgEl) return;
  try {
    const cv = await rasterizaSVG(svgEl, 2);
    cv.toBlob(b => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = nome + '.png';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
    });
  } catch (e) { alerta('Não consegui gerar o PNG neste navegador. Use “Imprimir / PDF”.'); }
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

function salvarComo(nome) {
  state.nome = nome;
  const l = lerProjetos();
  l[nome] = JSON.parse(JSON.stringify(state)); l[nome].quando = Date.now();
  gravarProjetos(l); $('#dlg').close(); toast('Projeto “' + nome + '” salvo.');
}

function dlgSalvar() {
  abrirDlg('Salvar projeto',
    '<div class="campo"><label for="nomeProj">Nome do projeto</label><input id="nomeProj" value="' + esc(state.nome || '') + '" style="font-family:var(--texto)"></div>' +
    '<p class="hint" style="margin-bottom:0">Fica guardado neste aparelho, no próprio navegador.</p>',
    [['Cancelar', () => $('#dlg').close()],
    ['Salvar', () => {
      const nome = ($('#nomeProj').value || '').trim() || 'Sem nome';
      /* Se já existe OUTRO projeto com esse nome, pergunta antes de sobrescrever.
         Salvar de novo o projeto que está aberto não pergunta nada. */
      if (lerProjetos()[nome] && nome !== state.nome) {
        abrirDlg('Substituir projeto', '<p>Já existe um projeto chamado <b>' + esc(nome) + '</b> neste aparelho. Substituir pelo projeto atual?</p>',
          [['Voltar', dlgSalvar], ['Substituir', () => salvarComo(nome), true]]);
      } else salvarComo(nome);
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
    ['Importar MS Project (.xml)', importarMSProject],
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
    nome: 'Relações PDM (II, TT e atraso)', modo: 'cpm', unidade: 'd',
    acts: [['A', 'Projeto', 4, []], ['B', 'Terraplenagem', 6, ['A']], ['C', 'Fundação', 8, ['B(II+3)']],
    ['D', 'Estrutura', 10, ['C(TT+2)']], ['E', 'Instalações', 5, ['C(+1)']], ['F', 'Entrega', 2, ['D', 'E']]]
  },
  {
    nome: 'Recursos (nivelamento)', modo: 'cpm', unidade: 'd', recLim: 5,
    rec: [2, 3, 2, 3, 2, 3, 1], rec2: [1, 0, 1, 0, 1, 1, 0], recNomes: ['equipe', 'guindaste', ''],
    acts: [['A', 'Preparação', 3, []], ['B', 'Módulo 1', 3, ['A']], ['C', 'Módulo 2', 5, ['A']], ['D', 'Módulo 3', 2, ['A']],
    ['E', 'Integração 1', 4, ['B']], ['F', 'Integração 2', 3, ['C', 'D']], ['G', 'Entrega', 2, ['E', 'F']]]
  },
  {
    nome: 'Cenário · Obra residencial (15 atividades)', modo: 'cpm', unidade: 'd', custoDir: 150000, custoInd: 900, recNomes: ['operários', '', ''],
    acts: [['A', 'Licenças e projeto', 5, [], 3, 200, 2], ['B', 'Terraplenagem', 10, ['A'], 7, 250, 3], ['C', 'Fundação', 15, ['B'], 12, 300, 4], ['D', 'Estrutura térreo', 8, ['C'], 5, 350, 5],
    ['E', 'Alvenaria', 12, ['C'], 9, 400, 2], ['F', 'Laje', 6, ['D'], 3, 450, 3], ['G', 'Instalação elétrica', 9, ['D', 'E'], 6, 500, 4], ['H', 'Instalação hidráulica', 7, ['E'], 4, 550, 5],
    ['I', 'Telhado', 10, ['F', 'G'], 7, 600, 2], ['J', 'Reboco', 5, ['G', 'H'], 2, 650, 3], ['K', 'Esquadrias', 8, ['I'], 5, 700, 4], ['L', 'Piso', 6, ['J'], 3, 750, 5],
    ['M', 'Pintura', 4, ['K', 'L'], 1, 800, 2], ['N', 'Limpeza', 3, ['M'], 1, 850, 3], ['O', 'Vistoria e entrega', 2, ['N'], 1, 900, 4]]
  },
  {
    nome: 'Cenário · Software com incerteza alta (PERT)', modo: 'pert', unidade: 's',
    acts: [['A', 'Levantamento de requisitos', [2, 4, 12], []], ['B', 'Arquitetura', [3, 6, 20], ['A']], ['C', 'Protótipo de telas', [1, 3, 9], ['A']],
    ['D', 'Desenvolvimento do núcleo', [4, 8, 30], ['B']], ['E', 'Desenvolvimento das telas', [2, 5, 15], ['C']], ['F', 'Integração', [3, 5, 10], ['D', 'E']],
    ['G', 'Testes automatizados', [1, 2, 8], ['F']], ['H', 'Testes com usuários', [2, 4, 16], ['F']], ['I', 'Correções', [1, 2, 5], ['G', 'H']], ['J', 'Implantação', [1, 1, 3], ['I']]]
  },
  {
    nome: 'Cenário · Evento com sobreposição (PDM)', modo: 'cpm', unidade: 'd',
    acts: [['A', 'Contratação do local', 10, []], ['B', 'Divulgação', 6, ['A']], ['C', 'Inscrições', 8, ['A(II+3)']], ['D', 'Credenciamento', 5, ['B', 'C(TT+1)']],
    ['E', 'Montagem', 4, ['C(-2)']], ['F', 'Ensaio geral', 3, ['D', 'E']], ['G', 'Abertura', 2, ['F(II+1)']], ['H', 'Evento e encerramento', 1, ['F', 'G']]]
  },
  {
    nome: 'Projeto para compressão', modo: 'cpm', unidade: 'd', custoDir: 12000, custoInd: 500,
    acts: [['A', 'Projeto', 6, [], 4, 800], ['B', 'Fundação', 8, ['A'], 5, 900],
    ['C', 'Instalações', 5, ['A'], 3, 400], ['D', 'Estrutura', 7, ['B'], 4, 1100],
    ['E', 'Acabamento', 4, ['C'], 3, 300], ['F', 'Entrega', 3, ['D', 'E'], 2, 600]]
  },
  {
    nome: 'Electrolux TF41B · lançamento (PERT, semanas)', modo: 'pert', unidade: 's',
    acts: [['A', 'Projeto detalhado do gabinete', [3, 5, 7], [], 3, 8], ['B', 'Homologação do compressor importado', [10, 14, 24], [], 10, 12],
    ['C', 'Adaptação da linha de injeção (PU)', [5, 8, 11], ['A'], 5, 5], ['D', 'Compra e setup do ferramental', [4, 6, 8], ['A'], 4, 6],
    ['E', 'Testes elétricos e de eficiência', [3, 4, 5], ['B', 'C'], 3, 7], ['F', 'Embalagem e plano logístico', [2, 3, 4], ['D'], 2, 4],
    ['G', 'Lote piloto e validação', [4, 6, 8], ['E'], 4, 9], ['H', 'Homologação Inmetro e PROCEL', [5, 8, 11], ['F', 'G'], 5, 10]]
  }
];
/* Exemplo guiado da aba Dados: 4 atividades, resultado conhecido (12 dias, A → B → D, folga de C = 2).
   Também é o estado da primeira visita: números com sentido, sem avisos sobre uma tabela vazia. */
function estadoExemploGuiado() {
  const st = estadoVazio();
  st.nome = 'Exemplo guiado';
  st.acts = [['A', 'Projeto', 3, []], ['B', 'Fundação', 4, ['A']], ['C', 'Instalações', 2, ['A']], ['D', 'Entrega', 5, ['B', 'C']]].map(x => {
    const o = novoAtv(x[0], x[1]); o.d = x[2]; o.o = x[2]; o.m = x[2]; o.p = x[2]; o.preds = x[3]; return o;
  });
  return st;
}
function carregarExemploMini() {
  carregar(estadoExemploGuiado());
  toast('Exemplo carregado: confira 12 dias e ' + 'A → B → D.');
}

function carregarExemplo(i) {
  const ex = EXEMPLOS[i]; if (!ex) return;
  if (typeof registraUso === 'function') registraUso('ex', ex.nome);
  const st = estadoVazio();
  st.nome = ex.nome; st.modo = ex.modo; st.unidade = ex.unidade || 'd';
  st.custoDir = ex.custoDir || ''; st.custoInd = ex.custoInd || '';
  if (ex.recLim) { st.recLim = ex.recLim; st.recModo = 'limite'; }
  if (ex.recNomes) st.recNomes = ex.recNomes.slice();
  st.acts = ex.acts.map(a => {
    const o = novoAtv(a[0], a[1]);
    if (ex.modo === 'pert') { o.o = a[2][0]; o.m = a[2][1]; o.p = a[2][2]; o.d = a[2][1]; }
    else { o.d = a[2]; o.o = a[2]; o.m = a[2]; o.p = a[2]; }
    const pr = leiaPredsRel(a[3].join(', '), null); o.preds = pr.preds; o.rel = pr.rel;
    if (ex.rec) o.rec = ex.rec[ex.acts.indexOf(a)];
    if (ex.rec2) o.rec2 = ex.rec2[ex.acts.indexOf(a)];
    if (a.length > 4) { o.dmin = a[4]; o.cc = a[5]; }
    if (a.length > 6) o.rec = a[6];
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
  const ehNum = v => /^[-+]?(R\$)?[\d.,]+$/.test(String(v == null ? '' : v).replace(/\s/g, ''));
  const codsColados = new Set(linhas.map(l => ((l.indexOf('\t') >= 0 ? l.split('\t') : l.split(/;|\s{2,}/))[0] || '').trim().toUpperCase()));
  const listaPreds = cols => leiaPredsRel(cols.join(','), codsColados);
  linhas.forEach((l, i) => {
    /* Do Excel vem tabulação: aí só ela separa colunas, e "A;B" dentro da célula de
       predecessoras continua sendo uma lista. Sem tabulação, separa por ; ou 2+ espaços. */
    const col = (l.indexOf('\t') >= 0 ? l.split('\t') : l.split(/;|\s{2,}/)).map(x => x.trim());
    if (!col.length || !col[0]) return;
    if (i === 0 && !ehNum(col[1]) && /c[oó]d|atividade|tarefa|dura/i.test(col.join(' '))) return;
    /* coluna de nome opcional: código · nome · duração · predecessoras */
    let k = 1, nome = '';
    if (col.length > 2 && !ehNum(col[1]) && ehNum(col[2])) { nome = col[1]; k = 2; }
    const a = novoAtv(String(col[0]).toUpperCase(), nome);
    if (pert) { a.o = num(col[k]); a.m = num(col[k + 1]); a.p = num(col[k + 2]); a.d = a.m; const pr = listaPreds(col.slice(k + 3)); a.preds = pr.preds; a.rel = pr.rel; }
    else { a.d = num(col[k]); const pr = listaPreds(col.slice(k + 1)); a.preds = pr.preds; a.rel = pr.rel; }
    novas.push(a);
  });
  if (!novas.length) { alerta('Não identifiquei nenhuma atividade no texto colado.'); return; }
  if ((substituir ? 0 : state.acts.length) + novas.length > MAX_ATIV) { alerta('O texto colado tem ' + novas.length + ' atividades e passaria do limite de ' + MAX_ATIV + ' por projeto. Nada foi importado.'); return; }
  state.acts = substituir ? novas : state.acts.concat(novas);
  renderDados(); renderCrashTabela(); recalcular();
  $('#painelColar').hidden = true;
  toast(novas.length + ' atividades importadas.');
}

/* ============================================================
   MODAIS E AVISOS
   ============================================================ */
function abrirDlg(titulo, corpo, botoes) {
  $('#dlgTitulo').innerHTML = titulo;   /* só recebe texto fixo do próprio app, nunca dado digitado */
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
const alertaHtml = html => abrirDlg('Atenção', '<p>' + html + '</p>', [['Entendi', () => $('#dlg').close(), true]]);   /* só texto fixo do app */
let toastT = null;
const VERSAO = 'v31';   /* igual ao CACHE do sw.js; aparece no rodapé para identificar a versão em relatos de problema */
function toast(msg, confiavel) {
  let el = $('#toast');
  if (!el) {
    el = document.createElement('div'); el.id = 'toast';
    el.style.cssText = 'position:fixed;left:50%;bottom:24px;transform:translateX(-50%);background:#16243B;color:#F1EEE8;padding:12px 18px;border-radius:4px;font-size:14px;z-index:99;opacity:0;transition:.2s;max-width:90vw';
    document.body.appendChild(el);
  }
  if (confiavel) el.innerHTML = msg; else el.textContent = msg;   /* HTML só para texto fixo do app (itálico em estrangeirismo) */
  el.style.opacity = '1';
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

/* Identificador aleatório e anônimo, só para a assistente dividir o limite de uso entre
   as pessoas de uma mesma rede (laboratório, sala de aula). Não tem relação com ninguém. */
function idCliente() {
  try {
    let id = localStorage.getItem('pertcpm.cliente');
    if (!id) {
      const v = new Uint8Array(12); crypto.getRandomValues(v);
      id = Array.from(v).map(b => b.toString(16).padStart(2, '0')).join('');
      localStorage.setItem('pertcpm.cliente', id);
    }
    return id;
  } catch (e) { return ''; }
}

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
    const r = await fetch('/api/agente', { method: 'POST', headers: { 'content-type': 'application/json', 'x-cliente': idCliente() }, body: JSON.stringify({ texto: texto, modo: modo }) });
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
      limite: 'Você já usou a assistente várias vezes nesta hora. Tente de novo mais tarde — enquanto isso, escrever uma atividade por linha continua funcionando.',
      indisponivel: 'A assistente com IA está indisponível no momento. Enquanto isso, escrever uma atividade por linha continua funcionando.',
      limite_geral: 'A assistente atingiu o limite de uso de hoje. Tente amanhã — enquanto isso, escrever uma atividade por linha continua funcionando.',
      rede: 'Sem conexão com o servidor. A calculadora continua funcionando <i>offline</i>.'
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
  if (!substituir) {
    /* A assistente sempre numera a partir de A; ao acrescentar, renomeia o que colidir
       com as atividades que já estão na tabela, e ajusta as predecessoras junto. */
    const usados = new Set(state.acts.map(a => String(a.id).toUpperCase()));
    const troca = new Map();
    novas.forEach(o => { let id = o.id; if (usados.has(id)) id = proxId(Array.from(usados).map(x => ({ id: x }))); usados.add(id); troca.set(o.id, id); });
    novas.forEach(o => { o.id = troca.get(o.id) || o.id; o.preds = o.preds.map(p => troca.get(p) || p); });
  }
  if (!substituir && !cabeMais(novas.length)) return;
  state.acts = substituir ? novas : state.acts.concat(novas);
  $('#unidade').value = state.unidade;
  $$('#segModo button').forEach(b => b.classList.toggle('on', b.dataset.m === state.modo));
  renderDados(); renderCrashTabela(); recalcular();
  $('#dlgAgente').close();
  toast(novas.length + ' atividades ' + (substituir ? 'aplicadas' : 'acrescentadas') + '. Confira antes de usar.');
  irPara('dados');
}

/* ============================================================
   CONTATO
   O link mailto: só abre se o aparelho tiver um programa de e-mail
   configurado — em muito computador não tem, e o clique não faz nada.
   Por isso o botão abre um modal com o endereço, cópia em um clique
   e atalhos para o webmail.
   ============================================================ */
const EMAIL_CONTATO = 'laura.valencia@facc.ufrj.br';
const ASSUNTO_CONTATO = 'Calculadora PERT/CPM';

function dlgContato() {
  const assunto = encodeURIComponent(ASSUNTO_CONTATO);
  const gmail = 'https://mail.google.com/mail/?view=cm&fs=1&to=' + encodeURIComponent(EMAIL_CONTATO) + '&su=' + assunto;
  const outlook = 'https://outlook.live.com/mail/0/deeplink/compose?to=' + encodeURIComponent(EMAIL_CONTATO) + '&subject=' + assunto;
  abrirDlg('Entre em contato',
    '<p style="margin-top:0">Escreva para:</p>' +
    '<div class="item"><div class="t"><b class="mono" id="ctEmail">' + esc(EMAIL_CONTATO) + '</b>' +
    '<span>Dúvida sobre o cálculo, sugestão ou erro encontrado.</span></div>' +
    '<button class="bt mini" id="ctCopiar">Copiar</button></div>' +
    '<p class="hint">Ou abra direto no seu <i>webmail</i>:</p>' +
    '<div style="display:flex;gap:8px;flex-wrap:wrap">' +
    '<a class="bt mini" href="' + gmail + '" target="_blank" rel="noopener" style="text-decoration:none">Gmail</a>' +
    '<a class="bt mini" href="' + outlook + '" target="_blank" rel="noopener" style="text-decoration:none">Outlook</a>' +
    '<a class="bt mini" href="mailto:' + EMAIL_CONTATO + '?subject=' + assunto + '" style="text-decoration:none">Programa de e-mail do computador</a>' +
    '</div>',
    [['Fechar', () => $('#dlg').close(), true]]);
  const bt = $('#ctCopiar');
  if (bt) bt.onclick = () => {
    const ok = () => { bt.textContent = 'Copiado'; setTimeout(() => { bt.textContent = 'Copiar'; }, 2000); };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(EMAIL_CONTATO).then(ok).catch(() => selecionaEmail());
    } else selecionaEmail();
  };
}
function selecionaEmail() {
  const el = $('#ctEmail'); if (!el) return;
  const faixa = document.createRange(); faixa.selectNodeContents(el);
  const sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(faixa);
  toast('Selecionei o endereço — use Ctrl+C para copiar.');
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
  if (typeof registraUso === 'function') registraUso('aba', p);
  $$('#tabs .aba').forEach(t => { const on = t.dataset.p === p; t.classList.toggle('on', on); t.setAttribute('aria-selected', on ? 'true' : 'false'); });
  const ativa = $('#tabs .aba.on'); if (ativa && ativa.scrollIntoView) ativa.scrollIntoView({ inline: 'center', block: 'nearest' });   /* no celular, o menu rola até a aba ativa */
  $$('.painel').forEach(x => x.classList.toggle('on', x.id === 'p-' + p));
  const pn = $('#p-' + p); if (pn && document.activeElement && document.activeElement.closest && !document.activeElement.closest('#p-' + p)) { try { pn.focus({ preventScroll: true }); } catch (e) { } }   /* leitor de tela e teclado seguem para o conteúdo */
  if (p === 'crash') renderCrashTabela();
  if (p === 'recursos') renderRec();
  if (p === 'ccpm') renderCCPM();
  if (p === 'controle') renderControle();
  if (p === 'pratica' && typeof renderPratica === 'function') renderPratica();
  gravarEstado();
}

function recalcular() {
  invalidaCompressao();
  calcOut = calcular();
  aplicaNotacao();
  renderAvisos(); renderResumo();
  if (state.modo === 'pert') $$('#tblDados td[data-te]').forEach(td => {
    const a = state.acts[+td.getAttribute('data-te')];
    td.textContent = fmt((num(a.o) + 4 * num(a.m) + num(a.p)) / 6);
  });
  if (calcOut.ciclo || !calcOut.acts.length) {
    ['#stageRede', '#stageGantt'].forEach(s => { $(s).innerHTML = '<p class="hint" style="padding:24px">Sem rede válida para desenhar.</p>'; });
    $('#tblResult').innerHTML = ''; $('#listaCaminhos').innerHTML = '';
    renderRec(); renderCCPM(); renderControle(); renderDidatica();
    gravarEstado();
    return;
  }
  renderResultados(); renderRede(); renderGantt(); renderPert(); renderRec(); renderCCPM(); renderControle(); renderDidatica();
  gravarEstado();
}

/* Ao trocar de modo, leva as durações junto. CPM→PERT parte de o = m = p = duração
   (onde as três estimativas ainda estão no padrão); PERT→CPM usa o te. Antes, trocar
   para PERT zerava tudo para 1, porque as estimativas começam em 1. */
function converteModo(novo) {
  if (novo === state.modo) return;
  state.acts.forEach(a => {
    const padrao = num(a.o) === 1 && num(a.m) === 1 && num(a.p) === 1;
    if (novo === 'pert') {
      if (padrao && num(a.d) !== 1) { a.o = a.d; a.m = a.d; a.p = a.d; }
    } else if (!(padrao && num(a.d) !== 1)) {
      a.d = Math.round(((num(a.o) + 4 * num(a.m) + num(a.p)) / 6) * 1000) / 1000;
    }
  });
  state.modo = novo;
}

/* Aceita qualquer JSON — do armazenamento, de um projeto salvo ou de uma importação — e
   devolve um estado que o resto do app consegue usar. Campo fora do formato vira o padrão.
   Sem isso, um arquivo importado com "preds" em texto derrubava o app, e como o estado era
   gravado ao sair, ele ficava quebrado a cada abertura seguinte. */
function normalizaEstado(novo) {
  const o = (novo && typeof novo === 'object' && !Array.isArray(novo)) ? novo : {};
  const st = Object.assign(estadoVazio(), o);
  st.modo = st.modo === 'pert' ? 'pert' : 'cpm';
  st.unidade = ['d', 's', 'm'].indexOf(st.unidade) >= 0 ? st.unidade : 'd';
  st.uteis = Number(st.uteis) === 1 ? 1 : 0;
  st.nome = String(st.nome == null ? '' : st.nome).slice(0, 120) || 'Novo projeto';
  st.inicio = /^\d{4}-\d{2}-\d{2}$/.test(String(st.inicio)) ? String(st.inicio) : '';
  ['custoInd', 'custoDir', 'prazoAlvo'].forEach(k => { st[k] = (typeof st[k] === 'number' || typeof st[k] === 'string') ? st[k] : ''; });
  st.aba = ['inicio', 'dados', 'result', 'rede', 'gantt', 'pert', 'calend', 'crash', 'recursos', 'ccpm', 'controle', 'pratica', 'guia', 'contato'].indexOf(st.aba) >= 0 ? st.aba : 'dados';
  st.notacao = st.notacao === 'intl' ? 'intl' : 'disc';
  st.recModo = st.recModo === 'limite' ? 'limite' : 'alisar';
  ['recLim2', 'recLim3', 'statusT', 'ccAvanco', 'ccConsumo'].forEach(k => { st[k] = (typeof st[k] === 'number' || typeof st[k] === 'string') ? st[k] : ''; });
  st.ccCorte = (typeof st.ccCorte === 'number' || typeof st.ccCorte === 'string') && String(st.ccCorte).trim() !== '' ? st.ccCorte : 50;
  st.ccMetodo = st.ccMetodo === 'rss' ? 'rss' : 'metade';
  st.mcDist = ['beta', 'tri', 'uni', 'normal'].indexOf(st.mcDist) >= 0 ? st.mcDist : 'beta';
  st.recNomes = (Array.isArray(st.recNomes) ? st.recNomes : []).slice(0, 3).map(x => String(x == null ? '' : x).slice(0, 24)); while (st.recNomes.length < 3) st.recNomes.push('');
  st.marcos = (Array.isArray(st.marcos) ? st.marcos : []).slice(0, 30).filter(m => m && typeof m === 'object').map(m => ({ nome: String(m.nome == null ? '' : m.nome).slice(0, 60), ref: String(m.ref == null ? '__fim' : m.ref).trim().toUpperCase().slice(0, 6) || '__fim', alvo: (typeof m.alvo === 'number' || typeof m.alvo === 'string') ? m.alvo : '' }));
  st.marcos.forEach(m => { if (m.ref === '__FIM') m.ref = '__fim'; });
  if (st.baseline && typeof st.baseline === 'object' && st.baseline.acts && typeof st.baseline.acts === 'object') {
    const acts = {}; Object.keys(st.baseline.acts).slice(0, MAX_ATIV).forEach(id => { const b = st.baseline.acts[id]; if (b && isFinite(+b.ES) && isFinite(+b.EF)) acts[String(id).slice(0, 6)] = { ES: +b.ES, EF: +b.EF, dur: isFinite(+b.dur) ? +b.dur : +b.EF - +b.ES }; });
    st.baseline = { quando: String(st.baseline.quando == null ? '' : st.baseline.quando).slice(0, 40), dur: isFinite(+st.baseline.dur) ? +st.baseline.dur : 0, acts };
  } else st.baseline = null;
  st.recRegra = ['folga', 'maior', 'recurso'].indexOf(st.recRegra) >= 0 ? st.recRegra : 'folga';
  st.recLim = (typeof st.recLim === 'number' || typeof st.recLim === 'string') ? st.recLim : '';
  st.acts = (Array.isArray(st.acts) ? st.acts : []).slice(0, MAX_ATIV).filter(a => a && typeof a === 'object' && !Array.isArray(a)).map(a => {
    const x = Object.assign(novoAtv('A'), a);
    x.id = String(x.id == null ? '' : x.id).trim().toUpperCase().slice(0, 6);
    x.nome = String(x.nome == null ? '' : x.nome).slice(0, 120);
    x.preds = (Array.isArray(x.preds) ? x.preds : String(x.preds == null ? '' : x.preds).split(/[,;\s]+/))
      .map(p => String(p).trim().toUpperCase()).filter(Boolean);
    const r0 = (x.rel && typeof x.rel === 'object' && !Array.isArray(x.rel)) ? x.rel : {};
    ['rec', 'rec2', 'rec3', 'custo', 'real', 'gasto', 'prob'].forEach(k => { x[k] = (typeof x[k] === 'number' || typeof x[k] === 'string') ? x[k] : ''; });
    x.rel = {};
    x.preds.forEach(p => {
      if (!Object.prototype.hasOwnProperty.call(r0, p)) return;
      const q = r0[p]; if (!q || typeof q !== 'object') return;
      const t = REL_ALIAS[String(q.t).toUpperCase()], lag = Number(q.lag);
      if (t && isFinite(lag) && Math.abs(lag) <= 1e6 && !(t === 'TI' && !lag)) x.rel[p] = { t, lag };
    });
    return x;
  });
  return st;
}

function carregar(novo) {
  const excesso = novo && Array.isArray(novo.acts) && novo.acts.length > MAX_ATIV;
  state = normalizaEstado(novo);
  if (excesso) setTimeout(() => alerta('O projeto tinha mais de ' + MAX_ATIV + ' atividades; abri só as ' + MAX_ATIV + ' primeiras.'), 0);
  $('#dtInicio').value = state.inicio || '';
  $('#unidade').value = state.unidade || 'd';
  $('#uteis').value = String(state.uteis || 0);
  $('#custoInd').value = state.custoInd || '';
  $('#custoInd2').value = state.custoInd || '';
  $('#notacao').value = state.notacao;
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

  $('#tblDados').addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.target.tagName !== 'INPUT') return;
    e.preventDefault();
    const tr = e.target.closest('tr'); if (!tr) return;
    const f = e.target.dataset.f, i = +tr.dataset.i;
    if (i >= state.acts.length - 1) {
      if (!cabeMais(1)) return;
      state.acts.push(novoAtv(proxId(state.acts))); renderDados(); recalcular();
    }
    const prox = $('#tblDados tr[data-i="' + (i + 1) + '"] input[data-f="' + (f === 'preds' || f === 'nome' ? f : 'id') + '"]') || $('#tblDados tr[data-i="' + (i + 1) + '"] input');
    if (prox) { prox.focus(); if (prox.select) prox.select(); }
  });
  $('#tblDados').addEventListener('input', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    lerCampo(+tr.dataset.i, e.target.dataset.f, e.target.value);
    recalcular();
  });
  /* Ao sair do campo de predecessoras, reescreve o texto já corrigido ("A-B" → "A, B") e avisa. */
  $('#tblDados').addEventListener('change', e => {
    if (e.target.dataset.f !== 'preds') return;
    const tr = e.target.closest('tr'); const a = tr && state.acts[+tr.dataset.i]; if (!a) return;
    const original = e.target.value, corrigido = textoPreds(a);
    const trocouSeparador = SEP_ALT.test(original.replace(/\([^)]*\)/g, '')) && corrigido.replace(/\s/g, '') !== original.replace(/\s/g, '').toUpperCase();
    if (original.trim() !== corrigido) e.target.value = corrigido;
    if (trocouSeparador) toast('Separador corrigido: “' + original.trim() + '” virou “' + corrigido + '”. Use vírgula entre as predecessoras.');
  });
  $('#tblDados').addEventListener('click', e => {
    const d = e.target.getAttribute('data-del'); if (d === null) return;
    state.acts.splice(+d, 1);
    renderDados(); renderCrashTabela(); recalcular();
  });
  $('#tblCrash').addEventListener('input', e => {
    const tr = e.target.closest('tr'); if (!tr) return;
    const a = state.acts[+tr.dataset.i]; if (!a) return;
    a[e.target.dataset.cf] = e.target.value; invalidaCompressao(); gravarEstado();
  });

  $('#btnAdd').onclick = () => { if (!cabeMais(1)) return; state.acts.push(novoAtv(proxId(state.acts))); renderDados(); recalcular(); };
  $('#btnAdd5').onclick = () => { if (!cabeMais(5)) return; for (let i = 0; i < 5; i++) state.acts.push(novoAtv(proxId(state.acts))); renderDados(); recalcular(); };
  $('#btnLimpar').onclick = () => abrirDlg('Limpar tudo', '<p>Isso apaga as atividades da tela. Projetos salvos continuam guardados.</p>',
    [['Cancelar', () => $('#dlg').close()], ['Apagar', () => { const antes = JSON.stringify(state); carregar(estadoVazio()); $('#dlg').close(); toastAcao('Atividades apagadas.', 'Desfazer', () => { carregar(normalizaEstado(JSON.parse(antes))); toast('Atividades restauradas.'); }); }, true]]);
  $('#btnColar').onclick = () => { const p = $('#painelColar'); p.hidden = !p.hidden; if (!p.hidden) $('#taColar').focus(); };
  $('#btnImportar').onclick = () => colar($('#taColar').value, $('#chkSubstituir').checked);

  $('#segModo').addEventListener('click', e => {
    const b = e.target.closest('button'); if (!b) return;
    converteModo(b.dataset.m);
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
  $('#notacao').addEventListener('change', () => { state.notacao = $('#notacao').value === 'intl' ? 'intl' : 'disc'; recalcular(); if (typeof renderPratica === 'function') renderPratica(); });
  $('#custoDir').addEventListener('input', () => { state.custoDir = $('#custoDir').value; invalidaCompressao(); gravarEstado(); });
  $('#prazoAlvo').addEventListener('input', () => { state.prazoAlvo = $('#prazoAlvo').value; invalidaCompressao(); gravarEstado(); });
  $('#custoInd2').addEventListener('input', () => { state.custoInd = $('#custoInd2').value; $('#custoInd').value = state.custoInd; invalidaCompressao(); gravarEstado(); });

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

  $('#btnContato').onclick = dlgContato;
  $('#btnMC').onclick = mcRodar;
  $('#mcDist').onchange = e => { state.mcDist = e.target.value; mcRes = null; renderMC(); gravarEstado(); };
  $('#tblPert').addEventListener('input', e => { const i = e.target.getAttribute('data-prob'); if (i === null || !state.acts[+i]) return; state.acts[+i].prob = e.target.value; mcRes = null; renderMC(); gravarEstado(); });
  montaPassos(); ligaTips();
  const vs = $('#versao'); if (vs) vs.textContent = VERSAO;
  /* seta à direita do menu enquanto houver abas escondidas */
  const nav = $('nav.abas'), tabs = $('#tabs');
  const sinal = () => { if (nav && tabs) nav.classList.toggle('mais', tabs.scrollWidth - tabs.clientWidth - tabs.scrollLeft > 6); };
  if (tabs) { tabs.addEventListener('scroll', sinal, { passive: true }); addEventListener('resize', sinal); setTimeout(sinal, 50); }
  $('#btnZmMenos').onclick = () => { zoomRede = Math.max(0.3, +(zoomRede - 0.2).toFixed(2)); renderRede(); };
  $('#btnZmAjustar').onclick = () => { const w = $('#stageRede').clientWidth - 2; if (redeLarg > 0 && w > 0) { zoomRede = Math.max(0.3, Math.min(2.4, +(w / redeLarg).toFixed(2))); renderRede(); } };
  $('#btnZmMais').onclick = () => { zoomRede = Math.min(2.4, +(zoomRede + 0.2).toFixed(2)); renderRede(); };
  ligarRecursos(); ligarControle(); ligarCCPM(); ligarDidatica(); ligarExtras();
  $('#btnExemploMini').onclick = carregarExemploMini;
  $('#btnHeroEx').onclick = () => { carregarExemploMini(); irPara('result'); scrollTo(0, 0); };
  /* lembra se a pessoa fechou o passo a passo */
  const det = $('#comoPreencher');
  try { if (localStorage.getItem('pertcpm.ajuda') === 'fechada') det.open = false; } catch (e) { }
  det.addEventListener('toggle', () => { try { localStorage.setItem('pertcpm.ajuda', det.open ? 'aberta' : 'fechada'); } catch (e) { } });
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

  /* botões de avanço entre os passos (data-ir="aba") */
  document.addEventListener('click', e => { const b = e.target.closest('[data-ir]'); if (b) { irPara(b.dataset.ir); scrollTo(0, 0); if (b.dataset.foco) setTimeout(() => { const f = $(b.dataset.foco); if (f) { f.focus(); if (f.select) f.select(); } }, 60); } });
  document.addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') { e.preventDefault(); dlgSalvar(); }
  });
}
function pararAnimacao() { if (animando) { clearInterval(animando); animando = null; } $('#btnPlay').textContent = '▶ Animar'; }

/* ---------- arranque ---------- */
(function () {
  ligar();
  const salvo = lerEstado();
  try { carregar(salvo || estadoExemploGuiado()); }
  catch (e) {
    /* Rede de segurança: se mesmo assim o estado salvo não servir, guarda uma cópia
       e recomeça limpo, em vez de deixar o app quebrado a cada abertura. */
    try { localStorage.setItem(CHAVE_ESTADO + '.quebrado', JSON.stringify(salvo)); localStorage.removeItem(CHAVE_ESTADO); } catch (_) { }
    carregar(estadoVazio());
    toast('Não consegui abrir o projeto anterior; comecei um novo.');
  }
  /* Link direto da aula: ?exemplo=tf41b abre o caso Electrolux pronto (T = 33 semanas, B → E → G → H). */
  try { if (/[?&]exemplo=tf41b\b/i.test(location.search)) carregarExemplo(EXEMPLOS.findIndex(e => /TF41B/.test(e.nome))); } catch (e) { }
  try { if (typeof iniciaPratica === 'function') iniciaPratica(); } catch (e) { }
  try { projAbrirPorLink(); } catch (e) { }
  addEventListener('beforeunload', gravarEstado);
  contarVisita();
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => { });
})();
