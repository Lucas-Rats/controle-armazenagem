// Sistema de Controle de Armazenagem — Worker (API)
//
// As rotas estáticas (index.html, style.css, script.js) são servidas
// automaticamente pelo binding "assets" do wrangler.jsonc. Este arquivo
// só roda para requisições que não batem com nenhum arquivo estático —
// ou seja, tudo que começa com /api/.
//
// Princípio central: QUANTIDADE NUNCA É ARMAZENADA. Ela é sempre contada
// a partir das peças reais na tabela `itens`. Um campo "quantidade" salvo
// no produto seria uma segunda versão da verdade, e uma hora as duas
// discordam — normalmente no meio de um inventário.

const COOKIE_SESSAO = 'sessao';
const SESSAO_HORAS = 12;
const HISTORICO_LIMITE = 500;
const LOGIN_MAX_TENTATIVAS = 5;
const LOGIN_JANELA_MIN = 15;
const LOTE_MAX = 500;   // seriais por operação
const CHUNK = 40;       // parâmetros por consulta SQL

function json(dados, status = 200, headersExtra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headersExtra },
  });
}

function erro(mensagem, status = 400) {
  return json({ erro: mensagem }, status);
}

function pedacos(lista, tamanho) {
  const saida = [];
  for (let i = 0; i < lista.length; i += tamanho) saida.push(lista.slice(i, i + tamanho));
  return saida;
}

// Aceita seriais colados em qualquer formato: um por linha, separados por
// vírgula, ponto e vírgula ou tabulação (o que sai de um leitor de código
// de barras ou de uma coluna copiada do Excel).
function normalizarSeriais(entrada) {
  const bruto = Array.isArray(entrada) ? entrada.join('\n') : String(entrada || '');
  const lista = bruto
    .split(/[\n\r,;\t]+/)
    .map((s) => s.trim())
    .filter(Boolean);
  const vistos = new Set();
  const unicos = [];
  const repetidosNoLote = [];
  for (const s of lista) {
    const chave = s.toUpperCase();
    if (vistos.has(chave)) {
      repetidosNoLote.push(s);
      continue;
    }
    vistos.add(chave);
    unicos.push(s);
  }
  return { seriais: unicos, repetidosNoLote };
}

function paraBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function deBase64Url(texto) {
  return atob(texto.replace(/-/g, '+').replace(/_/g, '/'));
}

async function assinar(payload, segredo) {
  const chave = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(payload));
  return paraBase64Url(assinatura);
}

async function criarSessao(segredo) {
  const exp = Date.now() + SESSAO_HORAS * 60 * 60 * 1000;
  const payload = paraBase64Url(new TextEncoder().encode(JSON.stringify({ exp })));
  return `${payload}.${await assinar(payload, segredo)}`;
}

async function sessaoValida(token, segredo) {
  if (!token) return false;
  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return false;
  if (assinatura !== (await assinar(payload, segredo))) return false;
  try {
    const { exp } = JSON.parse(deBase64Url(payload));
    return typeof exp === 'number' && exp > Date.now();
  } catch {
    return false;
  }
}

function pegarCookie(request, nome) {
  const cabecalho = request.headers.get('cookie') || '';
  const match = cabecalho.match(new RegExp(`(?:^|; )${nome}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function cookieSessao(token) {
  return `${COOKIE_SESSAO}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${SESSAO_HORAS * 3600}`;
}

function cookieLimpo() {
  return `${COOKIE_SESSAO}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function ehAdmin(request, env) {
  return sessaoValida(pegarCookie(request, COOKIE_SESSAO), env.SESSION_SECRET);
}

async function registrarHistorico(env, e) {
  await env.DB.prepare(
    `INSERT INTO historico
       (tipo, produto_codigo, produto_nome, serial, quantidade, referencia, local_origem, local_destino)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    e.tipo, e.produto_codigo || null, e.produto_nome || null, e.serial || null,
    e.quantidade || 1, e.referencia || null, e.local_origem || null, e.local_destino || null
  ).run();

  const { total } = await env.DB.prepare(`SELECT COUNT(*) as total FROM historico`).first();
  if (total > HISTORICO_LIMITE) {
    await env.DB.prepare(
      `DELETE FROM historico WHERE id IN (SELECT id FROM historico ORDER BY criado_em ASC LIMIT ?)`
    ).bind(total - HISTORICO_LIMITE).run();
  }
}

// Busca os itens correspondentes a uma lista de seriais, em pedaços para
// não estourar o limite de parâmetros de uma única consulta.
async function buscarPorSeriais(env, seriais, status = 'disponivel') {
  const achados = [];
  for (const grupo of pedacos(seriais, CHUNK)) {
    const marcadores = grupo.map(() => '?').join(',');
    const { results } = await env.DB.prepare(
      `SELECT itens.*, produtos.nome as produto_nome, locais.nome as local_nome
       FROM itens
       JOIN produtos ON produtos.codigo = itens.produto_codigo
       LEFT JOIN locais ON locais.id = itens.local_id
       WHERE itens.status = ? AND itens.serial IN (${marcadores})`
    ).bind(status, ...grupo).all();
    achados.push(...results);
  }
  return achados;
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (!pathname.startsWith('/api/')) return erro('não encontrado', 404);

    try {
      // ==================== Autenticação ====================

      if (pathname === '/api/login' && method === 'POST') {
        const ip = request.headers.get('cf-connecting-ip') || 'desconhecido';
        const desde = new Date(Date.now() - LOGIN_JANELA_MIN * 60000)
          .toISOString().replace('T', ' ').slice(0, 19);
        const { total } = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM login_tentativas WHERE ip = ? AND criado_em > ?`
        ).bind(ip, desde).first();

        if (total >= LOGIN_MAX_TENTATIVAS) {
          return erro(`muitas tentativas — aguarde ${LOGIN_JANELA_MIN} minutos`, 429);
        }
        const corpo = await request.json().catch(() => ({}));
        if (!env.ADMIN_PASSWORD || corpo.senha !== env.ADMIN_PASSWORD) {
          await env.DB.prepare(`INSERT INTO login_tentativas (ip) VALUES (?)`).bind(ip).run();
          return erro('senha incorreta', 401);
        }
        return json({ ok: true }, 200, { 'set-cookie': cookieSessao(await criarSessao(env.SESSION_SECRET)) });
      }

      if (pathname === '/api/logout' && method === 'POST') {
        return json({ ok: true }, 200, { 'set-cookie': cookieLimpo() });
      }

      if (pathname === '/api/me' && method === 'GET') {
        return json({ admin: await ehAdmin(request, env) });
      }

      // ==================== Leitura (admin e cliente) ====================

      if (pathname === '/api/produtos' && method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT * FROM produtos ORDER BY nome`).all();
        return json(results);
      }

      if (pathname === '/api/locais' && method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT * FROM locais ORDER BY nome`).all();
        return json(results);
      }

      // Visão agregada: quantidade por produto e por local.
      // Tudo contado na hora, a partir das peças reais.
      if (pathname === '/api/estoque' && method === 'GET') {
        const [porProduto, porLocal, totais] = await Promise.all([
          env.DB.prepare(
            `SELECT p.codigo, p.nome, COUNT(i.id) as quantidade
             FROM produtos p
             LEFT JOIN itens i ON i.produto_codigo = p.codigo AND i.status = 'disponivel'
             GROUP BY p.codigo, p.nome
             ORDER BY p.nome`
          ).all(),
          env.DB.prepare(
            `SELECT i.produto_codigo, COALESCE(l.nome, 'Sem local') as local_nome, COUNT(*) as quantidade
             FROM itens i
             LEFT JOIN locais l ON l.id = i.local_id
             WHERE i.status = 'disponivel'
             GROUP BY i.produto_codigo, l.nome
             ORDER BY l.nome`
          ).all(),
          env.DB.prepare(
            `SELECT
               (SELECT COUNT(*) FROM itens WHERE status = 'disponivel') as itens,
               (SELECT COUNT(*) FROM produtos) as produtos,
               (SELECT COUNT(*) FROM locais) as locais,
               (SELECT COUNT(*) FROM itens WHERE status = 'baixado') as baixados`
          ).first(),
        ]);

        const mapaLocais = {};
        for (const linha of porLocal.results) {
          (mapaLocais[linha.produto_codigo] ||= []).push({
            local: linha.local_nome,
            quantidade: linha.quantidade,
          });
        }

        return json({
          totais,
          produtos: porProduto.results.map((p) => ({ ...p, locais: mapaLocais[p.codigo] || [] })),
        });
      }

      if (pathname === '/api/itens' && method === 'GET') {
        const admin = await ehAdmin(request, env);
        const pedido = url.searchParams.get('status');
        // Cliente só enxerga disponíveis, independente do que peça na URL
        const status = admin && pedido ? pedido : 'disponivel';

        let sql = `
          SELECT itens.*, produtos.nome as produto_nome, locais.nome as local_nome
          FROM itens
          JOIN produtos ON produtos.codigo = itens.produto_codigo
          LEFT JOIN locais ON locais.id = itens.local_id
          WHERE itens.status = ?`;
        const params = [status];

        const localId = url.searchParams.get('local_id');
        const produtoCodigo = url.searchParams.get('produto_codigo');
        const busca = url.searchParams.get('q');

        if (localId) { sql += ` AND itens.local_id = ?`; params.push(localId); }
        if (produtoCodigo) { sql += ` AND itens.produto_codigo = ?`; params.push(produtoCodigo); }
        if (busca) {
          sql += ` AND (itens.serial LIKE ? OR produtos.codigo LIKE ? OR produtos.nome LIKE ?
                        OR itens.entrada_ref LIKE ? OR itens.saida_ref LIKE ?)`;
          const like = `%${busca}%`;
          params.push(like, like, like, like, like);
        }
        sql += ` ORDER BY itens.criado_em DESC LIMIT 1000`;

        const { results } = await env.DB.prepare(sql).bind(...params).all();
        return json(results);
      }

      if (pathname === '/api/historico' && method === 'GET') {
        const { results } = await env.DB.prepare(
          `SELECT * FROM historico ORDER BY criado_em DESC LIMIT 500`
        ).all();
        return json(results);
      }

      if (pathname === '/api/export' && method === 'GET') {
        const [produtos, locais, itens, historico] = await Promise.all([
          env.DB.prepare(`SELECT * FROM produtos`).all(),
          env.DB.prepare(`SELECT * FROM locais`).all(),
          env.DB.prepare(
            `SELECT itens.*, locais.nome as local_nome FROM itens LEFT JOIN locais ON locais.id = itens.local_id`
          ).all(),
          env.DB.prepare(`SELECT * FROM historico ORDER BY criado_em DESC LIMIT 500`).all(),
        ]);
        return json({
          exportado_em: new Date().toISOString(),
          produtos: produtos.results, locais: locais.results,
          itens: itens.results, historico: historico.results,
        });
      }

      // ==================== Daqui pra baixo, só admin ====================

      if (!(await ehAdmin(request, env))) {
        return erro('não autorizado — faça login como administrador', 401);
      }

      // ---------- Cadastros ----------

      if (pathname === '/api/produtos' && method === 'POST') {
        const { codigo, nome } = await request.json();
        if (!codigo || !nome) return erro('código e nome são obrigatórios');
        try {
          await env.DB.prepare(`INSERT INTO produtos (codigo, nome) VALUES (?, ?)`)
            .bind(codigo.trim().toUpperCase(), nome.trim()).run();
        } catch {
          return erro('já existe um produto com esse código', 409);
        }
        return json({ ok: true }, 201);
      }

      if (pathname.match(/^\/api\/produtos\/[^/]+$/) && method === 'DELETE') {
        const codigo = decodeURIComponent(pathname.split('/').pop());
        const { total } = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM itens WHERE produto_codigo = ? AND status = 'disponivel'`
        ).bind(codigo).first();
        if (total > 0) return erro(`produto tem ${total} item(ns) disponível(is) — dê baixa neles primeiro`, 409);
        await env.DB.prepare(`DELETE FROM produtos WHERE codigo = ?`).bind(codigo).run();
        return json({ ok: true });
      }

      if (pathname === '/api/locais' && method === 'POST') {
        const { nome } = await request.json();
        if (!nome) return erro('nome é obrigatório');
        try {
          await env.DB.prepare(`INSERT INTO locais (nome) VALUES (?)`).bind(nome.trim()).run();
        } catch {
          return erro('já existe um local com esse nome', 409);
        }
        return json({ ok: true }, 201);
      }

      if (pathname.match(/^\/api\/locais\/\d+$/) && method === 'DELETE') {
        const id = pathname.split('/').pop();
        const { total } = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM itens WHERE local_id = ? AND status = 'disponivel'`
        ).bind(id).first();
        if (total > 0) return erro(`local tem ${total} item(ns) disponível(is) — transfira-os primeiro`, 409);
        await env.DB.prepare(`DELETE FROM locais WHERE id = ?`).bind(id).run();
        return json({ ok: true });
      }

      // ---------- Entrada em lote ----------
      // Um produto, um local, N seriais. Cada serial vira uma peça.
      // A quantidade da operação é simplesmente quantos seriais entraram.

      if (pathname === '/api/entrada' && method === 'POST') {
        const corpo = await request.json();
        const { produto_codigo, local_id, referencia } = corpo;
        if (!produto_codigo) return erro('selecione o produto');

        const { seriais, repetidosNoLote } = normalizarSeriais(corpo.seriais);
        if (seriais.length === 0) return erro('informe pelo menos um número de série');
        if (seriais.length > LOTE_MAX) return erro(`máximo de ${LOTE_MAX} seriais por operação`);

        const produto = await env.DB.prepare(`SELECT nome FROM produtos WHERE codigo = ?`)
          .bind(produto_codigo).first();
        if (!produto) return erro('produto não encontrado', 404);

        const local = local_id
          ? await env.DB.prepare(`SELECT nome FROM locais WHERE id = ?`).bind(local_id).first()
          : null;

        const registrados = [];
        const jaExistiam = [];

        for (const grupo of pedacos(seriais, CHUNK)) {
          const comandos = grupo.map((serial) =>
            env.DB.prepare(
              `INSERT OR IGNORE INTO itens (serial, produto_codigo, local_id, entrada_ref)
               VALUES (?, ?, ?, ?)`
            ).bind(serial, produto_codigo, local_id || null, referencia?.trim() || null)
          );
          const resultados = await env.DB.batch(comandos);
          resultados.forEach((r, i) => {
            if (r.meta.changes > 0) registrados.push(grupo[i]);
            else jaExistiam.push(grupo[i]);
          });
        }

        if (registrados.length > 0) {
          await registrarHistorico(env, {
            tipo: 'entrada',
            produto_codigo, produto_nome: produto.nome,
            serial: registrados.length === 1 ? registrados[0] : null,
            quantidade: registrados.length,
            referencia: referencia?.trim() || null,
            local_destino: local ? local.nome : null,
          });
        }

        return json({
          ok: true,
          registrados: registrados.length,
          recusados: jaExistiam.length + repetidosNoLote.length,
          detalhe: {
            ja_disponiveis: jaExistiam,
            repetidos_no_lote: repetidosNoLote,
          },
        });
      }

      // ---------- Expedição (baixa em lote) ----------

      if (pathname === '/api/expedicao' && method === 'POST') {
        const corpo = await request.json();
        const { referencia } = corpo;
        const { seriais, repetidosNoLote } = normalizarSeriais(corpo.seriais);
        if (seriais.length === 0) return erro('informe pelo menos um número de série');
        if (seriais.length > LOTE_MAX) return erro(`máximo de ${LOTE_MAX} seriais por operação`);

        const itens = await buscarPorSeriais(env, seriais, 'disponivel');
        const encontrados = new Set(itens.map((i) => i.serial));
        const naoEncontrados = seriais.filter((s) => !encontrados.has(s));

        if (itens.length > 0) {
          for (const grupo of pedacos(itens, CHUNK)) {
            await env.DB.batch(
              grupo.map((item) =>
                env.DB.prepare(
                  `UPDATE itens SET status = 'baixado', baixado_em = datetime('now'), saida_ref = ?
                   WHERE id = ? AND status = 'disponivel'`
                ).bind(referencia?.trim() || null, item.id)
              )
            );
          }

          // Um registro de histórico por produto envolvido na expedição
          const porProduto = {};
          for (const item of itens) {
            (porProduto[item.produto_codigo] ||= { nome: item.produto_nome, locais: new Set(), itens: [] })
              .itens.push(item.serial);
            porProduto[item.produto_codigo].locais.add(item.local_nome || 'Sem local');
          }
          for (const [codigo, dados] of Object.entries(porProduto)) {
            await registrarHistorico(env, {
              tipo: 'baixa',
              produto_codigo: codigo, produto_nome: dados.nome,
              serial: dados.itens.length === 1 ? dados.itens[0] : null,
              quantidade: dados.itens.length,
              referencia: referencia?.trim() || null,
              local_origem: [...dados.locais].join(', '),
            });
          }
        }

        return json({
          ok: true,
          baixados: itens.length,
          recusados: naoEncontrados.length + repetidosNoLote.length,
          detalhe: {
            nao_encontrados: naoEncontrados,
            repetidos_no_lote: repetidosNoLote,
          },
        });
      }

      // ---------- Transferência em lote ----------

      if (pathname === '/api/transferencia' && method === 'POST') {
        const corpo = await request.json();
        const { local_id } = corpo;
        if (!local_id) return erro('selecione o local de destino');

        const { seriais, repetidosNoLote } = normalizarSeriais(corpo.seriais);
        if (seriais.length === 0) return erro('informe pelo menos um número de série');
        if (seriais.length > LOTE_MAX) return erro(`máximo de ${LOTE_MAX} seriais por operação`);

        const destino = await env.DB.prepare(`SELECT nome FROM locais WHERE id = ?`).bind(local_id).first();
        if (!destino) return erro('local de destino não encontrado', 404);

        const itens = await buscarPorSeriais(env, seriais, 'disponivel');
        const encontrados = new Set(itens.map((i) => i.serial));
        const naoEncontrados = seriais.filter((s) => !encontrados.has(s));
        const mover = itens.filter((i) => i.local_id !== Number(local_id));

        if (mover.length > 0) {
          for (const grupo of pedacos(mover, CHUNK)) {
            await env.DB.batch(
              grupo.map((item) =>
                env.DB.prepare(`UPDATE itens SET local_id = ? WHERE id = ? AND status = 'disponivel'`)
                  .bind(local_id, item.id)
              )
            );
          }
          const porProduto = {};
          for (const item of mover) {
            (porProduto[item.produto_codigo] ||= { nome: item.produto_nome, origens: new Set(), qtd: 0 });
            porProduto[item.produto_codigo].qtd++;
            porProduto[item.produto_codigo].origens.add(item.local_nome || 'Sem local');
          }
          for (const [codigo, dados] of Object.entries(porProduto)) {
            await registrarHistorico(env, {
              tipo: 'transferencia',
              produto_codigo: codigo, produto_nome: dados.nome,
              quantidade: dados.qtd,
              local_origem: [...dados.origens].join(', '),
              local_destino: destino.nome,
            });
          }
        }

        return json({
          ok: true,
          transferidos: mover.length,
          recusados: naoEncontrados.length + repetidosNoLote.length,
          detalhe: {
            nao_encontrados: naoEncontrados,
            ja_no_destino: itens.length - mover.length,
            repetidos_no_lote: repetidosNoLote,
          },
        });
      }

      // ---------- Operações de peça única (botões da tabela) ----------

      if (pathname.match(/^\/api\/itens\/\d+\/baixa$/) && method === 'POST') {
        const id = pathname.split('/')[3];
        const item = await env.DB.prepare(
          `SELECT itens.*, produtos.nome as produto_nome, locais.nome as local_nome
           FROM itens JOIN produtos ON produtos.codigo = itens.produto_codigo
           LEFT JOIN locais ON locais.id = itens.local_id
           WHERE itens.id = ? AND itens.status = 'disponivel'`
        ).bind(id).first();
        if (!item) return erro('item não encontrado ou já baixado', 404);

        await env.DB.prepare(
          `UPDATE itens SET status = 'baixado', baixado_em = datetime('now') WHERE id = ?`
        ).bind(id).run();

        await registrarHistorico(env, {
          tipo: 'baixa', produto_codigo: item.produto_codigo, produto_nome: item.produto_nome,
          serial: item.serial, quantidade: 1, local_origem: item.local_nome,
        });
        return json({ ok: true });
      }

      if (pathname.match(/^\/api\/itens\/\d+\/transferir$/) && method === 'POST') {
        const id = pathname.split('/')[3];
        const { local_id } = await request.json();
        const item = await env.DB.prepare(
          `SELECT itens.*, produtos.nome as produto_nome, locais.nome as local_origem_nome
           FROM itens JOIN produtos ON produtos.codigo = itens.produto_codigo
           LEFT JOIN locais ON locais.id = itens.local_id
           WHERE itens.id = ? AND itens.status = 'disponivel'`
        ).bind(id).first();
        if (!item) return erro('item não encontrado ou não disponível', 404);

        const novoLocal = local_id
          ? await env.DB.prepare(`SELECT nome FROM locais WHERE id = ?`).bind(local_id).first()
          : null;

        await env.DB.prepare(`UPDATE itens SET local_id = ? WHERE id = ?`).bind(local_id || null, id).run();

        await registrarHistorico(env, {
          tipo: 'transferencia', produto_codigo: item.produto_codigo, produto_nome: item.produto_nome,
          serial: item.serial, quantidade: 1,
          local_origem: item.local_origem_nome, local_destino: novoLocal ? novoLocal.nome : null,
        });
        return json({ ok: true });
      }

      // ---------- Histórico e importação ----------

      if (pathname === '/api/historico' && method === 'DELETE') {
        await env.DB.prepare(`DELETE FROM historico`).run();
        return json({ ok: true });
      }

      if (pathname === '/api/import' && method === 'POST') {
        const dados = await request.json();
        let importados = 0;

        for (const local of dados.locais || []) {
          if (local?.nome) {
            await env.DB.prepare(`INSERT OR IGNORE INTO locais (nome) VALUES (?)`).bind(local.nome).run();
          }
        }
        for (const produto of dados.produtos || []) {
          if (produto?.codigo && produto?.nome) {
            await env.DB.prepare(`INSERT OR IGNORE INTO produtos (codigo, nome) VALUES (?, ?)`)
              .bind(produto.codigo, produto.nome).run();
          }
        }
        for (const item of dados.itens || []) {
          if (!item?.serial || !item?.produto_codigo) continue;
          let localId = null;
          if (item.local_nome) {
            const local = await env.DB.prepare(`SELECT id FROM locais WHERE nome = ?`)
              .bind(item.local_nome).first();
            localId = local ? local.id : null;
          }
          const r = await env.DB.prepare(
            `INSERT OR IGNORE INTO itens (serial, produto_codigo, local_id, status, entrada_ref)
             VALUES (?, ?, ?, ?, ?)`
          ).bind(item.serial, item.produto_codigo, localId, item.status || 'disponivel', item.entrada_ref || null).run();
          if (r.meta.changes > 0) importados++;
        }

        await registrarHistorico(env, {
          tipo: 'import', produto_nome: 'Importação de arquivo', quantidade: importados,
        });
        return json({ ok: true, importados });
      }

      return erro('rota não encontrada', 404);
    } catch (e) {
      return erro('erro interno: ' + e.message, 500);
    }
  },
};
