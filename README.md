# Swap - Gestão de Lojas de Celulares

Aplicação web para gestão de lojas de celulares, com vendas, estoque e gestão de clientes.

## Tech Stack

- **Next.js 15** — Framework React full-stack
- **TypeScript** — Tipagem forte
- **Tailwind CSS v4** — Estilização
- **Clerk** — Autenticação (login, signup, user button)
- **Vercel** — Deploy (futuro)

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

Crie um arquivo `.env.local` com:

```
NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=...
CLERK_SECRET_KEY=...
NEXT_PUBLIC_CLERK_SIGN_IN_URL=/sign-in
NEXT_PUBLIC_CLERK_SIGN_UP_URL=/sign-up
NEXT_PUBLIC_CLERK_AFTER_SIGN_IN_URL=/
NEXT_PUBLIC_CLERK_AFTER_SIGN_UP_URL=/
```

## Estrutura do Projeto

```
src/
├── app/               # Next.js App Router
│   ├── layout.tsx     # Layout principal com ClerkProvider
│   ├── page.tsx       # Página inicial
│   ├── sign-in/       # Página de sign-in
│   └── sign-up/       # Página de sign-up
├── components/        # Componentes reutilizáveis
└── middleware.ts      # Middleware de autenticação do Clerk
```

## Roadmap

- [ ] Integração com Supabase (PostgreSQL)
- [ ] Vercel Deploy
- [ ] Cloudflare DNS / Domínio
- [ ] Backend separado ou Serverless Functions
- [ ] Resend (emails)
- [ ] PostHog (analytics)
- [ ] Sentry (erro/performance)
- [ ] Asaas (pagamentos)
- [ ] Upstash Redis (quando necessário)
- [ ] Pinecone (vector DB — só com caso de uso real)
