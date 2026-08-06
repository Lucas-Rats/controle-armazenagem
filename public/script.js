// Sistema de Controle de Armazenagem — lógica do cliente
// Tudo aqui fala com a API em /api/*. Nenhuma regra de negócio "de verdade"
// é decidida no navegador — o servidor sempre confere de novo, então nada
// aqui precisa (nem deve) ser tratado como fonte de verdade.

let admin = false;
let locaisCache = [];

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function mostrarToast(mensagem, tipo = 'ok') {
  const toast = $('#toast');
  toast.textContent = mensagem;
  toast.className = `toast ${tipo === 'erro' ? 'erro' : ''}`;
  toast.classList.remove('hidden');
  clearTimeout(mostrarToast._t);
  mostrarToast._t = setTimeout(() => toast.classList.add('hidden'), 3500);
}

async function api(caminho, opcoes = {}) {
  const resposta = await fetch(caminho, {
    ...opcoes,
    headers: { 'content-type': 'application/json', ...(opcoes.headers || {}) },
  });
  const dados = await resposta.json().catch(() => ({}));
  if (!resposta.ok) throw new Error(dados.erro || `erro ${resposta.status}`);
  return dados;
}

function aplicarModoAdmin() {
  $$('.admin-only').forEach((el) => el.classList.toggle('hidden', !admin));
  $('#btn-abrir-login').classList.toggle('hidden', admin);
  $('#btn-logout').classList.toggle('hidden', !admin);
  $('#auth-status').textContent = admin ? 'administrador' : 'visitante — só consulta';
  if (!admin) $('#filtro-status').value = 'disponivel';
}

// ---------- Carregamento ----------

async function carregarProdutos() {
  const produtos = await api('/api/produtos');
  $('#entrada-produto').innerHTML = produtos.map((p) => `<option value="${p.codigo}">${p.codigo} — ${p.nome}</option>`).join('');
}

async function carregarLocais() {
  locaisCache = await api('/api/locais');

  $('#entrada-local').innerHTML =
    '<option value="">— nenhum —</option>' + locaisCache.map((l) => `<option value="${l.id}">${l.nome}</option>`).join('');

  $('#filtro-local').innerHTML =
    '<option value="">Todos os locais</option>' + locaisCache.map((l) => `<option value="${l.id}">${l.nome}</option>`).join('');

  $('#lista-locais').innerHTML = locaisCache
    .map((l) => `<li>${l.nome} <button class="btn btn--ghost btn-excluir-local" data-id="${l.id}" data-nome="${l.nome}">Excluir</button></li>`)
    .join('');
}

async function carregarItens() {
  const params = new URLSearchParams();
  const busca = $('#filtro-busca').value.trim();
  const local = $('#filtro-local').value;
  const status = admin ? $('#filtro-status').value : 'disponivel';
  if (busca) params.set('q', busca);
  if (local) params.set('local_id', local);
  params.set('status', status);

  const itens = await api(`/api/itens?${params.toString()}`);
  const corpo = $('#tabela-itens');

  if (itens.length === 0) {
    corpo.innerHTML = `<tr><td colspan="5" class="vazio">Nenhum item encontrado.</td></tr>`;
    return;
  }

  corpo.innerHTML = itens
    .map((item) => {
      const carimbo =
        item.status === 'disponivel'
          ? '<span class="carimbo carimbo--disponivel">Disponível</span>'
          : '<span class="carimbo carimbo--baixado">Baixado</span>';

      const acoes =
        admin && item.status === 'disponivel'
          ? `<div class="linha-acoes">
               <select class="select-transferir" data-id="${item.id}">
                 <option value="">Transferir para…</option>
                 ${locaisCache
                   .map((l) => `<option value="${l.id}" ${l.id === item.local_id ? 'disabled' : ''}>${l.nome}</option>`)
                   .join('')}
               </select>
               <button class="btn btn--perigo btn-baixa" data-id="${item.id}">Dar baixa</button>
             </div>`
          : '';

      return `<tr>
        <td class="col-serial">${item.serial}</td>
        <td>${item.produto_nome || item.produto_codigo}</td>
        <td>${item.local_nome || '—'}</td>
        <td>${carimbo}</td>
        <td class="admin-only ${admin ? '' : 'hidden'}">${acoes}</td>
      </tr>`;
    })
    .join('');
}

async function carregarHistorico() {
  const historico = await api('/api/historico');
  const corpo = $('#tabela-historico');
  if (historico.length === 0) {
    corpo.innerHTML = `<tr><td colspan="6" class="vazio">Sem movimentações ainda.</td></tr>`;
    return;
  }
  const rotulos = { entrada: 'Entrada', baixa: 'Baixa', transferencia: 'Transferência', import: 'Importação' };
  corpo.innerHTML = historico
    .map(
      (h) => `<tr>
        <td>${new Date(h.criado_em.replace(' ', 'T') + 'Z').toLocaleString('pt-BR')}</td>
        <td>${rotulos[h.tipo] || h.tipo}</td>
        <td>${h.produto_nome || '—'}</td>
        <td class="col-serial">${h.serial || '—'}</td>
        <td>${h.local_origem || '—'}</td>
        <td>${h.local_destino || '—'}</td>
      </tr>`
    )
    .join('');
}

async function recarregarTudo() {
  await Promise.all([carregarProdutos(), carregarLocais()]);
  await Promise.all([carregarItens(), carregarHistorico()]);
}

// ---------- Autenticação ----------

async function verificarSessao() {
  const { admin: souAdmin } = await api('/api/me');
  admin = souAdmin;
  aplicarModoAdmin();
}

$('#btn-abrir-login').addEventListener('click', () => {
  $('#login-erro').classList.add('hidden');
  $('#input-senha').value = '';
  $('#dialog-login').showModal();
  $('#input-senha').focus();
});

$('#btn-cancelar-login').addEventListener('click', () => $('#dialog-login').close());

$('#form-login').addEventListener('submit', async (evento) => {
  evento.preventDefault();
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

// ---------- Filtros ----------

let filtroTimeout;
$('#filtro-busca').addEventListener('input', () => {
  clearTimeout(filtroTimeout);
  filtroTimeout = setTimeout(carregarItens, 250);
});
$('#filtro-local').addEventListener('change', carregarItens);
$('#filtro-status').addEventListener('change', carregarItens);

// ---------- Ações da tabela (delegadas, porque as linhas são recriadas) ----------

$('#tabela-itens').addEventListener('click', async (evento) => {
  if (!evento.target.classList.contains('btn-baixa')) return;
  if (!confirm('Dar baixa neste item? Essa ação não pode ser desfeita.')) return;
  try {
    await api(`/api/itens/${evento.target.dataset.id}/baixa`, { method: 'POST' });
    mostrarToast('Baixa registrada.');
    await carregarItens();
    await carregarHistorico();
  } catch (e) {
    mostrarToast(e.message, 'erro');
  }
});

$('#tabela-itens').addEventListener('change', async (evento) => {
  const alvo = evento.target;
  if (!alvo.classList.contains('select-transferir') || !alvo.value) return;
  try {
    await api(`/api/itens/${alvo.dataset.id}/transferir`, {
      method: 'POST',
      body: JSON.stringify({ local_id: Number(alvo.value) }),
    });
    mostrarToast('Item transferido.');
    await carregarItens();
    await carregarHistorico();
  } catch (e) {
    mostrarToast(e.message, 'erro');
    alvo.value = '';
  }
});

// ---------- Formulários admin ----------

function mensagemCartao(form, texto, tipo) {
  const msg = form.querySelector('.cartao__msg');
  msg.textContent = texto;
  msg.className = `cartao__msg ${tipo}`;
}

$('#form-produto').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const form = evento.target;
  try {
    await api('/api/produtos', {
      method: 'POST',
      body: JSON.stringify({ codigo: $('#produto-codigo').value, nome: $('#produto-nome').value }),
    });
    form.reset();
    mensagemCartao(form, 'Produto cadastrado.', 'ok');
    await carregarProdutos();
  } catch (e) {
    mensagemCartao(form, e.message, 'erro');
  }
});

$('#form-local').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const form = evento.target;
  try {
    await api('/api/locais', { method: 'POST', body: JSON.stringify({ nome: $('#local-nome').value }) });
    form.reset();
    mensagemCartao(form, 'Local cadastrado.', 'ok');
    await carregarLocais();
  } catch (e) {
    mensagemCartao(form, e.message, 'erro');
  }
});

$('#form-entrada').addEventListener('submit', async (evento) => {
  evento.preventDefault();
  const form = evento.target;
  try {
    await api('/api/itens', {
      method: 'POST',
      body: JSON.stringify({
        produto_codigo: $('#entrada-produto').value,
        serial: $('#entrada-serial').value,
        local_id: $('#entrada-local').value ? Number($('#entrada-local').value) : null,
      }),
    });
    form.reset();
    mensagemCartao(form, 'Entrada registrada.', 'ok');
    await carregarItens();
    await carregarHistorico();
  } catch (e) {
    mensagemCartao(form, e.message, 'erro');
  }
});

$('#lista-locais').addEventListener('click', async (evento) => {
  if (!evento.target.classList.contains('btn-excluir-local')) return;
  const { id, nome } = evento.target.dataset;
  if (!confirm(`Excluir o local "${nome}"?`)) return;
  try {
    await api(`/api/locais/${id}`, { method: 'DELETE' });
    mostrarToast('Local excluído.');
    await carregarLocais();
    await carregarItens();
  } catch (e) {
    mostrarToast(e.message, 'erro');
  }
});

$('#btn-limpar-historico').addEventListener('click', async () => {
  if (!confirm('Limpar todo o histórico? Essa ação não pode ser desfeita.')) return;
  await api('/api/historico', { method: 'DELETE' });
  await carregarHistorico();
  mostrarToast('Histórico limpo.');
});

// ---------- Exportar / importar ----------

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

$('#input-importar').addEventListener('change', async (evento) => {
  const arquivo = evento.target.files[0];
  if (!arquivo) return;
  try {
    const texto = await arquivo.text();
    const dados = JSON.parse(texto);
    const resultado = await api('/api/import', { method: 'POST', body: JSON.stringify(dados) });
    mostrarToast(`${resultado.importados} itens importados.`);
    await recarregarTudo();
  } catch (e) {
    mostrarToast('Falha ao importar: ' + e.message, 'erro');
  } finally {
    evento.target.value = '';
  }
});

// ---------- Início ----------

(function preencherManifesto() {
  const hoje = new Date();
  const numero = `${hoje.getFullYear()}${String(hoje.getMonth() + 1).padStart(2, '0')}${String(hoje.getDate()).padStart(2, '0')}`;
  $('#manifesto-num').textContent = numero;
})();

(async function iniciar() {
  try {
    await verificarSessao();
    await recarregarTudo();
  } catch (e) {
    mostrarToast('Erro ao carregar dados: ' + e.message, 'erro');
  }
})();