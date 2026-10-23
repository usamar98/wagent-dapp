-- Run after the existing Prisma migrations, using the Supabase database owner.
-- Wagent Ai uses wallet sessions and its Express API. Supabase browser roles
-- must not receive direct access to credentials, sessions, orders, or user data.
-- This is an idempotent setup script, not a replacement migration history.
BEGIN;
DO $wagent$
DECLARE
  app_table text;
BEGIN
  FOREACH app_table IN ARRAY ARRAY[
    'User', 'CreatorProfile', 'Session', 'WalletChallenge', 'Agent', 'AgentVersion',
    'Listing', 'Order', 'Entitlement', 'PaymentEvent', 'Payout', 'Review', 'Connection',
    'ConsentRecord', 'Instance', 'Execution', 'Signal', 'PaperTrade', 'Position',
    'Notification', 'Moderation', 'Report', 'Setting', 'TradingWorkspace',
    'PersonalAgentChannel', 'AgentCommand', 'TradeIntent', 'BrokerAuthorization',
    'BrokerOAuthState', '_prisma_migrations'
  ] LOOP
    IF to_regclass(format('public.%I', app_table)) IS NULL THEN
      RAISE EXCEPTION 'Missing Wagent Ai table %. Apply Prisma migrations first.', app_table;
    END IF;
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', app_table);
    EXECUTE format('REVOKE ALL PRIVILEGES ON TABLE public.%I FROM PUBLIC, anon, authenticated', app_table);
  END LOOP;
END
$wagent$;
COMMIT;
