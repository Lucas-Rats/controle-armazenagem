-- Migração 002 — quantidade e referências de documento
-- Use ESTE arquivo se o banco já está em produção com dados.
-- Instalação nova usa o schema.sql direto.
--
-- Rodar com:
--   npx wrangler d1 execute armazenagem-db --remote --file=./migracao-002.sql
--
-- Nenhum dado existente é apagado ou alterado. As colunas novas nascem
-- vazias nos registros antigos, o que é o comportamento correto: itens
-- que entraram antes disso realmente não têm nota fiscal registrada.

ALTER TABLE itens ADD COLUMN entrada_ref TEXT;
ALTER TABLE itens ADD COLUMN saida_ref TEXT;

CREATE INDEX IF NOT EXISTS idx_itens_entrada_ref ON itens(entrada_ref);
CREATE INDEX IF NOT EXISTS idx_itens_saida_ref ON itens(saida_ref);

ALTER TABLE historico ADD COLUMN quantidade INTEGER NOT NULL DEFAULT 1;
ALTER TABLE historico ADD COLUMN referencia TEXT;
