-- AlterTable
ALTER TABLE "StampEvent" ADD COLUMN     "note" TEXT;

-- CreateIndex
CREATE INDEX "Membership_storeId_createdAt_idx" ON "Membership"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "StampEvent_membershipId_kind_idx" ON "StampEvent"("membershipId", "kind");
