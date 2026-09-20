/* Contador de visitas da Calculadora PERT/CPM.
   Grava apenas números agregados: total, por dia, por página e visitantes únicos do dia.
   Não guarda IP, nem identificador que atravesse dias, nem qualquer dado pessoal. */

const URL_KV = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOK_KV = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const SEGREDO = process.env.SALT_VISITAS || TOK_KV || 'pertcpm';

async function redis(comandos) {
  const r = await fetch(URL_KV + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK_KV, 'Content-Type': 'application/json' },
    body: JSON.stringify(comandos),
  });
  if (!r.ok) throw new Error('kv ' + r.status);
  return r.json();
}

function diaSaoPaulo(d = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(d);
}

function limpaCaminho(p) {
  if (!p || typeof p !== 'string') return '/';
  p = p.split('?')[0].split('#')[0].slice(0, 80);
  if (!/^\/[A-Za-z0-9\/_.-]*$/.test(p)) return '/outro';
  return p;
}

async function impressaoDigital(req, dia) {
  /* Hash efêmero: muda de dia e não permite reconstruir o IP.
     Serve só para não contar a mesma pessoa duas vezes no mesmo dia. */
  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const ua = req.headers['user-agent'] || '';
  const dados = new TextEncoder().encode(dia + '|' + SEGREDO + '|' + ip + '|' + ua);
  const buf = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(buf)).slice(0, 12).map(b => b.toString(16).padStart(2, '0')).join('');
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_KV || !TOK_KV) { res.status(204).end(); return; }

  try {
    const dia = diaSaoPaulo();
    const caminho = limpaCaminho((req.query && req.query.p) || '/');
    const marca = await impressaoDigital(req, dia);

    const r = await redis([
      ['INCR', 'pertcpm:total'],
      ['INCR', 'pertcpm:dia:' + dia],
      ['INCR', 'pertcpm:pag:' + caminho],
      ['INCR', 'pertcpm:pagdia:' + caminho + ':' + dia],
      ['PFADD', 'pertcpm:unicos:' + dia, marca],
      ['SADD', 'pertcpm:dias', dia],
      ['SADD', 'pertcpm:paginas', caminho],
      ['EXPIRE', 'pertcpm:unicos:' + dia, 60 * 60 * 24 * 400],
    ]);
    const total = (r && r[0] && r[0].result) || 0;
    res.status(200).json({ ok: true, total });
  } catch (e) {
    res.status(204).end();
  }
};
