-- Preserve existing rules/events while replacing the paid discovery provider.
ALTER TABLE public."SolanaAlertRule" DROP CONSTRAINT "SolanaAlertRule_kind_check";
ALTER TABLE public."SolanaAlertRule" DROP CONSTRAINT "SolanaAlertRule_source_check";
ALTER TABLE public."SolanaAlertRule" DROP CONSTRAINT "SolanaAlertRule_check";
ALTER TABLE public."SolanaAlertRule" RENAME COLUMN "maxPoolAgeMinutes" TO "maxDiscoveryAgeMinutes";
ALTER TABLE public."SolanaAlertRule" ADD COLUMN "discoveryBaselineAt" TIMESTAMP(3);
UPDATE public."SolanaAlertRule" SET kind='NEW_DISCOVERY', source='DEX_SCREENER', "lastObservedAt"=NULL, "lastError"=NULL WHERE kind='NEW_POOL';
UPDATE public."SolanaAlertRule" SET source='DEX_SCREENER', "lastObservedAt"=NULL, "lastError"=NULL WHERE source='DEXTOOLS';
ALTER TABLE public."SolanaAlertRule" ADD CONSTRAINT "SolanaAlertRule_kind_check" CHECK (kind IN ('PRICE_ABOVE','PRICE_BELOW','LIQUIDITY_BELOW','NEW_DISCOVERY'));
ALTER TABLE public."SolanaAlertRule" ADD CONSTRAINT "SolanaAlertRule_source_check" CHECK (source='DEX_SCREENER');
ALTER TABLE public."SolanaAlertRule" ADD CONSTRAINT "SolanaAlertRule_check" CHECK ((kind='NEW_DISCOVERY' AND mint IS NULL AND threshold IS NULL) OR (kind<>'NEW_DISCOVERY' AND mint IS NOT NULL AND threshold IS NOT NULL));

CREATE TABLE public."SolanaTokenDiscovery" (
  mint TEXT PRIMARY KEY,
  "firstSeenAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3) NOT NULL
);
ALTER TABLE public."SolanaTokenDiscovery" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public."SolanaTokenDiscovery" FROM PUBLIC;
DO $wagent$
DECLARE browser_role TEXT;
BEGIN
  FOREACH browser_role IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=browser_role) THEN
      EXECUTE format('REVOKE ALL ON TABLE public."SolanaTokenDiscovery" FROM %I',browser_role);
    END IF;
  END LOOP;
END $wagent$;

-- Stored server-side, never accepted from a user-provided request URL.
ALTER TABLE public."PersonalAgentChannel" ADD COLUMN "appUrl" TEXT;
