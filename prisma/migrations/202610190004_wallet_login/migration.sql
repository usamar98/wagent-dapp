-- Retain users, orders, agent ownership and entitlements. Wallets are linked explicitly.
ALTER TABLE "User" ADD COLUMN "walletAddress" TEXT;
CREATE UNIQUE INDEX "User_walletAddress_key" ON "User"("walletAddress");
-- Email/password sessions cannot authenticate after the switch to wallet-only sign-in.
DELETE FROM "Session";
DROP TABLE "PasswordReset";
ALTER TABLE "User" DROP COLUMN "passwordHash";
ALTER TABLE "User" DROP COLUMN "email";
CREATE TABLE "WalletChallenge" (
  "id" TEXT NOT NULL,
  "walletAddress" TEXT NOT NULL,
  "chainId" INTEGER NOT NULL,
  "domain" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "usedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WalletChallenge_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WalletChallenge_expiresAt_idx" ON "WalletChallenge"("expiresAt");
