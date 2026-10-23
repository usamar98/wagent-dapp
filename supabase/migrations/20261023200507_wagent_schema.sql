-- Wagent Ai PostgreSQL baseline. Creates fresh tables or adopts existing tables without deleting records.
SET LOCAL search_path=public;
-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE IF NOT EXISTS "User" (
    "id" TEXT NOT NULL,
    "walletAddress" TEXT,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'USER',
    "emergencyStop" BOOLEAN NOT NULL DEFAULT false,
    "inboxEnabled" BOOLEAN NOT NULL DEFAULT true,
    "disabled" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CreatorProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "bio" TEXT NOT NULL DEFAULT 'Independent strategy creator.',
    "stripeAccountId" TEXT,
    "chargesEnabled" BOOLEAN NOT NULL DEFAULT false,
    "payoutsEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "CreatorProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "WalletChallenge" (
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "Agent" (
    "id" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "market" TEXT NOT NULL,
    "tags" TEXT[],
    "cover" TEXT NOT NULL DEFAULT 'orbit',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Agent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentVersion" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "config" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "priceCents" INTEGER NOT NULL,
    "setupInstructions" TEXT NOT NULL,
    "reviewNote" TEXT,
    "testedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Listing" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Listing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Order" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "creatorId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "commissionCents" INTEGER NOT NULL,
    "creatorCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "provider" TEXT NOT NULL,
    "providerSessionId" TEXT,
    "paymentIntentId" TEXT,
    "payoutStatus" TEXT NOT NULL DEFAULT 'NOT_PAID',
    "checkoutAttempt" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Entitlement" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "environment" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PaymentEvent" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "orderId" TEXT,
    "type" TEXT NOT NULL,
    "processedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Payout" (
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

-- CreateTable
CREATE TABLE IF NOT EXISTS "Review" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "rating" INTEGER NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Review_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Connection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedCredentials" TEXT NOT NULL,
    "recipient" TEXT,
    "verificationHash" TEXT,
    "verificationExpiresAt" TIMESTAMP(3),
    "verifiedAt" TIMESTAMP(3),
    "consentAt" TIMESTAMP(3),
    "optedOutAt" TIMESTAMP(3),
    "templateName" TEXT,
    "templateStatus" TEXT NOT NULL DEFAULT 'NOT_SUBMITTED',
    "eligibility" TEXT NOT NULL DEFAULT 'UNVERIFIED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Connection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ConsentRecord" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "connectionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConsentRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Instance" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'STOPPED',
    "cashCents" INTEGER NOT NULL DEFAULT 1000000,
    "lastSignalAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Instance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Execution" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "marketTimestamp" TIMESTAMP(3) NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Execution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Signal" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "executionId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "marketTimestamp" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Signal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PaperTrade" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "signalId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PAPER_FILLED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaperTrade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Position" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "quantity" DOUBLE PRECISION NOT NULL,
    "entryPrice" DOUBLE PRECISION NOT NULL,
    "costCents" INTEGER NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "signalId" TEXT,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DELIVERED_LOCAL',
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Moderation" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Moderation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Report" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TradingWorkspace" (
    "userId" TEXT NOT NULL,
    "activeInstanceId" TEXT,
    "maxOrderCents" INTEGER NOT NULL DEFAULT 10000,
    "maxDailyCents" INTEGER NOT NULL DEFAULT 50000,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TradingWorkspace_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PersonalAgentChannel" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "encryptedToken" TEXT NOT NULL,
    "tokenFingerprint" TEXT NOT NULL,
    "ownerId" TEXT,
    "agentId" TEXT,
    "pairingHash" TEXT,
    "pairingExpiresAt" TIMESTAMP(3),
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "offset" TEXT NOT NULL DEFAULT '0',
    "leaseToken" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastPollAt" TIMESTAMP(3),
    "lastMessageAt" TIMESTAMP(3),
    "lastError" TEXT,
    "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PersonalAgentChannel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentCommand" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "reply" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "intentId" TEXT,
    "channelId" TEXT,
    "recipientId" TEXT,
    "deliveryStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED',
    "replyMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentCommand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "TradeIntent" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "confirmationCode" TEXT NOT NULL,
    "side" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "price" DOUBLE PRECISION NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "filledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TradeIntent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BrokerAuthorization" (
    "userId" TEXT NOT NULL,
    "encryptedTokens" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "refreshLeaseUntil" TIMESTAMP(3),
    "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerAuthorization_pkey" PRIMARY KEY ("userId")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "BrokerOAuthState" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "encryptedVerifier" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "User_walletAddress_key" ON "User"("walletAddress");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreatorProfile_userId_key" ON "CreatorProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CreatorProfile_stripeAccountId_key" ON "CreatorProfile"("stripeAccountId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "WalletChallenge_expiresAt_idx" ON "WalletChallenge"("expiresAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Agent_creatorId_idx" ON "Agent"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentVersion_agentId_number_key" ON "AgentVersion"("agentId", "number");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Listing_agentId_key" ON "Listing"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Listing_versionId_key" ON "Listing"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Order_providerSessionId_key" ON "Order"("providerSessionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Order_paymentIntentId_key" ON "Order"("paymentIntentId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Order_creatorId_status_idx" ON "Order"("creatorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Order_buyerId_agentId_key" ON "Order"("buyerId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Entitlement_orderId_key" ON "Entitlement"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Entitlement_buyerId_agentId_key" ON "Entitlement"("buyerId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Payout_providerPayoutId_key" ON "Payout"("providerPayoutId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Payout_creatorId_idx" ON "Payout"("creatorId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Review_buyerId_agentId_key" ON "Review"("buyerId", "agentId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Connection_userId_provider_key" ON "Connection"("userId", "provider");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Instance_userId_versionId_key" ON "Instance"("userId", "versionId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Execution_instanceId_bucket_key" ON "Execution"("instanceId", "bucket");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Signal_executionId_symbol_key" ON "Signal"("executionId", "symbol");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PaperTrade_signalId_key" ON "PaperTrade"("signalId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Position_instanceId_symbol_key" ON "Position"("instanceId", "symbol");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Notification_signalId_channel_key" ON "Notification"("signalId", "channel");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PersonalAgentChannel_userId_key" ON "PersonalAgentChannel"("userId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PersonalAgentChannel_tokenFingerprint_key" ON "PersonalAgentChannel"("tokenFingerprint");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentCommand_userId_createdAt_idx" ON "AgentCommand"("userId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "AgentCommand_userId_source_externalId_key" ON "AgentCommand"("userId", "source", "externalId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "TradeIntent_userId_status_createdAt_idx" ON "TradeIntent"("userId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "TradeIntent_userId_confirmationCode_key" ON "TradeIntent"("userId", "confirmationCode");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "BrokerOAuthState_expiresAt_idx" ON "BrokerOAuthState"("expiresAt");

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."CreatorProfile"'::regclass AND conname='CreatorProfile_userId_fkey') THEN
    ALTER TABLE "CreatorProfile" ADD CONSTRAINT "CreatorProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Session"'::regclass AND conname='Session_userId_fkey') THEN
    ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Agent"'::regclass AND conname='Agent_creatorId_fkey') THEN
    ALTER TABLE "Agent" ADD CONSTRAINT "Agent_creatorId_fkey" FOREIGN KEY ("creatorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."AgentVersion"'::regclass AND conname='AgentVersion_agentId_fkey') THEN
    ALTER TABLE "AgentVersion" ADD CONSTRAINT "AgentVersion_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Listing"'::regclass AND conname='Listing_agentId_fkey') THEN
    ALTER TABLE "Listing" ADD CONSTRAINT "Listing_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Listing"'::regclass AND conname='Listing_versionId_fkey') THEN
    ALTER TABLE "Listing" ADD CONSTRAINT "Listing_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AgentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Order"'::regclass AND conname='Order_buyerId_fkey') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Order"'::regclass AND conname='Order_agentId_fkey') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Order"'::regclass AND conname='Order_versionId_fkey') THEN
    ALTER TABLE "Order" ADD CONSTRAINT "Order_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AgentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Entitlement"'::regclass AND conname='Entitlement_buyerId_fkey') THEN
    ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Entitlement"'::regclass AND conname='Entitlement_agentId_fkey') THEN
    ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "Agent"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Entitlement"'::regclass AND conname='Entitlement_versionId_fkey') THEN
    ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AgentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Instance"'::regclass AND conname='Instance_userId_fkey') THEN
    ALTER TABLE "Instance" ADD CONSTRAINT "Instance_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Instance"'::regclass AND conname='Instance_versionId_fkey') THEN
    ALTER TABLE "Instance" ADD CONSTRAINT "Instance_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "AgentVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Execution"'::regclass AND conname='Execution_instanceId_fkey') THEN
    ALTER TABLE "Execution" ADD CONSTRAINT "Execution_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Signal"'::regclass AND conname='Signal_instanceId_fkey') THEN
    ALTER TABLE "Signal" ADD CONSTRAINT "Signal_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."PaperTrade"'::regclass AND conname='PaperTrade_instanceId_fkey') THEN
    ALTER TABLE "PaperTrade" ADD CONSTRAINT "PaperTrade_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

-- AddForeignKey
DO $foreign_key$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid='public."Position"'::regclass AND conname='Position_instanceId_fkey') THEN
    ALTER TABLE "Position" ADD CONSTRAINT "Position_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $foreign_key$;

CREATE SCHEMA IF NOT EXISTS wagent_internal;
REVOKE ALL ON SCHEMA wagent_internal FROM PUBLIC;
DO $legacy$ BEGIN
  IF to_regclass('public."_prisma_migrations"') IS NOT NULL AND to_regclass('wagent_internal.previous_migrations') IS NULL THEN
    ALTER TABLE public."_prisma_migrations" SET SCHEMA wagent_internal;
    ALTER TABLE wagent_internal."_prisma_migrations" RENAME TO previous_migrations;
  END IF;
END $legacy$;
-- Run after SQL migrations, using the Supabase database owner.
-- Wagent Ai uses wallet sessions and its Express API. Supabase browser roles
-- must not receive direct access to credentials, sessions, orders, or user data.
-- This is an idempotent setup script, not a replacement migration history.
DO $wagent$
DECLARE
  app_table text;
  browser_role text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'User', 'CreatorProfile', 'Session', 'WalletChallenge', 'Agent', 'AgentVersion',
    'Listing', 'Order', 'Entitlement', 'PaymentEvent', 'Payout', 'Review', 'Connection',
    'ConsentRecord', 'Instance', 'Execution', 'Signal', 'PaperTrade', 'Position',
    'Notification', 'Moderation', 'Report', 'Setting', 'TradingWorkspace',
    'PersonalAgentChannel', 'AgentCommand', 'TradeIntent', 'BrokerAuthorization',
    'BrokerOAuthState'
  ] LOOP
    IF to_regclass(format('public.%I', app_table)) IS NULL THEN
      RAISE EXCEPTION 'Missing Wagent Ai table %. Apply SQL migrations first.', app_table;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC', app_table);
    FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
        EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM %I', app_table, browser_role);
      END IF;
    END LOOP;
  END LOOP;
END
$wagent$;
