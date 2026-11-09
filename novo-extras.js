/* Extras do novo design: Excel (.xlsx), CSV, importar MS Project (XML) e relatório para imprimir/PDF. */
'use strict';
(function () {
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
const linkStr = (p, t, lag) => t === 'TI' ? (lag ? p + '(' + (lag > 0 ? '+' : '') + lag + ')' : p) : p + '(' + t + (lag ? (lag > 0 ? '+' : '') + lag : '') + ')';
function msProject(xml) {
  const doc = new DOMParser().parseFromString(xml, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('XML');
  const raiz = doc.documentElement; if (!raiz || raiz.localName !== 'Project') throw new Error('Project');
  const txt = (el, tag) => { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent : ''; };
  const minDia = parseFloat(txt(raiz, 'MinutesPerDay')) || 480;
  const durHoras = s => { const m = /^PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?$/.exec(String(s || '').trim()); if (!m) return 0; return (+m[1] || 0) + (+m[2] || 0) / 60 + (+m[3] || 0) / 3600; };
  const tarefas = Array.from(raiz.getElementsByTagName('Task')).filter(t => txt(t, 'Summary') !== '1' && txt(t, 'UID') !== '0' && txt(t, 'Name') !== '' && txt(t, 'IsNull') !== '1');
  if (!tarefas.length || tarefas.length > 60) throw new Error('n');
  const porUID = new Map(), codigo = i => { let s = '', n = i; do { s = String.fromCharCode(65 + (n % 26)) + s; n = Math.floor(n / 26) - 1; } while (n >= 0); return s; };
  tarefas.forEach((t, i) => porUID.set(txt(t, 'UID'), codigo(i)));
  const TIPO = { '0': 'TT', '1': 'TI', '2': 'IT', '3': 'II' };
  const acts = tarefas.map(t => {
    const c = porUID.get(txt(t, 'UID')), d = Math.round(durHoras(txt(t, 'Duration')) / (minDia / 60) * 100) / 100, ps = [];
    Array.from(t.getElementsByTagName('PredecessorLink')).forEach(pl => {
      const p = porUID.get(txt(pl, 'PredecessorUID')); if (!p || p === c) return;
      const lag = Math.round((parseFloat(txt(pl, 'LinkLag')) || 0) / 10 / minDia * 100) / 100;   /* LinkLag: décimos de minuto */
      ps.push(linkStr(p, TIPO[txt(pl, 'Type')] || 'TI', lag));
    });
    const custo = parseFloat(txt(t, 'Cost'));
    return { c, n: txt(t, 'Name').slice(0, 120), d: String(d), p: ps.join(', '), o: String(d), m: String(d), pe: String(d), cn: isFinite(custo) && custo > 0 ? String(Math.round(custo) / 100) : '' };
  });
  return { acts, nome: (txt(raiz, 'Title') || txt(raiz, 'Name') || '').slice(0, 120) };
}
function calc(data) {
  const R = window.PERTENG.build(data.acts, data.mode, new Proxy({}, { get: () => () => 'erro' }));
  if (R.errors.length) return null;
  const N = R.nodes, dur = Math.max(...N.map(x => x.ef)), crit = N.filter(x => x.crit);
  return { N, dur, crit, sigma: data.mode === 'PERT' ? Math.sqrt(crit.reduce((s, x) => s + (x.v || 0), 0)) : null };
}
const r2 = v => Math.round(v * 100) / 100;
const nomeArq = () => 'pertcpm-' + new Date().toISOString().slice(0, 10);
function baixa(blob, nome) { const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = nome; document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000); }
function tabelas(data, $) {
  const c = calc(data); if (!c) return null; const pert = data.mode === 'PERT';
  const dados = [[$('Código', 'Code', 'Código'), $('Atividade', 'Activity', 'Actividad')].concat(pert ? ['o', 'm', 'p'] : [$('Duração', 'Duration', 'Duración')]).concat([$('Predecessoras', 'Predecessors', 'Predecesoras')])];
  const nn = v => { const x = Number(String(v).replace(',', '.')); return Number.isFinite(x) ? x : v; };
  data.acts.forEach(a => dados.push([a.c, a.n].concat(pert ? [nn(a.o), nn(a.m), nn(a.pe)] : [nn(a.d)]).concat([a.p || ''])));
  const res = [[$('Atividade', 'Activity', 'Actividad'), $('Duração', 'Duration', 'Duración'), 'ES', 'EF', 'LS', 'LF', $('Folga', 'Slack', 'Holgura'), $('Crítica', 'Critical', 'Crítica')]];
  c.N.forEach(x => res.push([x.c, r2(x.d), r2(x.es), r2(x.ef), r2(x.ls), r2(x.lf), r2(x.slack), x.crit ? $('sim', 'yes', 'sí') : $('não', 'no', 'no')]));
  const tot = [[$('Duração do projeto', 'Project duration', 'Duración del proyecto'), r2(c.dur)]];
  if (pert) tot.push(['σ', r2(c.sigma)]);
  tot.push([$('Caminho crítico', 'Critical path', 'Ruta crítica'), c.crit.map(x => x.c).join(' → ')]);
  return { c, dados, res, tot };
}
window.NX = {
  xlsx(data, $) { const t = tabelas(data, $); if (!t) return false; baixa(xlLivro([[$('Resultados', 'Results', 'Resultados'), t.res.concat([[]], t.tot)], [$('Dados', 'Data', 'Datos'), t.dados]]), nomeArq() + '.xlsx'); return true; },
  csv(data, $) {
    const t = tabelas(data, $); if (!t) return false; const en = $('', 'en', '') === 'en', sep = en ? ',' : ';';
    const q = v => { v = typeof v === 'number' ? (en ? String(v) : String(v).replace('.', ',')) : String(v == null ? '' : v); return /[";,\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; };
    baixa(new Blob(['﻿' + t.res.concat([[]], t.tot).map(l => l.map(q).join(sep)).join('\r\n')], { type: 'text/csv;charset=utf-8' }), nomeArq() + '.csv'); return true;
  },
  msProject(cb) {
    const inp = document.createElement('input'); inp.type = 'file'; inp.accept = '.xml,text/xml,application/xml';
    inp.onchange = () => { const f = inp.files[0]; if (!f) return; const fr = new FileReader(); fr.onload = () => { let r = null; try { r = msProject(fr.result); } catch (e) { } cb(r); }; fr.readAsText(f); };
    inp.click();
  },
  relatorio(data, $) {
    const t = tabelas(data, $); if (!t) return false; const w = window.open('', '_blank'); if (!w) return false;
    const loc = $('pt-BR', 'en-US', 'es-ES'), esc = s => String(s).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[ch]));
    const fv = v => typeof v === 'number' ? v.toLocaleString(loc) : v;
    const tab = l => '<table><thead><tr>' + l[0].map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead><tbody>' + l.slice(1).map(r => '<tr' + (r[7] === $('sim', 'yes', 'sí') ? ' class="c"' : '') + '>' + r.map(v => '<td>' + esc(fv(v)) + '</td>').join('') + '</tr>').join('') + '</tbody></table>';
    w.document.write('<!doctype html><html lang="' + loc + '"><meta charset="utf-8"><title>' + $('Relatório', 'Report', 'Informe') + ' · GEO PERT/CPM</title><style>body{font:13px/1.45 "IBM Plex Sans",Arial,sans-serif;color:#16243B;margin:28px}h1{font-size:20px;margin:6px 0 2px}h2{font-size:15px;margin:22px 0 6px;color:#1A3A6B}table{border-collapse:collapse;width:100%}th,td{border:1px solid #DED8CE;padding:4px 7px;text-align:left}th{background:#F1EEE8}tr.c td{color:#B3392C;font-weight:600}.kpi{display:flex;gap:28px;flex-wrap:wrap;margin:12px 0}.kpi b{display:block;font-size:19px}footer{margin-top:26px;font-size:11px;color:#5C6A80}@media print{button{display:none}}</style>' +
      '<img src="' + location.origin + '/img/' + $('logo-pequeno', 'logo-titulo', 'logo-titulo') + '.webp" alt="GEO PERT/CPM" style="width:300px"><h1>' + $('Relatório do projeto', 'Project report', 'Informe del proyecto') + '</h1><div>' + new Date().toLocaleDateString(loc) + ' · ' + (data.mode === 'PERT' ? 'PERT' : 'CPM') + '</div>' +
      '<div class="kpi">' + t.tot.map(r => '<div>' + esc(r[0]) + '<b>' + esc(fv(r[1])) + '</b></div>').join('') + '</div>' +
      '<h2>' + $('Datas e folgas (vermelho: crítica)', 'Dates and slack (red: critical)', 'Fechas y holguras (rojo: crítica)') + '</h2>' + tab(t.res) + '<h2>' + $('Dados', 'Data', 'Datos') + '</h2>' + tab(t.dados) +
      '<footer>GEO PERT/CPM · pertcpm.vercel.app · @LMVN 2026</footer><p><button onclick="print()">' + $('Imprimir / salvar PDF', 'Print / save PDF', 'Imprimir / guardar PDF') + '</button></p><script>setTimeout(function(){print()},700)<\/script></html>');
    w.document.close(); return true;
  }
};
})();
