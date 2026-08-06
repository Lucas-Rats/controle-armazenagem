// Sistema de Controle de Armazenagem — lógica do cliente
// Tudo fala com a API em /api/*. Nenhuma regra de negócio é decidida aqui:
// o servidor sempre confere de novo antes de gravar.

let admin = false;
let locaisCache = [];
let produtosCache = [];

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);
const num = (n) => Number(n || 0).toLocaleString('pt-BR');
const escapar = (t) => String(t ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function mostrarToast(mensagem, tipo = 'ok') {
  const toast = $('#toast');
  toast.textContent = mensagem;
  toast.className = `toast ${tipo === 'erro' ? 'erro' : ''}`;
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => toast.classList.add('hidden'), 4000);
}

async function api(caminho, opcoes = {}) {
  const r = await fetch(caminho, {
    ...opcoes,
    headers: { 'content-type': 'application/json', ...(opcoes.headers || {}) },
  });
  const dados = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(dados.erro || `erro ${r.status}`);
  return dados;
}

function aplicarModoAdmin() {
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !admin));
  $('#btn-abrir-login').classList.toggle('hidden', admin);
  $('#btn-logout').classList.toggle('hidden', !admin);
  $('#auth-status').textContent = admin ? 'administrador' : 'visitante — só consulta';
  if (!admin) $('#filtro-status').value = 'disponivel';
}

// ==================== Estoque agregado ====================

let estoqueCache = [];

async function carregarEstoque() {
  const { totais, produtos } = await api('/api/estoque');

  $('#total-itens').textContent = num(totais.itens);
  $('#total-produtos').textContent = num(totais.produtos);
  $('#total-locais').textContent = num(totais.locais);
  $('#total-baixados').textContent = num(totais.baixados);

  estoqueCache = produtos;
  renderEstoque();
}

// Filtra em memória: a lista de produtos é pequena, então a busca é
// instantânea e não gasta uma consulta ao banco a cada tecla.
function renderEstoque() {
  const busca = $('#busca-produto').value.trim().toLowerCase();
  const produtos = busca
    ? estoqueCache.filter((p) =>
        p.codigo.toLowerCase().includes(busca) || p.nome.toLowerCase().includes(busca))
    : estoqueCache;

  const somaFiltrada = produtos.reduce((s, p) => s + p.quantidade, 0);
  $('#contagem-produtos').textContent = busca
    ? `${num(produtos.length)} produto(s) · ${num(somaFiltrada)} peça(s)`
    : '';

  const corpo = $('#tabela-estoque');
  if (estoqueCache.length === 0) {
    corpo.innerHTML = `<tr><td colspan="4" class="vazio">Nenhum produto cadastrado ainda.</td></tr>`;
    return;
  }
  if (produtos.length === 0) {
    corpo.innerHTML = `<tr><td colspan="4" class="vazio">Nenhum produto corresponde a "${escapar(busca)}".</td></tr>`;
    return;
  }

  corpo.innerHTML = produtos.map((p) => {
    const chips = p.locais.length
      ? `<div class="chips">${p.locais.map((l) =>
          `<span class="chip">${escapar(l.local)} <strong>${num(l.quantidade)}</strong></span>`).join('')}</div>`
      : '<span class="lista__meta">sem peças em estoque</span>';
    return `<tr class="linha-produto" data-codigo="${escapar(p.codigo)}">
      <td class="col-codigo">${escapar(p.codigo)}</td>
      <td>${escapar(p.nome)}</td>
      <td class="col-qtd ${p.quantidade === 0 ? 'col-qtd--zero' : ''}">${num(p.quantidade)}</td>
      <td>${chips}</td>
    </tr>`;
  }).join('');
}

$('#tabela-estoque').addEventListener('click', async (ev) => {
  const linha = ev.target.closest('.linha-produto');
  if (!linha) return;
  const codigo = linha.dataset.codigo;
  const proxima = linha.nextElementSibling;

  if (proxima?.classList.contains('linha-seriais')) {
    proxima.remove();
    linha.classList.remove('aberta');
    return;
  }
  $$('.linha-seriais').forEach((el) => el.remove());
  $$('.linha-produto.aberta').forEach((el) => el.classList.remove('aberta'));
  linha.classList.add('aberta');

  const itens = await api(`/api/itens?produto_codigo=${encodeURIComponent(codigo)}&status=disponivel`);
  const conteudo = itens.length
    ? `<div class="seriais-lista">${itens.map((i) => `<code>${escapar(i.serial)}</code>`).join('')}</div>`
    : '<span class="lista__meta">nenhuma peça disponível</span>';
  linha.insertAdjacentHTML('afterend',
    `<tr class="linha-seriais"><td colspan="4">${conteudo}</td></tr>`);
});

// ==================== Estoque peça a peça ====================

async function carregarItens() {
  const params = new URLSearchParams();
  const busca = $('#filtro-busca').value.trim();
  if (busca) params.set('q', busca);
  if ($('#filtro-local').value) params.set('local_id', $('#filtro-local').value);
  if ($('#filtro-produto').value) params.set('produto_codigo', $('#filtro-produto').value);
  params.set('status', admin ? $('#filtro-status').value : 'disponivel');

  const itens = await api(`/api/itens?${params}`);
  $('#contagem-itens').textContent = `${num(itens.length)} peça(s)`;

  const corpo = $('#tabela-itens');
  if (itens.length === 0) {
    corpo.innerHTML = `<tr><td colspan="6" class="vazio">Nenhuma peça encontrada.</td></tr>`;
    return;
  }

  corpo.innerHTML = itens.map((item) => {
    const carimbo = item.status === 'disponivel'
      ? '<span class="carimbo carimbo--disponivel">Disponível</span>'
      : '<span class="carimbo carimbo--baixado">Expedido</span>';
    const doc = item.status === 'disponivel'
      ? (item.entrada_ref || '—')
      : (item.saida_ref || '—');
    const acoes = admin && item.status === 'disponivel'
      ? `<div class="linha-acoes">
           <select class="select-transferir" data-id="${item.id}">
             <option value="">Mover para…</option>
             ${locaisCache.map((l) =>
               `<option value="${l.id}" ${l.id === item.local_id ? 'disabled' : ''}>${escapar(l.nome)}</option>`).join('')}
           </select>
           <button class="btn btn--perigo btn-baixa" data-id="${item.id}">Baixar</button>
         </div>` : '';
    return `<tr>
      <td class="col-serial">${escapar(item.serial)}</td>
      <td>${escapar(item.produto_nome)} <span class="lista__meta">${escapar(item.produto_codigo)}</span></td>
      <td>${escapar(item.local_nome || '—')}</td>
      <td class="lista__meta">${escapar(doc)}</td>
      <td>${carimbo}</td>
      <td class="admin-only ${admin ? '' : 'hidden'}">${acoes}</td>
    </tr>`;
  }).join('');
}

// ==================== Histórico ====================

async function carregarHistorico() {
  const historico = await api('/api/historico');
  const corpo = $('#tabela-historico');
  if (historico.length === 0) {
    corpo.innerHTML = `<tr><td colspan="7" class="vazio">Sem movimentações ainda.</td></tr>`;
    return;
  }
  const rotulos = { entrada: 'Recebimento', baixa: 'Expedição', transferencia: 'Transferência', import: 'Importação' };
  corpo.innerHTML = historico.map((h) => `<tr>
    <td>${new Date(h.criado_em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}</td>
    <td>${rotulos[h.tipo] || h.tipo}</td>
    <td class="col-qtd">${num(h.quantidade)}</td>
    <td>${escapar(h.produto_nome || '—')}${h.serial ? ` <span class="lista__meta">${escapar(h.serial)}</span>` : ''}</td>
    <td class="lista__meta">${escapar(h.referencia || '—')}</td>
    <td>${escapar(h.local_origem || '—')}</td>
    <td>${escapar(h.local_destino || '—')}</td>
  </tr>`).join('');
}

// ==================== Cadastros ====================

function linhaCadastro(rotulo, meta, botoes) {
  return `<li><span>${rotulo}${meta}</span><span class="lista__acoes">${botoes}</span></li>`;
}

async function carregarProdutos() {
  produtosCache = await api('/api/produtos');
  const ativos = produtosCache.filter((p) => p.ativo !== 0);
  const arquivados = produtosCache.filter((p) => p.ativo === 0);

  // Só produtos ativos aparecem no formulário de recebimento
  $('#entrada-produto').innerHTML = ativos.map((p) =>
    `<option value="${escapar(p.codigo)}">${escapar(p.codigo)} — ${escapar(p.nome)}</option>`).join('');
  // O filtro mostra todos, para conseguir consultar peças de produtos arquivados
  $('#filtro-produto').innerHTML = '<option value="">Todos os produtos</option>' +
    produtosCache.map((p) =>
      `<option value="${escapar(p.codigo)}">${escapar(p.codigo)} — ${escapar(p.nome)}${p.ativo === 0 ? ' (arquivado)' : ''}</option>`).join('');

  $('#lista-produtos').innerHTML = ativos.map((p) => linhaCadastro(
    `<strong class="col-codigo">${escapar(p.codigo)}</strong> ${escapar(p.nome)}`, '',
    `<button class="btn btn--ghost btn-arquivar-produto" data-codigo="${escapar(p.codigo)}" data-ativo="0">Arquivar</button>
     <button class="btn btn--ghost btn-excluir-produto" data-codigo="${escapar(p.codigo)}">Excluir</button>`
  )).join('') || '<li class="lista__meta">Nenhum produto cadastrado.</li>';

  $('#arquivados-produtos').innerHTML = arquivados.map((p) => linhaCadastro(
    `<strong class="col-codigo">${escapar(p.codigo)}</strong> ${escapar(p.nome)}`, '',
    `<button class="btn btn--ghost btn-arquivar-produto" data-codigo="${escapar(p.codigo)}" data-ativo="1">Reativar</button>
     <button class="btn btn--ghost btn-excluir-produto" data-codigo="${escapar(p.codigo)}">Excluir</button>`
  )).join('');
  $('#bloco-arquivados-produtos').classList.toggle('hidden', arquivados.length === 0);
  $('#conta-arquivados-produtos').textContent = arquivados.length;
}

async function carregarLocais() {
  locaisCache = await api('/api/locais');
  const ativos = locaisCache.filter((l) => l.ativo !== 0);
  const arquivados = locaisCache.filter((l) => l.ativo === 0);
  const opcoesAtivas = ativos.map((l) => `<option value="${l.id}">${escapar(l.nome)}</option>`).join('');

  $('#entrada-local').innerHTML = '<option value="">— sem local —</option>' + opcoesAtivas;
  $('#transferencia-local').innerHTML = '<option value="">Selecione…</option>' + opcoesAtivas;
  $('#filtro-local').innerHTML = '<option value="">Todos os locais</option>' +
    locaisCache.map((l) =>
      `<option value="${l.id}">${escapar(l.nome)}${l.ativo === 0 ? ' (arquivado)' : ''}</option>`).join('');

  $('#lista-locais').innerHTML = ativos.map((l) => linhaCadastro(
    escapar(l.nome), '',
    `<button class="btn btn--ghost btn-arquivar-local" data-id="${l.id}" data-ativo="0">Arquivar</button>
     <button class="btn btn--ghost btn-excluir-local" data-id="${l.id}" data-nome="${escapar(l.nome)}">Excluir</button>`
  )).join('') || '<li class="lista__meta">Nenhum local cadastrado.</li>';

  $('#arquivados-locais').innerHTML = arquivados.map((l) => linhaCadastro(
    escapar(l.nome), '',
    `<button class="btn btn--ghost btn-arquivar-local" data-id="${l.id}" data-ativo="1">Reativar</button>
     <button class="btn btn--ghost btn-excluir-local" data-id="${l.id}" data-nome="${escapar(l.nome)}">Excluir</button>`
  )).join('');
  $('#bloco-arquivados-locais').classList.toggle('hidden', arquivados.length === 0);
  $('#conta-arquivados-locais').textContent = arquivados.length;
}

async function recarregarTudo() {
  await Promise.all([carregarProdutos(), carregarLocais()]);
  await Promise.all([carregarEstoque(), carregarItens(), carregarHistorico()]);
}

// ==================== Autenticação ====================

$('#btn-abrir-login').addEventListener('click', () => {
  $('#login-erro').classList.add('hidden');
  $('#input-senha').value = '';
  $('#dialog-login').showModal();
  $('#input-senha').focus();
});
$('#btn-cancelar-login').addEventListener('click', () => $('#dialog-login').close());

$('#form-login').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  try {
    await api('/api/login', { method: 'POST', body: JSON.stringify({ senha: $('#input-senha').value }) });
    $('#dialog-login').close();
    admin = true;
    aplicarModoAdmin();
    await recarregarTudo();
    mostrarToast('Login feito com sucesso.');
  } catch (e) {
    $('#login-erro').textContent = e.message;
    $('#login-erro').classList.remove('hidden');
  }
});

$('#btn-logout').addEventListener('click', async () => {
  await api('/api/logout', { method: 'POST' });
  admin = false;
  aplicarModoAdmin();
  await recarregarTudo();
  mostrarToast('Você saiu do modo administrador.');
});

// ==================== Abas e filtros ====================

$$('.aba').forEach((aba) => aba.addEventListener('click', () => {
  $$('.aba').forEach((a) => a.classList.toggle('aba--ativa', a === aba));
  const vista = aba.dataset.vista;
  $('#vista-produto').classList.toggle('hidden', vista !== 'produto');
  $('#vista-serial').classList.toggle('hidden', vista !== 'serial');
}));

$('#busca-produto').addEventListener('input', renderEstoque);

let filtroTimeout;
$('#filtro-busca').addEventListener('input', () => {
  clearTimeout(filtroTimeout);
  filtroTimeout = setTimeout(carregarItens, 250);
});
['#filtro-local', '#filtro-produto', '#filtro-status'].forEach((sel) =>
  $(sel).addEventListener('change', carregarItens));

// ==================== Contadores de serial ====================

function contarSeriais(texto) {
  return texto.split(/[\n\r,;\t]+/).map((s) => s.trim()).filter(Boolean).length;
}

[['#entrada-seriais', '#contador-entrada'],
 ['#expedicao-seriais', '#contador-expedicao'],
 ['#transferencia-seriais', '#contador-transferencia']].forEach(([campo, contador]) => {
  $(campo).addEventListener('input', () => {
    $(contador).textContent = `${contarSeriais($(campo).value)} seriais`;
  });
});

// ==================== Resultado das operações em lote ====================

function mostrarResultado(form, resultado, rotuloOk) {
  const caixa = form.querySelector('.resultado');
  const feitos = resultado.registrados ?? resultado.baixados ?? resultado.transferidos ?? 0;
  const d = resultado.detalhe || {};

  let html = `<div class="resultado__linha"><span class="resultado__ok">${num(feitos)}</span> ${rotuloOk}</div>`;
  if (resultado.recusados > 0) {
    html += `<div class="resultado__linha"><span class="resultado__aviso">${num(resultado.recusados)}</span> não processados</div>`;
  }
  if (d.ja_no_destino > 0) {
    html += `<div class="resultado__linha"><span>${num(d.ja_no_destino)}</span> já estavam no destino</div>`;
  }
  const listas = [
    ['Já existiam no estoque', d.ja_disponiveis],
    ['Não encontrados ou já expedidos', d.nao_encontrados],
    ['Repetidos dentro do lote', d.repetidos_no_lote],
  ].filter(([, lista]) => lista?.length);

  for (const [titulo, lista] of listas) {
    html += `<details><summary>${titulo} (${lista.length})</summary>
      <div class="seriais-lista">${lista.map((s) => `<code>${escapar(s)}</code>`).join('')}</div></details>`;
  }
  caixa.innerHTML = html;
  caixa.classList.remove('hidden');
}

// ==================== Operações ====================

$('#form-entrada').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  try {
    const resultado = await api('/api/entrada', {
      method: 'POST',
      body: JSON.stringify({
        produto_codigo: $('#entrada-produto').value,
        local_id: $('#entrada-local').value ? Number($('#entrada-local').value) : null,
        referencia: $('#entrada-ref').value,
        seriais: $('#entrada-seriais').value,
      }),
    });
    mostrarResultado(form, resultado, 'peças recebidas');
    $('#entrada-seriais').value = '';
    $('#contador-entrada').textContent = '0 seriais';
    await Promise.all([carregarEstoque(), carregarItens(), carregarHistorico()]);
  } catch (e) {
    mostrarToast(e.message, 'erro');
  }
});

$('#form-expedicao').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  const qtd = contarSeriais($('#expedicao-seriais').value);
  if (!confirm(`Dar baixa em ${qtd} serial(is)? Essa ação não pode ser desfeita.`)) return;
  try {
    const resultado = await api('/api/expedicao', {
      method: 'POST',
      body: JSON.stringify({
        referencia: $('#expedicao-ref').value,
        seriais: $('#expedicao-seriais').value,
      }),
    });
    mostrarResultado(form, resultado, 'peças expedidas');
    $('#expedicao-seriais').value = '';
    $('#contador-expedicao').textContent = '0 seriais';
    await Promise.all([carregarEstoque(), carregarItens(), carregarHistorico()]);
  } catch (e) {
    mostrarToast(e.message, 'erro');
  }
});

$('#form-transferencia').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  try {
    const resultado = await api('/api/transferencia', {
      method: 'POST',
      body: JSON.stringify({
        local_id: Number($('#transferencia-local').value),
        seriais: $('#transferencia-seriais').value,
      }),
    });
    mostrarResultado(form, resultado, 'peças transferidas');
    $('#transferencia-seriais').value = '';
    $('#contador-transferencia').textContent = '0 seriais';
    await Promise.all([carregarEstoque(), carregarItens(), carregarHistorico()]);
  } catch (e) {
    mostrarToast(e.message, 'erro');
  }
});

// ==================== Ações da tabela ====================

$('#tabela-itens').addEventListener('click', async (ev) => {
  if (!ev.target.classList.contains('btn-baixa')) return;
  if (!confirm('Dar baixa nesta peça? Não pode ser desfeito.')) return;
  try {
    await api(`/api/itens/${ev.target.dataset.id}/baixa`, { method: 'POST' });
    mostrarToast('Baixa registrada.');
    await Promise.all([carregarEstoque(), carregarItens(), carregarHistorico()]);
  } catch (e) { mostrarToast(e.message, 'erro'); }
});

$('#tabela-itens').addEventListener('change', async (ev) => {
  const alvo = ev.target;
  if (!alvo.classList.contains('select-transferir') || !alvo.value) return;
  try {
    await api(`/api/itens/${alvo.dataset.id}/transferir`, {
      method: 'POST', body: JSON.stringify({ local_id: Number(alvo.value) }),
    });
    mostrarToast('Peça transferida.');
    await Promise.all([carregarEstoque(), carregarItens(), carregarHistorico()]);
  } catch (e) { mostrarToast(e.message, 'erro'); alvo.value = ''; }
});

// ==================== Formulários de cadastro ====================

function mensagemCartao(form, texto, tipo) {
  const msg = form.querySelector('.cartao__msg');
  msg.textContent = texto;
  msg.className = `cartao__msg ${tipo}`;
}

$('#form-produto').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  try {
    await api('/api/produtos', {
      method: 'POST',
      body: JSON.stringify({ codigo: $('#produto-codigo').value, nome: $('#produto-nome').value }),
    });
    form.reset();
    mensagemCartao(form, 'Produto cadastrado.', 'ok');
    await Promise.all([carregarProdutos(), carregarEstoque()]);
  } catch (e) { mensagemCartao(form, e.message, 'erro'); }
});

$('#form-local').addEventListener('submit', async (ev) => {
  ev.preventDefault();
  const form = ev.target;
  try {
    await api('/api/locais', { method: 'POST', body: JSON.stringify({ nome: $('#local-nome').value }) });
    form.reset();
    mensagemCartao(form, 'Local cadastrado.', 'ok');
    await Promise.all([carregarLocais(), carregarEstoque()]);
  } catch (e) { mensagemCartao(form, e.message, 'erro'); }
});

async function acaoProduto(ev) {
  const alvo = ev.target;
  const codigo = alvo.dataset.codigo;
  if (!codigo) return;
  try {
    if (alvo.classList.contains('btn-excluir-produto')) {
      if (!confirm(`Excluir o produto ${codigo} de vez?`)) return;
      await api(`/api/produtos/${encodeURIComponent(codigo)}`, { method: 'DELETE' });
      mostrarToast('Produto excluído.');
    } else if (alvo.classList.contains('btn-arquivar-produto')) {
      const ativo = alvo.dataset.ativo === '1';
      await api(`/api/produtos/${encodeURIComponent(codigo)}`, {
        method: 'PATCH', body: JSON.stringify({ ativo }),
      });
      mostrarToast(ativo ? 'Produto reativado.' : 'Produto arquivado.');
    } else return;
    await Promise.all([carregarProdutos(), carregarEstoque()]);
  } catch (e) { mostrarToast(e.message, 'erro'); }
}
$('#lista-produtos').addEventListener('click', acaoProduto);
$('#arquivados-produtos').addEventListener('click', acaoProduto);

async function acaoLocal(ev) {
  const alvo = ev.target;
  const { id, nome } = alvo.dataset;
  if (!id) return;
  try {
    if (alvo.classList.contains('btn-excluir-local')) {
      if (!confirm(`Excluir o local "${nome}" de vez?`)) return;
      await api(`/api/locais/${id}`, { method: 'DELETE' });
      mostrarToast('Local excluído.');
    } else if (alvo.classList.contains('btn-arquivar-local')) {
      const ativo = alvo.dataset.ativo === '1';
      await api(`/api/locais/${id}`, { method: 'PATCH', body: JSON.stringify({ ativo }) });
      mostrarToast(ativo ? 'Local reativado.' : 'Local arquivado.');
    } else return;
    await Promise.all([carregarLocais(), carregarEstoque(), carregarItens()]);
  } catch (e) { mostrarToast(e.message, 'erro'); }
}
$('#lista-locais').addEventListener('click', acaoLocal);
$('#arquivados-locais').addEventListener('click', acaoLocal);

$('#btn-limpar-historico').addEventListener('click', async () => {
  if (!confirm('Limpar todo o histórico? Não pode ser desfeito.')) return;
  await api('/api/historico', { method: 'DELETE' });
  await carregarHistorico();
  mostrarToast('Histórico limpo.');
});

// ==================== Exportar / importar ====================

$('#btn-exportar').addEventListener('click', async () => {
  const dados = await api('/api/export');
  const blob = new Blob([JSON.stringify(dados, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `armazenagem-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

$('#input-importar').addEventListener('change', async (ev) => {
  const arquivo = ev.target.files[0];
  if (!arquivo) return;
  try {
    const resultado = await api('/api/import', { method: 'POST', body: await arquivo.text() });
    mostrarToast(`${resultado.importados} peças importadas.`);
    await recarregarTudo();
  } catch (e) {
    mostrarToast('Falha ao importar: ' + e.message, 'erro');
  } finally { ev.target.value = ''; }
});

// ==================== Início ====================

(function preencherManifesto() {
  const h = new Date();
  $('#manifesto-num').textContent =
    `${h.getFullYear()}${String(h.getMonth() + 1).padStart(2, '0')}${String(h.getDate()).padStart(2, '0')}`;
})();

(async function iniciar() {
  try {
    const { admin: souAdmin } = await api('/api/me');
    admin = souAdmin;
    aplicarModoAdmin();
    await recarregarTudo();
  } catch (e) {
    mostrarToast('Erro ao carregar dados: ' + e.message, 'erro');
  }
})();