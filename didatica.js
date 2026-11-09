/* Camada didática: explicação de cada número, cálculo passo a passo, realce cruzado tabela ↔ desenhos,
   linha do tempo no Gantt, prévia da rede, modo aluno na compressão e termos com definição.
   Carregado antes de app.js: só declara funções; usa os globais do app na hora da chamada. */
'use strict';

/* ---------- explicação de uma atividade, com os números ---------- */
function explicaAtividade(c, id) {
  const n = c.N.get(id); if (!n) return '';
  const S = k => '<b class="sg" data-s="' + k + '">' + sg(k) + '</b>';
  const li = [];
  if (!n.preds.length) li.push('<li>' + S('ES') + ' de <b>' + esc(id) + '</b> = <b>0</b>: não tem predecessora, começa junto com o projeto.</li>');
  else {
    const partes = n.preds.map(p => { const pn = c.N.get(p), r = n.rel.get(p) || REL0; const w = c.peso(pn, n); return r.t === 'TI' && !r.lag ? sg('EF') + '(' + esc(p) + ') = ' + fmt(pn.EF) : sg('ES') + '(' + esc(p) + ') + ' + fmt(w) + ' = ' + fmt(pn.ES + w); });
    li.push('<li>' + S('ES') + ' de <b>' + esc(id) + '</b> = maior entre ' + partes.join(', ') + ' = <b>' + fmt(n.ES) + '</b>' + (n.preds.length > 1 ? ': espera a última predecessora terminar.' : '.') + '</li>');
  }
  li.push('<li>' + S('EF') + ' = ' + sg('ES') + ' + duração = ' + fmt(n.ES) + ' + ' + fmt(n.dur) + ' = <b>' + fmt(n.EF) + '</b>.</li>');
  if (!n.succs.length) li.push('<li>' + S('LF') + ' = <b>' + fmt(n.LF) + '</b>: não tem sucessora, pode terminar junto com o projeto (' + fmt(c.dur) + ').</li>');
  else {
    const partes = n.succs.map(s => { const sn = c.N.get(s), r = sn.rel.get(id) || REL0; const w = c.peso(n, sn); return r.t === 'TI' && !r.lag ? sg('LS') + '(' + esc(s) + ') = ' + fmt(sn.LS) : sg('LS') + '(' + esc(s) + ') − ' + fmt(w) + ' + ' + fmt(n.dur) + ' = ' + fmt(sn.LS - w + n.dur); });
    li.push('<li>' + S('LF') + ' = menor entre ' + partes.join(', ') + ' = <b>' + fmt(n.LF) + '</b>: não pode atrasar a sucessora mais apertada.</li>');
  }
  li.push('<li>' + S('LS') + ' = ' + sg('LF') + ' − duração = ' + fmt(n.LF) + ' − ' + fmt(n.dur) + ' = <b>' + fmt(n.LS) + '</b>.</li>');
  li.push('<li><b>Folga total</b> = ' + sg('LS') + ' − ' + sg('ES') + ' = ' + fmt(n.LS) + ' − ' + fmt(n.ES) + ' = <b>' + fmt(n.FT) + '</b>' + (n.crit ? ' → <b style="color:var(--critico)">crítica</b>: qualquer atraso atrasa o projeto.' : ' → pode atrasar até ' + fmt(n.FT) + ' ' + uni(n.FT) + ' sem atrasar o projeto.') + '</li>');
  if (n.succs.length) li.push('<li><b>Folga livre</b> = menor ' + sg('ES') + ' das sucessoras − ' + sg('EF') + ' = ' + fmt(n.FL + n.EF) + ' − ' + fmt(n.EF) + ' = <b>' + fmt(n.FL) + '</b>: quanto pode atrasar sem mexer em ninguém.</li>');
  return '<div class="explica"><div class="explica-t"><b>' + esc(id) + '</b>' + (n.nome ? ' · ' + esc(n.nome) : '') + ' <span class="hint">· dura ' + fmt(n.dur) + ' ' + uni(n.dur) + '</span><button class="bt mini noprint" data-fecha-explica style="margin-left:auto">fechar</button></div><ol class="explica-passos">' + li.join('') + '</ol></div>';
}

/* ---------- cálculo completo, na ordem em que se faz à mão ---------- */
function explicaTudo(c) {
  const ida = c.ordem.map(id => { const n = c.N.get(id); const base = n.preds.length ? 'max(' + n.preds.map(p => fmt(c.N.get(p).ES + c.peso(c.N.get(p), n))).join(', ') + ')' : '0'; return '<li><b>' + esc(id) + '</b>: ' + sg('ES') + ' = ' + base + ' = ' + fmt(n.ES) + ' · ' + sg('EF') + ' = ' + fmt(n.ES) + ' + ' + fmt(n.dur) + ' = <b>' + fmt(n.EF) + '</b></li>'; });
  const volta = c.ordem.slice().reverse().map(id => { const n = c.N.get(id); const base = n.succs.length ? 'min(' + n.succs.map(s => fmt(c.N.get(s).LS - c.peso(n, c.N.get(s)) + n.dur)).join(', ') + ')' : fmt(c.dur); return '<li><b>' + esc(id) + '</b>: ' + sg('LF') + ' = ' + base + ' = ' + fmt(n.LF) + ' · ' + sg('LS') + ' = ' + fmt(n.LF) + ' − ' + fmt(n.dur) + ' = <b>' + fmt(n.LS) + '</b> · folga ' + fmt(n.FT) + (n.crit ? ' <span class="tag">crítica</span>' : '') + '</li>'; });
  return '<div class="duas"><div><h4>1 · Ida (da esquerda para a direita)</h4><p class="hint" style="margin:0 0 6px">' + sg('ES') + ' = maior ' + sg('EF') + ' das predecessoras; ' + sg('EF') + ' = ' + sg('ES') + ' + duração. Duração do projeto = maior ' + sg('EF') + ' = <b>' + fmt(c.dur) + '</b>.</p><ol class="explica-passos">' + ida.join('') + '</ol></div>' +
    '<div><h4>2 · Volta (da direita para a esquerda)</h4><p class="hint" style="margin:0 0 6px">' + sg('LF') + ' = menor ' + sg('LS') + ' das sucessoras (a última recebe ' + fmt(c.dur) + '); ' + sg('LS') + ' = ' + sg('LF') + ' − duração; folga = ' + sg('LS') + ' − ' + sg('ES') + '.</p><ol class="explica-passos">' + volta.join('') + '</ol></div></div>';
}

/* ---------- realce cruzado: uma atividade escolhida fica em destaque na tabela, na rede e no Gantt ---------- */
let atvFoco = null;
function focarAtividade(id, origem) {
  atvFoco = (id && atvFoco === id) ? null : id;
  const c = calcOut; if (!c || !c.N) return;
  const viz = new Set(); if (atvFoco && c.N.get(atvFoco)) { viz.add(atvFoco); c.N.get(atvFoco).preds.forEach(p => viz.add(p)); c.N.get(atvFoco).succs.forEach(s => viz.add(s)); }
  document.querySelectorAll('[data-id]').forEach(el => { const meu = el.getAttribute('data-id'); el.classList.toggle('realce', !!atvFoco && meu === atvFoco); el.classList.toggle('vizinho', !!atvFoco && meu !== atvFoco && viz.has(meu)); el.classList.toggle('apagado', !!atvFoco && !viz.has(meu)); });
  const box = $('#explicaAtv'); if (box) box.innerHTML = atvFoco ? explicaAtividade(c, atvFoco) : '';
  const box2 = $('#explicaRede'); if (box2) box2.innerHTML = atvFoco ? explicaAtividade(c, atvFoco) : '';
  if (atvFoco && origem === 'tabela') { const b = $('#explicaAtv'); if (b) b.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); }
}

/* ---------- linha do tempo no Gantt ---------- */
let ganttT = null;   /* período escolhido no controle deslizante; null = sem linha */
function renderLinhaTempo() {
  const c = calcOut, r = $('#gTempo'), out = $('#gTempoTxt'); if (!r || !c || !c.acts.length) return;
  r.max = Math.ceil(c.dur); r.step = c.dur > 60 ? 1 : 0.5;
  if (ganttT === null || ganttT > c.dur) { r.value = 0; out.innerHTML = '<span class="hint">Arraste para ver o que está em andamento em cada período.</span>'; return; }
  r.value = ganttT;
  const em = c.acts.filter(n => n.ES - 1e-9 <= ganttT && ganttT < n.EF - 1e-9), feitas = c.acts.filter(n => n.EF - 1e-9 <= ganttT), falt = c.acts.filter(n => n.ES - 1e-9 > ganttT);
  out.innerHTML = '<b>Período ' + fmt(ganttT) + (state.inicio ? ' (' + fmtData(diaDoPeriodo(ganttT)) + ')' : '') + ':</b> em andamento <b>' + (em.length ? em.map(n => esc(n.id)).join(', ') : 'nada') + '</b> · concluídas: ' + feitas.length + ' · ainda não iniciadas: ' + falt.length + (em.some(n => n.crit) ? ' · <span style="color:var(--critico)">há atividade crítica em andamento: nada de atraso aqui</span>' : '');
}

/* ---------- prévia da rede na aba Dados ---------- */
function renderMiniRede() {
  const box = $('#miniRede'); if (!box) return;
  const c = calcOut;
  if (!c || !c.acts.length || c.ciclo || c.acts.length > 40) { box.innerHTML = c && c.acts.length > 40 ? '<p class="hint" style="margin:0">Prévia desligada acima de 40 atividades: veja a aba Rede.</p>' : ''; return; }
  const src = $('#stageRede svg'); if (!src) { box.innerHTML = ''; return; }
  const svg = src.cloneNode(true);
  svg.removeAttribute('width'); svg.removeAttribute('height'); svg.querySelectorAll('[data-tip]').forEach(el => el.removeAttribute('data-tip'));
  box.innerHTML = ''; box.appendChild(svg);
}

/* ---------- modo aluno na compressão: o aluno escolhe o que encurtar e compara com o algoritmo ---------- */
let alunoCrash = null;
function alunoIniciar() {
  const base = calcular(); if (base.erros.length || !base.acts.length) { alerta('Corrija os erros dos dados antes.'); return; }
  const dur = new Map(), dmin = new Map(), custo = new Map();
  state.acts.forEach(a => { const id = String(a.id).trim().toUpperCase(); if (!id) return; dur.set(id, durDe(a)); dmin.set(id, a.dmin === '' ? durDe(a) : Math.min(durDe(a), num(a.dmin))); custo.set(id, a.cc === '' ? Infinity : num(a.cc)); });
  alunoCrash = { dur, dmin, custo, gasto: 0, passos: [], inicio: base.dur };
  renderAluno();
}
function renderAluno() {
  const box = $('#alunoSaida'); if (!box) return;
  if (!alunoCrash) { box.innerHTML = '<p class="hint" style="margin:0">Aqui você faz a compressão na mão: a cada passo escolhe qual atividade crítica encurtar em 1 período e vê o custo. No fim, compare com o que o algoritmo faria.</p><button class="bt primario mini noprint" id="btnAlunoIniciar">Começar a comprimir na mão</button>'; return; }
  const A = alunoCrash, s = calcular(A.dur);
  const ind = num($('#custoInd2').value || state.custoInd || 0);
  const crit = s.acts.filter(n => n.crit);
  const pode = id => A.dur.get(id) - A.dmin.get(id) > EPS && isFinite(A.custo.get(id));
  const corte = corteMinimo(s, A.dur, A.dmin, A.custo);
  let h = '<div class="kpis"><div class="kpi"><div class="olho">Prazo atual</div><div class="v navy">' + fmt(s.dur) + '</div></div><div class="kpi"><div class="olho">Gasto para acelerar</div><div class="v">' + money(A.gasto) + '</div></div><div class="kpi"><div class="olho">Economia de indireto</div><div class="v" style="color:var(--folga)">' + money((A.inicio - s.dur) * ind) + '</div></div><div class="kpi"><div class="olho">Saldo</div><div class="v ' + ((A.inicio - s.dur) * ind - A.gasto < -1e-9 ? 'crit' : '') + '">' + money((A.inicio - s.dur) * ind - A.gasto) + '</div></div></div>';
  h += '<p class="hint" style="margin:10px 0 6px">Caminho(s) crítico(s) agora: <b>' + s.caminhosCriticos.slice(0, 4).map(p => p.ids.map(esc).join(' → ')).join('</b> e <b>') + '</b>' + (s.caminhosCriticos.length > 1 ? '. Com mais de um caminho crítico, encurtar uma atividade de um só não adianta: escolha uma comum aos dois ou encurte uma de cada.' : '.') + '</p>';
  h += '<div class="aluno-opcoes">';
  crit.forEach(n => { const ok = pode(n.id); h += '<button class="bt mini aluno-op" data-aluno="' + esc(n.id) + '"' + (ok ? '' : ' disabled') + ' title="' + (ok ? 'encurtar 1 período' : (isFinite(A.custo.get(n.id)) ? 'já está na duração mínima' : 'sem custo de aceleração informado: não pode')) + '"><b>' + esc(n.id) + '</b> ' + fmt(A.dur.get(n.id)) + ' → ' + fmt(A.dur.get(n.id) - 1) + (ok ? ' · ' + money(A.custo.get(n.id)) : ' · —') + '</button>'; });
  h += '</div>';
  if (A.passos.length) { h += '<div class="rolar" style="margin-top:10px"><table class="tab"><thead><tr><th class="dir">Passo</th><th>Você encurtou</th><th class="dir">Custou</th><th class="dir">Prazo ficou</th><th>O algoritmo faria</th></tr></thead><tbody>'; A.passos.forEach((p, i) => { h += '<tr><td class="dir">' + (i + 1) + '</td><td class="cod"><b>' + esc(p.id) + '</b></td><td class="dir">' + money(p.custo) + '</td><td class="dir"><b>' + fmt(p.dur) + '</b>' + (p.dur >= p.antes - EPS ? ' <span style="color:var(--critico)">(não encurtou!)</span>' : '') + '</td><td class="txt">' + (p.sug ? esc(p.sug.ids.join(' + ')) + ' por ' + money(p.sug.custo) + (p.sug.custo < p.custo - 1e-9 ? ' <span style="color:var(--critico)">(mais barato)</span>' : p.sug.ids.indexOf(p.id) >= 0 && p.sug.ids.length === 1 ? ' <span style="color:var(--folga)">(igual)</span>' : '') : '—') + '</td></tr>'; }); h += '</tbody></table></div>'; }
  h += '<div class="noprint" style="margin-top:10px;display:flex;gap:8px;flex-wrap:wrap"><button class="bt mini" id="btnAlunoReiniciar">Recomeçar</button>' + (corte ? '<span class="hint" style="align-self:center">Dica: agora o corte mais barato seria <b>' + corte.ids.map(esc).join(' + ') + '</b> (' + money(corte.custo) + '/período).</span>' : '<span class="hint" style="align-self:center">Não dá para encurtar mais: todo caminho crítico passa por atividade na duração mínima ou sem custo informado.</span>') + '</div>';
  box.innerHTML = h;
}
function alunoEncurtar(id) {
  const A = alunoCrash; if (!A || !A.dur.has(id)) return;
  const antes = calcular(A.dur);
  const sug = corteMinimo(antes, A.dur, A.dmin, A.custo);
  const delta = Math.min(1, A.dur.get(id) - A.dmin.get(id)); if (!(delta > EPS)) return;
  A.dur.set(id, A.dur.get(id) - delta);
  const depois = calcular(A.dur), custo = A.custo.get(id) * delta;
  A.gasto += custo; A.passos.push({ id, custo, dur: depois.dur, antes: antes.dur, sug: sug ? { ids: sug.ids, custo: sug.custo * delta } : null });
  renderAluno();
}

/* ---------- termos com definição ao passar o mouse ---------- */
const TERMOS = [
  ['caminho crítico', 'A sequência mais longa de atividades do início ao fim: define a duração do projeto. Suas atividades não têm folga.'],
  ['folga total', 'Quanto uma atividade pode atrasar sem atrasar o fim do projeto (UDI − PDI).'],
  ['folga livre', 'Quanto uma atividade pode atrasar sem atrasar nenhuma sucessora.'],
  ['predecessoras', 'Atividades que precisam acontecer antes desta.'],
  ['predecessora', 'Atividade que precisa acontecer antes desta.'],
  ['sucessoras', 'Atividades que dependem desta para começar (ou terminar).'],
  ['sucessora', 'Atividade que depende desta.'],
  ['Monte Carlo', 'Método de simulação: sorteia muitas vezes as durações e mede o resultado.'],
  ['valor agregado', 'Valor do trabalho já feito, medido pelo custo planejado dele (EV).'],
  ['curva S', 'Gráfico do custo (ou trabalho) acumulado ao longo do tempo; tem forma de S.'],
  ['pulmão', 'Reserva de tempo colocada no fim de uma cadeia para absorver atrasos (corrente crítica).'],
  ['custo indireto', 'Custo que corre com o tempo, independentemente das atividades: gerência, aluguel, multas.'],
  ['custo direto', 'Custo das próprias atividades (mão de obra, materiais).'],
  ['beta-PERT', 'Distribuição usada no PERT: entre o otimista e o pessimista, com o mais provável pesando 4.'],
  ['nivelamento', 'Redistribuir atividades no tempo para que a carga de recursos caiba no disponível.'],
];
function anotarTermos(raiz) {
  if (typeof LANG !== 'undefined' && LANG !== 'pt') return;   /* termos e definições só existem em português */
  const re = new RegExp('(' + TERMOS.map(t => t[0].replace(/[-]/g, '\\-')).join('|') + ')', 'i');
  const def = {}; TERMOS.forEach(t => { def[t[0].toLowerCase()] = t[1]; });
  (raiz || document).querySelectorAll('p.ler, p.apoio, .gloss dd').forEach(p => {
    if (p.dataset.termos) return; p.dataset.termos = '1';
    const feitos = new Set();
    const tw = document.createTreeWalker(p, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement.closest('b, .sg, .sga, .sgn, .mono, .termo, a, button') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nos = []; while (tw.nextNode()) nos.push(tw.currentNode);
    nos.forEach(no => {
      let txt = no.nodeValue, m, out = document.createDocumentFragment(), mudou = false, guarda = 0;
      while ((m = re.exec(txt)) && guarda++ < 20) {
        const chave = m[1].toLowerCase();
        if (feitos.has(chave)) { out.appendChild(document.createTextNode(txt.slice(0, m.index + m[1].length))); txt = txt.slice(m.index + m[1].length); continue; }
        feitos.add(chave); mudou = true;
        out.appendChild(document.createTextNode(txt.slice(0, m.index)));
        const sp = document.createElement('span'); sp.className = 'termo'; sp.setAttribute('data-tip', def[chave]); sp.textContent = m[1]; out.appendChild(sp);
        txt = txt.slice(m.index + m[1].length);
      }
      if (mudou) { out.appendChild(document.createTextNode(txt)); no.parentNode.replaceChild(out, no); }
    });
  });
}

/* ---------- liga tudo ---------- */
function renderDidatica() {
  renderLinhaTempo(); renderMiniRede();
  if (atvFoco && calcOut && calcOut.N && !calcOut.N.get(atvFoco)) atvFoco = null;
  if (atvFoco) { const id = atvFoco; atvFoco = null; focarAtividade(id); }
  const bx = $('#explicaTudoCorpo'); if (bx && calcOut && calcOut.acts.length && !calcOut.ciclo) bx.innerHTML = explicaTudo(calcOut);
  alunoCrash = null; renderAluno();   /* dados mudaram: recomeça o modo aluno */
}
function ligarDidatica() {
  document.addEventListener('click', e => {
    const f = e.target.closest('[data-fecha-explica]'); if (f) { focarAtividade(atvFoco); return; }
    const al = e.target.closest('[data-aluno]'); if (al) { alunoEncurtar(al.getAttribute('data-aluno')); return; }
    if (e.target.id === 'btnAlunoIniciar') { alunoIniciar(); return; }
    if (e.target.id === 'btnAlunoReiniciar') { alunoIniciar(); return; }
    const el = e.target.closest('#tblResult tr[data-id], #stageRede g[data-id], #stageGantt [data-id]');
    if (el && !e.target.closest('input, button, a')) { focarAtividade(el.getAttribute('data-id'), el.closest('#tblResult') ? 'tabela' : 'desenho'); return; }
    if (e.target.closest('#miniRede')) { irPara('rede'); scrollTo(0, 0); }
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && atvFoco) focarAtividade(atvFoco); });
  const r = $('#gTempo'); if (r) { r.addEventListener('input', () => { ganttT = +r.value; renderGantt(); renderLinhaTempo(); }); const z = $('#gTempoZerar'); if (z) z.onclick = () => { ganttT = null; renderGantt(); renderLinhaTempo(); }; }
  const px = $('#prazoXr'), pxn = $('#prazoX');
  if (px && pxn) {
    px.addEventListener('input', () => { pxn.value = px.value; renderPert(); });
    pxn.addEventListener('input', () => { px.value = pxn.value; });
  }
  anotarTermos();
}
