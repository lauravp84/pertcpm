/* Leitura dos números do contador. Devolve totais, série diária e páginas.
   Se STATS_KEY estiver definida, exige ?k=<chave> para o detalhamento. */

const URL_KV = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || '';
const TOK_KV = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || '';
const CHAVE = process.env.STATS_KEY || '';

async function redis(comandos) {
  const r = await fetch(URL_KV + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOK_KV, 'Content-Type': 'application/json' },
    body: JSON.stringify(comandos),
  });
  if (!r.ok) throw new Error('kv ' + r.status);
  return (await r.json()).map(x => x.result);
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_KV || !TOK_KV) { res.status(200).json({ configurado: false }); return; }

  const q = req.query || {};
  const detalhe = !CHAVE || q.k === CHAVE;

  try {
    const [total, dias, paginas] = await redis([
      ['GET', 'pertcpm:total'],
      ['SMEMBERS', 'pertcpm:dias'],
      ['SMEMBERS', 'pertcpm:paginas'],
    ]);

    if (!detalhe) { res.status(200).json({ configurado: true, total: Number(total || 0) }); return; }

    const listaDias = (dias || []).sort();
    const listaPags = (paginas || []).sort();

    const cmds = [];
    listaDias.forEach(d => cmds.push(['GET', 'pertcpm:dia:' + d]));
    listaDias.forEach(d => cmds.push(['PFCOUNT', 'pertcpm:unicos:' + d]));
    listaPags.forEach(p => cmds.push(['GET', 'pertcpm:pag:' + p]));
    const vals = cmds.length ? await redis(cmds) : [];

    const n = listaDias.length;
    const serie = listaDias.map((d, i) => ({
      dia: d,
      visitas: Number(vals[i] || 0),
      pessoas: Number(vals[n + i] || 0),
    }));
    const porPagina = listaPags
      .map((p, i) => ({ pagina: p, visitas: Number(vals[2 * n + i] || 0) }))
      .sort((a, b) => b.visitas - a.visitas);

    res.status(200).json({
      configurado: true,
      total: Number(total || 0),
      pessoas: serie.reduce((s, x) => s + x.pessoas, 0),
      serie,
      porPagina,
    });
  } catch (e) {
    res.status(500).json({ configurado: true, erro: 'falha ao ler os dados' });
  }
};
