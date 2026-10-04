-- CreateTable
CREATE TABLE "TargetMetrics" (
    "postTargetId" TEXT NOT NULL,
    "likes" INTEGER NOT NULL DEFAULT 0,
    "comments" INTEGER NOT NULL DEFAULT 0,
    "shares" INTEGER NOT NULL DEFAULT 0,
    "reach" INTEGER NOT NULL DEFAULT 0,
    "impressions" INTEGER NOT NULL DEFAULT 0,
    "saves" INTEGER NOT NULL DEFAULT 0,
    "clicks" INTEGER NOT NULL DEFAULT 0,
    "partial" BOOLEAN NOT NULL DEFAULT false,
    "lastError" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetMetrics_pkey" PRIMARY KEY ("postTargetId")
);

-- CreateIndex
CREATE INDEX "TargetMetrics_fetchedAt_idx" ON "TargetMetrics"("fetchedAt");

-- AddForeignKey
ALTER TABLE "TargetMetrics" ADD CONSTRAINT "TargetMetrics_postTargetId_fkey" FOREIGN KEY ("postTargetId") REFERENCES "PostTarget"("id") ON DELETE CASCADE ON UPDATE CASCADE;
