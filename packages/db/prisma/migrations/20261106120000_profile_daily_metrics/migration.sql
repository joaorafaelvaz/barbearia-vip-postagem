-- Desempenho do perfil no Google Meu Negócio (Business Profile Performance API)
ALTER TABLE "ConnectedAccount" ADD COLUMN "profileMetricsAt" TIMESTAMP(3),
    ADD COLUMN "profileMetricsError" TEXT;

CREATE TABLE "ProfileDailyMetric" (
    "connectedAccountId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "impressionsSearch" INTEGER NOT NULL DEFAULT 0,
    "impressionsMaps" INTEGER NOT NULL DEFAULT 0,
    "websiteClicks" INTEGER NOT NULL DEFAULT 0,
    "callClicks" INTEGER NOT NULL DEFAULT 0,
    "directionRequests" INTEGER NOT NULL DEFAULT 0,
    "messagingClicks" INTEGER NOT NULL DEFAULT 0,
    "bookings" INTEGER NOT NULL DEFAULT 0,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProfileDailyMetric_pkey" PRIMARY KEY ("connectedAccountId","date")
);

CREATE INDEX "ProfileDailyMetric_date_idx" ON "ProfileDailyMetric"("date");

ALTER TABLE "ProfileDailyMetric" ADD CONSTRAINT "ProfileDailyMetric_connectedAccountId_fkey" FOREIGN KEY ("connectedAccountId") REFERENCES "ConnectedAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
