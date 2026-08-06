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

**Recebimento** — escolhe o produto, o local e informa a lista de seriais,
um por linha. O sistema registra cada serial como uma peça, avisa quais
foram recusados por já existirem, e lança uma única linha no histórico com
a quantidade total.

**Expedição** — cola os seriais que estão saindo, opcionalmente com o
número do pedido. Dá baixa em todos de uma vez e mostra quais não foram
encontrados. A baixa é irreversível.

**Transferência** — cola os seriais e escolhe o local de destino. Move
todos de uma vez, mantendo serial e produto.

Todas as três aceitam desde 1 até 500 seriais por operação, e todas
relatam exatamente o que entrou e o que foi recusado — nada falha em
silêncio.

## Corrigir erros

Erro de digitação não deve virar movimentação falsa. Por isso existe uma
via separada da baixa, e tudo que ela faz aparece no histórico como
**Correção**, não como entrada ou saída.

**Serial digitado errado** — botão Corrigir na linha da peça. Só funciona
com peça disponível: peça já expedida é registro fechado.

**Peça cadastrada por engano** — botão Remover na linha da peça. Existe
para o operador não precisar dar uma baixa falsa, que apareceria como
expedição no relatório do cliente.

**Nome ou código do produto** — botão Corrigir na lista de produtos.
Trocar o nome muda só o cadastro. Trocar o código arrasta junto as peças
e o histórico, porque o código é o identificador que eles apontam, não um
rótulo.

**Nome do local** — botão Corrigir na lista de locais. O histórico das
movimentações antigas mantém o nome que o local tinha na época, que é o
que de fato estava escrito quando a peça se moveu.

## Excluir vs. arquivar

Produto ou local **sem nenhuma peça associada** pode ser excluído de vez.

Assim que uma peça passa por ele, excluir deixa de ser possível: apagar o
registro destruiria a rastreabilidade das peças que já foram expedidas.
Nesse caso a opção é **arquivar** — ele some das listas e dos campos de
seleção, mas continua no histórico, e pode ser reativado a qualquer
momento.

## Regras aplicadas pelo servidor

- Não existem dois seriais iguais disponíveis ao mesmo tempo
- Serial de peça já expedida pode ser reutilizado numa peça nova
- Produto só pode ser excluído se não tiver peças disponíveis
- Local só pode ser excluído se não tiver peças disponíveis
- Baixa é irreversível
- Cliente (sem login) só vê peças disponíveis e só pode exportar
- Histórico guarda todas as operações, sem descartar nada

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

## Recriar o banco (enquanto está em testes)

O `schema.sql` é a única definição do banco. Enquanto o sistema não está
em uso real, mudança de estrutura não usa migração: derruba as tabelas e
roda o schema de novo.

No console de query do D1:

```sql
DROP TABLE IF EXISTS itens;
DROP TABLE IF EXISTS historico;
DROP TABLE IF EXISTS produtos;
DROP TABLE IF EXISTS locais;
DROP TABLE IF EXISTS login_tentativas;
```

Depois cole o conteúdo do `schema.sql` e execute. O `database_id` não
muda, então o `wrangler.jsonc` continua igual e os secrets continuam
valendo.

A ordem importa: `itens` sai primeiro porque aponta para `produtos` e
`locais`.

**Quando entrar em produção isso muda.** A partir do momento em que
existirem dados reais, alterações de estrutura passam a exigir
`ALTER TABLE` num arquivo de migração — derrubar tabela deixa de ser uma
opção.

## Deploy pelo GitHub

O repositório é conectado pelo Workers Builds (Workers & Pages > Create
application > Import a repository). O `wrangler.jsonc` precisa estar na
raiz da pasta indicada como *Root directory*, ao lado do `package.json`.

Os secrets (`ADMIN_PASSWORD` e `SESSION_SECRET`) são configurados no
painel do Worker, em Settings > Variables and Secrets. Eles nunca vão
para o repositório.

## Relatórios e backup

São coisas diferentes e ficam em botões diferentes:

**Planilha: resumo** — CSV com uma linha por produto e local, com a
quantidade. É o relatório gerencial: quanto tem de cada coisa e onde.

**Planilha: peça a peça** — CSV com uma linha por peça: serial, produto,
local, status, nota de entrada e pedido de saída. É o relatório de
rastreio. Para o administrador, respeita o filtro de status escolhido na
tela (disponíveis ou já expedidos).

Os dois abrem direto no Excel, com acentuação correta e colunas
separadas — o arquivo sai com BOM UTF-8 e ponto e vírgula, que é o que o
Excel em português espera.

**Imprimir / PDF** — usa a impressão do navegador. Em "Destino", escolha
"Salvar como PDF". Serve para anexar em e-mail ou imprimir e assinar; a
folha sai sem botões, formulários nem filtros.

**Backup** — arquivo JSON com tudo. Não é relatório: é o formato que o
botão **Restaurar** consegue ler de volta. Guarde periodicamente.