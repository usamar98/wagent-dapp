-- Opt-in, server-managed trading wallets. All limits are application-enforced.
CREATE TABLE public."SolanaTradingWallet" (
  "userId" TEXT PRIMARY KEY REFERENCES public."User"(id) ON DELETE CASCADE,
  address TEXT NOT NULL UNIQUE,
  "ownerAddress" TEXT NOT NULL,
  "encryptedSecret" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE TABLE public."SolanaTradePermission" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "channelId" TEXT NOT NULL,
  "channelFingerprint" TEXT NOT NULL,
  "channelOwnerId" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "ownerAddress" TEXT NOT NULL,
  "tradingAddress" TEXT NOT NULL,
  "allowedMints" TEXT[] NOT NULL CHECK (cardinality("allowedMints") BETWEEN 1 AND 10),
  "perTradeLamports" TEXT NOT NULL CHECK ("perTradeLamports" ~ '^[1-9][0-9]{0,11}$'),
  "dailyLamports" TEXT NOT NULL CHECK ("dailyLamports" ~ '^[1-9][0-9]{0,11}$'),
  "maxFeeLamports" TEXT NOT NULL CHECK ("maxFeeLamports" ~ '^[1-9][0-9]{0,7}$'),
  "slippageBps" INTEGER NOT NULL CHECK ("slippageBps" BETWEEN 1 AND 200),
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "revokedAt" TIMESTAMP(3),
  "revokeReason" TEXT,
  "consentMessage" TEXT NOT NULL,
  signature TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX "SolanaTradePermission_userId_createdAt_idx" ON public."SolanaTradePermission"("userId","createdAt" DESC);
CREATE UNIQUE INDEX "SolanaTradePermission_one_active_idx" ON public."SolanaTradePermission"("userId") WHERE "revokedAt" IS NULL;
CREATE TABLE public."SolanaPermissionChallenge" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "sessionId" TEXT NOT NULL,
  purpose TEXT NOT NULL CHECK (purpose IN ('GRANT','WITHDRAWAL')),
  address TEXT NOT NULL,
  message TEXT NOT NULL,
  payload JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  UNIQUE ("userId",purpose)
);
CREATE INDEX "SolanaPermissionChallenge_expiresAt_idx" ON public."SolanaPermissionChallenge"("expiresAt");
CREATE TABLE public."SolanaChatTrade" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "commandId" TEXT NOT NULL UNIQUE REFERENCES public."AgentCommand"(id) ON DELETE CASCADE,
  "permissionId" TEXT NOT NULL REFERENCES public."SolanaTradePermission"(id),
  "walletAddress" TEXT NOT NULL,
  side TEXT NOT NULL CHECK (side IN ('BUY','SELL')),
  mint TEXT NOT NULL,
  amount TEXT NOT NULL,
  "budgetLamports" TEXT NOT NULL DEFAULT '0' CHECK ("budgetLamports" ~ '^[0-9]{1,13}$'),
  status TEXT NOT NULL DEFAULT 'PREPARING' CHECK (status IN ('PREPARING','PREPARED','EXECUTING','UNKNOWN','CONFIRMED','FAILED','REJECTED','CANCELLED')),
  "providerRequestId" TEXT UNIQUE,
  signature TEXT,
  quote JSONB NOT NULL DEFAULT '{}',
  error TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX "SolanaChatTrade_userId_createdAt_idx" ON public."SolanaChatTrade"("userId","createdAt" DESC);
CREATE INDEX "SolanaChatTrade_userId_status_idx" ON public."SolanaChatTrade"("userId",status);
CREATE INDEX "SolanaChatTrade_permissionId_idx" ON public."SolanaChatTrade"("permissionId");
CREATE TABLE public."SolanaWalletWithdrawal" (
  id TEXT PRIMARY KEY,
  "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
  "walletAddress" TEXT NOT NULL,
  "ownerAddress" TEXT NOT NULL,
  mint TEXT NOT NULL,
  amount TEXT NOT NULL,
  signature TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'PREPARED' CHECK (status IN ('PREPARED','EXECUTING','UNKNOWN','CONFIRMED','FAILED','CANCELLED')),
  "lastValidBlockHeight" TEXT NOT NULL,
  error TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX "SolanaWalletWithdrawal_userId_createdAt_idx" ON public."SolanaWalletWithdrawal"("userId","createdAt" DESC);
CREATE INDEX "SolanaWalletWithdrawal_userId_status_idx" ON public."SolanaWalletWithdrawal"("userId",status);
DO $wagent$
DECLARE t text; r text;
BEGIN
  FOREACH t IN ARRAY ARRAY['SolanaTradingWallet','SolanaTradePermission','SolanaPermissionChallenge','SolanaChatTrade','SolanaWalletWithdrawal'] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
    FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
      IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF;
    END LOOP;
  END LOOP;
END $wagent$;
