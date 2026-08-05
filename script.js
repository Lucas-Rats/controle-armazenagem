// ==================== CONFIGURAÇÃO ====================
const SENHA_ADMIN = 'haroldo07'; // Altere aqui a senha do administrador

// ==================== ESTADO ====================
const CHAVE = 'armazenagem_v7';
let predios = [];
let produtos = [];
let historico = [];
let usuarioAtual = null; // 'admin' ou 'cliente'

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
    localStorage.setItem(CHAVE, JSON.stringify({ predios, produtos, historico }));
}

// ==================== AUTENTICAÇÃO ====================
function mostrarLogin() {
    document.getElementById('telaLogin').style.display = 'flex';
    document.getElementById('appPrincipal').style.display = 'none';
    document.getElementById('senhaBox').style.display = 'none';
    document.getElementById('erroSenha').style.display = 'none';
    document.getElementById('senhaAdmin').value = '';
    sessionStorage.removeItem('usuario');
    usuarioAtual = null;
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
    document.getElementById('blocoFormularios').style.display = admin ? 'block' : 'none';
    document.getElementById('btnImportar').style.display = admin ? 'inline-block' : 'none';
    document.getElementById('btnLimparHistorico').style.display = admin ? 'inline-block' : 'none';
    document.getElementById('colAcoes').style.display = admin ? 'table-cell' : 'none';

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
            const id = btn.dataset.id;
            const temProdutos = produtos.some(p => p.predioId === id);
            if (temProdutos) {
                toast('Remova todos os produtos deste local primeiro', 'erro');
                return;
            }
            if (confirm('Excluir este local de armazenagem?')) {
                predios = predios.filter(p => p.id !== id);
                salvarDados();
                atualizarTudo();
                toast('Local removido', 'sucesso');
            }
        });
    });
}

function atualizarSelectsPredios() {
    const opts = predios.map(p => `<option value="${p.id}">${p.nome}</option>`).join('');
    document.getElementById('cadPredio').innerHTML = '<option value="">Selecione...</option>' + opts;
    document.getElementById('filtroPredio').innerHTML = '<option value="">Todos os locais</option>' + opts;
    document.getElementById('transfOrigem').innerHTML = '<option value="">Origem...</option>' + opts;
    document.getElementById('transfDestino').innerHTML = '<option value="">Destino...</option>' + opts;
}

document.getElementById('btnAddPredio').addEventListener('click', () => {
    if (usuarioAtual !== 'admin') return;
    const nome = document.getElementById('novoPredioNome').value.trim();
    if (!nome) return toast('Digite um nome', 'erro');
    if (predios.some(p => p.nome.toLowerCase() === nome.toLowerCase())) {
        return toast('Já existe um local com esse nome', 'erro');
    }
    predios.push({ id: gerarId(), nome });
    salvarDados();
    document.getElementById('novoPredioNome').value = '';
    atualizarTudo();
    toast('Local adicionado', 'sucesso');
});

// ==================== PRODUTOS ====================
function getPredioNome(id) {
    return predios.find(p => p.id === id)?.nome || 'Desconhecido';
}

function atualizarResumo() {
    const container = document.getElementById('cardsResumo');
    const totais = {};
    predios.forEach(p => totais[p.id] = 0);
    produtos.forEach(prod => {
        if (totais[prod.predioId] !== undefined) totais[prod.predioId] += prod.qty;
    });
    const cores = ['#4a90d9', '#e67e22', '#27ae60', '#8e44ad', '#c0392b', '#2980b9'];
    let html = predios.map((p, i) => {
        const cor = cores[i % cores.length];
        return `<div class="card-resumo" style="border-left-color:${cor}">
            <div class="titulo">${p.nome}</div>
            <div class="valor">${totais[p.id] || 0}</div>
            <div class="sub">itens em estoque</div>
        </div>`;
    }).join('');
    html += `<div class="card-resumo total">
        <div class="titulo">Total Geral</div>
        <div class="valor">${Object.values(totais).reduce((a,b)=>a+b,0)}</div>
        <div class="sub">unidades</div>
    </div>`;
    container.innerHTML = html;
}

function atualizarSelectsProdutos() {
    if (usuarioAtual !== 'admin') return;
    const mov = document.getElementById('movSerial');
    const transf = document.getElementById('transfSerial');
    const options = produtos.map(p =>
        `<option value="${p.id}">${p.serial} (${getPredioNome(p.predioId)} - ${p.qty} un.)</option>`
    ).join('');
    const vazio = '<option value="">Selecione...</option>';
    mov.innerHTML = vazio + options;
    transf.innerHTML = vazio + options;
}

function renderizarTabela() {
    const filtroSerial = document.getElementById('filtroSerial').value.trim().toLowerCase();
    const filtroPredio = document.getElementById('filtroPredio').value;
    const tbody = document.getElementById('corpoTabela');
    const admin = usuarioAtual === 'admin';

    let lista = produtos.filter(p => {
        const matchSerial = !filtroSerial || p.serial.toLowerCase().includes(filtroSerial);
        const matchPredio = !filtroPredio || p.predioId === filtroPredio;
        return matchSerial && matchPredio;
    });

    document.getElementById('contagemResultados').textContent = `${lista.length} produto(s)`;
    document.getElementById('colAcoes').style.display = admin ? 'table-cell' : 'none';

    if (lista.length === 0) {
        const colspan = admin ? 4 : 3;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="vazio">Nenhum produto encontrado.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(p => {
        let acoesHtml = '';
        if (admin) {
            acoesHtml = `
                <td class="acoes">
                    <button class="btn-entrada" data-id="${p.id}" data-acao="entrada">Entrada</button>
                    <button class="btn-saida" data-id="${p.id}" data-acao="saida">Saída</button>
                    <button class="btn-remover" data-id="${p.id}" data-acao="remover">Remover</button>
                </td>`;
        }
        return `
            <tr>
                <td><strong>${p.serial}</strong></td>
                <td class="${p.qty <= 5 ? 'qtd-baixa' : ''}">${p.qty}</td>
                <td><span class="badge-predio">${getPredioNome(p.predioId)}</span></td>
                ${acoesHtml}
            </tr>
        `;
    }).join('');

    if (admin) {
        tbody.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const acao = btn.dataset.acao;
                const prod = produtos.find(p => p.id === id);
                if (!prod) return;
                if (acao === 'entrada') {
                    prod.qty += 1;
                    addHistorico(prod.serial, 'entrada', 1, getPredioNome(prod.predioId));
                    salvarDados(); atualizarTudo(); toast(`+1 ${prod.serial}`, 'sucesso');
                } else if (acao === 'saida') {
                    if (prod.qty < 1) return toast('Estoque zerado', 'erro');
                    prod.qty -= 1;
                    addHistorico(prod.serial, 'saida', 1, getPredioNome(prod.predioId));
                    if (prod.qty === 0 && confirm('Produto zerado. Remover?')) {
                        produtos = produtos.filter(p => p.id !== id);
                    }
                    salvarDados(); atualizarTudo(); toast(`-1 ${prod.serial}`, 'sucesso');
                } else if (acao === 'remover') {
                    if (confirm(`Remover "${prod.serial}"?`)) {
                        addHistorico(prod.serial, 'remocao', prod.qty, getPredioNome(prod.predioId));
                        produtos = produtos.filter(p => p.id !== id);
                        salvarDados(); atualizarTudo(); toast('Produto removido', 'sucesso');
                    }
                }
            });
        });
    }
}

// ==================== HISTÓRICO ====================
function addHistorico(serial, tipo, qty, predio) {
    historico.push({ serial, tipo, qty, predio, data: new Date().toLocaleString('pt-BR') });
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
        let tipoClasse = '', tipoTexto = h.tipo;
        if (h.tipo === 'entrada') { tipoClasse = 'tipo-entrada'; tipoTexto = 'ENTRADA'; }
        else if (h.tipo === 'saida') { tipoClasse = 'tipo-saida'; tipoTexto = 'SAÍDA'; }
        else if (h.tipo === 'transferencia') { tipoClasse = 'tipo-transf'; tipoTexto = 'TRANSF.'; }
        else { tipoClasse = 'tipo-saida'; tipoTexto = h.tipo.toUpperCase(); }
        return `<div class="item-historico">
            <span><strong>${h.serial}</strong> — <span class="${tipoClasse}">${tipoTexto}</span> de ${h.qty} un. | ${h.predio}</span>
            <span class="data">${h.data}</span>
        </div>`;
    }).join('');
}

// ==================== OPERAÇÕES (Admin) ====================
document.getElementById('formCadastro').addEventListener('submit', (e) => {
    e.preventDefault();
    if (usuarioAtual !== 'admin') return;
    const serial = document.getElementById('cadSerial').value.trim();
    const qty = parseInt(document.getElementById('cadQty').value, 10);
    const predioId = document.getElementById('cadPredio').value;
    if (!serial || isNaN(qty) || qty < 1 || !predioId) return toast('Preencha todos os campos', 'erro');
    if (produtos.some(p => p.serial.toLowerCase() === serial.toLowerCase() && p.predioId === predioId)) {
        return toast('Este serial já existe neste local', 'erro');
    }
    produtos.push({ id: gerarId(), serial, qty, predioId });
    addHistorico(serial, 'entrada', qty, getPredioNome(predioId));
    salvarDados(); atualizarTudo(); e.target.reset(); toast('Produto cadastrado', 'sucesso');
});

document.getElementById('formMov').addEventListener('submit', (e) => {
    e.preventDefault();
    if (usuarioAtual !== 'admin') return;
    const id = document.getElementById('movSerial').value;
    const tipo = document.getElementById('movTipo').value;
    const qty = parseInt(document.getElementById('movQty').value, 10);
    if (!id || !tipo || isNaN(qty) || qty < 1) return toast('Preencha todos os campos', 'erro');
    const prod = produtos.find(p => p.id === id);
    if (!prod) return toast('Produto não encontrado', 'erro');
    if (tipo === 'saida' && prod.qty < qty) return toast(`Estoque insuficiente (${prod.qty} un.)`, 'erro');
    prod.qty += (tipo === 'entrada' ? qty : -qty);
    addHistorico(prod.serial, tipo, qty, getPredioNome(prod.predioId));
    if (prod.qty === 0 && confirm('Estoque zerado. Remover produto?')) {
        produtos = produtos.filter(p => p.id !== id);
    }
    salvarDados(); atualizarTudo(); e.target.reset(); toast('Movimentação registrada', 'sucesso');
});

document.getElementById('formTransf').addEventListener('submit', (e) => {
    e.preventDefault();
    if (usuarioAtual !== 'admin') return;
    const id = document.getElementById('transfSerial').value;
    const origemId = document.getElementById('transfOrigem').value;
    const destinoId = document.getElementById('transfDestino').value;
    const qty = parseInt(document.getElementById('transfQty').value, 10);
    if (!id || !origemId || !destinoId || isNaN(qty) || qty < 1) return toast('Preencha todos os campos', 'erro');
    if (origemId === destinoId) return toast('Origem e destino iguais', 'erro');
    const prodOrigem = produtos.find(p => p.id === id);
    if (!prodOrigem || prodOrigem.predioId !== origemId || prodOrigem.qty < qty) return toast('Estoque insuficiente na origem', 'erro');
    prodOrigem.qty -= qty;
    if (prodOrigem.qty === 0) produtos = produtos.filter(p => p.id !== id);
    const prodDestino = produtos.find(p => p.serial.toLowerCase() === prodOrigem.serial.toLowerCase() && p.predioId === destinoId);
    if (prodDestino) prodDestino.qty += qty;
    else produtos.push({ id: gerarId(), serial: prodOrigem.serial, qty, predioId: destinoId });
    addHistorico(prodOrigem.serial, 'transferencia', qty, `${getPredioNome(origemId)} → ${getPredioNome(destinoId)}`);
    salvarDados(); atualizarTudo(); e.target.reset(); toast('Transferência concluída', 'sucesso');
});

// ==================== EXPORTAÇÃO / IMPORTAÇÃO ====================
document.getElementById('btnExportar').addEventListener('click', () => {
    const data = JSON.stringify({ predios, produtos, historico }, null, 2);
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
                if (data.predios && data.produtos && data.historico) {
                    if (confirm('Substituir todos os dados?')) {
                        predios = data.predios;
                        produtos = data.produtos;
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
    if (confirm('Limpar todo o histórico?')) {
        historico = [];
        salvarDados();
        renderizarHistorico();
        toast('Histórico limpo', 'sucesso');
    }
});

// ==================== LOGOUT ====================
document.getElementById('btnLogout').addEventListener('click', () => {
    mostrarLogin();
});

// ==================== FILTROS ====================
document.getElementById('filtroSerial').addEventListener('input', renderizarTabela);
document.getElementById('filtroPredio').addEventListener('change', renderizarTabela);

// ==================== DATA ====================
function atualizarData() {
    document.getElementById('dataAtual').textContent = new Date().toLocaleDateString('pt-BR', {
        weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

// ==================== ATUALIZAÇÃO GLOBAL ====================
function atualizarTudo() {
    renderizarPredios();
    atualizarSelectsPredios();
    atualizarSelectsProdutos();
    atualizarResumo();
    renderizarTabela();
    renderizarHistorico();
}

// ==================== INICIALIZAÇÃO ====================
function verificarSessao() {
    const sessao = sessionStorage.getItem('usuario');
    if (sessao === 'admin' || sessao === 'cliente') {
        entrarComo(sessao);
    } else {
        mostrarLogin();
    }
}

// Eventos da tela de login
document.getElementById('btnAdmin').addEventListener('click', () => {
    document.getElementById('senhaBox').style.display = 'flex';
    document.getElementById('erroSenha').style.display = 'none';
    document.getElementById('senhaAdmin').focus();
});

document.getElementById('btnEntrarAdmin').addEventListener('click', () => {
    const senha = document.getElementById('senhaAdmin').value;
    if (senha === SENHA_ADMIN) {
        entrarComo('admin');
    } else {
        document.getElementById('erroSenha').style.display = 'block';
        document.getElementById('senhaAdmin').value = '';
    }
});

document.getElementById('btnCliente').addEventListener('click', () => {
    entrarComo('cliente');
});

document.getElementById('senhaAdmin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnEntrarAdmin').click();
});

document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
    verificarSessao();
});