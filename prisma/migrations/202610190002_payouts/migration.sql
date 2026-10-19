CREATE TABLE "Payout" (
  "id" TEXT NOT NULL,
  "creatorId" TEXT NOT NULL,
  "providerPayoutId" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "currency" TEXT NOT NULL,
  "providerEventAt" TIMESTAMP(3) NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Payout_providerPayoutId_key" ON "Payout"("providerPayoutId");
CREATE INDEX "Payout_creatorId_idx" ON "Payout"("creatorId");
CREATE UNIQUE INDEX "CreatorProfile_stripeAccountId_key" ON "CreatorProfile"("stripeAccountId");
