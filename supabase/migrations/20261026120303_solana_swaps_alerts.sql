-- Solana wallet proofs, non-custodial swaps, and owner-scoped alert rules.
CREATE TABLE public."SolanaWallet" (
  "userId" TEXT PRIMARY KEY REFERENCES public."User"(id) ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE,
  "verifiedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE TABLE public."SolanaWalletChallenge" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL UNIQUE REFERENCES public."User"(id) ON DELETE CASCADE,
  "sessionId" TEXT NOT NULL,
  address TEXT NOT NULL,
  message TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "SolanaWalletChallenge_expiresAt_idx" ON public."SolanaWalletChallenge"("expiresAt");
CREATE TABLE public."SolanaSwap" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "clientRequestId" TEXT NOT NULL,
  "providerRequestId" TEXT NOT NULL UNIQUE,
  "walletAddress" TEXT NOT NULL,
  "inputMint" TEXT NOT NULL,
  "outputMint" TEXT NOT NULL,
  "inputAmount" TEXT NOT NULL CHECK ("inputAmount" ~ '^[1-9][0-9]{0,19}$'),
  "outputAmount" TEXT NOT NULL CHECK ("outputAmount" ~ '^[1-9][0-9]{0,19}$'),
  "unsignedTransaction" TEXT NOT NULL,
  quote JSONB NOT NULL,
  status TEXT NOT NULL DEFAULT 'QUOTED' CHECK (status IN ('QUOTED','EXECUTING','CONFIRMED','FAILED','UNKNOWN','EXPIRED','CANCELLED')),
  signature TEXT,
  error TEXT,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  UNIQUE ("userId","clientRequestId")
);
CREATE INDEX "SolanaSwap_userId_createdAt_idx" ON public."SolanaSwap"("userId","createdAt" DESC);
CREATE INDEX "SolanaSwap_userId_status_idx" ON public."SolanaSwap"("userId",status);
CREATE TABLE public."SolanaAlertRule" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('PRICE_ABOVE','PRICE_BELOW','LIQUIDITY_BELOW','NEW_POOL')),
  source TEXT NOT NULL CHECK (source IN ('DEX_SCREENER','DEXTOOLS')),
  mint TEXT,
  threshold DOUBLE PRECISION CHECK (threshold > 0 AND threshold <= 1000000000000000),
  delivery TEXT NOT NULL CHECK (delivery IN ('IN_APP','BOTH')),
  "minLiquidityUsd" DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK ("minLiquidityUsd" BETWEEN 0 AND 1000000000000000),
  "maxPoolAgeMinutes" INTEGER NOT NULL DEFAULT 60 CHECK ("maxPoolAgeMinutes" BETWEEN 1 AND 1440),
  "cooldownMinutes" INTEGER NOT NULL DEFAULT 30 CHECK ("cooldownMinutes" BETWEEN 5 AND 10080),
  enabled BOOLEAN NOT NULL DEFAULT TRUE,
  "lastMatched" BOOLEAN NOT NULL DEFAULT FALSE,
  "lastObservedAt" TIMESTAMP(3),
  "lastCheckedAt" TIMESTAMP(3),
  "lastTriggeredAt" TIMESTAMP(3),
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  CHECK ((kind='NEW_POOL' AND source='DEXTOOLS' AND mint IS NULL AND threshold IS NULL) OR (kind<>'NEW_POOL' AND mint IS NOT NULL AND threshold IS NOT NULL))
);
CREATE INDEX "SolanaAlertRule_due_idx" ON public."SolanaAlertRule"(enabled,"lastCheckedAt");
CREATE INDEX "SolanaAlertRule_userId_idx" ON public."SolanaAlertRule"("userId");
CREATE TABLE public."SolanaAlertEvent" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "ruleId" TEXT NOT NULL REFERENCES public."SolanaAlertRule"(id) ON DELETE CASCADE,
  "dedupeKey" TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  UNIQUE ("ruleId","dedupeKey")
);
CREATE INDEX "SolanaAlertEvent_userId_createdAt_idx" ON public."SolanaAlertEvent"("userId","createdAt" DESC);
DO $wagent$
DECLARE app_table TEXT; browser_role TEXT;
BEGIN
  FOREACH app_table IN ARRAY ARRAY['SolanaWallet','SolanaWalletChallenge','SolanaSwap','SolanaAlertRule','SolanaAlertEvent'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',app_table);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',app_table);
    FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
        EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',app_table,browser_role);
      END IF;
    END LOOP;
  END LOOP;
END $wagent$;
