-- Add Robinhood records; never reinterpret or delete funded Solana wallets.
CREATE TABLE "RHWallet" (
  "userId" text PRIMARY KEY REFERENCES "User"(id) ON DELETE CASCADE,
  address text NOT NULL UNIQUE CHECK (address ~ '^0x[0-9a-f]{40}$'),
  "ownerAddress" text NOT NULL CHECK ("ownerAddress" ~ '^0x[0-9a-f]{40}$'),
  "encryptedSecret" text NOT NULL,
  "chainId" integer NOT NULL DEFAULT 4663 CHECK ("chainId" = 4663),
  "createdAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE TABLE "RHChallenge" (
  id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "sessionId" text NOT NULL, purpose text NOT NULL, address text NOT NULL,
  message text NOT NULL, payload jsonb NOT NULL, "expiresAt" timestamp(3) NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE INDEX "RHChallenge_user_expiry" ON "RHChallenge" ("userId", "expiresAt");
CREATE TABLE "RHPermission" (
  id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('TRADE','WITHDRAW')),
  "channelId" text NOT NULL, fingerprint text NOT NULL, recipient text NOT NULL,
  "instanceId" text, "ownerAddress" text NOT NULL, "walletAddress" text NOT NULL,
  "tokenScope" text NOT NULL CHECK ("tokenScope" IN ('ANY_ROBINHOOD','SELECTED_TOKENS')),
  tokens text[] NOT NULL DEFAULT '{}',
  "perLimitWei" numeric(78,0) NOT NULL CHECK ("perLimitWei" > 0),
  "dailyLimitWei" numeric(78,0) NOT NULL CHECK ("dailyLimitWei" >= "perLimitWei"),
  "maxFeeWei" numeric(78,0) NOT NULL CHECK ("maxFeeWei" > 0 AND "maxFeeWei" < "perLimitWei"),
  "slippageBps" integer NOT NULL CHECK ("slippageBps" BETWEEN 1 AND 200),
  "expiresAt" timestamp(3) NOT NULL, "revokedAt" timestamp(3), "revokeReason" text,
  message text NOT NULL, signature text NOT NULL, "createdAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE INDEX "RHPermission_user_kind" ON "RHPermission" ("userId", kind, "createdAt" DESC);
CREATE TABLE "RHOperation" (
  id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "commandId" text UNIQUE REFERENCES "AgentCommand"(id), "permissionId" text REFERENCES "RHPermission"(id),
  kind text NOT NULL CHECK (kind IN ('BUY','SELL','WITHDRAW')),
  "tokenAddress" text NOT NULL, amount text NOT NULL, "walletAddress" text NOT NULL,
  status text NOT NULL, "budgetWei" numeric(78,0) NOT NULL DEFAULT 0 CHECK ("budgetWei" >= 0),
  "txHash" text UNIQUE, "approvalHash" text UNIQUE, nonce integer,
  data jsonb NOT NULL DEFAULT '{}', error text,
  "confirmationHash" text, "confirmationExpiresAt" timestamp(3),
  "createdAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  "updatedAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE INDEX "RHOperation_user_status" ON "RHOperation" ("userId", status);
CREATE INDEX "RHOperation_user_day" ON "RHOperation" ("userId", "createdAt" DESC);
CREATE TABLE "RHAlert" (
  id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  name text NOT NULL, kind text NOT NULL CHECK (kind IN ('DISCOVERY','PRICE_ABOVE','PRICE_BELOW','LIQUIDITY_BELOW')),
  "tokenAddress" text, threshold double precision, "minLiquidityUsd" double precision NOT NULL DEFAULT 10000,
  delivery text NOT NULL CHECK (delivery IN ('IN_APP','WHATSAPP')), enabled boolean NOT NULL DEFAULT true,
  "cooldownMinutes" integer NOT NULL DEFAULT 60 CHECK ("cooldownMinutes" BETWEEN 1 AND 10080),
  "lastMatched" boolean NOT NULL DEFAULT false, "lastCheckedAt" timestamp(3), "lastTriggeredAt" timestamp(3),
  "baselineAt" timestamp(3), "lastError" text, "createdAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE INDEX "RHAlert_due" ON "RHAlert" (enabled, "lastCheckedAt");
CREATE TABLE "RHDiscovery" (
  address text PRIMARY KEY, "firstSeenAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  "lastSeenAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE TABLE "RHAlertEvent" (
  id text PRIMARY KEY, "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  "ruleId" text NOT NULL REFERENCES "RHAlert"(id) ON DELETE CASCADE,
  "dedupeKey" text NOT NULL UNIQUE, title text NOT NULL, body text NOT NULL,
  "createdAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP)
);
CREATE INDEX "RHAlertEvent_user" ON "RHAlertEvent" ("userId", "createdAt" DESC);
DO $$
DECLARE tab text; rol text;
BEGIN
  FOREACH tab IN ARRAY ARRAY['RHWallet','RHChallenge','RHPermission','RHOperation','RHAlert','RHDiscovery','RHAlertEvent'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', tab);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC', tab);
    FOREACH rol IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=rol) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I', tab, rol);
      END IF;
    END LOOP;
  END LOOP;
END $$;
-- Retire advance Solana authority while keeping keys, balances and recovery history intact.
UPDATE "SolanaTradePermission" SET "revokedAt"=timezone('UTC',CURRENT_TIMESTAMP),"revokeReason"='New trading migrated to Robinhood Chain. Legacy Solana recovery remains available.' WHERE "revokedAt" IS NULL;
UPDATE "SolanaWithdrawalPermission" SET "revokedAt"=timezone('UTC',CURRENT_TIMESTAMP),"revokeReason"='Chain migration requires a fresh, separate Robinhood withdrawal approval.' WHERE "revokedAt" IS NULL;
