-- Token de usuário Meta (longa duração) para operações que não aceitam token de Página
ALTER TABLE "ConnectedAccount" ADD COLUMN "userTokenEnc" TEXT;
