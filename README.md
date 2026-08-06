# Controle de Armazenagem — Workers + D1

Sistema de controle de estoque com rastreabilidade por número de série.

## Como a quantidade funciona

Não existe um campo "quantidade" gravado em lugar nenhum do banco.

A quantidade de um produto é sempre o resultado de **contar as peças com
serial registrado e status disponível**. Se o sistema diz que tem 47
unidades do código 602000, é porque existem 47 seriais distintos daquele
produto no estoque — cada um com seu local, sua nota de entrada e seu
histórico.

Isso é de propósito. Um campo `quantidade` salvo no produto seria uma
segunda versão da verdade, e uma hora as duas discordam — geralmente no
meio de um inventário, e sem jeito de saber qual está certa. Contando
peças reais, a conta nunca pode divergir do que está no armazém.

## Estrutura de dados

```
produtos       código (part number) + nome comercial
   │            ex: 602000 — Versace
   │
   └── itens   uma linha por PEÇA FÍSICA
                serial único + local + status + nota de entrada/saída
```

Um produto tem N peças. Cada peça tem um serial diferente. A quantidade
do produto é quantas peças ele tem disponíveis.

## Operações

**Recebimento** — escolhe o produto, o local e cola a lista de seriais
(um por linha, ou colados direto do Excel ou de um leitor de código de
barras). O sistema registra cada serial como uma peça, avisa quais foram
recusados por já existirem, e lança uma única linha no histórico com a
quantidade total.

**Expedição** — cola os seriais que estão saindo, opcionalmente com o
número do pedido. Dá baixa em todos de uma vez e mostra quais não foram
encontrados. A baixa é irreversível.

**Transferência** — cola os seriais e escolhe o local de destino. Move
todos de uma vez, mantendo serial e produto.

Todas as três aceitam desde 1 até 500 seriais por operação, e todas
relatam exatamente o que entrou e o que foi recusado — nada falha em
silêncio.

## Regras aplicadas pelo servidor

- Não existem dois seriais iguais disponíveis ao mesmo tempo
- Serial de peça já expedida pode ser reutilizado numa peça nova
- Produto só pode ser excluído se não tiver peças disponíveis
- Local só pode ser excluído se não tiver peças disponíveis
- Baixa é irreversível
- Cliente (sem login) só vê peças disponíveis e só pode exportar
- Histórico guarda as últimas 500 operações

Nada disso depende do navegador: mesmo alterando o JavaScript pelo
DevTools, o servidor recusa a operação.

## Instalação

```bash
npm install
npx wrangler login
npx wrangler d1 create armazenagem-db
```

Cole o `database_id` retornado no `wrangler.jsonc`, depois:

```bash
npm run db:schema
npx wrangler secret put ADMIN_PASSWORD
npx wrangler secret put SESSION_SECRET   # openssl rand -base64 32
npm run deploy
```

## Já tem o sistema rodando?

Se o banco já está em produção com dados, **não rode o schema.sql** — ele
é para instalação nova. Rode a migração, que adiciona as colunas novas
sem tocar em nada do que já existe:

```bash
npx wrangler d1 execute armazenagem-db --remote --file=./migracao-002.sql
```

Ou cole o conteúdo do `migracao-002.sql` no console do D1 pelo painel.
Depois é só dar push — o build automático publica o resto.

## Deploy pelo GitHub

O repositório é conectado pelo Workers Builds (Workers & Pages > Create
application > Import a repository). O `wrangler.jsonc` precisa estar na
raiz da pasta indicada como *Root directory*, ao lado do `package.json`.

Os secrets (`ADMIN_PASSWORD` e `SESSION_SECRET`) são configurados no
painel do Worker, em Settings > Variables and Secrets. Eles nunca vão
para o repositório.

## Backup

O botão **Exportar JSON** baixa produtos, locais, peças e histórico.
Funciona para administrador e para cliente.
