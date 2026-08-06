// Sistema de Controle de Armazenagem — Worker (API)
//
// As rotas estáticas (index.html, style.css, script.js) são servidas
// automaticamente pelo binding "assets" configurado no wrangler.jsonc.
// Este arquivo só é executado para requisições que não batem com nenhum
// arquivo estático — ou seja, tudo que começa com /api/.

const COOKIE_SESSAO = 'sessao';
const SESSAO_HORAS = 12;
const HISTORICO_LIMITE = 500;
const LOGIN_MAX_TENTATIVAS = 5;
const LOGIN_JANELA_MIN = 15;

function json(dados, status = 200, headersExtra = {}) {
  return new Response(JSON.stringify(dados), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...headersExtra },
  });
}

function erro(mensagem, status = 400) {
  return json({ erro: mensagem }, status);
}

function paraBase64Url(bytes) {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function deBase64Url(texto) {
  return atob(texto.replace(/-/g, '+').replace(/_/g, '/'));
}

async function assinar(payload, segredo) {
  const chave = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const assinatura = await crypto.subtle.sign('HMAC', chave, new TextEncoder().encode(payload));
  return paraBase64Url(assinatura);
}

async function criarSessao(segredo) {
  const exp = Date.now() + SESSAO_HORAS * 60 * 60 * 1000;
  const payload = paraBase64Url(new TextEncoder().encode(JSON.stringify({ exp })));
  const assinatura = await assinar(payload, segredo);
  return `${payload}.${assinatura}`;
}

async function sessaoValida(token, segredo) {
  if (!token) return false;
  const [payload, assinatura] = token.split('.');
  if (!payload || !assinatura) return false;
  const esperado = await assinar(payload, segredo);
  if (assinatura !== esperado) return false;
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
  const maxAge = SESSAO_HORAS * 60 * 60;
  return `${COOKIE_SESSAO}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function cookieLimpo() {
  return `${COOKIE_SESSAO}=; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=0`;
}

async function ehAdmin(request, env) {
  const token = pegarCookie(request, COOKIE_SESSAO);
  return sessaoValida(token, env.SESSION_SECRET);
}

async function registrarHistorico(env, entrada) {
  await env.DB.prepare(
    `INSERT INTO historico (tipo, produto_codigo, produto_nome, serial, local_origem, local_destino)
     VALUES (?, ?, ?, ?, ?, ?)`
  )
    .bind(
      entrada.tipo,
      entrada.produto_codigo || null,
      entrada.produto_nome || null,
      entrada.serial || null,
      entrada.local_origem || null,
      entrada.local_destino || null
    )
    .run();

  const { total } = await env.DB.prepare(`SELECT COUNT(*) as total FROM historico`).first();
  if (total > HISTORICO_LIMITE) {
    await env.DB.prepare(
      `DELETE FROM historico WHERE id IN (
         SELECT id FROM historico ORDER BY criado_em ASC LIMIT ?
       )`
    )
      .bind(total - HISTORICO_LIMITE)
      .run();
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    if (!pathname.startsWith('/api/')) {
      return erro('não encontrado', 404);
    }

    try {
      // ---------- Autenticação ----------

      if (pathname === '/api/login' && method === 'POST') {
        const ip = request.headers.get('cf-connecting-ip') || 'desconhecido';
        const desde = new Date(Date.now() - LOGIN_JANELA_MIN * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19);
        const { total } = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM login_tentativas WHERE ip = ? AND criado_em > ?`
        )
          .bind(ip, desde)
          .first();

        if (total >= LOGIN_MAX_TENTATIVAS) {
          return erro(`muitas tentativas — aguarde ${LOGIN_JANELA_MIN} minutos e tente de novo`, 429);
        }

        const corpo = await request.json().catch(() => ({}));
        if (!env.ADMIN_PASSWORD || corpo.senha !== env.ADMIN_PASSWORD) {
          await env.DB.prepare(`INSERT INTO login_tentativas (ip) VALUES (?)`).bind(ip).run();
          return erro('senha incorreta', 401);
        }

        const token = await criarSessao(env.SESSION_SECRET);
        return json({ ok: true }, 200, { 'set-cookie': cookieSessao(token) });
      }

      if (pathname === '/api/logout' && method === 'POST') {
        return json({ ok: true }, 200, { 'set-cookie': cookieLimpo() });
      }

      if (pathname === '/api/me' && method === 'GET') {
        return json({ admin: await ehAdmin(request, env) });
      }

      // ---------- Leitura (admin e cliente) ----------

      if (pathname === '/api/produtos' && method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT * FROM produtos ORDER BY nome`).all();
        return json(results);
      }

      if (pathname === '/api/locais' && method === 'GET') {
        const { results } = await env.DB.prepare(`SELECT * FROM locais ORDER BY nome`).all();
        return json(results);
      }

      if (pathname === '/api/itens' && method === 'GET') {
        const admin = await ehAdmin(request, env);
        const statusPedido = url.searchParams.get('status');
        // Cliente só pode ver itens disponíveis, mesmo que peça outra coisa na URL
        const status = admin && statusPedido ? statusPedido : 'disponivel';
        const localId = url.searchParams.get('local_id');
        const produtoCodigo = url.searchParams.get('produto_codigo');
        const busca = url.searchParams.get('q');

        let sql = `
          SELECT itens.*, produtos.nome as produto_nome, locais.nome as local_nome
          FROM itens
          JOIN produtos ON produtos.codigo = itens.produto_codigo
          LEFT JOIN locais ON locais.id = itens.local_id
          WHERE itens.status = ?`;
        const params = [status];

        if (localId) {
          sql += ` AND itens.local_id = ?`;
          params.push(localId);
        }
        if (produtoCodigo) {
          sql += ` AND itens.produto_codigo = ?`;
          params.push(produtoCodigo);
        }
        if (busca) {
          sql += ` AND (itens.serial LIKE ? OR produtos.codigo LIKE ? OR produtos.nome LIKE ?)`;
          const like = `%${busca}%`;
          params.push(like, like, like);
        }
        sql += ` ORDER BY itens.criado_em DESC`;

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
          produtos: produtos.results,
          locais: locais.results,
          itens: itens.results,
          historico: historico.results,
        });
      }

      // ---------- A partir daqui, só admin ----------

      if (!(await ehAdmin(request, env))) {
        return erro('não autorizado — faça login como administrador', 401);
      }

      if (pathname === '/api/produtos' && method === 'POST') {
        const { codigo, nome } = await request.json();
        if (!codigo || !nome) return erro('código e nome são obrigatórios');
        try {
          await env.DB.prepare(`INSERT INTO produtos (codigo, nome) VALUES (?, ?)`)
            .bind(codigo.trim().toUpperCase(), nome.trim())
            .run();
        } catch {
          return erro('já existe um produto com esse código', 409);
        }
        return json({ ok: true }, 201);
      }

      if (pathname.match(/^\/api\/produtos\/[^/]+$/) && method === 'DELETE') {
        const codigo = decodeURIComponent(pathname.split('/').pop());
        const { total } = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM itens WHERE produto_codigo = ? AND status = 'disponivel'`
        )
          .bind(codigo)
          .first();
        if (total > 0) return erro('produto tem itens disponíveis — dê baixa neles primeiro', 409);
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

      if (pathname.match(/^\/api\/locais\/\d+$/) && method === 'PUT') {
        const id = pathname.split('/').pop();
        const { nome } = await request.json();
        if (!nome) return erro('nome é obrigatório');
        try {
          await env.DB.prepare(`UPDATE locais SET nome = ? WHERE id = ?`).bind(nome.trim(), id).run();
        } catch {
          return erro('já existe um local com esse nome', 409);
        }
        return json({ ok: true });
      }

      if (pathname.match(/^\/api\/locais\/\d+$/) && method === 'DELETE') {
        const id = pathname.split('/').pop();
        const { total } = await env.DB.prepare(
          `SELECT COUNT(*) as total FROM itens WHERE local_id = ? AND status = 'disponivel'`
        )
          .bind(id)
          .first();
        if (total > 0) return erro('local tem itens disponíveis — transfira-os primeiro', 409);
        await env.DB.prepare(`DELETE FROM locais WHERE id = ?`).bind(id).run();
        return json({ ok: true });
      }

      if (pathname === '/api/itens' && method === 'POST') {
        const { produto_codigo, serial, local_id } = await request.json();
        if (!produto_codigo || !serial) return erro('produto e serial são obrigatórios');

        const produto = await env.DB.prepare(`SELECT nome FROM produtos WHERE codigo = ?`)
          .bind(produto_codigo)
          .first();
        if (!produto) return erro('produto não encontrado', 404);

        try {
          await env.DB.prepare(`INSERT INTO itens (serial, produto_codigo, local_id) VALUES (?, ?, ?)`)
            .bind(serial.trim(), produto_codigo, local_id || null)
            .run();
        } catch {
          return erro('já existe um item disponível com esse serial', 409);
        }

        const local = local_id
          ? await env.DB.prepare(`SELECT nome FROM locais WHERE id = ?`).bind(local_id).first()
          : null;

        await registrarHistorico(env, {
          tipo: 'entrada',
          produto_codigo,
          produto_nome: produto.nome,
          serial: serial.trim(),
          local_destino: local ? local.nome : null,
        });
        return json({ ok: true }, 201);
      }

      if (pathname.match(/^\/api\/itens\/\d+\/baixa$/) && method === 'POST') {
        const id = pathname.split('/')[3];
        const item = await env.DB.prepare(
          `SELECT itens.*, produtos.nome as produto_nome, locais.nome as local_nome
           FROM itens
           JOIN produtos ON produtos.codigo = itens.produto_codigo
           LEFT JOIN locais ON locais.id = itens.local_id
           WHERE itens.id = ? AND itens.status = 'disponivel'`
        )
          .bind(id)
          .first();
        if (!item) return erro('item não encontrado ou já baixado', 404);

        await env.DB.prepare(`UPDATE itens SET status = 'baixado', baixado_em = datetime('now') WHERE id = ?`)
          .bind(id)
          .run();

        await registrarHistorico(env, {
          tipo: 'baixa',
          produto_codigo: item.produto_codigo,
          produto_nome: item.produto_nome,
          serial: item.serial,
          local_origem: item.local_nome,
        });
        return json({ ok: true });
      }

      if (pathname.match(/^\/api\/itens\/\d+\/transferir$/) && method === 'POST') {
        const id = pathname.split('/')[3];
        const { local_id } = await request.json();
        const item = await env.DB.prepare(
          `SELECT itens.*, produtos.nome as produto_nome, locais.nome as local_origem_nome
           FROM itens
           JOIN produtos ON produtos.codigo = itens.produto_codigo
           LEFT JOIN locais ON locais.id = itens.local_id
           WHERE itens.id = ? AND itens.status = 'disponivel'`
        )
          .bind(id)
          .first();
        if (!item) return erro('item não encontrado ou não disponível', 404);

        const novoLocal = local_id
          ? await env.DB.prepare(`SELECT nome FROM locais WHERE id = ?`).bind(local_id).first()
          : null;

        await env.DB.prepare(`UPDATE itens SET local_id = ? WHERE id = ?`).bind(local_id || null, id).run();

        await registrarHistorico(env, {
          tipo: 'transferencia',
          produto_codigo: item.produto_codigo,
          produto_nome: item.produto_nome,
          serial: item.serial,
          local_origem: item.local_origem_nome,
          local_destino: novoLocal ? novoLocal.nome : null,
        });
        return json({ ok: true });
      }

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
              .bind(produto.codigo, produto.nome)
              .run();
          }
        }
        for (const item of dados.itens || []) {
          if (!item?.serial || !item?.produto_codigo) continue;
          let localId = null;
          if (item.local_nome) {
            const local = await env.DB.prepare(`SELECT id FROM locais WHERE nome = ?`)
              .bind(item.local_nome)
              .first();
            localId = local ? local.id : null;
          }
          const resultado = await env.DB.prepare(
            `INSERT OR IGNORE INTO itens (serial, produto_codigo, local_id, status) VALUES (?, ?, ?, ?)`
          )
            .bind(item.serial, item.produto_codigo, localId, item.status || 'disponivel')
            .run();
          if (resultado.meta.changes > 0) importados++;
        }

        await registrarHistorico(env, { tipo: 'import', produto_nome: `${importados} itens importados` });
        return json({ ok: true, importados });
      }

      return erro('rota não encontrada', 404);
    } catch (e) {
      return erro('erro interno: ' + e.message, 500);
    }
  },
};