-- Partes de vídeo cortadas automaticamente para Stories (filhas do asset original)
ALTER TABLE "MediaAsset" ADD COLUMN "parentId" TEXT,
    ADD COLUMN "segmentIndex" INTEGER,
    ADD COLUMN "splitStartedAt" TIMESTAMP(3);

CREATE INDEX "MediaAsset_parentId_idx" ON "MediaAsset"("parentId");

ALTER TABLE "MediaAsset" ADD CONSTRAINT "MediaAsset_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "MediaAsset"("id") ON DELETE CASCADE ON UPDATE CASCADE;
