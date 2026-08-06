-- Sistema de Controle de Armazenagem — schema do banco D1
-- Rode com: wrangler d1 execute armazenagem-db --remote --file=./schema.sql

CREATE TABLE IF NOT EXISTS locais (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  nome TEXT NOT NULL UNIQUE COLLATE NOCASE,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS produtos (
  codigo TEXT PRIMARY KEY,
  nome TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS itens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  serial TEXT NOT NULL,
  produto_codigo TEXT NOT NULL REFERENCES produtos(codigo),
  local_id INTEGER REFERENCES locais(id),
  status TEXT NOT NULL DEFAULT 'disponivel' CHECK (status IN ('disponivel', 'baixado')),
  criado_em TEXT NOT NULL DEFAULT (datetime('now')),
  baixado_em TEXT
);

-- Só pode existir um serial "disponivel" por vez (itens baixados podem repetir o serial)
CREATE UNIQUE INDEX IF NOT EXISTS idx_itens_serial_disponivel
  ON itens(serial) WHERE status = 'disponivel';
CREATE INDEX IF NOT EXISTS idx_itens_produto ON itens(produto_codigo);
CREATE INDEX IF NOT EXISTS idx_itens_local ON itens(local_id);
CREATE INDEX IF NOT EXISTS idx_itens_status ON itens(status);

CREATE TABLE IF NOT EXISTS historico (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tipo TEXT NOT NULL,
  produto_codigo TEXT,
  produto_nome TEXT,
  serial TEXT,
  local_origem TEXT,
  local_destino TEXT,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_historico_criado ON historico(criado_em);

-- Controle de tentativas de login (proteção contra força bruta)
CREATE TABLE IF NOT EXISTS login_tentativas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ip TEXT NOT NULL,
  criado_em TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_login_tentativas_ip ON login_tentativas(ip, criado_em);