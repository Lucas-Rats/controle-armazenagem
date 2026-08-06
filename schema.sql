-- Sistema de Controle de Armazenagem — schema do banco D1
--
-- Este arquivo é a definição completa e única do banco. Para aplicar:
--   npx wrangler d1 execute armazenagem-db --remote --file=./schema.sql
-- ou cole o conteúdo no console de query do D1 pelo painel.
--
-- Todos os CREATE usam IF NOT EXISTS, então rodar duas vezes não quebra
-- nada — mas também não altera tabelas que já existem. Enquanto o sistema
-- está em testes, mudança de estrutura = derrubar as tabelas e rodar isto
-- de novo (o comando de reset está no README).

CREATE TABLE IF NOT EXISTS locais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produtos (
  codigo TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  ativo INTEGER NOT NULL DEFAULT 1,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cada linha aqui e UMA peca fisica. A quantidade em estoque nunca e
-- guardada em lugar nenhum: ela e sempre o resultado de contar as linhas
-- desta tabela com status 'disponivel'. Guardar um numero separado seria
-- criar uma segunda versao da verdade, que cedo ou tarde discorda da
-- primeira.
CREATE TABLE IF NOT EXISTS itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT NOT NULL,
  produto_codigo TEXT NOT NULL REFERENCES produtos(codigo),
  local_id INTEGER REFERENCES locais(id),
  status TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'baixado')),
  entrada_ref TEXT,
  saida_ref TEXT,   
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  baixado_em TEXT
);

-- So pode existir um serial 'disponivel' por vez. Seriais de itens ja
-- baixados podem repetir (a peca saiu; outra peca igual pode entrar).
CREATE UNIQUE INDEX IF NOT EXISTS idx_itens_serial_disponivel
  ON itens(serial) WHERE status = 'disponivel';
CREATE INDEX IF NOT EXISTS idx_itens_produto ON itens(produto_codigo);
CREATE INDEX IF NOT EXISTS idx_itens_local ON itens(local_id);
CREATE INDEX IF NOT EXISTS idx_itens_status ON itens(status);
CREATE INDEX IF NOT EXISTS idx_itens_entrada_ref ON itens(entrada_ref);
CREATE INDEX IF NOT EXISTS idx_itens_saida_ref ON itens(saida_ref);

-- Uma linha por OPERACAO, nao por peca. Uma entrada de 50 unidades gera
-- um registro com quantidade = 50, nao 50 registros.
CREATE TABLE IF NOT EXISTS historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  produto_codigo TEXT,
  produto_nome TEXT,
  serial TEXT,
  quantidade INTEGER NOT NULL DEFAULT 1,
  referencia TEXT,
  local_origem TEXT,
  local_destino TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_historico_criado ON historico(criado_em);

CREATE TABLE IF NOT EXISTS login_tentativas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_tentativas_ip ON login_tentativas(ip, criado_em);