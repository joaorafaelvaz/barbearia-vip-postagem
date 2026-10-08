-- Capa do Reel: imagem escolhida e/ou quadro do vídeo
ALTER TABLE "Post" ADD COLUMN "coverMediaId" TEXT,
    ADD COLUMN "coverOffsetMs" INTEGER;

ALTER TABLE "Post" ADD CONSTRAINT "Post_coverMediaId_fkey"
    FOREIGN KEY ("coverMediaId") REFERENCES "MediaAsset"("id") ON DELETE SET NULL ON UPDATE CASCADE;
