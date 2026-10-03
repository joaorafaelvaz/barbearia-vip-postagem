-- CreateEnum
CREATE TYPE "MediaKind" AS ENUM ('IMAGE', 'VIDEO');

-- AlterTable
ALTER TABLE "MediaAsset" ADD COLUMN     "durationSec" INTEGER,
ADD COLUMN     "kind" "MediaKind" NOT NULL DEFAULT 'IMAGE';
