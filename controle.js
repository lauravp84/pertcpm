/* Controle do projeto: curva S, valor agregado (EVM), marcos e linha de base.
   Carregado antes de app.js: só declara funções; usa os globais do app (state, calcOut, $, fmt…) na hora da chamada. */
'use strict';

/* ---------- custo planejado por atividade ----------
   Prioridade: custo informado na aba Controle; senão, o custo direto normal rateado pela duração;
   senão, 1 unidade por período (a curva S sai em "períodos de trabalho"). */
function evCustos(c) {
  const m = new Map(); let fonte = 'informado', algum = false;
  c.acts.forEach(n => { const v = num(n.ref.custo); if (String(n.ref.custo == null ? '' : n.ref.custo).trim() !== '' && v >= 0) { m.set(n.id, v); algum = true; } });
  if (algum) { c.acts.forEach(n => { if (!m.has(n.id)) m.set(n.id, 0); }); return { custos: m, fonte }; }
  const total = num(state.custoDir), somaDur = c.acts.reduce((t, n) => t + n.dur, 0);
  if (total > 0 && somaDur > 0) { c.acts.forEach(n => m.set(n.id, total * n.dur / somaDur)); return { custos: m, fonte: 'rateado' }; }
  c.acts.forEach(n => m.set(n.id, n.dur)); return { custos: m, fonte: 'duracao' };
}
/* fração planejada da atividade concluída no instante t (linear entre ES e EF) */
function evFracao(n, t) { if (n.dur <= 1e-9) return t >= n.ES - 1e-9 ? 1 : 0; return Math.min(1, Math.max(0, (t - n.ES) / n.dur)); }
function evPV(c, custos, t) { let s = 0; c.acts.forEach(n => { s += custos.get(n.id) * evFracao(n, t); }); return s; }

function evCalcular(c) {
  const { custos, fonte } = evCustos(c);
  const BAC = Array.from(custos.values()).reduce((a, b) => a + b, 0);
  const T = Math.min(Math.max(0, num(state.statusT)), c.dur);
  const temStatus = String(state.statusT == null ? '' : state.statusT).trim() !== '';
  let EV = 0, AC = 0, temGasto = false, temReal = false;
  c.acts.forEach(n => {
    const r = num(n.ref.real); if (String(n.ref.real == null ? '' : n.ref.real).trim() !== '') temReal = true;
    EV += custos.get(n.id) * Math.min(1, Math.max(0, r / 100));
    if (String(n.ref.gasto == null ? '' : n.ref.gasto).trim() !== '') { temGasto = true; AC += Math.max(0, num(n.ref.gasto)); }
  });
  const PV = evPV(c, custos, T);
  /* tempo agregado (earned schedule): instante em que o planejado valia EV */
  let ES = 0;
  if (EV > 0) { let lo = 0, hi = c.dur; for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (evPV(c, custos, mid) < EV) lo = mid; else hi = mid; } ES = (lo + hi) / 2; }
  const SPI = PV > 0 ? EV / PV : NaN, CPI = temGasto && AC > 0 ? EV / AC : NaN;
  const SPIt = T > 0 ? ES / T : NaN;
  return {
    custos, fonte, BAC, T, temStatus, temReal, temGasto, PV, EV, AC, SV: EV - PV, CV: temGasto ? EV - AC : NaN, SPI, CPI, ES, SPIt,
    EAC: isFinite(CPI) && CPI > 0 ? BAC / CPI : NaN, ETC: isFinite(CPI) && CPI > 0 ? BAC / CPI - AC : NaN, VAC: isFinite(CPI) && CPI > 0 ? BAC - BAC / CPI : NaN,
    prazoPrev: isFinite(SPIt) && SPIt > 0 ? c.dur / SPIt : NaN, pctPlan: BAC > 0 ? PV / BAC : 0, pctReal: BAC > 0 ? EV / BAC : 0
  };
}

function evCurvaS(c, ev) {
  const W = 560, H = 250, L = 64, R = 20, T0 = 16, B = 40;
  const fim = Math.max(c.dur, isFinite(ev.prazoPrev) ? ev.prazoPrev : 0, 1e-9), topo = Math.max(ev.BAC, isFinite(ev.EAC) ? ev.EAC : 0, ev.AC, 1e-9) * 1.05;
  const sx = t => L + t / fim * (W - L - R), sy = v => T0 + (1 - v / topo) * (H - T0 - B);
  let d = '';
  for (let i = 0; i <= 100; i++) { const t = c.dur * i / 100; d += (i ? 'L' : 'M') + sx(t).toFixed(1) + ',' + sy(evPV(c, ev.custos, t)).toFixed(1) + ' '; }
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:720px;display:block" font-family="IBM Plex Mono, monospace" role="img" aria-label="Curva S: custo planejado acumulado, valor agregado e custo real">';
  [0, 0.25, 0.5, 0.75, 1].forEach(q => { const y = sy(topo * q / 1.05); s += '<line x1="' + L + '" y1="' + y.toFixed(1) + '" x2="' + (W - R) + '" y2="' + y.toFixed(1) + '" stroke="#EFEBE3"/><text x="' + (L - 6) + '" y="' + (y + 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + C.apagadinho + '">' + money(Math.round(topo * q / 1.05)) + '</text>'; });
  s += '<path d="' + d + '" fill="none" stroke="' + C.navy + '" stroke-width="2.2"/>';
  s += '<line x1="' + L + '" y1="' + (H - B) + '" x2="' + (W - R) + '" y2="' + (H - B) + '" stroke="' + C.borda + '"/>';
  [0, fim / 2, fim].forEach((t, i) => { s += '<text x="' + sx(t).toFixed(1) + '" y="' + (H - B + 16) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '" font-size="12" fill="' + C.apagadinho + '">' + fmt(t) + '</text>'; });
  s += '<text x="' + sx(c.dur).toFixed(1) + '" y="' + (sy(ev.BAC) - 6).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + C.navy + '">BAC ' + money(Math.round(ev.BAC)) + '</text>';
  if (ev.temStatus) {
    const x = sx(ev.T);
    s += '<line x1="' + x.toFixed(1) + '" y1="' + T0 + '" x2="' + x.toFixed(1) + '" y2="' + (H - B) + '" stroke="' + C.apagado + '" stroke-dasharray="4 3"/><text x="' + (x + 4).toFixed(1) + '" y="' + (T0 + 10) + '" font-size="11" fill="' + C.apagado + '">status</text>';
    s += '<circle cx="' + x.toFixed(1) + '" cy="' + sy(ev.PV).toFixed(1) + '" r="4.5" fill="' + C.navy + '"/><text x="' + (x + 7).toFixed(1) + '" y="' + (sy(ev.PV) + 4).toFixed(1) + '" font-size="11" fill="' + C.navy + '">PV</text>';
    if (ev.temReal) {
      s += '<path d="M' + sx(0) + ',' + sy(0).toFixed(1) + ' L' + x.toFixed(1) + ',' + sy(ev.EV).toFixed(1) + '" fill="none" stroke="' + C.folga + '" stroke-width="2"/><circle cx="' + x.toFixed(1) + '" cy="' + sy(ev.EV).toFixed(1) + '" r="4.5" fill="' + C.folga + '"/><text x="' + (x + 7).toFixed(1) + '" y="' + (sy(ev.EV) + 4).toFixed(1) + '" font-size="11" fill="' + C.folga + '">EV</text>';
      if (isFinite(ev.prazoPrev)) s += '<line x1="' + sx(ev.prazoPrev).toFixed(1) + '" y1="' + T0 + '" x2="' + sx(ev.prazoPrev).toFixed(1) + '" y2="' + (H - B) + '" stroke="' + C.folga + '" stroke-dasharray="2 3"/>';
    }
    if (ev.temGasto) {
      s += '<path d="M' + sx(0) + ',' + sy(0).toFixed(1) + ' L' + x.toFixed(1) + ',' + sy(ev.AC).toFixed(1) + '" fill="none" stroke="' + C.critico + '" stroke-width="2"/><circle cx="' + x.toFixed(1) + '" cy="' + sy(ev.AC).toFixed(1) + '" r="4.5" fill="' + C.critico + '"/><text x="' + (x + 7).toFixed(1) + '" y="' + (sy(ev.AC) + 4).toFixed(1) + '" font-size="11" fill="' + C.critico + '">AC</text>';
      if (isFinite(ev.EAC)) s += '<path d="M' + x.toFixed(1) + ',' + sy(ev.AC).toFixed(1) + ' L' + sx(isFinite(ev.prazoPrev) ? ev.prazoPrev : c.dur).toFixed(1) + ',' + sy(ev.EAC).toFixed(1) + '" fill="none" stroke="' + C.critico + '" stroke-dasharray="3 3"/><text x="' + (W - R) + '" y="' + (sy(ev.EAC) - 4).toFixed(1) + '" text-anchor="end" font-size="11" fill="' + C.critico + '">EAC ' + money(Math.round(ev.EAC)) + '</text>';
    }
  }
  return s + '</svg>';
}

function renderControle() {
  const box = $('#ctrlSaida'); if (!box) return;
  const c = calcOut;
  if (!c || c.vazio || c.ciclo || (c.erros && c.erros.length) || !c.acts.length) { $('#tblCtrl').innerHTML = ''; box.innerHTML = '<p class="hint">Corrija os erros da aba Dados para acompanhar o projeto.</p>'; $('#ctrlMarcos').innerHTML = ''; $('#ctrlBase').innerHTML = ''; return; }
  const ev = evCalcular(c);
  if ($('#statusT') !== document.activeElement) $('#statusT').value = state.statusT;
  const tb = $('#tblCtrl');
  if (!tb.contains(document.activeElement)) {
    let h = '<thead><tr><th>Atividade</th><th class="dir">' + sg('ES') + '</th><th class="dir">' + sg('EF') + '</th><th class="w-num">Custo planejado</th><th class="dir">Previsto em t</th><th class="w-num">% concluído real</th><th class="w-num">Gasto real</th></tr></thead><tbody>';
    c.acts.forEach(n => {
      const i = state.acts.indexOf(n.ref);
      h += '<tr class="' + (n.crit ? 'crit' : '') + '"><td class="cod"><b>' + esc(n.id) + '</b>' + (n.nome ? ' <span style="color:var(--apagado)">' + esc(n.nome) + '</span>' : '') + '</td><td class="dir">' + fmt(n.ES) + '</td><td class="dir">' + fmt(n.EF) + '</td>' +
        '<td><input data-ctrl="custo" data-i="' + i + '" inputmode="decimal" value="' + esc(n.ref.custo) + '" placeholder="' + esc(money(Math.round(ev.custos.get(n.id)))) + '" aria-label="Custo planejado de ' + esc(n.id) + '"></td>' +
        '<td class="dir">' + (ev.temStatus ? Math.round(evFracao(n, ev.T) * 100) + '%' : '—') + '</td>' +
        '<td><input data-ctrl="real" data-i="' + i + '" inputmode="decimal" value="' + esc(n.ref.real) + '" placeholder="0" aria-label="Percentual concluído de ' + esc(n.id) + '"></td>' +
        '<td><input data-ctrl="gasto" data-i="' + i + '" inputmode="decimal" value="' + esc(n.ref.gasto) + '" placeholder="0" aria-label="Gasto real de ' + esc(n.id) + '"></td></tr>';
    });
    tb.innerHTML = h + '</tbody>';
  }
  const un = v => money(Math.round(v * 100) / 100);
  const fonteTxt = ev.fonte === 'informado' ? 'custos informados na tabela' : ev.fonte === 'rateado' ? 'custo direto normal (' + money(num(state.custoDir)) + ') rateado pela duração de cada atividade' : 'sem custos informados: cada período de trabalho vale 1 (a curva mede trabalho, não dinheiro)';
  let h = '<p class="hint" style="margin:0 0 8px">Base da curva: ' + fonteTxt + '. Orçamento total (BAC): <b>' + un(ev.BAC) + '</b>.</p>';
  h += evCurvaS(c, ev);
  h += '<div class="legenda"><span><i style="background:var(--navy)"></i>Planejado (PV)</span><span><i style="background:var(--folga)"></i>Valor agregado (EV)</span><span><i style="background:var(--critico)"></i>Custo real (AC)</span></div>';
  if (!ev.temStatus) {
    h += '<p class="ler interp"><b class="t">O que a curva diz:</b> é a curva S do plano: quanto do orçamento deveria estar gasto a cada período se tudo correr como planejado. Para acompanhar o projeto, informe acima o <b>período de status</b> e, na tabela, o % concluído e o gasto real de cada atividade.</p>';
  } else {
    const pct = v => isFinite(v) ? (v * 100).toFixed(0) + '%' : '—';
    h += '<div class="kpis" style="margin-top:14px">' +
      '<div class="kpi"><div class="olho">PV (planejado até ' + fmt(ev.T) + ')</div><div class="v">' + un(ev.PV) + '</div></div>' +
      '<div class="kpi"><div class="olho">EV (valor agregado)</div><div class="v navy">' + (ev.temReal ? un(ev.EV) : '—') + '</div></div>' +
      '<div class="kpi"><div class="olho">AC (custo real)</div><div class="v">' + (ev.temGasto ? un(ev.AC) : '—') + '</div></div></div>';
    if (ev.temReal) {
      h += '<div class="rolar" style="margin-top:12px"><table class="tab"><thead><tr><th>Indicador</th><th class="dir">Valor</th><th>Leitura</th></tr></thead><tbody>' +
        '<tr><td>SV = EV − PV</td><td class="dir">' + un(ev.SV) + '</td><td class="txt">' + (ev.SV < -1e-9 ? 'atrasado em valor' : ev.SV > 1e-9 ? 'adiantado' : 'no prazo') + '</td></tr>' +
        '<tr><td>SPI = EV ÷ PV</td><td class="dir">' + (isFinite(ev.SPI) ? ev.SPI.toFixed(2).replace('.', DEC) : '—') + '</td><td class="txt">' + (isFinite(ev.SPI) ? (ev.SPI < 0.999 ? 'a cada 1 planejado, só ' + ev.SPI.toFixed(2).replace('.', DEC) + ' foi feito' : 'ritmo igual ou melhor que o plano') : 'nada planejado até aqui') + '</td></tr>' +
        '<tr><td>Tempo agregado (ES)</td><td class="dir">' + fmt(ev.ES) + '</td><td class="txt">o trabalho feito equivale ao plano do período ' + fmt(ev.ES) + (isFinite(ev.SPIt) ? ' (SPI<sub>t</sub> = ' + ev.SPIt.toFixed(2).replace('.', DEC) + ')' : '') + '</td></tr>' +
        '<tr><td>Prazo previsto</td><td class="dir"><b>' + (isFinite(ev.prazoPrev) ? fmt(ev.prazoPrev) + ' ' + uni(ev.prazoPrev) : '—') + '</b></td><td class="txt">plano: ' + fmt(c.dur) + ' ' + uni(c.dur) + (isFinite(ev.prazoPrev) ? ' (' + (ev.prazoPrev > c.dur + 1e-9 ? '+' : '') + fmt(ev.prazoPrev - c.dur) + ')' : '') + '</td></tr>' +
        (ev.temGasto ? '<tr><td>CV = EV − AC</td><td class="dir">' + un(ev.CV) + '</td><td class="txt">' + (ev.CV < -1e-9 ? 'acima do orçamento' : ev.CV > 1e-9 ? 'abaixo do orçamento' : 'no orçamento') + '</td></tr>' +
          '<tr><td>CPI = EV ÷ AC</td><td class="dir">' + (isFinite(ev.CPI) ? ev.CPI.toFixed(2).replace('.', DEC) : '—') + '</td><td class="txt">' + (isFinite(ev.CPI) ? 'cada 1 gasto rendeu ' + ev.CPI.toFixed(2).replace('.', DEC) + ' de valor' : '—') + '</td></tr>' +
          '<tr><td>EAC = BAC ÷ CPI</td><td class="dir"><b>' + un(ev.EAC) + '</b></td><td class="txt">custo final previsto (orçamento: ' + un(ev.BAC) + ')</td></tr>' +
          '<tr><td>ETC = EAC − AC</td><td class="dir">' + un(ev.ETC) + '</td><td class="txt">quanto ainda falta gastar</td></tr>' +
          '<tr><td>VAC = BAC − EAC</td><td class="dir">' + un(ev.VAC) + '</td><td class="txt">' + (ev.VAC < -1e-9 ? 'estouro previsto' : 'sobra prevista') + '</td></tr>' : '') +
        '</tbody></table></div>';
      const frases = [];
      frases.push('No período <b>' + fmt(ev.T) + '</b>, o plano previa <b>' + pct(ev.pctPlan) + '</b> do projeto pronto e foi feito <b>' + pct(ev.pctReal) + '</b>' + (isFinite(ev.SPI) ? ' (SPI ' + ev.SPI.toFixed(2).replace('.', DEC) + ')' : '') + '.');
      if (isFinite(ev.prazoPrev)) frases.push('Mantido este ritmo, o projeto termina em <b>' + fmt(ev.prazoPrev) + ' ' + uni(ev.prazoPrev) + '</b>' + (ev.prazoPrev > c.dur + 0.05 ? ', <b>' + fmt(ev.prazoPrev - c.dur) + ' ' + uni(ev.prazoPrev - c.dur) + ' de atraso</b>.' : ', dentro do prazo.'));
      if (ev.temGasto && isFinite(ev.CPI)) frases.push(ev.CPI < 0.999 ? 'Cada 1 gasto rendeu só ' + ev.CPI.toFixed(2).replace('.', DEC) + ': o custo final tende a <b>' + un(ev.EAC) + '</b>, ' + un(-ev.VAC) + ' acima do orçamento.' : 'O gasto está rendendo: custo final previsto de <b>' + un(ev.EAC) + '</b>.');
      h += '<p class="ler interp"><b class="t">O que o resultado diz:</b> ' + frases.join(' ') + '</p>';
    } else h += '<p class="hint">Informe o <b>% concluído real</b> das atividades para calcular o valor agregado e os índices.</p>';
  }
  box.innerHTML = h;
  renderMarcos(c); renderBase(c);
}

/* ---------- marcos ---------- */
function renderMarcos(c) {
  const box = $('#ctrlMarcos'); if (!box) return;
  const ms = state.marcos || [];
  let h = '<div class="rolar"><table class="tab"><thead><tr><th>Marco</th><th>Ao terminar</th><th class="dir">Previsto</th><th class="dir">Alvo</th><th class="dir">Diferença</th><th class="w-x noprint"></th></tr></thead><tbody>';
  ms.forEach((m, i) => {
    const n = c.N.get(m.ref); const prev = n ? n.EF : (m.ref === '__fim' ? c.dur : NaN);
    const alvo = String(m.alvo == null ? '' : m.alvo).trim() === '' ? NaN : num(m.alvo); const dif = prev - alvo;
    h += '<tr><td><input data-marco="nome" data-i="' + i + '" value="' + esc(m.nome) + '" placeholder="nome do marco" maxlength="60" aria-label="Nome do marco"></td>' +
      '<td><select data-marco="ref" data-i="' + i + '" aria-label="Atividade de referência"><option value="__fim"' + (m.ref === '__fim' ? ' selected' : '') + '>fim do projeto</option>' + c.acts.map(x => '<option value="' + esc(x.id) + '"' + (x.id === m.ref ? ' selected' : '') + '>' + esc(x.id) + (x.nome ? ' · ' + esc(x.nome.slice(0, 20)) : '') + '</option>').join('') + '</select></td>' +
      '<td class="dir"><b>' + (isFinite(prev) ? fmt(prev) + (state.inicio ? ' (' + fmtData(diaDoPeriodo(prev)) + ')' : '') : '—') + '</b></td>' +
      '<td><input data-marco="alvo" data-i="' + i + '" inputmode="decimal" value="' + esc(m.alvo) + '" placeholder="período" aria-label="Período alvo"></td>' +
      '<td class="dir" style="color:' + (dif > 1e-9 ? 'var(--critico)' : 'var(--folga)') + ';font-weight:600">' + (isFinite(dif) ? (dif > 1e-9 ? '+' + fmt(dif) + ' (atraso)' : dif < -1e-9 ? fmt(dif) + ' (folga)' : 'no alvo') : '—') + '</td>' +
      '<td class="noprint"><button class="remover" data-marco-del="' + i + '" aria-label="Remover marco">×</button></td></tr>';
  });
  h += '</tbody></table></div><div class="noprint" style="margin-top:10px"><button class="bt mini" id="btnMarco">+ Marco</button></div>';
  if (!ms.length) h = '<p class="hint" style="margin:0 0 8px">Marcos são entregas com data combinada (por exemplo, “protótipo aprovado”). Ligue cada marco ao fim de uma atividade e informe o período alvo: a calculadora compara com o previsto.</p>' + h;
  box.innerHTML = h;
}

/* ---------- linha de base ---------- */
function renderBase(c) {
  const box = $('#ctrlBase'); if (!box) return;
  const b = state.baseline;
  if (!b) { box.innerHTML = '<p class="hint" style="margin:0 0 8px">A linha de base é a “foto” do plano aprovado. Salve-a e, quando o projeto mudar (durações, novas atividades), veja aqui o que se deslocou.</p><button class="bt primario mini noprint" id="btnBaseSalvar">Salvar linha de base agora</button>'; return; }
  let h = '<p class="hint" style="margin:0 0 8px">Linha de base salva em ' + esc(b.quando) + ' · prazo na base: <b>' + fmt(b.dur) + '</b> · prazo atual: <b>' + fmt(c.dur) + '</b> (' + (c.dur - b.dur > 1e-9 ? '<span style="color:var(--critico)">+' + fmt(c.dur - b.dur) + '</span>' : c.dur - b.dur < -1e-9 ? '<span style="color:var(--folga)">' + fmt(c.dur - b.dur) + '</span>' : 'igual') + ').</p>';
  const fim = Math.max(c.dur, b.dur, 1e-9), L = 120, W = 560, lh = 20, ids = c.ordem.slice(); Object.keys(b.acts).forEach(id => { if (ids.indexOf(id) < 0) ids.push(id); });
  const H = 12 + ids.length * lh + 24, sx = t => L + t / fim * (W - L - 12);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:760px;display:block" font-family="IBM Plex Sans, sans-serif" role="img" aria-label="Comparação com a linha de base">';
  ids.forEach((id, i) => {
    const y = 6 + i * lh, n = c.N.get(id), ba = b.acts[id];
    s += '<text x="' + (L - 6) + '" y="' + (y + 13) + '" text-anchor="end" font-size="12" fill="' + C.tinta + '">' + esc(id) + '</text>';
    if (ba) s += '<rect x="' + sx(ba.ES).toFixed(1) + '" y="' + (y + 2) + '" width="' + Math.max(2, sx(ba.EF) - sx(ba.ES)).toFixed(1) + '" height="6" fill="' + C.neutro + '"/>';
    if (n) s += '<rect x="' + sx(n.ES).toFixed(1) + '" y="' + (y + 9) + '" width="' + Math.max(2, sx(n.EF) - sx(n.ES)).toFixed(1) + '" height="7" rx="1.5" fill="' + (n.crit ? C.critico : C.navy) + '"/>';
  });
  const yb = 6 + ids.length * lh; s += '<line x1="' + L + '" y1="' + yb + '" x2="' + (W - 12) + '" y2="' + yb + '" stroke="' + C.borda + '"/>';
  [0, fim / 2, fim].forEach((t, i) => { s += '<text x="' + sx(t).toFixed(1) + '" y="' + (yb + 15) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '" font-size="12" fill="' + C.apagadinho + '">' + fmt(t) + '</text>'; });
  s += '</svg>';
  h += s + '<div class="legenda"><span><i style="background:var(--neutro)"></i>Linha de base</span><span><i style="background:var(--navy)"></i>Plano atual</span><span><i style="background:var(--critico)"></i>Atual, crítica</span></div>';
  h += '<div class="rolar" style="margin-top:10px"><table class="tab"><thead><tr><th>Atividade</th><th class="dir">Término na base</th><th class="dir">Término atual</th><th class="dir">Variação</th></tr></thead><tbody>';
  ids.forEach(id => { const n = c.N.get(id), ba = b.acts[id]; const d = n && ba ? n.EF - ba.EF : NaN; h += '<tr class="' + (Math.abs(d) > 1e-9 ? 'crit' : '') + '"><td class="cod"><b>' + esc(id) + '</b>' + (!n ? ' <span style="color:var(--apagado)">(removida)</span>' : !ba ? ' <span style="color:var(--apagado)">(nova)</span>' : '') + '</td><td class="dir">' + (ba ? fmt(ba.EF) : '—') + '</td><td class="dir">' + (n ? fmt(n.EF) : '—') + '</td><td class="dir">' + (isFinite(d) ? (Math.abs(d) < 1e-9 ? '—' : (d > 0 ? '+' : '') + fmt(d)) : '—') + '</td></tr>'; });
  h += '</tbody></table></div><div class="noprint" style="margin-top:10px;display:flex;gap:8px"><button class="bt mini" id="btnBaseSalvar">Salvar nova linha de base</button><button class="bt mini perigo" id="btnBaseApagar">Apagar linha de base</button></div>';
  box.innerHTML = h;
}
function baseSalvar() {
  const c = calcOut; if (!c || !c.acts.length || c.erros.length) { alerta('Corrija os erros dos dados antes de salvar a linha de base.'); return; }
  const acts = {}; c.acts.forEach(n => { acts[n.id] = { ES: n.ES, EF: n.EF, dur: n.dur }; });
  state.baseline = { quando: new Date().toLocaleString(LOCALE, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }), dur: c.dur, acts };
  gravarEstado(); renderBase(c); toast('Linha de base salva.');
}
function ligarControle() {
  const st = $('#statusT'); if (!st) return;
  st.oninput = () => { state.statusT = st.value; renderControle(); gravarEstado(); };
  $('#tblCtrl').addEventListener('input', e => { const f = e.target.getAttribute('data-ctrl'); if (!f) return; const a = state.acts[+e.target.dataset.i]; if (!a) return; a[f] = e.target.value; renderControle(); gravarEstado(); });
  const painel = $('#p-controle');
  painel.addEventListener('click', e => {
    if (e.target.id === 'btnMarco') { state.marcos = state.marcos || []; if (state.marcos.length >= 30) { alerta('No máximo 30 marcos.'); return; } state.marcos.push({ nome: '', ref: '__fim', alvo: '' }); renderMarcos(calcOut); gravarEstado(); }
    const del = e.target.getAttribute('data-marco-del'); if (del !== null) { state.marcos.splice(+del, 1); renderMarcos(calcOut); gravarEstado(); }
    if (e.target.id === 'btnBaseSalvar') baseSalvar();
    if (e.target.id === 'btnBaseApagar') { state.baseline = null; gravarEstado(); renderBase(calcOut); }
  });
  painel.addEventListener('input', e => { const f = e.target.getAttribute('data-marco'); if (!f) return; const m = state.marcos[+e.target.dataset.i]; if (!m) return; m[f] = e.target.value; if (f !== 'nome') renderMarcos(calcOut); gravarEstado(); });
  painel.addEventListener('change', e => { if (e.target.getAttribute('data-marco') === 'ref') { renderMarcos(calcOut); } });
}
