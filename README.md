# MacApp - Gestão de Lojas de Celulares

Aplicação web para gestão de lojas de celulares, com vendas, estoque e gestão de clientes.

## Tech Stack

- **Next.js 15** — Framework React full-stack (App Router)
- **TypeScript** — Tipagem forte
- **Tailwind CSS v4** — Estilização
- **Clerk** — Autenticação (login, signup, user button)
- **Supabase (Postgres)** — Banco de produção, via `@supabase/supabase-js` + migrações SQL
- **Vercel** — Deploy do frontend e das rotas de API (serverless)

O backend são os próprios Route Handlers do Next.js em `src/app/api/*`, publicados
como funções serverless no Vercel. Não há servidor Express separado neste app.

## Pré-requisitos

- Node.js 18+
- npm ou yarn

## Instalação

```bash
npm install
```

## Desenvolvimento

```bash
npm run dev
```

Acesse http://localhost:3000

## Variáveis de Ambiente

Crie um arquivo `.env.local` (já ignorado pelo git) com:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_SUPABASE_URL=...
NEXT_PUBLIC_SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

## Banco de dados

A identidade do app é do Clerk, então as chaves de usuário nas tabelas são
`TEXT` (ex.: `user_2abc...`) e não UUID: não existe dependência de `auth.users`.
O perfil em `profiles` é criado sob demanda na primeira requisição autenticada
(`getOrCreateProfile` em `src/lib/auth.ts`), sem depender de webhook.

O banco de produção (`kufiimcpfnzlsulprgfo`) já está provisionado: a migração foi
aplicada no SQL Editor e as rotas públicas de leitura respondem
`200 {"data":[]}`. Em um projeto novo, aplique
o `supabase/migrations/001_initial_schema.sql` no SQL Editor do Supabase; sem isso
as rotas respondem 500 com `Could not find the table 'public.stores' in the
schema cache`. A migração é idempotente, então pode ser reaplicada sem risco.

O papel de um usuário começa como `customer`; para virar dono de loja, atualize
manualmente a coluna `role` em `profiles` para `store_manager`.

## Testes

```bash
npm run db:check
```

Sobe um Postgres em WASM (PGlite), aplica `supabase/migrations/001_initial_schema.sql`
do zero e valida as tabelas, o tipo das chaves de usuário, os padrões de consulta
usados pelas rotas, o decremento de estoque, as views e o isolamento por RLS.
Não exige Docker nem credenciais, então também roda no CI.

## Estrutura do Projeto

```
src/
├── app/               # Next.js App Router
│   ├── api/           # Rotas de API (stores, products, orders)
│   ├── layout.tsx     # Layout principal com ClerkProvider
│   ├── page.tsx       # Página inicial
│   ├── sign-in/       # Página de sign-in
│   └── sign-up/       # Página de sign-up
├── components/        # Componentes reutilizáveis
├── lib/               # auth.ts (perfil do Clerk) e supabase.ts
└── middleware.ts      # Middleware do Clerk (API sem sessão responde 401 em JSON)
supabase/
└── migrations/        # Schema inicial do Postgres
```

## API

Todas as rotas exigem sessão do Clerk, exceto o catálogo público.

| Rota | Métodos | Acesso |
| --- | --- | --- |
| `/api/stores` | GET | Público (lojas ativas) |
| `/api/stores` | POST | Autenticado (cria loja do usuário) |
| `/api/products` | GET | Público (`?store_id=` opcional, só produtos ativos) |
| `/api/products` | POST | Dono da loja (ou admin) — terceiros recebem `403` |
| `/api/orders` | GET | Autenticado (cliente vê seus pedidos, gerente vê os da loja) |
| `/api/orders` | POST | Autenticado (loja ativa, itens da própria loja, estoque e preço validados no servidor) |
| `/api/orders/[orderId]` | GET | Autenticado (cliente dono do pedido ou gerente da loja) |

Chamadas de API sem sessão recebem `401` em JSON; páginas redirecionam para `/sign-in`.

### Fluxo autenticado

Login pelo Clerk → criar loja → cadastrar produto → fechar pedido foi exercitado
com sessão real (instância de desenvolvimento do Clerk) contra um build local
apontando para o Supabase de produção. O que o fluxo garante hoje:

- `profiles` é criado na primeira ação autenticada, inclusive em `POST /api/stores`;
- produto só entra no catálogo de quem é dono da loja (ou admin);
- pedido exige loja ativa e itens da própria loja, e o total é calculado no servidor;
- produto repetido no carrinho é agregado antes da checagem de estoque;
- falha do banco vira status adequado (`409` para slug duplicado, `400` para payload
  inválido) sem vazar nome de constraint nem SQLSTATE.

A baixa de estoque usa compare-and-swap por produto e desfaz o pedido se a
gravação conflitar, mas ainda não é uma transação única: veja o roadmap.

## Roadmap

- [x] Integração com Supabase (PostgreSQL) — cliente e migração versionada
- [x] Migração verificada em Postgres local (`npm run db:check`): 18 checagens, incluindo RLS
- [x] Banco provisionado: migração aplicada no projeto Supabase de produção
- [x] Vercel Deploy
- [ ] CI no GitHub Actions (arquivo pronto, falta o escopo `workflow` no token)
- [ ] Proteção de branch em `main` e merge do PR com as rotas de API
- [ ] Cloudflare DNS / Domínio + SSL (hoje só os aliases `*.vercel.app`)
- [x] Backend: Route Handlers serverless no Vercel (sem servidor Express separado)
- [x] Fluxo autenticado verificado ponta a ponta (login → loja → produto → pedido)
- [ ] Pedido atômico: criar pedido, itens e baixa de estoque numa transação (função no Postgres)
- [ ] Resend (emails)
- [ ] PostHog (analytics)
- [ ] Sentry (erro/performance)
- [ ] Asaas (pagamentos) — depende de saldo/ledger no schema e rota de webhook
- [ ] Upstash Redis (quando necessário)
- [ ] Pinecone (vector DB — só com caso de uso real)
