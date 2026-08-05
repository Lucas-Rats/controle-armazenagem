// ==================== CONFIGURAÇÃO ====================
const SENHA_ADMIN = 'admin123'; // Altere aqui se desejar

// ==================== ESTADO ====================
const CHAVE = 'armazenagem_v8';
let predios = [];           // { id, nome }
let codigos = [];          // { id, codigo }
let itens = [];            // { id, serial, codigoId, predioId, status: 'disponivel' | 'baixado' }
let historico = [];        // { serial, tipo, predioOrigem, predioDestino, data }

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
            codigos = data.codigos || [];
            itens = data.itens || [];
            historico = data.historico || [];
        }
    } catch (e) {}
    // Dados padrão
    if (predios.length === 0) {
        predios = [
            { id: gerarId(), nome: 'Prédio 1' },
            { id: gerarId(), nome: 'Prédio 2' },
            { id: gerarId(), nome: 'Prédio 3' }
        ];
    }
}

function salvarDados() {
    localStorage.setItem(CHAVE, JSON.stringify({ predios, codigos, itens, historico }));
}

// ==================== AUTENTICAÇÃO ====================
let usuarioAtual = null;
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
    document.getElementById('blocoProdutosBase').style.display = admin ? 'block' : 'none';
    document.getElementById('blocoFormularios').style.display = admin ? 'block' : 'none';
    document.getElementById('btnImportar').style.display = admin ? 'inline-block' : 'none';
    document.getElementById('btnLimparHistorico').style.display = admin ? 'inline-block' : 'none';
    document.getElementById('colAcoes').style.display = admin ? 'table-cell' : 'none';
    document.getElementById('nivelAcesso').textContent = admin ? 'Admin' : 'Cliente';
    document.getElementById('nivelAcesso').style.background = admin ? '#0d904f' : '#1a73e8';
    // Filtro de status: cliente vê apenas disponíveis
    document.getElementById('filtroStatus').style.display = admin ? 'inline-block' : 'none';
    if (!admin) document.getElementById('filtroStatus').value = 'disponivel';
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

// ==================== CÓDIGOS DE PRODUTO ====================
function renderizarCodigos() {
    const lista = document.getElementById('listaCodigos');
    if (usuarioAtual !== 'admin') return;
    lista.innerHTML = codigos.map(c => `
        <li style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid #eee;">
            <span>${c.codigo}</span>
            <button class="btn-remover excluir-codigo" data-id="${c.id}" style="margin-left:10px;">Excluir</button>
        </li>
    `).join('');
    document.querySelectorAll('.excluir-codigo').forEach(btn => {
        btn.addEventListener('click', () => {
            if (itens.some(i => i.codigoId === btn.dataset.id && i.status === 'disponivel')) {
                toast('Existem itens ativos desse código. Dê baixa antes.', 'erro');
                return;
            }
            if (confirm('Excluir código?')) {
                codigos = codigos.filter(c => c.id !== btn.dataset.id);
                salvarDados();
                atualizarTudo();
                toast('Código removido', 'sucesso');
            }
        });
    });
}
document.getElementById('btnAddCodigo').addEventListener('click', () => {
    if (usuarioAtual !== 'admin') return;
    const cod = document.getElementById('novoCodigo').value.trim().toUpperCase();
    if (!cod) return toast('Digite o código', 'erro');
    if (codigos.some(c => c.codigo === cod)) return toast('Código já existe', 'erro');
    codigos.push({ id: gerarId(), codigo: cod });
    salvarDados();
    document.getElementById('novoCodigo').value = '';
    atualizarTudo();
    toast('Código adicionado', 'sucesso');
});

function getCodigoNome(id) {
    return codigos.find(c => c.id === id)?.codigo || '???';
}
function getPredioNome(id) {
    return predios.find(p => p.id === id)?.nome || '???';
}

// ==================== ITENS (SERIAL) ====================
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

    const optsCodigos = codigos.map(c => `<option value="${c.id}">${c.codigo}</option>`).join('');
    document.getElementById('cadCodigo').innerHTML = '<option value="">Selecione...</option>' + optsCodigos;
}

function renderizarTabela() {
    const filtroSerial = document.getElementById('filtroSerial').value.trim().toLowerCase();
    const filtroPredio = document.getElementById('filtroPredio').value;
    const filtroStatus = document.getElementById('filtroStatus').value;
    const admin = usuarioAtual === 'admin';
    const tbody = document.getElementById('corpoTabela');

    let lista = itens.filter(i => {
        if (!admin && i.status !== 'disponivel') return false;
        if (admin && filtroStatus && i.status !== filtroStatus) return false;
        if (!admin && i.status !== 'disponivel') return false;
        const matchSerial = !filtroSerial || i.serial.toLowerCase().includes(filtroSerial);
        const matchPredio = !filtroPredio || i.predioId === filtroPredio;
        return matchSerial && matchPredio;
    });

    document.getElementById('contagemResultados').textContent = `${lista.length} item(ns)`;
    document.getElementById('colAcoes').style.display = admin ? 'table-cell' : 'none';

    if (lista.length === 0) {
        const colspan = admin ? 4 : 3;
        tbody.innerHTML = `<tr><td colspan="${colspan}" class="vazio">Nenhum item encontrado.</td></tr>`;
        return;
    }

    tbody.innerHTML = lista.map(i => {
        const statusClass = i.status === 'disponivel' ? 'status-disponivel' : 'status-baixado';
        let acoesHtml = '';
        if (admin && i.status === 'disponivel') {
            acoesHtml = `
                <td class="acoes">
                    <button class="btn-baixa" data-id="${i.id}" data-acao="baixa">Baixa</button>
                    <button class="btn-transferir" data-id="${i.id}" data-acao="transferir">Transferir</button>
                </td>`;
        } else if (admin) {
            acoesHtml = '<td></td>';
        }
        return `
            <tr>
                <td class="${statusClass}">${i.serial}</td>
                <td>${getCodigoNome(i.codigoId)}</td>
                <td><span class="badge-predio">${getPredioNome(i.predioId)}</span></td>
                ${acoesHtml}
            </tr>
        `;
    }).join('');

    if (admin) {
        tbody.querySelectorAll('button').forEach(btn => {
            btn.addEventListener('click', () => {
                const id = btn.dataset.id;
                const acao = btn.dataset.acao;
                const item = itens.find(i => i.id === id);
                if (!item) return;
                if (acao === 'baixa') {
                    if (confirm(`Dar baixa definitiva no serial "${item.serial}"?`)) {
                        item.status = 'baixado';
                        addHistorico(item.serial, 'baixa', getPredioNome(item.predioId), '');
                        salvarDados();
                        atualizarTudo();
                        toast('Baixa registrada', 'sucesso');
                    }
                } else if (acao === 'transferir') {
                    // Preencher formulário de transferência e focar
                    document.getElementById('transfSerial').value = id;
                    document.getElementById('transfOrigem').value = item.predioId;
                    document.getElementById('transfDestino').value = '';
                    document.getElementById('transfDestino').focus();
                    toast('Selecione o destino e clique Transferir', 'sucesso');
                }
            });
        });
    }
}

// ==================== HISTÓRICO ====================
function addHistorico(serial, tipo, predioOrigem, predioDestino) {
    historico.push({
        serial,
        tipo,
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
        if (h.tipo === 'entrada') { tipoClasse = 'tipo-entrada'; descricao = `ENTRADA em ${h.predioOrigem}`; }
        else if (h.tipo === 'baixa') { tipoClasse = 'tipo-baixa'; descricao = `BAIXA de ${h.predioOrigem}`; }
        else if (h.tipo === 'transferencia') { tipoClasse = 'tipo-transf'; descricao = `TRANSF. ${h.predioOrigem} → ${h.predioDestino}`; }
        return `<div class="item-historico">
            <span><strong>${h.serial}</strong> — <span class="${tipoClasse}">${descricao}</span></span>
            <span class="data">${h.data}</span>
        </div>`;
    }).join('');
}

// ==================== OPERAÇÕES ====================
document.getElementById('formCadastroSerial').addEventListener('submit', (e) => {
    e.preventDefault();
    if (usuarioAtual !== 'admin') return;
    const codigoId = document.getElementById('cadCodigo').value;
    const serial = document.getElementById('cadSerial').value.trim().toUpperCase();
    const predioId = document.getElementById('cadPredio').value;
    if (!codigoId || !serial || !predioId) return toast('Preencha todos os campos', 'erro');
    if (itens.some(i => i.serial === serial && i.status === 'disponivel')) {
        return toast('Já existe um item disponível com esse serial', 'erro');
    }
    itens.push({
        id: gerarId(),
        serial,
        codigoId,
        predioId,
        status: 'disponivel'
    });
    addHistorico(serial, 'entrada', getPredioNome(predioId), '');
    salvarDados();
    atualizarTudo();
    e.target.reset();
    toast('Serial cadastrado', 'sucesso');
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
    item.predioId = destinoId;
    addHistorico(item.serial, 'transferencia', getPredioNome(origemId), getPredioNome(destinoId));
    salvarDados();
    atualizarTudo();
    e.target.reset();
    toast('Transferência concluída', 'sucesso');
});

// ==================== EXPORTAÇÃO/IMPORTAÇÃO ====================
document.getElementById('btnExportar').addEventListener('click', () => {
    const data = JSON.stringify({ predios, codigos, itens, historico }, null, 2);
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
                if (data.predios && data.codigos && data.itens && data.historico) {
                    if (confirm('Substituir todos os dados?')) {
                        predios = data.predios;
                        codigos = data.codigos;
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

// Logout, filtros, data...
document.getElementById('btnLogout').addEventListener('click', mostrarLogin);
document.getElementById('filtroSerial').addEventListener('input', renderizarTabela);
document.getElementById('filtroPredio').addEventListener('change', renderizarTabela);
document.getElementById('filtroStatus').addEventListener('change', renderizarTabela);

function atualizarData() {
    document.getElementById('dataAtual').textContent = new Date().toLocaleDateString('pt-BR', {
        weekday: 'short', day: '2-digit', month: '2-digit', year: 'numeric'
    });
}

function atualizarTudo() {
    renderizarPredios();
    renderizarCodigos();
    atualizarSelects();
    atualizarResumo();
    renderizarTabela();
    renderizarHistorico();
}

// Inicialização
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
document.getElementById('btnEntrarAdmin').addEventListener('click', () => {
    if (document.getElementById('senhaAdmin').value === SENHA_ADMIN) entrarComo('admin');
    else {
        document.getElementById('erroSenha').style.display = 'block';
        document.getElementById('senhaAdmin').value = '';
    }
});
document.getElementById('btnCliente').addEventListener('click', () => entrarComo('cliente'));
document.getElementById('senhaAdmin').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('btnEntrarAdmin').click();
});
document.addEventListener('DOMContentLoaded', () => {
    carregarDados();
    verificarSessao();
});