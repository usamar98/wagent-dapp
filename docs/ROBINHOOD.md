# Robinhood Chain setup and migration

Robinhood mainnet uses chain ID **4663**, ETH and EVM 0x addresses. Alchemy supplies RPC, 0x supplies supported exact-input swaps and DEX Screener supplies discovery, prices and liquidity.

## Vercel environment

Keep the existing DATABASE_URL, **original CREDENTIAL_ENCRYPTION_KEY**, APP_URL=https://wagent-ai.vercel.app, DEMO_MODE=false and payment configuration. Never regenerate the encryption key for an existing database.

| Variable | Value |
| --- | --- |
| ROBINHOOD_RPC_URL | Your free-plan Alchemy Robinhood mainnet HTTPS RPC URL including its private provider key |
| ZEROX_API_KEY | Your 0x key under a plan you have confirmed has no subscription charge |
| TRADING_CHAIN | Optional robinhood, the live default |
| ROBINHOOD_SWAPS_ENABLED | Optional true; false independently blocks new swaps |
| ROBINHOOD_ALERTS_ENABLED | Optional true; false stops alert checks |
| ROBINHOOD_WITHDRAWALS_ENABLED | Optional true; false blocks advance WhatsApp withdrawals |

Use Production variables and redeploy after adding them. No VITE_ prefix. The browser uses the official public Robinhood RPC only for adding the wallet network; Alchemy credentials stay on the server. Missing credentials block quotes/execution with a clear setup state.

The app does not purchase subscriptions, enable paid billing, sponsor gas or upgrade plans. Free APIs have quotas. Users pay ETH gas, pool costs and applicable 0x fees. The quoted 0x fee is capped at 1% of the quoted input/output token; positive execution surplus may be collected separately by 0x. Exact fees, minimum receive and maximum gas are shown before approval. No AI, exchange trading, DEXTools or Birdeye key is required.

## Setup

1. Sign in with the existing EVM workspace identity. Select a privately owned agent in Connections and pair the creator's personal WhatsApp agent. Existing pairings remain available.
2. Open WhatsApp trading and choose MetaMask, Binance Wallet or a compatible EVM wallet. Verify the original owner by signing the displayed custody/ownership message. This creates a new encrypted EVM trading key but grants no spending.
3. Review a native-ETH transfer from that owner or copy the dedicated address for an external deposit. ETH must be on Robinhood Chain. Binance Wallet is distinct from Binance Exchange, and Robinhood Chain is independent of brokerage balances.
4. Review and sign a new trading permission. Choose Any supported Robinhood token or selected ERC-20 addresses, total per-operation and UTC daily ETH budgets, gas reserve, slippage and expiry.
5. Send Buy 0.001 ETH of <0x token address> or Sell 100 of <0x token address> in the paired owner chat. An any-token grant permits later exact addresses without editing a list. Funds and executable supported routes are still required.

Private old agents may be selected, but their saved Solana addresses are not Robinhood assets. New grants explicitly name chain 4663 and cannot reuse a Solana signature. Portfolio's Add ETH action tops up the existing dedicated wallet without repeating setup or changing grants.

Wagent holds the dedicated signing key encrypted. Limits are application-enforced, not an on-chain spending contract. A service or encryption-key compromise could put deposits at risk. The main owner key is never requested. Personal agent chats are not end-to-end encrypted.

## Transaction safeguards

Amount plus reserved gas counts against both signed budgets. Daily usage continues across grant replacement. The app binds original owner, dedicated wallet, agent, paired chat, connection fingerprint, network, scope and expiry.

0x AllowanceHolder transactions are checked against the current on-chain Settler registry. Executable calldata must protect the intended recipient, input asset/amount, output asset and minimum receive. Unsupported layouts fail closed. Only the exact input amount may be approved to the verified AllowanceHolder, never unlimited approval or approval to the Settler itself.

A sale may require a token approval and then a swap. Both must fit the gas reserve. If approval/submission is uncertain, processing stops at the saved hash. Check commands do not send or advance financial actions. An approval-only result explicitly says no swap was submitted; a fresh order is required after checking the result.

Hashes and nonces are persisted before a single network send. Unknown submissions retain reservations and are never blindly resent. Review links are NOT SUBMITTED and explain absent, expired or revoked permissions. Renewing access does not replay old requests. Status replies identify the exact request and timestamp.

## Withdrawals

Website recovery returns ETH or supported ERC-20s to the original owner under a fresh one-use signature. Reviewing recovery revokes advance chat permissions. The recipient, asset and amount are fixed; gas and nonce may refresh only within the signed maximum.

WhatsApp withdrawals require a separate native-ETH grant with per-operation/daily budgets, gas cap and expiry. Withdraw 0.001 ETH creates a preview to the fixed original owner. Send CONFIRM WITHDRAW <code> within two minutes. Codes are single use and bound to that permission and chat; users cannot supply a different recipient.

Cancel withdrawal cancels an unsigned preview. Revoke trading and Revoke withdrawals are independent. Revoke access and Stop all end both. Already submitted transactions cannot be recalled. Trading access alone never authorizes withdrawals.

## Preserved Solana funds

Migration 20261101100204_robinhood_chain.sql creates seven private RLS-enabled RH tables. It retires old advance Solana grants but preserves encrypted keys, original owners, operations and history. Apply it through the existing migration runner before deployment.

Legacy Solana recovery remains in navigation. Verify the original Solana owner and sign the exact SOL or supported SPL withdrawal. Keep SOL for fees/rent. New Solana swaps, deposits and permissions are disabled. The migration does not bridge assets, reinterpret lamports as wei or turn old keys into EVM wallets.

## Worker alerts and verification

The existing protected Vercel worker and Supabase Cron remain in use. Up to 20 alert rules per user and 20 due rules per cycle are processed. Discovery establishes a baseline and deduplicates later observations from the latest indexed profiles. Threshold checks skip stale/missing data. This is limited discovery coverage, not every launch.

Run npm test and npm run build. Tests use embedded PostgreSQL, ephemeral wallets and mocked providers. No live WhatsApp message or funded transfer is required. Provider-key readiness and authentication can be checked in production before keys are added; actual quote coverage requires the configured providers.

Sources: [Robinhood network](https://docs.robinhood.com/chain/connecting/), [0x contracts](https://docs.0x.org/docs/core-concepts/contracts), [0x fees](https://0x.org/pricing), [Alchemy pricing](https://www.alchemy.com/pricing), [DEX Screener API](https://docs.dexscreener.com/api/reference).
