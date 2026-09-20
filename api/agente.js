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

  try {
    const bruto = CHAVE_ANTHROPIC ? await chamaAnthropic(texto, modo) : await chamaOpenAI(texto, modo);
    const dados = saneia(extraiJSON(bruto), modo);
    if (!dados) { res.status(200).json({ ok: false, motivo: 'resposta_invalida' }); return; }
    res.status(200).json({ ok: true, modo, ...dados });
  } catch (e) {
    res.status(200).json({ ok: false, motivo: 'falha_api', detalhe: String(e.message || e).slice(0, 120) });
  }
};
