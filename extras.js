/* Extras: link do projeto completo, modo projetor, exportar .xlsx, importar MS Project (.xml),
   registro de uso por aba/exemplo, "ache o erro" e relatório do exercício em PDF.
   Carregado antes de app.js: só declara funções; usa os globais do app na hora da chamada. */
'use strict';

/* ---------- link do projeto completo ---------- */
function projLink() {
  const c = calcOut; if (!c || !c.acts.length) { alerta('Preencha pelo menos uma atividade para gerar o link.'); return; }
  const st = JSON.parse(JSON.stringify(state)); delete st.aba; delete st.baseline;
  const url = location.origin + location.pathname + '#proj=' + prB64(JSON.stringify(st));
  if (url.length > 6000) { alerta('Este projeto é grande demais para caber num link. Use Exportar JSON (botão Abrir) e envie o arquivo.'); return; }
  const mostra = () => abrirDlg('<i>Link</i> do projeto', '<p>Quem abrir este <i>link</i> recebe o projeto inteiro (atividades, relações, custos, recursos) na aba Dados. O projeto que a pessoa tiver aberto é guardado antes.</p><input id="prUrl" readonly value="' + esc(url) + '" style="width:100%;font-family:var(--mono);font-size:12.5px" onclick="this.select()">', [['Fechar', () => $('#dlg').close(), true]]);
  if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(() => toast('<i>Link</i> do projeto copiado.', true)).catch(mostra); else mostra();
}
function projAbrirPorLink() {
  if (location.hash.indexOf('#proj=') !== 0) return false;
  let novo = null;
  try { novo = normalizaEstado(JSON.parse(prDeB64(location.hash.slice(6)))); } catch (e) { novo = null; }
  if (!novo || !novo.acts.length) { alertaHtml('Não consegui abrir o projeto deste <i>link</i>.'); return false; }
  const atual = state && state.acts && state.acts.some(a => String(a.id).trim() && (a.nome || a.preds.length));
  const abre = () => { if (atual) { const l = lerProjetos(); l['Antes do link (' + new Date().toLocaleString('pt-BR').slice(0, 16) + ')'] = Object.assign({ quando: Date.now() }, state); gravarProjetos(l); } novo.aba = 'dados'; carregar(novo); history.replaceState(null, '', location.pathname); toast('Projeto aberto pelo link.'); };
  if (atual) abrirDlg('Abrir projeto do <i>link</i>?', '<p>Este <i>link</i> traz um projeto com ' + novo.acts.length + ' atividades (' + esc(novo.nome) + '). O que você tem aberto agora será salvo em “Abrir” antes de ser substituído.</p>', [['Cancelar', () => { $('#dlg').close(); history.replaceState(null, '', location.pathname); }], ['Abrir projeto', () => { $('#dlg').close(); abre(); }, true]]);
  else abre();
  return true;
}

/* ---------- modo projetor ---------- */
function projetorAlternar() {
  const on = document.body.classList.toggle('projetor');
  const b = $('#btnProjetor'); if (b) b.textContent = on ? 'Sair do projetor' : 'Projetor';
  try { localStorage.setItem('pertcpm.projetor', on ? '1' : ''); } catch (e) { }
  if (on) toast('Modo projetor: textos de apoio escondidos e fontes maiores. Esc para sair.');
  if (typeof renderRede === 'function' && calcOut && calcOut.acts.length) { renderRede(); renderGantt(); }
}

/* ---------- .xlsx mínimo (zip sem compressão + SpreadsheetML) ---------- */
const XL_CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function xlCrc32(u8) { let c = 0xFFFFFFFF; for (let i = 0; i < u8.length; i++) c = XL_CRC[(c ^ u8[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function xlZip(arquivos) {   /* arquivos: [[nome, textoUtf8]] */
  const enc = new TextEncoder(), partes = [], centro = []; let off = 0;
  const u16 = v => [v & 255, (v >> 8) & 255], u32 = v => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255];
  arquivos.forEach(([nome, txt]) => {
    const dados = enc.encode(txt), n = enc.encode(nome), crc = xlCrc32(dados);
    const cab = new Uint8Array([0x50, 0x4B, 3, 4, 20, 0, 0, 8, 0, 0, 0, 0, 0, 0, ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(n.length), 0, 0]);
    partes.push(cab, n, dados);
    centro.push(new Uint8Array([0x50, 0x4B, 1, 2, 20, 0, 20, 0, 0, 8, 0, 0, 0, 0, 0, 0, ...u32(crc), ...u32(dados.length), ...u32(dados.length), ...u16(n.length), 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, ...u32(off)]), n);
    off += cab.length + n.length + dados.length;
  });
  const tamC = centro.reduce((t, p) => t + p.length, 0);
  const fim = new Uint8Array([0x50, 0x4B, 5, 6, 0, 0, 0, 0, ...u16(arquivos.length), ...u16(arquivos.length), ...u32(tamC), ...u32(off), 0, 0]);
  return new Blob([...partes, ...centro, fim], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function xlPlanilha(linhas) {   /* linhas: array de arrays (número ou texto) */
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const col = i => { let s = ''; i++; while (i > 0) { const m = (i - 1) % 26; s = String.fromCharCode(65 + m) + s; i = Math.floor((i - 1) / 26); } return s; };
  let r = '';
  linhas.forEach((ln, i) => {
    r += '<row r="' + (i + 1) + '">';
    ln.forEach((v, j) => { const ref = col(j) + (i + 1); if (typeof v === 'number' && isFinite(v)) r += '<c r="' + ref + '"><v>' + v + '</v></c>'; else if (v !== '' && v != null) r += '<c r="' + ref + '" t="inlineStr"><is><t>' + x(v) + '</t></is></c>'; });
    r += '</row>';
  });
  return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>' + r + '</sheetData></worksheet>';
}
function xlLivro(abas) {   /* abas: [[nome, linhas]] */
  const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
  const arq = [
    ['[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' + abas.map((_, i) => '<Override PartName="/xl/worksheets/sheet' + (i + 1) + '.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>').join('') + '</Types>'],
    ['_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
    ['xl/workbook.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' + abas.map((a, i) => '<sheet name="' + x(a[0].slice(0, 31)) + '" sheetId="' + (i + 1) + '" r:id="rId' + (i + 1) + '"/>').join('') + '</sheets></workbook>'],
    ['xl/_rels/workbook.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' + abas.map((_, i) => '<Relationship Id="rId' + (i + 1) + '" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet' + (i + 1) + '.xml"/>').join('') + '</Relationships>'],
  ];
  abas.forEach((a, i) => arq.push(['xl/worksheets/sheet' + (i + 1) + '.xml', xlPlanilha(a[1])]));
  return xlZip(arq);
}
function exportarXLSX() {
  const c = calcOut; if (!c || !c.acts.length) { alerta('Não há resultados para exportar.'); return; }
  const pert = state.modo === 'pert';
  const dados = [['Código', 'Atividade'].concat(pert ? ['o', 'm', 'p', 'te'] : ['Duração']).concat(['Predecessoras', 'Duração mínima', 'Custo/período acelerado', 'Recurso 1', 'Recurso 2', 'Recurso 3', 'Custo planejado'])];
  c.acts.forEach(n => { const a = n.ref; dados.push([n.id, a.nome || ''].concat(pert ? [num(a.o), num(a.m), num(a.p), n.dur] : [n.dur]).concat([textoPreds(a), a.dmin === '' ? '' : num(a.dmin), a.cc === '' ? '' : num(a.cc), a.rec === '' ? '' : num(a.rec), a.rec2 === '' ? '' : num(a.rec2), a.rec3 === '' ? '' : num(a.rec3), a.custo === '' ? '' : num(a.custo)])); });
  const res = [['Atividade', 'Duração', sg('ES'), sg('EF'), sg('LS'), sg('LF'), 'Folga total', 'Folga livre', 'Crítica']];
  c.acts.forEach(n => res.push([n.id, n.dur, n.ES, n.EF, n.LS, n.LF, n.FT, n.FL, n.crit ? 'sim' : 'não']));
  res.push([]); res.push(['Duração do projeto', c.dur]); if (pert) { res.push(['σ do caminho crítico', c.sigma]); } res.push(['Caminho crítico', c.critSeq.join(' → ')]);
  const cam = [['Caminho', 'Duração', 'Crítico']]; (c.caminhos || []).slice(0, 200).forEach(p => cam.push([p.ids.join(' → '), p.dur, p.crit ? 'sim' : 'não']));
  const blob = xlLivro([['Resultados', res], ['Dados', dados], ['Caminhos', cam]]);
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nomeArquivo() + '.xlsx'; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 400);
}

/* ---------- importar MS Project (.xml) ---------- */
function importarMSProject() {
  const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xml,text/xml,application/xml';
  inp.onchange = () => {
    const f = inp.files[0]; if (!f) return;
    const fr = new FileReader();
    fr.onload = () => { try { const st = msProjectParaEstado(fr.result); carregar(st); $('#dlg').close(); toast('Projeto do MS Project importado: ' + st.acts.length + ' atividades.'); } catch (e) { alerta('Não consegui ler este arquivo como XML do MS Project. ' + (e && e.message ? e.message : '')); } };
    fr.readAsText(f);
  };
  inp.click();
}
function msProjectParaEstado(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML malformado.');
  const raiz = doc.documentElement; if (!raiz || raiz.localName !== 'Project') throw new Error('Não é um arquivo de projeto.');
  const txt = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent : ''; };
  const minDia = parseFloat(txt(raiz, 'MinutesPerDay')) || 480;
  const durHoras = s => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s || '').trim()); if (!m) return 0; return (+m[1] || 0) + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600; };
  const tarefas = Array.from(raiz.getElementsByTagName('Task')).filter(t => txt(t, 'Summary') !== '1' && txt(t, 'UID') !== '0' && txt(t, 'Name') !== '' && txt(t, 'IsNull') !== '1');
  if (!tarefas.length) throw new Error('Nenhuma tarefa encontrada.');
  if (tarefas.length > MAX_ATIV) throw new Error('Mais de ' + MAX_ATIV + ' tarefas.');
  const porUID = new Map(), usados = new Set(), codigo = i => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
  tarefas.forEach((t, i) => { let id = codigo(i); while (usados.has(id)) id = id + '1'; usados.add(id); porUID.set(txt(t, 'UID'), id); });
  const st = estadoVazio(); st.nome = (txt(raiz, 'Title') || txt(raiz, 'Name') || 'Projeto importado').slice(0, 120); st.unidade = 'd'; st.acts = [];
  const TIPO = { '0': 'TT', '1': 'TI', '2': 'IT', '3': 'II' };
  tarefas.forEach(t => {
    const a = novoAtv(porUID.get(txt(t, 'UID')), txt(t, 'Name').slice(0, 120));
    const d = Math.round(durHoras(txt(t, 'Duration')) / (minDia / 60) * 100) / 100; a.d = d; a.o = d; a.m = d; a.p = d;
    a.preds = []; a.rel = {};
    Array.from(t.getElementsByTagName('PredecessorLink')).forEach(pl => {
      const p = porUID.get(txt(pl, 'PredecessorUID')); if (!p || p === a.id) return;
      const tipo = TIPO[txt(pl, 'Type')] || 'TI'; let lag = parseFloat(txt(pl, 'LinkLag')) || 0;
      lag = lag / 10 / minDia;   /* LinkLag vem sempre em décimos de minuto; LagFormat só diz como o Project exibe */
      if (a.preds.indexOf(p) < 0) a.preds.push(p);
      if (tipo !== 'TI' || Math.abs(lag) > 1e-9) a.rel[p] = { t: tipo, lag: Math.round(lag * 100) / 100 };
    });
    const custo = parseFloat(txt(t, 'Cost')); if (isFinite(custo) && custo > 0) a.custo = Math.round(custo) / 100;   /* Cost vem em centavos */
    st.acts.push(a);
  });
  return normalizaEstado(st);
}

/* ---------- uso por aba e por exemplo (agregado, sem identificar ninguém) ---------- */
const usoJaEnviado = new Set();
function registraUso(tipo, nome) {
  const chave = tipo + ':' + String(nome || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  if (!chave || usoJaEnviado.has(chave) || chave === 'aba:inicio') return; usoJaEnviado.add(chave);
  try { const url = '/api/hit?p=' + encodeURIComponent(chave); if (navigator.sendBeacon) navigator.sendBeacon(url); else fetch(url, { keepalive: true }).catch(() => { }); } catch (e) { }
}

/* ---------- Praticar: ache o erro ---------- */
let prErro = null;
const PR_ERROS = {
  min: { cel: 'pdi', rot: 'tomou o menor PDT das predecessoras em vez do maior', expl: 'A atividade só pode começar quando TODAS as predecessoras terminaram: por isso o início mais cedo é o MAIOR término entre elas, não o menor.' },
  folgaDur: { cel: 'ft', rot: 'confundiu folga com duração', expl: 'A folga total é UDI − PDI (ou UDT − PDT): quanto a atividade pode escorregar. Não tem relação com a duração dela.' },
  sinal: { cel: 'udi', rot: 'somou a duração em vez de subtrair', expl: 'No caminho de volta anda-se para trás: UDI = UDT − duração. Somar dá um início mais tarde do que o término, o que não existe.' },
  crit: { cel: 'crit', rot: 'marcou como crítica uma atividade com folga', expl: 'Crítica é só a atividade com folga total zero. Se há folga, um pequeno atraso nela não muda o prazo do projeto.' },
  pdt: { cel: 'pdt', rot: 'esqueceu de somar a duração', expl: 'PDT = PDI + duração. Copiar o PDI para o PDT faz a atividade durar zero.' }
};
function prErroGerar() {
  for (let tent = 0; tent < 40; tent++) {
    const e = prGerar(Math.random() < 0.5 ? 'facil' : 'medio', 'cpm'), c = prGab(e); if (c.erros.length) continue;
    const S = k => ({ ES: 'pdi', EF: 'pdt', LS: 'udi', LF: 'udt' })[k];
    const tipos = Object.keys(PR_ERROS).sort(() => Math.random() - 0.5);
    for (const tipo of tipos) {
      const cands = c.acts.filter(n => {
        if (tipo === 'min') return n.preds.length >= 2 && new Set(n.preds.map(p => c.N.get(p).EF)).size > 1;
        if (tipo === 'folgaDur') return Math.abs(n.FT - n.dur) > 1e-9;
        if (tipo === 'sinal') return n.dur > 0;
        if (tipo === 'crit') return !n.crit;
        if (tipo === 'pdt') return n.dur > 0;
        return false;
      });
      if (!cands.length) continue;
      const n = cands[Math.floor(Math.random() * cands.length)];
      let valor;
      if (tipo === 'min') valor = Math.min.apply(null, n.preds.map(p => c.N.get(p).EF));
      else if (tipo === 'folgaDur') valor = n.dur;
      else if (tipo === 'sinal') valor = n.LF + n.dur;
      else if (tipo === 'crit') valor = 'sim';
      else valor = n.ES;
      prErro = { e, c, tipo, id: n.id, cel: PR_ERROS[tipo].cel, valor, escolha: null };
      renderPrErro(); return;
    }
  }
}
function renderPrErro() {
  const box = $('#prErroCorpo'); if (!box) return;
  if (!prErro) { box.innerHTML = '<p class="hint" style="margin:0 0 8px">Um quadro de cálculo já preenchido, com <b>um erro típico de prova</b> escondido. Encontre a célula errada e clique nela.</p><button class="bt primario mini noprint" id="btnPrErro">Gerar um quadro com erro</button>'; return; }
  const { e, c, id, cel, valor, escolha } = prErro;
  const v = (n, k) => (n.id === id && k === cel) ? valor : { pdi: n.ES, pdt: n.EF, udi: n.LS, udt: n.LF, ft: n.FT, crit: n.crit ? 'sim' : 'não' }[k];
  const mostra = (n, k) => { const x = v(n, k); return k === 'crit' ? (x === 'sim' ? 'sim' : 'não') : fmt(x); };
  let h = '<p class="hint" style="margin:0 0 8px">Rede: ' + e.acts.map(a => '<b>' + esc(a.id) + '</b> (' + fmt(a.d) + (a.preds.length ? '; após ' + a.preds.join(', ') : '') + ')').join(' · ') + '. Clique na célula errada.</p>';
  h += '<div class="rolar"><table class="tab ache"><thead><tr><th>Atividade</th><th class="dir">Dur.</th><th class="dir">' + sg('ES') + '</th><th class="dir">' + sg('EF') + '</th><th class="dir">' + sg('LS') + '</th><th class="dir">' + sg('LF') + '</th><th class="dir">FT</th><th>Crítica</th></tr></thead><tbody>';
  c.acts.forEach(n => {
    h += '<tr><td class="cod"><b>' + esc(n.id) + '</b></td><td class="dir">' + fmt(n.dur) + '</td>';
    ['pdi', 'pdt', 'udi', 'udt', 'ft', 'crit'].forEach(k => {
      const eh = n.id === id && k === cel, esc2 = escolha && escolha[0] === n.id && escolha[1] === k;
      let cls = 'ache-cel'; if (escolha) { if (eh) cls += ' ache-certa'; else if (esc2) cls += ' ache-errada'; }
      h += '<td class="' + (k === 'crit' ? '' : 'dir ') + cls + '" data-ache="' + esc(n.id) + '|' + k + '">' + mostra(n, k) + '</td>';
    });
    h += '</tr>';
  });
  h += '</tbody></table></div>';
  if (escolha) {
    const acertou = escolha[0] === id && escolha[1] === cel, info = PR_ERROS[prErro.tipo];
    const certo = cel === 'crit' ? (c.N.get(id).crit ? 'sim' : 'não') : fmt({ pdi: c.N.get(id).ES, pdt: c.N.get(id).EF, udi: c.N.get(id).LS, udt: c.N.get(id).LF, ft: c.N.get(id).FT }[cel]);
    h += '<div class="nota" style="margin-top:12px"><b>' + (acertou ? 'Isso! ' : 'Não é essa. ') + 'O erro está em ' + esc(prNomeCel(id, cel)) + ': quem fez o quadro ' + info.rot + '.</b>' + esc(info.expl) + ' O valor certo é <b>' + certo + '</b>.</div>';
  }
  h += '<div class="noprint" style="margin-top:10px;display:flex;gap:8px"><button class="bt mini" id="btnPrErro">Outro quadro</button>' + (!escolha ? '<span class="hint" style="align-self:center">Dica: siga a ordem do cálculo (ida, volta, folga) e refaça cada célula de cabeça.</span>' : '') + '</div>';
  box.innerHTML = h;
}

/* ---------- relatório do exercício (imprimir / salvar em PDF) ---------- */
function prRelatorio() {
  if (!prEx) { alerta('Abra um exercício primeiro.'); return; }
  const e = prEx, c = prGab(e), cels = prCelulas(c, e), pert = e.modo === 'pert';
  let certas = 0; cels.forEach(([id, k]) => { if (prOk(e, prResp[id + '|' + k], prEsperado(c, id, k), k)) certas++; });
  const x = s => esc(s == null ? '' : s), r = (id, k) => { const v = prResp[id + '|' + k]; return v == null || String(v).trim() === '' ? '—' : (k === 'crit' ? (v === 'sim' ? 'sim' : 'não') : x(v)); };
  const g = (id, k) => { const v = prEsperado(c, id, k); return k === 'crit' ? (v === 'sim' ? 'sim' : 'não') : fmt(v); };
  const ok = (id, k) => prOk(e, prResp[id + '|' + k], prEsperado(c, id, k), k);
  const cols = (pert ? ['te'] : []).concat(['pdi', 'pdt', 'udi', 'udt', 'ft', 'crit']);
  const rot = { te: 'te', pdi: sg('ES'), pdt: sg('EF'), udi: sg('LS'), udt: sg('LF'), ft: 'FT', crit: 'Crítica' };
  let h = '<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório do exercício</title><style>body{font:14px/1.45 Georgia,serif;color:#16243B;margin:28px;max-width:900px}h1{font-size:24px;margin:0 0 4px}h2{font-size:17px;margin:22px 0 6px}table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #cfc9bf;padding:5px 8px;text-align:right}th:first-child,td:first-child{text-align:left}th{background:#f1eee8}.er{background:#fbeae6;color:#7a2418}.ok{color:#2e7386}.meta{color:#5c6a80;font-size:13px}input{font:inherit;border:0;border-bottom:1px solid #999;min-width:260px}@media print{input{border:0}.np{display:none}}</style></head><body>';
  h += '<h1>GEO PERT/CPM · Relatório do exercício</h1><p class="meta">' + x(e.titulo) + ' · ' + (pert ? 'PERT' : 'CPM') + ' · gerado em ' + new Date().toLocaleString('pt-BR') + '</p>';
  h += '<p>Aluno(a): <input placeholder="escreva seu nome" aria-label="Nome"> &nbsp; Turma: <input style="min-width:120px" placeholder="turma"></p>';
  h += '<h2>Enunciado</h2><table><tr><th>Atividade</th>' + (pert ? '<th>o</th><th>m</th><th>p</th>' : '<th>Duração</th>') + '<th style="text-align:left">Predecessoras</th></tr>';
  e.acts.forEach(a => { h += '<tr><td>' + x(a.id) + (a.nome ? ' · ' + x(a.nome) : '') + '</td>' + (pert ? '<td>' + fmt(a.o) + '</td><td>' + fmt(a.m) + '</td><td>' + fmt(a.p) + '</td>' : '<td>' + fmt(a.d) + '</td>') + '<td style="text-align:left">' + (a.preds.length ? x(a.preds.join(', ')) : 'começa o projeto') + '</td></tr>'; });
  h += '</table><h2>Respostas (sua / certa)</h2><table><tr><th>Atividade</th>' + cols.map(k => '<th>' + rot[k] + '</th>').join('') + '</tr>';
  e.acts.forEach(a => { h += '<tr><td>' + x(a.id) + '</td>' + cols.map(k => '<td class="' + (ok(a.id, k) ? 'ok' : 'er') + '">' + r(a.id, k) + (ok(a.id, k) ? '' : ' <small>(' + g(a.id, k) + ')</small>') + '</td>').join('') + '</tr>'; });
  h += '</table><p>Duração do projeto: <b class="' + (ok('__proj', 'dur') ? 'ok' : 'er') + '">' + r('__proj', 'dur') + '</b>' + (ok('__proj', 'dur') ? '' : ' (certo: ' + g('__proj', 'dur') + ')') + (pert ? ' · σ: <b class="' + (ok('__proj', 'sigma') ? 'ok' : 'er') + '">' + r('__proj', 'sigma') + '</b>' + (ok('__proj', 'sigma') ? '' : ' (certo: ' + g('__proj', 'sigma') + ')') : '') + ' · caminho crítico: <b>' + x(c.critSeq.join(' → ')) + '</b></p>';
  h += '<h2>Resultado</h2><p><b>' + certas + ' de ' + cels.length + ' células certas (' + Math.round(100 * certas / cels.length) + '%).</b> Células em vermelho estão erradas ou em branco; o valor certo aparece entre parênteses.</p>';
  h += '<p class="meta">Correção automática do GEO PERT/CPM (@LMVN 2026). Conferência: o mesmo motor de cálculo da calculadora.</p><p class="np"><button onclick="print()">Imprimir ou salvar em PDF</button></p></body></html>';
  const w = window.open('', '_blank'); if (!w) { alerta('O navegador bloqueou a janela do relatório. Permita janelas para este site e tente de novo.'); return; }
  w.document.open(); w.document.write(h); w.document.close();
}

function ligarExtras() {
  const bp = $('#btnProjetor'); if (bp) bp.onclick = projetorAlternar;
  const bl = $('#btnLinkProj'); if (bl) bl.onclick = projLink;
  const bx = $('#btnXLSX'); if (bx) bx.onclick = exportarXLSX;
  try { if (localStorage.getItem('pertcpm.projetor') === '1') { document.body.classList.add('projetor'); if (bp) bp.textContent = 'Sair do projetor'; } } catch (e) { }
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('projetor')) projetorAlternar(); });
  document.addEventListener('click', e => {
    if (e.target.id === 'btnPrErro') { prErroGerar(); return; }
    const cel = e.target.closest('[data-ache]'); if (cel && prErro && !prErro.escolha) { prErro.escolha = cel.getAttribute('data-ache').split('|'); renderPrErro(); return; }
    if (e.target.closest('[data-acao="relatorio"]')) prRelatorio();
  });
  renderPrErro(); montaReflexoes();
}

/* ---------- perguntas para pensar, no fim de cada aba ---------- */
const REFLEXOES = {
  result: ['Se a atividade com maior folga atrasar exatamente a folga dela, o prazo muda? E se atrasar um dia a mais?', 'Por que uma atividade pode ter folga total grande e folga livre zero? Dê um exemplo da rede.', 'Duas atividades críticas em paralelo: encurtar uma delas em 1 período encurta o projeto?'],
  rede: ['Troque mentalmente a duração de uma atividade não crítica até ela virar crítica. Quanto precisou aumentar? Compare com a folga dela.', 'Qual atividade tem mais predecessoras? O PDI dela vem de qual delas?'],
  gantt: ['Arraste a linha do tempo até a metade do projeto: quantas atividades estão em andamento ao mesmo tempo? Isso diz algo sobre a equipe necessária?', 'Ligue “barras tardias”: qual atividade pode começar mais tarde sem prejuízo? Que risco há em deixá-la para o fim?'],
  pert: ['Com 50% de confiança o prazo é o te. Por que prometer o te é arriscado?', 'Compare a probabilidade da curva normal com a simulação. Em que tipo de rede elas se afastam mais, e por quê?'],
  crash: ['Por que o algoritmo prefere encurtar a atividade mais barata do caminho crítico, e não a mais longa?', 'O que acontece com o custo total quando o custo indireto por período é zero? Vale a pena comprimir?'],
  recursos: ['Alisar não muda o prazo; respeitar um limite pode mudar. Em que situação o gestor aceita o segundo caso?', 'Qual regra de prioridade deu o menor prazo nesta rede? Teste as três.'],
  ccpm: ['Se cada atividade já tem margem embutida, por que o projeto ainda atrasa? (Lembre: síndrome do estudante e lei de Parkinson.)', 'O pulmão de projeto é menor que a soma das margens retiradas. Por que isso é razoável estatisticamente?'],
  controle: ['SPI = 0,8 no meio do projeto. O que isso diz sobre o prazo final? E se o SPI fosse 0,8 a 95% do projeto?', 'Por que o CPI costuma ser mais difícil de recuperar que o SPI?']
};
function montaReflexoes() {
  Object.keys(REFLEXOES).forEach(p => {
    const painel = $('#p-' + p); if (!painel || painel.querySelector('.reflexao')) return;
    const alvo = painel.querySelector('.passos');
    const html = '<details class="como reflexao noprint"><summary>Para pensar</summary><div class="corpo"><ol>' + REFLEXOES[p].map(q => '<li>' + q + '</li>').join('') + '</ol><p class="hint" style="margin:6px 0 0">Não há gabarito: mude os dados na aba Dados e verifique a sua resposta na própria calculadora.</p></div></details>';
    if (alvo) alvo.insertAdjacentHTML('beforebegin', html); else painel.insertAdjacentHTML('beforeend', html);
  });
}
