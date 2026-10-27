-- Existing signatures remain restricted to their original mint lists.
ALTER TABLE public."SolanaTradePermission"
  ADD COLUMN "tokenScope" TEXT NOT NULL DEFAULT 'AGENT_MINTS',
  DROP CONSTRAINT "SolanaTradePermission_allowedMints_check",
  ADD CONSTRAINT "SolanaTradePermission_tokenScope_check"
    CHECK ("tokenScope" IN ('AGENT_MINTS', 'ANY_SOLANA')),
  ADD CONSTRAINT "SolanaTradePermission_allowedMints_check"
    CHECK (("tokenScope" = 'AGENT_MINTS' AND cardinality("allowedMints") BETWEEN 1 AND 10)
      OR ("tokenScope" = 'ANY_SOLANA' AND cardinality("allowedMints") = 0)),
  ADD CONSTRAINT "SolanaTradePermission_any_token_consent_check"
    CHECK ("tokenScope" <> 'ANY_SOLANA' OR position(
      E'\nToken scope: Any supported Solana token\nAllowed mints: Any supported Solana token\n'
      IN "consentMessage") > 0);
