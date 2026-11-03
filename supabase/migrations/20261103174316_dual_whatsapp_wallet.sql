-- Preserve the existing connection as slot 1 and the existing funded wallet.
ALTER TABLE "PersonalAgentChannel" ADD COLUMN slot integer NOT NULL DEFAULT 1 CHECK (slot IN (1,2));
DROP INDEX "PersonalAgentChannel_userId_key";
CREATE UNIQUE INDEX "PersonalAgentChannel_userId_slot_key" ON "PersonalAgentChannel" ("userId",slot);
CREATE UNIQUE INDEX "PersonalAgentChannel_userId_agent_key" ON "PersonalAgentChannel" ("userId","agentId") WHERE "agentId" IS NOT NULL;
CREATE INDEX "RHPermission_channel_kind" ON "RHPermission" ("userId","channelId",kind,"createdAt" DESC);
CREATE INDEX "RHOperation_permission_day" ON "RHOperation" ("permissionId","createdAt");
ALTER TABLE "RHOperation" ADD COLUMN "channelId" text, ADD COLUMN "channelSlot" integer, ADD COLUMN "channelLabel" text;
UPDATE "RHOperation" o SET "channelId"=p."channelId","channelSlot"=1,"channelLabel"=c.label FROM "RHPermission" p LEFT JOIN "PersonalAgentChannel" c ON c.id=p."channelId" AND c."userId"=p."userId" WHERE o."permissionId"=p.id AND o."userId"=p."userId";
-- A signed ceiling only; it grants no trading or withdrawal authority itself.
CREATE TABLE "RHWalletBudget" (
  "userId" text NOT NULL REFERENCES "User"(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('TRADE','WITHDRAW')),
  "walletAddress" text NOT NULL, "ownerAddress" text NOT NULL,
  "perLimitWei" numeric(78,0) NOT NULL CHECK ("perLimitWei">0),
  "dailyLimitWei" numeric(78,0) NOT NULL CHECK ("dailyLimitWei">="perLimitWei"),
  message text NOT NULL, signature text NOT NULL,
  "updatedAt" timestamp(3) NOT NULL DEFAULT timezone('UTC',CURRENT_TIMESTAMP),
  PRIMARY KEY ("userId",kind)
);
ALTER TABLE "RHWalletBudget" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "RHWalletBudget" FROM PUBLIC;
DO $$ DECLARE rol text; BEGIN
  FOREACH rol IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname=rol) THEN EXECUTE format('REVOKE ALL ON "RHWalletBudget" FROM %I',rol); END IF;
  END LOOP;
END $$;
