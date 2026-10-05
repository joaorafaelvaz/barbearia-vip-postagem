-- CreateEnum
CREATE TYPE "PostFormat" AS ENUM ('FEED', 'STORY', 'REEL');

-- AlterTable
ALTER TABLE "Post" ADD COLUMN     "format" "PostFormat" NOT NULL DEFAULT 'FEED';
