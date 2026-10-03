# ADR 0001 — Agendamento por fila própria (BullMQ) em vez do agendamento nativo das plataformas

**Status**: Aceito
**Data**: 2026-10-03

## Contexto

O produto precisa publicar a mesma postagem em N unidades × M plataformas em um horário
escolhido pelo franqueador. Duas estratégias foram avaliadas:

1. **Agendamento nativo da plataforma**: enviar o post imediatamente com instrução de
   publicação futura (Facebook suporta `scheduled_publish_time` em posts de Page).
2. **Fila própria**: guardar o post e um job por conta-alvo com `delay` até o horário,
   e publicar no momento certo via API.

## Decisão

Usar **fila própria** (BullMQ sobre Redis), com um job por `PostTarget`.

## Justificativa

- O Instagram Content Publishing API e o Google Business Profile `localPosts` não
  oferecem agendamento nativo. Só o Facebook oferece. Uma estratégia única para as três
  plataformas simplifica o modelo de dados, a UI e o tratamento de erros.
- Com fila própria, cancelar ou editar um post pendente é uma operação local (remover ou
  substituir o job), sem chamadas às APIs externas.
- Retentativas, backoff e idempotência ficam sob controle do sistema, com status visível
  por conta no painel.
- O custo é operar Redis e um processo worker, já previstos na stack.

## Consequências

- O worker precisa estar em execução no horário agendado. Mitigação: BullMQ persiste jobs
  atrasados no Redis; ao reiniciar, o worker retoma os jobs vencidos.
- Horários são armazenados em UTC (`PostTarget.scheduledAt`) e convertidos a partir do
  fuso horário da unidade (`Unit.timezone`, IANA) no momento da criação.
- Job id determinístico (`post-target-<postTargetId>`) garante idempotência de enfileiramento.
