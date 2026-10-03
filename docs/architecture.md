# Arquitetura — Publicador Social Multi-Unidade

## Componentes

```
+--------------------------+          +--------------------------+
| apps/web (Next.js)       |          | apps/worker (Node)       |
| - UI (composicao, painel)|  Redis   | - BullMQ Worker          |
| - API routes             | -------> | - chama connectors       |
| - OAuth callbacks        |  (fila)  | - atualiza PostTarget    |
+------------+-------------+          +------------+-------------+
             |                                     |
             v                                     v
       packages/db (Prisma) ----------------> PostgreSQL
             |
             v
       packages/core        -> crypto (AES-GCM), fuso horario, erros tipados, regras de midia
       packages/connectors  -> Publisher: FacebookPage, Instagram, GoogleBusinessProfile
```

## Fluxo principal

1. Franqueador compõe um post, escolhe unidades, plataformas e data/hora.
2. `apps/web` cria `Post` e um `PostTarget` por conta selecionada, em transação, com
   `scheduledAt` em UTC (convertido do fuso da unidade).
3. Para cada `PostTarget`, enfileira um job BullMQ com `jobId = post-target-<id>` e
   `delay = scheduledAt - now`.
4. No horário, `apps/worker` carrega o target, descriptografa o token da conta, chama o
   `Publisher` da plataforma e grava `externalPostId` ou `lastError`.
5. O painel lê `PostTarget.status` para mostrar pendente / publicando / publicado / falhou,
   com ações de re-tentar (reenfileira) e cancelar (remove job).

## Multi-tenant

Toda entidade de negócio pertence a uma `Organization`. Toda query da camada web filtra
por `organizationId` da sessão. O worker não tem sessão: opera por `postTargetId` e valida
que a conta pertence à mesma organização do post.

## Fuso horário

`Unit.timezone` é um identificador IANA (ex.: `America/Sao_Paulo`). A UI envia a data/hora
local escolhida; `packages/core` converte para UTC usando `Intl` (sem dependências).

## Segredos

Tokens de acesso (Meta Page Access Token, Google refresh token) são criptografados com
AES-256-GCM antes de persistir, usando `APP_ENCRYPTION_KEY`. Nunca são logados.
