/* Idiomas: português (original), inglês e espanhol.
   A interface é escrita em português; em EN/ES, cada texto que aparece na tela (inclusive os gerados
   na hora: explicações, dicas, diálogos) passa por um dicionário de trechos (i18n_dados.js).
   Carregado antes dos demais scripts. */
'use strict';
const LANGS = { pt: 'Português', en: 'English', es: 'Español' };
const LANG = (() => {
  try {
    const q = new URLSearchParams(location.search).get('lang');
    if (q && LANGS[q]) { if (!new URLSearchParams(location.search).has('teste')) localStorage.setItem('pertcpm.lang', q); return q; }
    const s = localStorage.getItem('pertcpm.lang'); if (s && LANGS[s]) return s;
  } catch (e) { }
  const n = String(navigator.language || 'pt').slice(0, 2).toLowerCase();
  return LANGS[n] ? n : 'pt';
})();
const LOCALE = { pt: 'pt-BR', en: 'en-US', es: 'es-ES' }[LANG];
const DEC = LANG === 'en' ? '.' : ',';
/* tipos de relação: códigos internos em português (TI, II, TT, IT); fora do PT, mostra os do PMBOK */
const relVis = t => (LANG === 'pt' ? t : ({ TI: 'FS', II: 'SS', TT: 'FF', IT: 'SF' }[t] || t));

let I18N_RE = null, I18N_MAP = null;
function i18nPrepara() {
  if (I18N_RE || LANG === 'pt' || typeof I18N_DIC === 'undefined' || !I18N_DIC[LANG]) return;
  I18N_MAP = new Map();
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+');
  const alts = [];
  I18N_DIC[LANG].forEach(([pt, tr]) => {
    if (I18N_MAP.has(pt)) return;
    I18N_MAP.set(pt, tr);
    const ini = /^[\p{L}\p{N}]/u.test(pt) ? '(?<![\\p{L}\\p{N}])' : '';
    const fim = /[\p{L}\p{N}]$/u.test(pt) ? '(?![\\p{L}\\p{N}])' : '';
    alts.push(ini + esc(pt) + fim);
  });
  I18N_RE = new RegExp(alts.join('|'), 'gu');
}
function traduz(s) {
  if (!I18N_RE || !s || !/[A-Za-zÀ-ÿ]/.test(s)) return s;
  return s.replace(I18N_RE, m => { const k = m.replace(/\s+/g, ' '); return I18N_MAP.has(k) ? I18N_MAP.get(k) : m; });
}
/* nomes de exemplos prontos: traduzidos já na carga, porque os desenhos os mostram cortados ("Instalação hidrául…") */
const traduzNome = s => (LANG === 'pt' || typeof traduz !== 'function') ? s : (i18nPrepara(), traduz(s));
const I18N_ATTRS = ['title', 'placeholder', 'aria-label', 'data-tip', 'alt'];
const I18N_PULA = 'script,style,#tip,[data-notr]';
const i18nVisto = new WeakMap();
function i18nNo(n) {
  if (n.nodeType === 3) {
    const p = n.parentNode; if (!p || (p.closest && p.closest(I18N_PULA + ',textarea'))) return;
    const v = n.nodeValue; if (i18nVisto.get(n) === v) return;
    const t = traduz(v); if (t !== v) n.nodeValue = t;
    i18nVisto.set(n, n.nodeValue);
  } else if (n.nodeType === 1) {
    if (n.matches && n.matches(I18N_PULA)) return;
    I18N_ATTRS.forEach(a => i18nAttr(n, a));
    for (let c = n.firstChild; c; c = c.nextSibling) i18nNo(c);
  }
}
/* o que este script já escreveu não é traduzido de novo: palavras iguais nas duas línguas
   (ex.: "terminar") seriam trocadas outra vez */
const i18nAttrVisto = new WeakMap();
function i18nAttr(n, a) {
  if (!n.hasAttribute || !n.hasAttribute(a)) return;
  const v = n.getAttribute(a);
  const visto = i18nAttrVisto.get(n); if (visto && visto[a] === v) return;
  const t = a === 'data-tip' ? v.split('\n').map(traduz).join('\n') : traduz(v);
  if (t !== v) n.setAttribute(a, t);
  const reg = visto || {}; reg[a] = t; i18nAttrVisto.set(n, reg);
}
function i18nIniciar() {
  document.documentElement.lang = LOCALE;
  const sel = document.getElementById('selLang');
  if (sel) {
    sel.value = LANG;
    sel.onchange = () => {
      const v = sel.value; if (!LANGS[v] || v === LANG) return;
      try { localStorage.setItem('pertcpm.lang', v); } catch (e) { }
      try { if (typeof state !== 'undefined' && state) { state.notacao = v === 'pt' ? 'disc' : 'intl'; if (typeof gravarEstado === 'function') gravarEstado(); } } catch (e) { }
      const u = new URL(location.href); u.searchParams.delete('lang'); location.replace(u.pathname + u.search + u.hash);
    };
  }
  if (LANG === 'pt') return;
  i18nPrepara();
  document.title = traduz(document.title);
  /* o subtítulo do logotipo faz parte da imagem: fora do PT, usa o logo sem subtítulo e escreve o subtítulo traduzido */
  const lg = document.querySelector('.tit-logo img');
  if (lg) {
    lg.src = 'img/logo-titulo.webp'; lg.width = 970; lg.height = 180; lg.alt = 'GEO PERT/CPM';
    const sub = document.createElement('div'); sub.className = 'logo-sub';
    sub.textContent = traduz('Gestão Estratégica de Operações');
    sub.style.cssText = 'font:500 clamp(15px,2.4vw,24px)/1.2 var(--texto);letter-spacing:.06em;color:var(--navy);margin-top:6px';
    lg.insertAdjacentElement('afterend', sub);
  }
  i18nNo(document.body);
  new MutationObserver(ms => {
    for (const m of ms) {
      if (m.type === 'characterData') i18nNo(m.target);
      else if (m.type === 'attributes') i18nAttr(m.target, m.attributeName);
      else m.addedNodes.forEach(i18nNo);
    }
  }).observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: I18N_ATTRS });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', i18nIniciar); else i18nIniciar();
