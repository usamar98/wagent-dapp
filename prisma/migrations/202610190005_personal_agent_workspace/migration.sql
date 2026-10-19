CREATE TABLE "TradingWorkspace" (
 "userId" TEXT PRIMARY KEY, "activeInstanceId" TEXT,
 "maxOrderCents" INTEGER NOT NULL DEFAULT 10000,
 "maxDailyCents" INTEGER NOT NULL DEFAULT 50000,
 "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "PersonalAgentChannel" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL UNIQUE, "label" TEXT NOT NULL,
 "encryptedToken" TEXT NOT NULL, "tokenFingerprint" TEXT NOT NULL UNIQUE,
 "ownerId" TEXT, "agentId" TEXT, "pairingHash" TEXT, "pairingExpiresAt" TIMESTAMP(3),
 "enabled" BOOLEAN NOT NULL DEFAULT true, "offset" TEXT NOT NULL DEFAULT '0',
 "leaseToken" TEXT, "leaseUntil" TIMESTAMP(3), "nextPollAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastPollAt" TIMESTAMP(3), "lastMessageAt" TIMESTAMP(3), "lastError" TEXT,
 "consentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE TABLE "AgentCommand" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "source" TEXT NOT NULL,
 "externalId" TEXT NOT NULL, "text" TEXT NOT NULL, "reply" TEXT NOT NULL,
 "status" TEXT NOT NULL, "intentId" TEXT, "channelId" TEXT, "recipientId" TEXT,
 "deliveryStatus" TEXT NOT NULL DEFAULT 'NOT_REQUIRED', "replyMessageId" TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("userId", "source", "externalId")
);
CREATE INDEX "AgentCommand_userId_createdAt_idx" ON "AgentCommand" ("userId", "createdAt");
CREATE TABLE "TradeIntent" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "instanceId" TEXT NOT NULL,
 "confirmationCode" TEXT NOT NULL, "side" TEXT NOT NULL, "symbol" TEXT NOT NULL,
 "amountCents" INTEGER NOT NULL, "price" DOUBLE PRECISION NOT NULL, "source" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'PENDING', "expiresAt" TIMESTAMP(3) NOT NULL,
 "filledAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 UNIQUE ("userId", "confirmationCode")
);
CREATE INDEX "TradeIntent_userId_status_createdAt_idx" ON "TradeIntent" ("userId", "status", "createdAt");
CREATE TABLE "BrokerAuthorization" (
 "userId" TEXT PRIMARY KEY, "encryptedTokens" TEXT NOT NULL, "scope" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "refreshLeaseUntil" TIMESTAMP(3),
 "connectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "BrokerOAuthState" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL, "sessionId" TEXT NOT NULL, "encryptedVerifier" TEXT NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "BrokerOAuthState_expiresAt_idx" ON "BrokerOAuthState" ("expiresAt");
