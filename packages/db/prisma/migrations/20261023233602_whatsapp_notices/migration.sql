-- CreateEnum
CREATE TYPE "WhatsappNoticeState" AS ENUM ('ativo', 'pausado', 'enviando', 'concluido', 'cancelado');

-- CreateEnum
CREATE TYPE "WhatsappDeliveryStatus" AS ENUM ('enviado', 'falhou', 'perdido', 'pausado');

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "whatsappChatId" TEXT;

-- AlterTable
ALTER TABLE "Unit" ADD COLUMN     "whatsappChatId" TEXT;

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "whatsappChatId" TEXT;

-- CreateTable
CREATE TABLE "WhatsappNotice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "targets" JSONB NOT NULL,
    "firstSendAt" TIMESTAMP(3) NOT NULL,
    "recurrence" JSONB NOT NULL,
    "endAt" TIMESTAMP(3),
    "nextRunAt" TIMESTAMP(3),
    "state" "WhatsappNoticeState" NOT NULL DEFAULT 'ativo',
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "sendingStartedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WhatsappNotice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsappDelivery" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "noticeId" TEXT NOT NULL,
    "occurrenceAt" TIMESTAMP(3) NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chatId" TEXT NOT NULL,
    "targetName" TEXT NOT NULL,
    "status" "WhatsappDeliveryStatus" NOT NULL,
    "error" TEXT,

    CONSTRAINT "WhatsappDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WhatsappNotice_organizationId_state_nextRunAt_idx" ON "WhatsappNotice"("organizationId", "state", "nextRunAt");

-- CreateIndex
CREATE INDEX "WhatsappNotice_state_nextRunAt_idx" ON "WhatsappNotice"("state", "nextRunAt");

-- CreateIndex
CREATE INDEX "WhatsappDelivery_organizationId_sentAt_idx" ON "WhatsappDelivery"("organizationId", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsappDelivery_noticeId_occurrenceAt_chatId_key" ON "WhatsappDelivery"("noticeId", "occurrenceAt", "chatId");

-- AddForeignKey
ALTER TABLE "WhatsappNotice" ADD CONSTRAINT "WhatsappNotice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsappDelivery" ADD CONSTRAINT "WhatsappDelivery_noticeId_fkey" FOREIGN KEY ("noticeId") REFERENCES "WhatsappNotice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
