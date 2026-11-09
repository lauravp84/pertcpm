/* Corrente crítica (CCPM, Goldratt): durações agressivas, pulmão de projeto, pulmões de convergência e gráfico de febre.
   Carregado antes de app.js: só declara funções. */
'use strict';

/* Durações "seguras" (as informadas) e "agressivas" (sem a margem de segurança de cada atividade).
   CPM: agressiva = segura × (1 − corte). PERT: agressiva = m (mais provável) e segura = p (pessimista). */
function ccDuracoes(c) {
  const corte = Math.min(0.9, Math.max(0, num(state.ccCorte) / 100));
  const seg = new Map(), agr = new Map();
  c.acts.forEach(n => {
    const a = n.ref;
    if (state.modo === 'pert') { seg.set(n.id, num(a.p)); agr.set(n.id, Math.min(num(a.m), num(a.p))); }
    else { seg.set(n.id, num(a.d)); agr.set(n.id, num(a.d) * (1 - corte)); }
  });
  return { seg, agr, corte };
}
const ccPulmao = (margens, metodo) => metodo === 'rss' ? Math.sqrt(margens.reduce((t, m) => t + m * m, 0)) : margens.reduce((t, m) => t + m, 0) / 2;

function ccCalcular(c) {
  const { seg, agr, corte } = ccDuracoes(c);
  const metodo = state.ccMetodo === 'rss' ? 'rss' : 'metade';
  const A = calcular(agr);                                   /* rede com durações agressivas */
  if (A.erros.length || !A.acts.length) return null;
  const cadeia = A.critSeq.slice();                          /* corrente crítica (sem disputa de recursos) */
  const naCadeia = new Set(cadeia);
  const margem = id => Math.max(0, seg.get(id) - agr.get(id));
  const PB = ccPulmao(cadeia.map(margem), metodo);
  /* pulmões de convergência: para cada atividade fora da corrente cujo sucessor está na corrente
     (ou que encerra o projeto), a cadeia alimentadora é o caminho mais longo, fora da corrente, que chega nela. */
  const melhor = new Map(), veio = new Map();
  A.ordem.forEach(id => {
    if (naCadeia.has(id)) return;
    const n = A.N.get(id); let b = 0, de = null;
    n.preds.forEach(p => { if (!naCadeia.has(p) && melhor.has(p) && melhor.get(p) + agr.get(p) > b) { b = melhor.get(p) + agr.get(p); de = p; } });
    melhor.set(id, b); veio.set(id, de);
  });
  const feeds = [];
  A.ordem.forEach(id => {
    if (naCadeia.has(id)) return;
    const n = A.N.get(id);
    const entra = n.succs.filter(s => naCadeia.has(s));
    const final = !n.succs.length;
    if (!entra.length && !final) return;
    const seq = []; for (let cur = id; cur; cur = veio.get(cur)) seq.unshift(cur);
    const FB = ccPulmao(seq.map(margem), metodo);
    const folga = A.N.get(id).FT;
    feeds.push({ seq, antesDe: entra.length ? entra.sort((x, y) => A.N.get(x).ES - A.N.get(y).ES)[0] : 'FIM', FB, folga, cabe: FB <= folga + 1e-9 });
  });
  const durAgr = A.dur, durSeg = c.dur, protegido = durAgr + PB;
  return { A, cadeia, PB, feeds, durAgr, durSeg, protegido, metodo, corte, seg, agr, margem };
}

function ccFebre(avanco, consumo) {
  const W = 320, H = 240, L = 44, R = 14, T = 14, B = 36;
  const sx = v => L + v / 100 * (W - L - R), sy = v => T + (1 - v / 100) * (H - T - B);
  const amar = x => 20 + 0.4 * x, verm = x => 50 + 0.4 * x;   /* limites das zonas (convenção desta ferramenta) */
  const area = (f, g) => { let d = 'M' + sx(0) + ',' + sy(f(0)); for (let x = 0; x <= 100; x += 10) d += ' L' + sx(x) + ',' + sy(f(x)); for (let x = 100; x >= 0; x -= 10) d += ' L' + sx(x) + ',' + sy(g(x)); return d + ' Z'; };
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:420px;display:block" font-family="IBM Plex Mono, monospace" role="img" aria-label="Gráfico de febre do pulmão">';
  s += '<path d="' + area(() => 0, amar) + '" fill="#D9EBDD"/><path d="' + area(amar, verm) + '" fill="#F6E7B8"/><path d="' + area(verm, () => 100) + '" fill="#F3CFC8"/>';
  [0, 50, 100].forEach(v => { s += '<text x="' + (L - 6) + '" y="' + (sy(v) + 4) + '" text-anchor="end" font-size="11" fill="' + C.apagadinho + '">' + v + '%</text><text x="' + sx(v) + '" y="' + (H - B + 16) + '" text-anchor="middle" font-size="11" fill="' + C.apagadinho + '">' + v + '%</text>'; });
  s += '<text x="' + (W / 2) + '" y="' + (H - 4) + '" text-anchor="middle" font-size="11" fill="' + C.apagado + '">corrente crítica concluída</text>';
  s += '<text transform="translate(11 ' + (H / 2) + ') rotate(-90)" text-anchor="middle" font-size="11" fill="' + C.apagado + '">pulmão consumido</text>';
  if (isFinite(avanco) && isFinite(consumo)) s += '<circle cx="' + sx(avanco) + '" cy="' + sy(consumo) + '" r="7" fill="' + C.navy + '" stroke="#fff" stroke-width="2"/>';
  return s + '</svg>';
}
function ccZona(avanco, consumo) { if (!isFinite(avanco) || !isFinite(consumo)) return null; if (consumo <= 20 + 0.4 * avanco) return 'verde'; if (consumo <= 50 + 0.4 * avanco) return 'amarela'; return 'vermelha'; }

function renderCCPM() {
  const box = $('#ccSaida'); if (!box) return;
  const c = calcOut;
  if ($('#ccCorte') !== document.activeElement) $('#ccCorte').value = state.ccCorte;
  $('#ccMetodo').value = state.ccMetodo === 'rss' ? 'rss' : 'metade';
  $('#ccCampoCorte').style.display = state.modo === 'pert' ? 'none' : '';
  if ($('#ccAvanco') !== document.activeElement) $('#ccAvanco').value = state.ccAvanco;
  if ($('#ccConsumo') !== document.activeElement) $('#ccConsumo').value = state.ccConsumo;
  if (!c || c.vazio || c.ciclo || (c.erros && c.erros.length) || !c.acts.length) { box.innerHTML = '<p class="hint">Corrija os erros da aba Dados para montar a corrente crítica.</p>'; return; }
  const r = ccCalcular(c); if (!r) { box.innerHTML = '<p class="hint">Não foi possível calcular com as durações agressivas.</p>'; return; }
  const metodoTxt = r.metodo === 'rss' ? 'raiz da soma dos quadrados das margens' : 'metade da soma das margens (regra dos 50%)';
  let h = '<div class="kpis">' +
    '<div class="kpi"><div class="olho">Prazo com margens (CPM)</div><div class="v">' + fmt(r.durSeg) + '</div></div>' +
    '<div class="kpi"><div class="olho">Corrente agressiva</div><div class="v">' + fmt(r.durAgr) + '</div></div>' +
    '<div class="kpi"><div class="olho">Pulmão de projeto</div><div class="v navy">' + fmt(r.PB) + '</div></div>' +
    '<div class="kpi"><div class="olho">Prazo protegido</div><div class="v" style="color:var(--folga)">' + fmt(r.protegido) + ' ' + uni(r.protegido) + '</div></div></div>';
  h += '<p class="ler interp"><b class="t">O que o resultado diz:</b> tirando a margem de segurança de cada atividade (' + (state.modo === 'pert' ? 'usando o tempo mais provável no lugar do pessimista' : 'corte de ' + Math.round(r.corte * 100) + '%') + '), a corrente crítica <b>' + r.cadeia.map(esc).join(' → ') + '</b> leva <b>' + fmt(r.durAgr) + '</b>. Em vez de proteger cada atividade, protege-se o projeto inteiro com um único pulmão de <b>' + fmt(r.PB) + '</b> (' + metodoTxt + ') no fim: prazo prometido <b>' + fmt(r.protegido) + ' ' + uni(r.protegido) + '</b>' + (r.protegido < r.durSeg - 1e-9 ? ', <b>' + fmt(r.durSeg - r.protegido) + ' ' + uni(r.durSeg - r.protegido) + ' a menos</b> que somando as margens uma a uma' : '') + '. As atividades passam a ser executadas sem data de início fixa, em revezamento: quem termina avisa o próximo.</p>';
  /* desenho: corrente + pulmão, alimentadoras com pulmão de convergência */
  const fim = Math.max(r.protegido, r.durSeg, 1e-9), L = 56, W = 620, lh = 22, linhas = [['Corrente', null]].concat(r.feeds.map((f, i) => ['Alim. ' + (i + 1), f]));
  const H = 10 + linhas.length * lh + 28, sx = t => L + t / fim * (W - L - 12);
  let s = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ' + W + ' ' + H + '" style="width:100%;max-width:800px;display:block" font-family="IBM Plex Mono, monospace" role="img" aria-label="Corrente crítica com pulmões">';
  const caixa = (x0, x1, y, cor, txt, claro) => '<rect x="' + sx(x0).toFixed(1) + '" y="' + (y + 3) + '" width="' + Math.max(2, sx(x1) - sx(x0) - 1).toFixed(1) + '" height="16" rx="2" fill="' + cor + '"/>' + (sx(x1) - sx(x0) > 18 ? '<text x="' + ((sx(x0) + sx(x1)) / 2).toFixed(1) + '" y="' + (y + 15) + '" text-anchor="middle" font-size="11" fill="' + (claro ? '#16243B' : '#fff') + '">' + esc(txt) + '</text>' : '');
  linhas.forEach((ln, i) => {
    const y = 6 + i * lh; s += '<text x="' + (L - 6) + '" y="' + (y + 15) + '" text-anchor="end" font-size="11" fill="' + C.apagado + '">' + esc(ln[0]) + '</text>';
    if (!ln[1]) { r.cadeia.forEach(id => { const n = r.A.N.get(id); s += caixa(n.ES, n.EF, y, C.critico, id); }); s += caixa(r.durAgr, r.protegido, y, '#F0A89C', 'PP ' + fmt(r.PB), true); }
    else { const f = ln[1]; f.seq.forEach(id => { const n = r.A.N.get(id); s += caixa(n.ES, n.EF, y, C.navy, id); }); const ult = r.A.N.get(f.seq[f.seq.length - 1]); s += caixa(ult.EF, ult.EF + f.FB, y, '#9FC3CF', 'PC ' + fmt(f.FB), true); }
  });
  const yb = 6 + linhas.length * lh; s += '<line x1="' + L + '" y1="' + yb + '" x2="' + (W - 12) + '" y2="' + yb + '" stroke="' + C.borda + '"/>';
  [0, fim / 2, fim].forEach((t, i) => { s += '<text x="' + sx(t).toFixed(1) + '" y="' + (yb + 15) + '" text-anchor="' + (i === 0 ? 'start' : i === 2 ? 'end' : 'middle') + '" font-size="11" fill="' + C.apagadinho + '">' + fmt(t) + '</text>'; });
  s += '</svg>';
  h += '<h3 style="font-size:19px;margin:16px 0 6px">Corrente e pulmões</h3>' + s + '<div class="legenda"><span><i style="background:var(--critico)"></i>Corrente crítica (agressiva)</span><span><i style="background:#F0A89C"></i>Pulmão de projeto (PP)</span><span><i style="background:var(--navy)"></i>Cadeia alimentadora</span><span><i style="background:#9FC3CF"></i>Pulmão de convergência (PC)</span></div>';
  h += '<div class="rolar" style="margin-top:12px"><table class="tab"><thead><tr><th>Atividade</th><th class="dir">Segura</th><th class="dir">Agressiva</th><th class="dir">Margem retirada</th><th>Papel</th></tr></thead><tbody>';
  r.A.ordem.forEach(id => { const na = r.cadeia.indexOf(id) >= 0; h += '<tr class="' + (na ? 'crit' : '') + '"><td class="cod"><b>' + esc(id) + '</b></td><td class="dir">' + fmt(r.seg.get(id)) + '</td><td class="dir"><b>' + fmt(r.agr.get(id)) + '</b></td><td class="dir">' + fmt(r.margem(id)) + '</td><td class="txt">' + (na ? 'corrente crítica' : 'alimentadora') + '</td></tr>'; });
  h += '</tbody></table></div>';
  if (r.feeds.length) {
    h += '<h3 style="font-size:19px;margin:16px 0 6px">Pulmões de convergência</h3><div class="rolar"><table class="tab"><thead><tr><th>Cadeia alimentadora</th><th>Entra antes de</th><th class="dir">Pulmão</th><th class="dir">Folga disponível</th><th>Situação</th></tr></thead><tbody>';
    r.feeds.forEach(f => { h += '<tr><td class="cod">' + f.seq.map(esc).join(' → ') + '</td><td class="cod"><b>' + esc(f.antesDe) + '</b></td><td class="dir"><b>' + fmt(f.FB) + '</b></td><td class="dir">' + fmt(f.folga) + '</td><td class="txt">' + (f.cabe ? 'cabe na folga' : '<span style="color:var(--critico)">maior que a folga: adianta a cadeia em ' + fmt(f.FB - f.folga) + '</span>') + '</td></tr>'; });
    h += '</tbody></table></div>';
  }
  /* gráfico de febre */
  const av = String(state.ccAvanco == null ? '' : state.ccAvanco).trim() === '' ? NaN : Math.min(100, Math.max(0, num(state.ccAvanco)));
  const co = String(state.ccConsumo == null ? '' : state.ccConsumo).trim() === '' ? NaN : Math.min(100, Math.max(0, num(state.ccConsumo)));
  const zona = ccZona(av, co);
  h += '<h3 style="font-size:19px;margin:18px 0 6px">Gráfico de febre</h3><p class="hint" style="margin:0 0 8px">Durante a execução, informe acima quanto da corrente já foi concluído e quanto do pulmão de projeto já foi consumido. Verde: siga; amarela: planeje a recuperação; vermelha: aja agora.</p>';
  h += '<div class="duas" style="align-items:center">' + '<div>' + ccFebre(av, co) + '</div><div>' + (zona ? '<p class="ler interp" style="margin:0"><b class="t">Zona ' + zona + ':</b> ' + (zona === 'verde' ? 'o consumo do pulmão (' + fmt(co) + '%) está compatível com o avanço (' + fmt(av) + '%). Nenhuma ação necessária.' : zona === 'amarela' ? 'o pulmão está sendo consumido mais rápido que o avanço. Prepare um plano de recuperação (horas extras, reforço, troca de sequência) para usar se entrar no vermelho.' : 'o pulmão vai acabar antes do fim da corrente. Execute o plano de recuperação agora; sem ação, o prazo prometido não se sustenta.') + (isFinite(co) ? ' Pulmão restante: <b>' + fmt(r.PB * (1 - co / 100)) + ' ' + uni(r.PB * (1 - co / 100)) + '</b>.' : '') + '</p>' : '<p class="hint" style="margin:0">Sem dados de execução ainda.</p>') + '</div></div>';
  h += '<p class="hint" style="margin-top:12px">Limite desta calculadora: a corrente crítica aqui é o caminho crítico com durações agressivas, sem resolver disputa de recursos. Com recursos limitados, use antes a aba Recursos e leia a corrente no cronograma nivelado.</p>';
  box.innerHTML = h;
}
function ligarCCPM() {
  if (!$('#ccCorte')) return;
  $('#ccCorte').oninput = e => { state.ccCorte = e.target.value; renderCCPM(); gravarEstado(); };
  $('#ccMetodo').onchange = e => { state.ccMetodo = e.target.value; renderCCPM(); gravarEstado(); };
  $('#ccAvanco').oninput = e => { state.ccAvanco = e.target.value; renderCCPM(); gravarEstado(); };
  $('#ccConsumo').oninput = e => { state.ccConsumo = e.target.value; renderCCPM(); gravarEstado(); };
}
