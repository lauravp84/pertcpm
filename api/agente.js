/* Agente da calculadora PERT/CPM.
   Recebe a descrição do projeto em texto livre e devolve a lista de atividades
   com duração e precedências, pronta para preencher a tabela.

   Precisa de uma chave da API da Anthropic na variável de ambiente
   ANTHROPIC_API_KEY (ou OPENAI_API_KEY, se preferir a OpenAI).
   Sem chave, responde {ok:false, motivo:'sem_chave'} e a página cai no
   modo sem IA, que entende listas coladas. */

const CHAVE_ANTHROPIC = process.env.ANTHROPIC_API_KEY || '';
const CHAVE_OPENAI = process.env.OPENAI_API_KEY || '';
const MODELO_ANTHROPIC = process.env.MODELO_AGENTE || 'claude-sonnet-5';
const MODELO_OPENAI = process.env.MODELO_AGENTE_OPENAI || 'gpt-4o-mini';
const LIMITE_TEXTO = 4000;

/* Limites de uso. O endpoint é público e cada chamada gasta a chave de quem hospeda,
   então sem teto qualquer pessoa poderia esgotar o crédito. Três camadas, ajustáveis
   por variável de ambiente:
   - por navegador (identificador anônimo): protege contra um uso desproporcional;
   - por rede (IP): bem mais alto, para caber uma turma inteira atrás do mesmo roteador;
   - geral do dia: o teto de gasto, valha o que valer. */
const URL_KV = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOK_KV = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const LIM_NAVEGADOR_HORA = Number(process.env.AGENTE_LIMITE_NAVEGADOR_HORA) || 10;
const LIM_REDE_HORA = Number(process.env.AGENTE_LIMITE_REDE_HORA) || 150;
const LIM_GERAL_DIA = Number(process.env.AGENTE_LIMITE_DIA) || 250;

async function redis(comandos) {
  const r = await fetch(URL_KV + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK_KV, 'Content-Type': 'application/json' },
    body: JSON.stringify(comandos),
  });
  if (!r.ok) throw new Error('kv ' + r.status);
  return r.json();
}

async function hashCurto(texto) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(texto));
  return Array.from(new Uint8Array(buf)).slice(0, 10).map(b => b.toString(16).padStart(2, '0')).join('');
}

/* Devolve null se pode usar, ou o motivo da recusa. Falha fechada: sem banco (ou com o
   banco fora do ar) não há como contar, então a IA não é chamada — a página cai no modo
   por lista. Melhor isso do que deixar o gasto sem controle. */
async function verificaLimite(req) {
  if (!URL_KV || !TOK_KV) return 'indisponivel';
  try {
    const agora = new Date();
    const hora = agora.toISOString().slice(0, 13), dia = agora.toISOString().slice(0, 10);
    const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    let cli = String(req.headers['x-cliente'] || '');
    if (!/^[a-f0-9]{8,40}$/.test(cli)) cli = 'sem-id:' + ip;           // sem identificador, divide com a rede
    const kNav = 'pertcpm:ag:nav:' + hora + ':' + await hashCurto(cli);
    const kRede = 'pertcpm:ag:rede:' + hora + ':' + await hashCurto(ip);
    const kDia = 'pertcpm:ag:dia:' + dia;
    const r = await redis([
      ['INCR', kNav], ['EXPIRE', kNav, 7200],
      ['INCR', kRede], ['EXPIRE', kRede, 7200],
    ]);
    const nav = Number(r[0].result), rede = Number(r[2].result);
    if (nav > LIM_NAVEGADOR_HORA || rede > LIM_REDE_HORA) return 'limite';
    /* O total do dia só conta quem passou pelas duas camadas acima. Se contasse também os
       pedidos recusados, bastaria alguém insistir de um navegador só para esgotar o teto e
       travar a assistente para todo mundo. */
    const g = await redis([['INCR', kDia], ['EXPIRE', kDia, 172800]]);
    if (Number(g[0].result) > LIM_GERAL_DIA) return 'limite_geral';
    return null;
  } catch (e) { return 'indisponivel'; }
}

const INSTRUCOES = `Você ajuda estudantes e profissionais a montar a rede de um projeto para análise PERT/CPM.

A partir da descrição do projeto, devolva as atividades necessárias com duração e precedências.

Regras:
- Entre 5 e 20 atividades, na ordem lógica de execução.
- Código: letras maiúsculas sequenciais (A, B, C...), no máximo 3 caracteres.
- Nome: curto e concreto, no máximo 40 caracteres, em português.
- "preds": lista de códigos que precisam terminar antes. A primeira atividade tem lista vazia.
- Crie paralelismo onde fizer sentido: atividades independentes não devem depender umas das outras.
- Não crie ciclos: uma atividade só depende de atividades anteriores na lista.
- Se o usuário informar prazos, respeite-os; caso contrário, estime durações plausíveis na unidade pedida.
- No modo "pert", devolva três estimativas por atividade: o (otimista) <= m (mais provável) <= p (pessimista).
- No modo "cpm", devolva apenas "d" (duração única).

Responda SOMENTE com JSON válido, sem texto em volta, no formato:
{"unidade":"d|s|m","atividades":[{"id":"A","nome":"...","d":5,"preds":[]}],"observacoes":"uma ou duas frases sobre as premissas que você adotou"}
No modo pert troque "d":5 por "o":3,"m":5,"p":9.`;

function extraiJSON(texto) {
  if (!texto) return null;
  let t = String(texto).trim();
  const cerca = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (cerca) t = cerca[1].trim();
  const i = t.indexOf('{'), f = t.lastIndexOf('}');
  if (i < 0 || f <= i) return null;
  try { return JSON.parse(t.slice(i, f + 1)); } catch (e) { return null; }
}

/* Aceita só o que a calculadora sabe usar e conserta o que dá para consertar. */
function saneia(dados, modo) {
  if (!dados || !Array.isArray(dados.atividades)) return null;
  const vistos = new Set();
  const limpas = [];
  dados.atividades.slice(0, 30).forEach((a, i) => {
    let id = String(a.id || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3);
    if (!id || vistos.has(id)) id = String.fromCharCode(65 + (i % 26)) + (i >= 26 ? String(i) : '');
    if (vistos.has(id)) return;
    vistos.add(id);
    const num = (v, padrao) => {
      const n = parseFloat(v);
      return isFinite(n) && n >= 0 && n < 10000 ? n : padrao;
    };
    const item = {
      id,
      nome: String(a.nome || '').slice(0, 60),
      preds: (Array.isArray(a.preds) ? a.preds : [])
        .map(p => String(p).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 3))
        .filter(p => p && p !== id && vistos.has(p)),
    };
    if (modo === 'pert') {
      item.o = num(a.o, 1); item.m = num(a.m, item.o); item.p = num(a.p, item.m);
      if (item.m < item.o) item.m = item.o;
      if (item.p < item.m) item.p = item.m;
    } else {
      item.d = num(a.d != null ? a.d : a.m, 1);
    }
    limpas.push(item);
  });
  if (!limpas.length) return null;
  const uni = ['d', 's', 'm'].indexOf(String(dados.unidade || '').trim()) >= 0 ? String(dados.unidade).trim() : 'd';
  return { unidade: uni, atividades: limpas, observacoes: String(dados.observacoes || '').slice(0, 400) };
}

async function chamaAnthropic(texto, modo) {
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': CHAVE_ANTHROPIC,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: MODELO_ANTHROPIC,
      max_tokens: 2000,
      system: INSTRUCOES,
      messages: [{ role: 'user', content: 'Modo: ' + modo + '\n\nProjeto:\n' + texto }],
    }),
  });
  if (!r.ok) throw new Error('anthropic ' + r.status);
  const j = await r.json();
  return (j.content || []).map(b => b.text || '').join('');
}

async function chamaOpenAI(texto, modo) {
  const r = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', Authorization: 'Bearer ' + CHAVE_OPENAI },
    body: JSON.stringify({
      model: MODELO_OPENAI,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: INSTRUCOES },
        { role: 'user', content: 'Modo: ' + modo + '\n\nProjeto:\n' + texto },
      ],
    }),
  });
  if (!r.ok) throw new Error('openai ' + r.status);
  const j = await r.json();
  return ((j.choices || [])[0] || {}).message ? j.choices[0].message.content : '';
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') { res.status(405).json({ ok: false, motivo: 'metodo' }); return; }
  if (!CHAVE_ANTHROPIC && !CHAVE_OPENAI) { res.status(200).json({ ok: false, motivo: 'sem_chave' }); return; }

  let corpo = req.body;
  if (typeof corpo === 'string') { try { corpo = JSON.parse(corpo); } catch (e) { corpo = {}; } }
  const texto = String((corpo && corpo.texto) || '').trim().slice(0, LIMITE_TEXTO);
  const modo = (corpo && corpo.modo) === 'pert' ? 'pert' : 'cpm';
  if (texto.length < 10) { res.status(200).json({ ok: false, motivo: 'texto_curto' }); return; }

  const recusa = await verificaLimite(req);
  if (recusa) { res.status(200).json({ ok: false, motivo: recusa }); return; }

  try {
    const bruto = CHAVE_ANTHROPIC ? await chamaAnthropic(texto, modo) : await chamaOpenAI(texto, modo);
    const dados = saneia(extraiJSON(bruto), modo);
    if (!dados) { res.status(200).json({ ok: false, motivo: 'resposta_invalida' }); return; }
    res.status(200).json({ ok: true, modo, ...dados });
  } catch (e) {
    res.status(200).json({ ok: false, motivo: 'falha_api', detalhe: String(e.message || e).slice(0, 120) });
  }
};
