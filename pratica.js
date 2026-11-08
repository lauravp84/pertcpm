/* ============================================================
   PRATICAR: exercício com correção, dica, gabarito e link.
   O aluno calcula à mão, preenche a tabela e confere. Os gabaritos
   saem do próprio motor de cálculo, então valem para qualquer rede.
   Carregado antes do app.js: nada aqui usa o app no carregamento,
   só depois que iniciaPratica() é chamada.
   ============================================================ */
'use strict';

const PR_CHAVE = 'pertcpm.pratica';
const PR_PRONTOS = [
  { id: 'guiado', titulo: 'Exemplo guiado (4 atividades)', modo: 'cpm', unidade: 'd', acts: [['A', 'Projeto', 3, []], ['B', 'Fundação', 4, ['A']], ['C', 'Instalações', 2, ['A']], ['D', 'Entrega', 5, ['B', 'C']]] },
  { id: 'obra', titulo: 'Construção (6 atividades)', modo: 'cpm', unidade: 'd', acts: [['A', 'Projeto', 6, []], ['B', 'Fundação', 8, ['A']], ['C', 'Instalações', 5, ['A']], ['D', 'Estrutura', 7, ['B']], ['E', 'Acabamento', 4, ['C']], ['F', 'Entrega', 3, ['D', 'E']]] },
  { id: 'empate', titulo: 'Dois caminhos críticos (5 atividades)', modo: 'cpm', unidade: 'd', acts: [['A', 'Planejamento', 3, []], ['B', 'Compras', 5, ['A']], ['C', 'Cadastro', 5, ['A']], ['D', 'Montagem', 4, ['B', 'C']], ['E', 'Entrega', 2, ['D']]] },
  { id: 'pert', titulo: 'Lançamento de produto, PERT (6 atividades)', modo: 'pert', unidade: 's', acts: [['A', 'Pesquisa de mercado', [2, 3, 6], []], ['B', 'Protótipo', [3, 5, 10], ['A']], ['C', 'Plano de marketing', [2, 3, 4], ['A']], ['D', 'Testes com usuários', [2, 4, 7], ['B']], ['E', 'Treinamento', [1, 2, 3], ['C']], ['F', 'Lançamento', [1, 1, 2], ['D', 'E']]] }
];

let prEx = null, prResp = {}, prConferido = false, prMsg = '', prDicaCel = '', prDicaNivel = 0;

/* ---------- construção dos exercícios ---------- */
function prDePronto(id) {
  const p = PR_PRONTOS.find(x => x.id === id); if (!p) return null;
  return {
    titulo: p.titulo, modo: p.modo, unidade: p.unidade,
    acts: p.acts.map(a => { const o = { id: a[0], nome: a[1], preds: a[3].slice() }; if (p.modo === 'pert') { o.o = a[2][0]; o.m = a[2][1]; o.p = a[2][2]; } else o.d = a[2]; return o; })
  };
}

function prDeDados() {
  const c = calcOut;
  if (!c || !c.acts || c.acts.length < 2 || (c.erros && c.erros.length)) return null;
  return {
    titulo: 'Meu projeto (aba Dados)', modo: state.modo, unidade: state.unidade,
    acts: c.acts.map(n => {
      const a = n.ref, o = { id: n.id, nome: a.nome || '', preds: n.preds.slice() };
      if (state.modo === 'pert') { o.o = num(a.o); o.m = num(a.m); o.p = num(a.p); } else o.d = num(a.d);
      return o;
    })
  };
}

function prGerar(nivel, modo) {
  const n = { facil: 5, medio: 7, dificil: 9 }[nivel] || 6;
  const ids = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  const r = (a, b) => a + Math.floor(Math.random() * (b - a + 1));
  const preds = ids.map(() => []);
  for (let i = 1; i < n; i++) {
    const maxP = nivel === 'facil' ? 1 : 2;
    const qtd = i === 1 ? 1 : (Math.random() < 0.25 && nivel !== 'facil' ? 0 : r(1, maxP));   /* 0: também começa o projeto */
    for (let k = 0; k < qtd; k++) {
      const p = ids[Math.max(0, i - 1 - r(0, Math.min(2, i - 1)))];
      if (preds[i].indexOf(p) < 0) preds[i].push(p);
    }
  }
  /* uma única atividade final: quem ficou sem sucessora liga na última */
  const temSuc = new Set(); preds.forEach(l => l.forEach(p => temSuc.add(p)));
  for (let i = 0; i < n - 1; i++) if (!temSuc.has(ids[i]) && preds[n - 1].indexOf(ids[i]) < 0) preds[n - 1].push(ids[i]);
  const acts = ids.map((id, i) => {
    const o = { id, nome: '', preds: preds[i] };
    if (modo === 'pert') { o.o = r(1, 5); o.m = o.o + r(0, 3); o.p = o.m + r(1, 5); } else o.d = r(1, 9);
    return o;
  });
  const nome = { facil: 'fácil', medio: 'médio', dificil: 'difícil' }[nivel] || '';
  return { titulo: 'Exercício gerado: ' + nome + ', ' + (modo === 'pert' ? 'PERT' : 'CPM'), modo, unidade: modo === 'pert' ? 's' : 'd', acts };
}

/* Gabarito: roda o motor sobre uma cópia, sem tocar no projeto da aba Dados. */
function prGab(e) {
  const tmp = Object.assign(estadoVazio(), {
    modo: e.modo, unidade: e.unidade || 'd',
    acts: e.acts.map(a => Object.assign(novoAtv(a.id, a.nome || ''), a))
  });
  const guardado = state; state = tmp;
  try { return calcular(); } finally { state = guardado; }
}

/* ---------- células, valores esperados, conferência ---------- */
const PR_GRUPO = { te: 'te', pdi: 'ida', pdt: 'ida', dur: 'ida', udt: 'volta', udi: 'volta', ft: 'folga', crit: 'crit', sigma: 'proj' };
const PR_KEY = { pdi: 'ES', pdt: 'EF', udi: 'LS', udt: 'LF' };

function prEsperado(c, id, k) {
  if (id === '__proj') return k === 'dur' ? c.dur : c.sigma;
  const n = c.N.get(id);
  return { te: n.dur, pdi: n.ES, pdt: n.EF, udi: n.LS, udt: n.LF, ft: n.FT, crit: n.crit ? 'sim' : 'nao' }[k];
}
function prCelulas(c, e) {
  const pert = e.modo === 'pert', cels = [];
  e.acts.forEach(a => {
    if (pert) cels.push([a.id, 'te']);
    ['pdi', 'pdt', 'udi', 'udt', 'ft', 'crit'].forEach(k => cels.push([a.id, k]));
  });
  cels.push(['__proj', 'dur']);
  if (pert) cels.push(['__proj', 'sigma']);
  return cels;
}
function prOk(e, resp, esp, k) {
  if (resp === undefined || resp === null || String(resp).trim() === '') return false;
  if (k === 'crit') return resp === esp;
  return Math.abs(num(resp) - esp) <= (e.modo === 'pert' ? 0.06 : 0.0051);
}
const prFmtResp = x => fmt(x);

/* Ordem em que um aluno raciocina: te, caminho de ida, duração, caminho de volta, folgas, críticas, σ. */
function prOrdemDica(c, e) {
  const ord = c.ordem, pert = e.modo === 'pert', l = [];
  if (pert) ord.forEach(id => l.push([id, 'te']));
  ord.forEach(id => { l.push([id, 'pdi']); l.push([id, 'pdt']); });
  l.push(['__proj', 'dur']);
  ord.slice().reverse().forEach(id => { l.push([id, 'udt']); l.push([id, 'udi']); });
  ord.forEach(id => l.push([id, 'ft']));
  ord.forEach(id => l.push([id, 'crit']));
  if (pert) l.push(['__proj', 'sigma']);
  return l;
}

function prRegra(k) {
  return {
    te: 'te = (o + 4m + p) / 6.',
    pdi: sg('ES') + ' = maior ' + sg('EF') + ' entre as predecessoras (sem predecessora: 0).',
    pdt: sg('EF') + ' = ' + sg('ES') + ' + duração.',
    dur: 'A duração do projeto é o maior ' + sg('EF') + ' entre as atividades finais.',
    udt: sg('LF') + ' = menor ' + sg('LS') + ' entre as sucessoras (atividade final: ' + sg('LF') + ' = duração do projeto).',
    udi: sg('LS') + ' = ' + sg('LF') + ' − duração.',
    ft: 'Folga total = ' + sg('LS') + ' − ' + sg('ES') + '.',
    crit: 'Atividade crítica é a que tem folga total zero.',
    sigma: 'σ² = soma das variâncias ((p − o)/6)² das atividades do caminho crítico; σ é a raiz quadrada.'
  }[k];
}
function prNumeros(c, e, id, k) {
  const f = fmt, N = c.N, n = id === '__proj' ? null : N.get(id);
  switch (k) {
    case 'te': { const a = e.acts.find(x => x.id === id); return 'Em ' + id + ': te = (' + f(a.o) + ' + 4×' + f(a.m) + ' + ' + f(a.p) + ') / 6.'; }
    case 'pdi': return n.preds.length ? 'Predecessoras de ' + id + ': ' + n.preds.map(p => p + ' (' + sg('EF') + ' = ' + f(N.get(p).EF) + ')').join(', ') + '. Fique com o maior.' : id + ' não tem predecessora: ' + sg('ES') + ' = 0.';
    case 'pdt': return 'Em ' + id + ': ' + sg('ES') + ' + duração = ' + f(n.ES) + ' + ' + f(n.dur) + '.';
    case 'dur': return 'Atividades finais: ' + c.finais.map(i => i + ' (' + sg('EF') + ' = ' + f(N.get(i).EF) + ')').join(', ') + '.';
    case 'udt': return n.succs.length ? 'Sucessoras de ' + id + ': ' + n.succs.map(s => s + ' (' + sg('LS') + ' = ' + f(N.get(s).LS) + ')').join(', ') + '. Fique com o menor.' : id + ' é final: ' + sg('LF') + ' = duração do projeto (' + f(c.dur) + ').';
    case 'udi': return 'Em ' + id + ': ' + sg('LF') + ' − duração = ' + f(n.LF) + ' − ' + f(n.dur) + '.';
    case 'ft': return 'Em ' + id + ': ' + sg('LS') + ' − ' + sg('ES') + ' = ' + f(n.LS) + ' − ' + f(n.ES) + '.';
    case 'crit': return 'A folga total de ' + id + ' é ' + f(n.FT) + (n.crit ? ': zero, então é crítica.' : ': diferente de zero, então não é crítica.');
    case 'sigma': return 'Caminho crítico: ' + c.critSeq.join(' → ') + '. σ² = ' + f(c.critVar) + '.';
  }
  return '';
}

/* ---------- renderização ---------- */
function prNomeCel(id, k) { return (id === '__proj' ? 'projeto' : 'atividade ' + id) + ', ' + ({ te: 'te', pdi: sg('ES'), pdt: sg('EF'), udi: sg('LS'), udt: sg('LF'), ft: 'folga total', crit: 'crítica', dur: 'duração do projeto', sigma: 'σ' }[k]); }

function prAtualizaSeletor() {
  const sel = $('#prSel'); if (!sel) return;
  const atual = prEx ? '<option value="__atual">' + esc(prEx.titulo) + ' (atual)</option>' : '<option value="">Escolha um exercício…</option>';
  sel.innerHTML = atual + PR_PRONTOS.map(p => '<option value="' + p.id + '">' + esc(p.titulo) + '</option>').join('') + '<option value="__dados">Meu projeto (aba Dados)</option>';
  sel.value = prEx ? '__atual' : '';
}

function renderPratica() {
  const corpo = $('#prCorpo'); if (!corpo) return;
  prAtualizaSeletor();
  if (!prEx) {
    corpo.innerHTML = '<div class="nota"><b>Como funciona</b>Escolha um exercício pronto, gere um novo ou use o seu projeto da aba Dados. Calcule à mão, digite as respostas na tabela e clique em <b>Conferir</b>. Se travar, use <b>Dica</b>; ela vai do geral para o numérico.</div>';
    return;
  }
  const e = prEx, pert = e.modo === 'pert', c = prGab(e);
  if (c.erros.length) { corpo.innerHTML = '<div class="faixa-erro"><b>Este exercício tem erro</b>' + c.erros.join('<br>') + '</div>'; return; }
  const cels = prCelulas(c, e);
  const u = UNI[e.unidade] ? UNI[e.unidade][1] : 'dias';

  /* enunciado */
  let h = '<div class="sec" style="margin-top:22px"><h3>' + esc(e.titulo) + '</h3><p class="apoio">Unidade de tempo: <b>' + u + '</b>. ' +
    (pert ? 'Calcule o tempo esperado (te) de cada atividade e use-o em todo o restante.' : 'Use as durações da tabela.') + '</p></div>';
  h += '<div class="card"><div class="rolar"><table class="tab" aria-label="Enunciado"><thead><tr><th>Atividade</th>' +
    (pert ? '<th class="dir">o</th><th class="dir">m</th><th class="dir">p</th>' : '<th class="dir">Duração</th>') + '<th>Predecessoras</th></tr></thead><tbody>';
  e.acts.forEach(a => {
    h += '<tr><td class="cod"><b>' + esc(a.id) + '</b>' + (a.nome ? ' <span class="txt" style="color:var(--apagado)">' + esc(a.nome) + '</span>' : '') + '</td>' +
      (pert ? '<td class="dir">' + fmt(a.o) + '</td><td class="dir">' + fmt(a.m) + '</td><td class="dir">' + fmt(a.p) + '</td>' : '<td class="dir">' + fmt(a.d) + '</td>') +
      '<td>' + (a.preds.length ? esc(a.preds.join(', ')) : 'começa o projeto') + '</td></tr>';
  });
  h += '</tbody></table></div></div>';

  /* resposta */
  const campo = (id, k) => {
    const cod = id + '|' + k, v = prResp[cod] === undefined ? '' : prResp[cod];
    let cls = '', mk = '';
    if (prConferido) {
      const ok = prOk(e, v, prEsperado(c, id, k), k);
      cls = ok ? ' ok' : ' erro'; mk = ok ? '<span class="mk certo">certo</span>' : '<span class="mk er">×</span>';
    }
    const rot = esc(prNomeCel(id, k));
    if (k === 'crit') return '<select class="pr' + cls + '" data-id="' + esc(id) + '" data-k="crit" aria-label="' + rot + '"><option value="">—</option><option value="sim"' + (v === 'sim' ? ' selected' : '') + '>Sim</option><option value="nao"' + (v === 'nao' ? ' selected' : '') + '>Não</option></select>' + mk;
    return '<input class="pr' + cls + '" data-id="' + esc(id) + '" data-k="' + k + '" inputmode="decimal" value="' + esc(v) + '" aria-label="' + rot + '">' + mk;
  };
  h += '<div class="sec" style="margin-top:26px"><h3>Sua resposta</h3><p class="apoio">Use vírgula nos decimais. Os valores seguem a convenção de fim de período (veja o Guia).</p></div>';
  h += '<div class="card"><div class="rolar"><table class="tab prt" style="min-width:640px" aria-label="Tabela de respostas"><thead><tr><th>Atividade</th>' +
    (pert ? '<th class="dir">te</th>' : '') + '<th class="dir">' + sg('ES') + '</th><th class="dir">' + sg('EF') + '</th><th class="dir">' + sg('LS') + '</th><th class="dir">' + sg('LF') + '</th><th class="dir">Folga total</th><th>Crítica?</th></tr></thead><tbody>';
  e.acts.forEach(a => {
    h += '<tr><td class="cod"><b>' + esc(a.id) + '</b></td>' + (pert ? '<td class="dir">' + campo(a.id, 'te') + '</td>' : '') +
      ['pdi', 'pdt', 'udi', 'udt', 'ft'].map(k => '<td class="dir">' + campo(a.id, k) + '</td>').join('') + '<td>' + campo(a.id, 'crit') + '</td></tr>';
  });
  h += '</tbody></table></div>' +
    '<div class="card-corpo" style="display:flex;gap:24px;flex-wrap:wrap;align-items:center;border-top:1px solid var(--borda-int)">' +
    '<div><div class="olho">Duração do projeto (' + u + ')</div>' + campo('__proj', 'dur') + '</div>' +
    (pert ? '<div><div class="olho">Desvio-padrão do projeto (σ)</div>' + campo('__proj', 'sigma') + '</div>' : '') +
    '</div>' +
    '<div class="barra-acoes noprint">' +
    '<button class="bt primario" data-acao="conferir">Conferir</button>' +
    '<button class="bt" data-acao="dica">Dica</button>' +
    '<button class="bt" data-acao="gabarito">Mostrar gabarito</button>' +
    '<button class="bt" data-acao="limpar">Limpar respostas</button>' +
    '<button class="bt" data-acao="link" style="margin-left:auto">Copiar <i>link</i> do exercício</button></div></div>';
  h += '<div id="prFeedback" aria-live="polite">' + prMsg + '</div>';
  corpo.innerHTML = h;
}

/* ---------- ações ---------- */
function prSalva() { try { localStorage.setItem(PR_CHAVE, JSON.stringify({ ex: prEx, resp: prResp, conferido: prConferido })); } catch (e) { } }
const prAssin = e => JSON.stringify(e && e.acts);

function prAbre(e, manterRespostas) {
  const mesmo = manterRespostas && prEx && prAssin(prEx) === prAssin(e);
  prEx = e; if (!mesmo) { prResp = {}; prConferido = false; prMsg = ''; }
  prDicaCel = ''; prDicaNivel = 0; prSalva(); renderPratica();
}

function prConferir() {
  const c = prGab(prEx), cels = prCelulas(c, prEx);
  let certas = 0; const erros = {};
  cels.forEach(([id, k]) => {
    const ok = prOk(prEx, prResp[id + '|' + k], prEsperado(c, id, k), k);
    if (ok) certas++; else erros[PR_GRUPO[k]] = (erros[PR_GRUPO[k]] || 0) + 1;
  });
  const total = cels.length, pct = Math.round(100 * certas / total);
  const regra = {
    te: 'Tempo esperado: ' + prRegra('te'),
    ida: 'Caminho de ida: ' + prRegra('pdi') + ' ' + prRegra('pdt'),
    volta: 'Caminho de volta: ' + prRegra('udt') + ' ' + prRegra('udi'),
    folga: 'Folgas: ' + prRegra('ft'),
    crit: 'Atividades críticas: ' + prRegra('crit'),
    proj: 'Desvio-padrão: ' + prRegra('sigma')
  };
  const ordem = ['te', 'ida', 'volta', 'folga', 'crit', 'proj'];
  const lista = ordem.filter(g => erros[g]).map(g => '<li><b>' + erros[g] + '</b> ' + (erros[g] === 1 ? 'erro' : 'erros') + ' em ' + regra[g] + '</li>').join('');
  const juizo = pct === 100 ? 'Tudo certo. Peça um exercício novo para praticar de novo.' : pct >= 70 ? 'Bom caminho. Corrija as células marcadas e confira de novo.' : 'Vale rever o passo a passo (aba Guia). Use a Dica: ela segue a ordem em que se calcula.';
  prConferido = true;
  prMsg = '<div class="nota" style="margin-top:16px"><b>Você acertou ' + certas + ' de ' + total + ' (' + pct + '%)</b>' + juizo + (lista ? '<ul style="margin:8px 0 0;padding-left:18px">' + lista + '</ul>' : '') + '</div>';
  prSalva(); renderPratica();
}

function prDica() {
  const c = prGab(prEx), ordem = prOrdemDica(c, prEx);
  const alvo = ordem.find(([id, k]) => !prOk(prEx, prResp[id + '|' + k], prEsperado(c, id, k), k));
  if (!alvo) { prMsg = '<div class="nota" style="margin-top:16px"><b>Nada a corrigir</b>Todas as respostas estão certas. Confira para ver o resultado, ou gere um exercício novo.</div>'; renderPratica(); return; }
  const cod = alvo[0] + '|' + alvo[1];
  prDicaNivel = (cod === prDicaCel) ? Math.min(2, prDicaNivel + 1) : 1; prDicaCel = cod;
  const txt = prDicaNivel === 1 ? prRegra(alvo[1]) : prRegra(alvo[1]) + ' ' + prNumeros(c, prEx, alvo[0], alvo[1]);
  prMsg = '<div class="nota" style="margin-top:16px"><b>Dica sobre ' + esc(prNomeCel(alvo[0], alvo[1])) + (prDicaNivel === 1 ? ' (peça de novo para ver os números)' : '') + '</b>' + esc(txt) + '</div>';
  renderPratica();
  const el = $('#prCorpo [data-id="' + alvo[0] + '"][data-k="' + alvo[1] + '"]'); if (el) el.focus();
}

function prGabarito() {
  abrirDlg('Mostrar o gabarito?', '<p>As respostas certas vão preencher a tabela. Você perde a chance de descobrir sozinho; depois, gere um exercício novo para praticar de novo.</p>',
    [['Voltar', () => $('#dlg').close()], ['Mostrar', () => {
      const c = prGab(prEx);
      prCelulas(c, prEx).forEach(([id, k]) => { const v = prEsperado(c, id, k); prResp[id + '|' + k] = k === 'crit' ? v : prFmtResp(v); });
      prConferido = true;
      prMsg = '<div class="nota" style="margin-top:16px"><b>Gabarito exibido</b>Compare com o que você tinha feito e gere um exercício novo para treinar sem consulta.</div>';
      prSalva(); renderPratica(); $('#dlg').close();
    }, true]]);
}

function prLimpar() { prResp = {}; prConferido = false; prMsg = ''; prDicaCel = ''; prSalva(); renderPratica(); }

const prB64 = s => btoa(String.fromCharCode.apply(null, new TextEncoder().encode(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const prDeB64 = t => { t = t.replace(/-/g, '+').replace(/_/g, '/'); while (t.length % 4) t += '='; const b = atob(t), u = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u[i] = b.charCodeAt(i); return new TextDecoder().decode(u); };

function prLink() {
  const url = location.origin + location.pathname + '#ex=' + prB64(JSON.stringify(prEx));
  const mostra = () => abrirDlg('<i>Link</i> do exercício', '<p>Quem abrir este <i>link</i> recebe o exercício na aba Praticar, sem o gabarito.</p><input id="prUrl" readonly value="' + esc(url) + '" style="width:100%;font-family:var(--mono);font-size:12.5px;padding:10px;border:1px solid var(--borda);border-radius:3px" onclick="this.select()">', [['Fechar', () => $('#dlg').close(), true]]);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => toast('<i>Link</i> do exercício copiado.', true)).catch(mostra);
  else mostra();
}

/* Valida um exercício vindo de fora (link ou armazenamento): tudo é tratado como dado não confiável. */
function prLimpaEx(raw) {
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.acts)) return null;
  const modo = raw.modo === 'pert' ? 'pert' : 'cpm', unidade = ['d', 's', 'm'].indexOf(raw.unidade) >= 0 ? raw.unidade : 'd';
  const acts = raw.acts.slice(0, 30).filter(a => a && typeof a === 'object').map(a => {
    const id = String(a.id == null ? '' : a.id).trim().toUpperCase().replace(/[^A-Z0-9_-]/g, '').slice(0, 6); if (!id) return null;
    const o = { id, nome: String(a.nome == null ? '' : a.nome).slice(0, 60), preds: (Array.isArray(a.preds) ? a.preds : []).map(p => String(p).trim().toUpperCase()).filter(Boolean) };
    if (modo === 'pert') { o.o = Math.max(0, num(a.o)); o.m = Math.max(0, num(a.m)); o.p = Math.max(0, num(a.p)); } else o.d = Math.max(0, num(a.d));
    return o;
  }).filter(Boolean);
  if (acts.length < 2) return null;
  const ids = new Set(acts.map(a => a.id)); if (ids.size !== acts.length) return null;
  acts.forEach(a => { a.preds = a.preds.filter(p => p !== a.id && ids.has(p)); });
  const e = { titulo: String(raw.titulo == null ? 'Exercício' : raw.titulo).slice(0, 80), modo, unidade, acts };
  return prGab(e).erros.length ? null : e;
}

function iniciaPratica() {
  let salvo = null;
  try { salvo = JSON.parse(localStorage.getItem(PR_CHAVE) || 'null'); } catch (e) { }
  if (salvo) { const e = prLimpaEx(salvo.ex); if (e) { prEx = e; prResp = (salvo.resp && typeof salvo.resp === 'object') ? salvo.resp : {}; prConferido = !!salvo.conferido; } }

  const sel = $('#prSel');
  sel.addEventListener('change', () => {
    const v = sel.value;
    if (v === '__atual' || v === '') return;
    if (v === '__dados') { const e = prDeDados(); if (!e) { alerta('O projeto da aba Dados precisa ter pelo menos 2 atividades e nenhum erro para virar exercício.'); renderPratica(); return; } prAbre(e); return; }
    prAbre(prDePronto(v));
  });
  $('#prGerar').addEventListener('click', () => prAbre(prGerar($('#prNivel').value, $('#prTipo').value)));

  const corpo = $('#prCorpo');
  corpo.addEventListener('input', ev => {
    const t = ev.target; if (!t.classList || !t.classList.contains('pr')) return;
    prResp[t.dataset.id + '|' + t.dataset.k] = t.value;
    if (prConferido) {   /* a conferência anterior deixou de valer: some a marcação, sem redesenhar (não perde o foco) */
      prConferido = false; prMsg = '';
      corpo.querySelectorAll('.pr').forEach(i => i.classList.remove('ok', 'erro'));
      corpo.querySelectorAll('.mk').forEach(m => m.remove());
      const fb = $('#prFeedback'); if (fb) fb.innerHTML = '';
    }
    prSalva();
  });
  corpo.addEventListener('change', ev => { if (ev.target.tagName === 'SELECT') ev.target.dispatchEvent(new Event('input', { bubbles: true })); });
  corpo.addEventListener('click', ev => {
    const b = ev.target.closest('[data-acao]'); if (!b || !prEx) return;
    ({ conferir: prConferir, dica: prDica, gabarito: prGabarito, limpar: prLimpar, link: prLink }[b.dataset.acao] || function () { })();
  });

  /* exercício que chegou por link */
  if (location.hash.indexOf('#ex=') === 0) {
    try {
      const e = prLimpaEx(JSON.parse(prDeB64(location.hash.slice(4))));
      if (e) { prAbre(e, true); irPara('pratica'); toast('Exercício aberto pelo link. Calcule e confira.'); }
      else alertaHtml('Não consegui abrir o exercício deste <i>link</i>: ele está incompleto ou com erro.');
    } catch (err) { alertaHtml('Não consegui abrir o exercício deste <i>link</i>.'); }
  }
  renderPratica();
}
