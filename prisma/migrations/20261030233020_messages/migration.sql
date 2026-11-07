-- AlterTable
ALTER TABLE "Membership" ADD COLUMN     "messagesOff" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "audienceDays" INTEGER,
    "recipients" INTEGER NOT NULL DEFAULT 0,
    "walletSent" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageDelivery" (
    "id" TEXT NOT NULL,
    "messageId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Message_storeId_createdAt_idx" ON "Message"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "MessageDelivery_membershipId_createdAt_idx" ON "MessageDelivery"("membershipId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MessageDelivery_messageId_membershipId_key" ON "MessageDelivery"("messageId", "membershipId");

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageDelivery" ADD CONSTRAINT "MessageDelivery_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
