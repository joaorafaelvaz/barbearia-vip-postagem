-- Normalização de vídeo (formato seguro para iOS/Android)
ALTER TABLE "MediaAsset" ADD COLUMN "normalizedAt" TIMESTAMP(3),
    ADD COLUMN "normalizeNote" TEXT;
