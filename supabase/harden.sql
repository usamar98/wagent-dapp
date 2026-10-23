-- Run after SQL migrations, using the Supabase database owner.
-- Wagent Ai uses wallet sessions and its Express API. Supabase browser roles
-- must not receive direct access to credentials, sessions, orders, or user data.
-- This is an idempotent setup script, not a replacement migration history.
BEGIN;
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
COMMIT;
