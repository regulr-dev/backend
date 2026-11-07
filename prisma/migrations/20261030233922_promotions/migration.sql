-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "birthdayYear" INTEGER;

-- AlterTable
ALTER TABLE "NfcTag" ADD COLUMN     "stamps" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "Reward" ADD COLUMN     "endsAt" TIMESTAMP(3),
ADD COLUMN     "perCustomerLimit" INTEGER,
ADD COLUMN     "startsAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StampEvent" ADD COLUMN     "rewardId" TEXT;

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "birthdayStamps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'Europe/Budapest';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "birthDay" INTEGER,
ADD COLUMN     "birthMonth" INTEGER;

-- CreateTable
CREATE TABLE "Promotion" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "multiplier" INTEGER NOT NULL,
    "days" TEXT NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startsOn" TEXT,
    "endsOn" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Promotion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Promotion_storeId_idx" ON "Promotion"("storeId");

-- AddForeignKey
ALTER TABLE "Promotion" ADD CONSTRAINT "Promotion_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
