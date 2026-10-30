# Wagent Ai

## Register
product

## Users
People create a private Solana token agent and pair their own personal WhatsApp agent. An EVM message from MetaMask, Binance Wallet, or Phantom identifies the workspace account. A separate Solana owner account approves manual swaps or signs advance permission for a separately funded, server-managed chat trading wallet. After pairing, a guided flow connects the owner, funds the dedicated wallet with an explicitly approved SOL transfer, and reviews spending limits. Existing workspaces remain tied to their original EVM address.

## Product Purpose
Build a Solana agent and connect its conversation. Available now: private agents, WhatsApp ownership pairing, DEX Screener discovery, private watchlists, wallet-approved Jupiter swaps, optional permissioned WhatsApp trading with budgets/expiry/revoke and owner-signed withdrawals, and configurable discovery/price/liquidity alerts using DEX Screener. Dedicated-wallet keys are held encrypted by the service; limits are application-enforced and must never be described as on-chain delegation. Missing provider keys show setup required. Background alerts and WhatsApp commands require a persistent worker. Without active permission, chat buy/sell requests produce website review links. Exit automation and the marketplace remain Coming soon. DEXTools, Coinbase, and Birdeye are not used. Old records are preserved; isolated demos retain paper execution.

Production polling uses Supabase Cron to invoke a protected Vercel worker every 10 seconds, independently of the owner's computer. A fenced database lease coordinates overlapping invocations and bounded batches preserve existing per-command and permission checks. Hosting/provider availability and account quotas still apply. Local polling is an optional development/standalone alternative.

## Brand Personality
Calm, precise, independent. A useful marketplace with credible detail and no profitability promises.

## Anti-references
No subscription upsells, invented verified returns, casino styling, or ambiguous live-trading controls. Avoid clutter, decorative glass, and excessive accent colors.

## Design Principles
Lead with agent creation and WhatsApp pairing. Keep network, mint identity, liquidity, data age, and capability states explicit. Never label token profiles as every launch or pool age as mint age. Never imply that a listing is a safety endorsement. Keep completed setup separate from future execution. Preserve ownership isolation, credential encryption, activity history, and emergency stop. No fabricated prices, balances, user counts, returns, or AI capabilities.

WhatsApp trading offers explicit owner-signed token access: any supported Solana token, or selected saved mints. One any-token approval allows later exact-mint commands until expiry or revocation, within unchanged budget and transaction protections. Existing grants stay restricted until the owner signs broader access. Saving individual mints is optional for any-token setup. No approval signs or funds a trade on its own.

## Accessibility & Inclusion

The paired WhatsApp chat answers Balance, Portfolio, Token <address>, Trade history, and My limits with live on-chain balances or explicitly dated DEX Screener estimates. Native SOL withdrawals use an independently signed, expiring permission bound to the original Solana owner and paired chat. A request previews the fixed recipient and amount, then requires its unique confirmation code within two minutes. Amount plus the reserved fee cap counts against per-withdrawal and UTC daily budgets; failures and uncertain submissions retain their reservation. Revocation, connection changes, owner changes and emergency stop block new sends. Unknown results are reconciled read-only and never automatically resent. Existing trading grants do not authorize withdrawals.

Portfolio displays real Solana balances and DEX Screener estimates for both the dedicated trading wallet and verified owner wallet. Missing prices remain unavailable. Dedicated-wallet sales on the website require a fresh, session-bound owner signature authorizing one exact reviewed transaction, preserving the existing route, simulation, fee, expiry, emergency-stop and replay protections. Sale proceeds remain in the same trading wallet. Symbol labels always retain the exact token address as the identity.
Keyboard navigation, semantic controls, visible focus, readable contrast, reduced-motion support, responsive mobile workflows.
