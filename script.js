const SALT = 'armazem2024';
const HASH_CORRETO = '73fdd166cd3efe591527028265ded0ba1b40b16d277ffb09db95b6c9701c4287';

// ==================== ESTADO ====================
const CHAVE = 'armazenagem_v10';
let predios = [];      // { id, nome }
let produtos = [];     // { id, codigo, nome }
let itens = [];        // { id, serial, produtoId, predioId, status: 'disponivel' | 'baixado' }
let historico = [];    // { tipo, produtoCodigo, produtoNome, serial, predioOrigem, predioDestino, data }

function gerarId() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 4);
}

// ==================== PERSISTÊNCIA ====================
function carregarDados() {
    try {
        const raw = localStorage.getItem(CHAVE);
        if (raw) {
            const data = JSON.parse(raw);
            predios = data.predios || [];
            produtos = data.produtos || [];
            itens = data.itens || [];
            historico = data.historico || [];
        }
    } catch (e) {}
    if (predios.length === 0) {
        predios = [
            { id: gerarId(), nome: 'Prédio 1' },
            { id: gerarId(), nome: 'Prédio 2' },
            { id: gerarId(), nome: 'Prédio 3' }
        ];
    }
}

function salvarDados() {
    localStorage.setItem(CHAVE, JSON.stringify({ predios, produtos, itens, historico }));
}

// ==================== AUTENTICAÇÃO COM HASH + SALT ====================
let usuarioAtual = null;

async function verificarSenha(senhaDigitada) {
    const encoder = new TextEncoder();
    const data = encoder.encode(SALT + senhaDigitada);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    return hashHex === HASH_CORRETO;
}

function mostrarLogin() {
    document.getElementById('telaLogin').style.display = 'flex';
    document.getElementById('appPrincipal').style.display = 'none';
    document.getElementById('senhaBox').style.display = 'none';
    document.getElementById('erroSenha').style.display = 'none';
    document.getElementById('senhaAdmin').value = '';
    sessionStorage.removeItem('usuario');
    usuarioAtual = null;
}

async function tentarLoginAdmin() {
    const senha = document.getElementById('senhaAdmin').value;
    if (await verificarSenha(senha)) {
        entrarComo('admin');
    } else {
        document.getElementById('erroSenha').style.display = 'block';
        document.getElementById('senhaAdmin').value = '';
    }
}

function entrarComo(tipo) {
    usuarioAtual = tipo;
    sessionStorage.setItem('usuario', tipo);
    document.getElementById('telaLogin').style.display = 'none';
    document.getElementById('appPrincipal').style.display = 'block';
    aplicarPermissoes();
    atualizarTudo();
    atualizarData();
}

function aplicarPermissoes() {
    const admin = usuarioAtual === 'admin';
    document.getElementById('blocoGerenciarPredios').style.display = admin ? 'block' : 'none';
    document.getElementById('blocoProdutosBase').style.display = admin ? 'block' : 'none';
    document.getElementById('blocoFormularios').style.display = admin ? 'block' : 'none';
    document.getElementById('btnImportar').style.display = admin ? 'inline-block' : 'none';
    document.getElementById('btnLimparHistorico').style.display = admin ? 'inline-block' : 'none';
    document.getElementById('colAcoes').style.display = admin ? 'table-cell' : 'none';
    document.getElementById('filtroStatus').style.display = admin ? 'inline-block' : 'none';
    if (!admin) document.getElementById('filtroStatus').value = 'disponivel';
    document.getElementById('nivelAcesso').textContent = admin ? 'Admin' : 'Cliente';
    document.getElementById('nivelAcesso').style.background = admin ? '#0d904f' : '#1a73e8';
}

// ==================== TOAST ====================
function toast(msg, tipo = '') {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.className = `toast ${tipo} mostrar`;
    clearTimeout(el._timer);
    el._timer = setTimeout(() => el.classList.remove('mostrar'), 2500);
}

// ==================== PRÉDIOS ====================
function renderizarPredios() {
    const lista = document.getElementById('listaPredios');
    if (usuarioAtual !== 'admin') return;
    lista.innerHTML = predios.map(p => `
        <li style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee;">
            <input type="text" value="${p.nome}" data-id="${p.id}" class="edit-predio" style="border:none;background:transparent;flex:1;font-size:0.9rem;">
            <button class="btn-remover excluir-predio" data-id="${p.id}" style="margin-left:10px;">Excluir</button>
        </li>
    `).join('');
    document.querySelectorAll('.edit-predio').forEach(input => {
        input.addEventListener('change', () => {
            const predio = predios.find(p => p.id === input.dataset.id);
            const novo = input.value.trim();
            if (novo && novo !== predio.nome) {
                predio.nome = novo;
                salvarDados();
                atualizarTudo();
                toast('Nome atualizado', 'sucesso');
            }
        });
    });
    document.querySelectorAll('.excluir-predio').forEach(btn => {
        btn.addEventListener('click', () => {
            if (itens.some(i => i.predioId === btn.dataset.id && i.status === 'disponivel')) {
                toast('Esvazie o local antes de excluí-lo', 'erro');
                return;
            }
            if (confirm('Excluir local?')) {
                predios = predios.filter(p => p.id !== btn.dataset.id);
                salvarDados();
                atualizarTudo();
                toast('Local removido', 'sucesso');
            }
        });
    });
}
document.getElementById('btnAddPredio').addEventListener('click', () => {
    if (usuarioAtual !== 'admin') return;
    const nome = document.getElementById('novoPredioNome').value.trim();
    if (!nome) return toast('Digite um nome', 'erro');
    if (predios.some(p => p.nome.toLowerCase() === nome.toLowerCase())) return toast('Já existe', 'erro');
    predios.push({ id: gerarId(), nome });
    salvarDados();
    document.getElementById('novoPredioNome').value = '';
    atualizarTudo();
    toast('Local adicionado', 'sucesso');
});

// ==================== PRODUTOS ====================
function renderizarProdutos() {
    const lista = document.getElementById('listaProdutos');
    if (usuarioAtual !== 'admin') return;
    lista.innerHTML = produtos.map(p => `
        <li style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee;">
            <span><strong>${p.codigo}</strong> - ${p.nome}</span>
            <button class="btn-remover excluir-produto" data-id="${p.id}" style="margin-left:10px;">Excluir</button>
        </li>
    `).join('');
    document.querySelectorAll('.excluir-produto').forEach(btn => {
        btn.addEventListener('click', () => {
            if (itens.some(i => i.produtoId === btn.dataset.id && i.status === 'disponivel')) {
                toast('Existem itens ativos desse produto. Dê baixa antes.', 'erro');
                return;
            }
            if (confirm('Excluir produto?')) {
                produtos = produtos.filter(p => p.id !== btn.dataset.id);
                salvarDados();
                atualizarTudo();
                toast('Produto removido', 'sucesso');
            }
        });
    });
}
document.getElementById('btnAddProduto').addEventListener('click', () => {
    if (usuarioAtual !== 'admin') return;
    const codigo = document.getElementById('novoCodigoProduto').value.trim().toUpperCase();
    const nome = document.getElementById('novoNomeProduto').value.trim();
    if (!codigo || !nome) return toast('Preencha código e nome', 'erro');
    if (produtos.some(p => p.codigo === codigo)) return toast('Código já existe', 'erro');
    produtos.push({ id: gerarId(), codigo, nome });
    salvarDados();
    document.getElementById('novoCodigoProduto').value = '';
    document.getElementById('novoNomeProduto').value = '';
    atualizarTudo();
    toast('Produto adicionado', 'sucesso');
});

function getProdutoInfo(produtoId) {
    const p = produtos.find(prod => prod.id === produtoId);
    return p || { codigo: '???', nome: '???' };
}
function getPredioNome(id) {
    return predios.find(p => p.id === id)?.nome || '???';
}

// ==================== ITENS (SERIAIS) ====================
function atualizarResumo() {
    const container = document.getElementById('cardsResumo');
    const totais = {};
    predios.forEach(p => totais[p.id] = 0);
    itens.filter(i => i.status === 'disponivel').forEach(i => {
        if (totais[i.predioId] !== undefined) totais[i.predioId]++;
    });
    const cores = ['#4a90d9', '#e67e22', '#27ae60', '#8e44ad', '#c0392b', '#2980b9'];
    let html = predios.map((p, i) => {
        const cor = cores[i % cores.length];
        return `<div class="card-resumo" style="border-left-color:${cor}">
            <div class="titulo">${p.nome}</div>
            <div class="valor">${totais[p.id] || 0}</div>
            <div class="sub">itens disponíveis</div>
        </div>`;
    }).join('');
    const total = Object.values(totais).reduce((a,b)=>a+b,0);
    html += `<div class="card-resumo total">
        <div class="titulo">Total Geral</div>
        <div class="valor">${total}</div>
        <div class="sub">unidades em estoque</div>
    </div>`;
    container.innerHTML = html;
}

function atualizarSelects() {
    const optsPredios = predios.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
    document.getElementById('cadPredio').innerHTML = '<option value="">Selecione...</option>' + optsPredios;
    document.getElementById('filtroPredio').innerHTML = '<option value="">Todos os locais</option>' + optsPredios;
    document.getElementById('transfOrigem').innerHTML = '<option value="">Origem...</option>' + optsPredios;
    document.getElementById('transfDestino').innerHTML = '<option value="">Destino...</option>' + optsPredios;

    const optsProdutos = produtos.map(p => `<option value="${p.id}">${p.codigo} - ${p.nome}</option>`).join('');
    document.getElementById('cadProduto').innerHTML = '<option value="">Selecione...</option>' + optsProdutos;

    // Preencher select de serial para transferência (apenas disponíveis)
    const seriaisDisponiveis = itens.filter(i => i.status === 'disponivel');
    const optsSeriais = seriaisDisponiveis.map(i => {
        const prod = getProdutoInfo(i.produtoId);
        return `<option value="${i.id}">${i.serial} (${prod.codigo} - ${getPredioNome(i.predioId)})</option>`;
    }).join('');
    document.getElementById('transfSerial').innerHTML = '<option value="">Selecione...</option>' + optsSeriais;
}

function renderizarTabela() {
    const termoBusca = document.getElementById('filtroGeral').value.trim().toLowerCase();
    const filtroPredio = document.getElementById('filtroPredio').value;
    const filtroStatus = document.getElementById('filtroStatus').value;
    const admin = usuarioAtual === 'admin';
    const tbody = document.getElementById('corpoTabela');

    let lista = itens.filter(i => {
        if (!admin && i.status !== 'disponivel') return false;
        if (admin && filtroStatus && i.status !== filtroStatus) return false;
        const matchPredio = !filtroPredio || i.predioId === filtroPredio;
        // Busca por código, nome do produto ou serial
        let matchTermo = true;
        if (termoBusca) {
            const prod = getProdutoInfo(i.produtoId);
            matchTermo = prod.codigo.toLowerCase().includes(termoBusca) ||
                        prod.nome.toLowerCase().includes(termoBusca) ||
                        i.serial.toLowerCase().includes(termoBusca);
        }
        return matchPredio && matchTermo;
    });

    document.getElementById('contagemResultados').textContent = `${lista.length} item(ns)`;
    document.getElementById('colAcoes').style.display = admin ? 'table-cell' : 'none';

    if (lista.length === 0) {
        const colspan = admin ? 5 : 4;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="vazio">Nenhum item encontrado.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(i => {
        const prod = getProdutoInfo(i.produtoId);
        const statusClass = i.status === 'disponivel' ? 'status-disponivel' : 'status-baixado';
        let acoesHtml = '';
        if (admin && i.status === 'disponivel') {
            acoesHtml = `
                <td class="acoes">
                    <button class="btn-baixa" data-id="${i.id}">Baixa</button>
                    <button class="btn-transferir" data-id="${i.id}">Transferir</button>
                </td>`;
        } else if (admin) {
            acoesHtml = '<td></td>';
        }
        return `
            <tr>
                <td>${prod.codigo}</td>
                <td>${prod.nome}</td>
                <td class="${statusClass}">${i.serial}</td>
                <td><span class="badge-predio">${getPredioNome(i.predioId)}</span></td>
                ${acoesHtml}
            </tr>
        `;
    }).join('');

    if (admin) {
        tbody.querySelectorAll('.btn-baixa').forEach(btn => {
            btn.addEventListener('click', () => darBaixa(btn.dataset.id));
        });
        tbody.querySelectorAll('.btn-transferir').forEach(btn => {
            btn.addEventListener('click', () => prepararTransferencia(btn.dataset.id));
        });
    }
}

function darBaixa(id) {
    const item = itens.find(i => i.id === id);
    if (!item || item.status !== 'disponivel') return;
    const prod = getProdutoInfo(item.produtoId);
    if (confirm(`Dar baixa definitiva no serial "${item.serial}" (${prod.codigo} - ${prod.nome})?`)) {
        item.status = 'baixado';
        addHistorico('baixa', prod.codigo, prod.nome, item.serial, getPredioNome(item.predioId), '');
        salvarDados();
        atualizarTudo();
        toast('Baixa registrada', 'sucesso');
    }
}

function prepararTransferencia(id) {
    const item = itens.find(i => i.id === id);
    if (!item || item.status !== 'disponivel') return;
    document.getElementById('transfSerial').value = id;
    document.getElementById('transfOrigem').value = item.predioId;
    document.getElementById('transfDestino').value = '';
    document.getElementById('transfDestino').focus();
    toast('Selecione o destino e clique Transferir', 'sucesso');
}

// ==================== HISTÓRICO ====================
function addHistorico(tipo, produtoCodigo, produtoNome, serial, predioOrigem, predioDestino) {
    historico.push({
        tipo,
        produtoCodigo,
        produtoNome,
        serial,
        predioOrigem,
        predioDestino,
        data: new Date().toLocaleString('pt-BR')
    });
    if (historico.length > 500) historico = historico.slice(-500);
}

function renderizarHistorico() {
    const container = document.getElementById('listaHistorico');
    if (historico.length === 0) {
        container.innerHTML = '<div class="vazio">Nenhuma movimentação.</div>';
        return;
    }
    const recentes = historico.slice(-40).reverse();
    container.innerHTML = recentes.map(h => {
        let tipoClasse = '', descricao = '';
        if (h.tipo === 'entrada') { tipoClasse = 'tipo-entrada'; descricao = `ENTRADA de ${h.serial} (${h.produtoCodigo}) em ${h.predioOrigem}`; }
        else if (h.tipo === 'baixa') { tipoClasse = 'tipo-baixa'; descricao = `BAIXA de ${h.serial} (${h.produtoCodigo}) de ${h.predioOrigem}`; }
        else if (h.tipo === 'transferencia') { tipoClasse = 'tipo-transf'; descricao = `TRANSF. de ${h.serial} de ${h.predioOrigem} → ${h.predioDestino}`; }
        return `<div class="item-historico">
            <span>${descricao}</span>
            <span class="data">${h.data}</span>
        </div>`;
    }).join('');
}

// ==================== OPERAÇÕES ====================
document.getElementById('formCadastroSerial').addEventListener('submit', (e) => {
    e.preventDefault();
    if (usuarioAtual !== 'admin') return;
    const produtoId = document.getElementById('cadProduto').value;
    const serial = document.getElementById('cadSerial').value.trim().toUpperCase();
    const predioId = document.getElementById('cadPredio').value;
    if (!produtoId || !serial || !predioId) return toast('Preencha todos os campos', 'erro');
    if (itens.some(i => i.serial === serial && i.status === 'disponivel')) {
        return toast('Já existe um item disponível com esse serial', 'erro');
    }
    itens.push({ id: gerarId(), serial, produtoId, predioId, status: 'disponivel' });
    const prod = getProdutoInfo(produtoId);
    addHistorico('entrada', prod.codigo, prod.nome, serial, getPredioNome(predioId), '');
    salvarDados();
    atualizarTudo();
    e.target.reset();
    toast('Serial cadastrado e entrada registrada', 'sucesso');
});

document.getElementById('formTransf').addEventListener('submit', (e) => {
    e.preventDefault();
    if (usuarioAtual !== 'admin') return;
    const serialId = document.getElementById('transfSerial').value;
    const origemId = document.getElementById('transfOrigem').value;
    const destinoId = document.getElementById('transfDestino').value;
    if (!serialId || !origemId || !destinoId) return toast('Preencha todos os campos', 'erro');
    if (origemId === destinoId) return toast('Origem e destino iguais', 'erro');
    const item = itens.find(i => i.id === serialId);
    if (!item || item.predioId !== origemId || item.status !== 'disponivel') {
        return toast('Item não encontrado na origem', 'erro');
    }
    const origemNome = getPredioNome(origemId);
    const destinoNome = getPredioNome(destinoId);
    item.predioId = destinoId;
    const prod = getProdutoInfo(item.produtoId);
    addHistorico('transferencia', prod.codigo, prod.nome, item.serial, origemNome, destinoNome);
    salvarDados();
    atualizarTudo();
    e.target.reset();
    toast('Transferência concluída', 'sucesso');
});

// ==================== EXPORTAÇÃO / IMPORTAÇÃO ====================
document.getElementById('btnExportar').addEventListener('click', () => {
    const data = JSON.stringify({ predios, produtos, itens, historico }, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'armazenagem_backup.json';
    a.click();
    toast('Dados exportados', 'sucesso');
});

document.getElementById('btnImportar').addEventListener('click', () => {
    if (usuarioAtual !== 'admin') return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (ev) => {
        const file = ev.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const data = JSON.parse(e.target.result);
                if (data.predios && data.produtos && data.itens && data.historico) {
                    if (confirm('Substituir todos os dados?')) {
                        predios = data.predios;
                        produtos = data.produtos;
                        itens = data.itens;
                        historico = data.historico;
                        salvarDados();
                        atualizarTudo();
                        toast('Dados importados', 'sucesso');
                    }
                } else toast('Arquivo inválido', 'erro');
            } catch (ex) { toast('Erro ao ler arquivo', 'erro'); }
        };
        reader.readAsText(file);
    };
    input.click();
});

document.getElementById('btnLimparHistorico').addEventListener('click', () => {
    if (usuarioAtual !== 'admin') return;
    if (confirm('Limpar histórico?')) {
        historico = [];
        salvarDados();
        renderizarHistorico();
        toast('Histórico limpo', 'sucesso');
    }
});

// ==================== LOGOUT, FILTROS, DATA ====================
document.getElementById('btnLogout').addEventListener('click', mostrarLogin);
document.getElementById('filtroGeral').addEventListener('input', renderizarTabela);
document.getElementById('filtroPredio').addEventListener('change', renderizarTabela);
document.getElementById('filtroStatus').addEventListener('change', renderizarTabela);

function atualizarData() {
    document.getElementById('dataAtual').textContent = new Date().toLocaleDateString('pt-BR', {
        weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

function atualizarTudo() {
    renderizarPredios();
    renderizarProdutos();
    atualizarSelects();
    atualizarResumo();
    renderizarTabela();
    renderizarHistorico();
}

// ==================== INICIALIZAÇÃO ====================
function verificarSessao() {
    const sessao = sessionStorage.getItem('usuario');
    if (sessao === 'admin' || sessao === 'cliente') entrarComo(sessao);
    else mostrarLogin();
}

document.getElementById('btnAdmin').addEventListener('click', () => {
    document.getElementById('senhaBox').style.display = 'flex';
    document.getElementById('erroSenha').style.display = 'none';
    document.getElementById('senhaAdmin').focus();
});

document.getElementById('btnEntrarAdmin').addEventListener('click', tentarLoginAdmin);

document.getElementById('btnCliente').addEventListener('click', () => entrarComo('cliente'));

document.getElementById('senhaAdmin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') tentarLoginAdmin();
});

document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
    verificarSessao();
});