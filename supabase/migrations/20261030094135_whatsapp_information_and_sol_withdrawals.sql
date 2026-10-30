-- Explicit, independently signed withdrawal access. Existing trade grants stay unchanged.
ALTER TABLE public."SolanaPermissionChallenge" DROP CONSTRAINT "SolanaPermissionChallenge_purpose_check";
ALTER TABLE public."SolanaPermissionChallenge" ADD CONSTRAINT "SolanaPermissionChallenge_purpose_check" CHECK (purpose IN ('GRANT','WITHDRAWAL','WITHDRAWAL_GRANT'));
CREATE TABLE public."SolanaWithdrawalPermission" (
 id TEXT PRIMARY KEY,
 "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
 "channelId" TEXT NOT NULL, "channelFingerprint" TEXT NOT NULL, "channelOwnerId" TEXT NOT NULL,
 "ownerAddress" TEXT NOT NULL, "tradingAddress" TEXT NOT NULL,
 "perWithdrawalLamports" TEXT NOT NULL CHECK ("perWithdrawalLamports" ~ '^[1-9][0-9]{0,10}$'),
 "dailyLamports" TEXT NOT NULL CHECK ("dailyLamports" ~ '^[1-9][0-9]{0,11}$'),
 "maxFeeLamports" TEXT NOT NULL CHECK ("maxFeeLamports" ~ '^[1-9][0-9]{0,6}$'),
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "revokeReason" TEXT,
 "consentMessage" TEXT NOT NULL, signature TEXT NOT NULL,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX "SolanaWithdrawalPermission_userId_createdAt_idx" ON public."SolanaWithdrawalPermission"("userId","createdAt" DESC);
CREATE UNIQUE INDEX "SolanaWithdrawalPermission_one_active_idx" ON public."SolanaWithdrawalPermission"("userId") WHERE "revokedAt" IS NULL;
CREATE TABLE public."SolanaChatWithdrawal" (
 id TEXT PRIMARY KEY,
 "userId" TEXT NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
 "commandId" TEXT NOT NULL UNIQUE REFERENCES public."AgentCommand"(id) ON DELETE CASCADE,
 "executeCommandId" TEXT UNIQUE REFERENCES public."AgentCommand"(id) ON DELETE CASCADE,
 "permissionId" TEXT NOT NULL REFERENCES public."SolanaWithdrawalPermission"(id),
 "walletAddress" TEXT NOT NULL, "ownerAddress" TEXT NOT NULL, amount TEXT NOT NULL,
 "budgetLamports" TEXT NOT NULL CHECK ("budgetLamports" ~ '^[1-9][0-9]{0,11}$'),
 "confirmationHash" TEXT NOT NULL, "confirmationExpiresAt" TIMESTAMP(3) NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('AWAITING_CONFIRMATION','PREPARING','PREPARED','EXECUTING','UNKNOWN','CONFIRMED','FAILED','REJECTED','CANCELLED','EXPIRED')),
 signature TEXT UNIQUE, "lastValidBlockHeight" TEXT, error TEXT,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
 "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC')
);
CREATE INDEX "SolanaChatWithdrawal_userId_createdAt_idx" ON public."SolanaChatWithdrawal"("userId","createdAt" DESC);
CREATE INDEX "SolanaChatWithdrawal_userId_status_idx" ON public."SolanaChatWithdrawal"("userId",status);
CREATE INDEX "SolanaChatWithdrawal_permissionId_idx" ON public."SolanaChatWithdrawal"("permissionId");
DO $wagent$
DECLARE t text; r text;
BEGIN
 FOREACH t IN ARRAY ARRAY['SolanaWithdrawalPermission','SolanaChatWithdrawal'] LOOP
  EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY',t);
  EXECUTE format('REVOKE ALL ON TABLE public.%I FROM PUBLIC',t);
  FOREACH r IN ARRAY ARRAY['anon','authenticated'] LOOP
   IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=r) THEN EXECUTE format('REVOKE ALL ON TABLE public.%I FROM %I',t,r); END IF;
  END LOOP;
 END LOOP;
END $wagent$;
