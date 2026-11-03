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
2. Open WhatsApp trading and choose MetaMask or Phantom. Verify the original owner by signing the displayed custody/ownership message. This creates a new encrypted EVM trading key but grants no spending.
3. Review a native-ETH transfer from that owner or copy the dedicated address for an external deposit. ETH must be on Robinhood Chain. Exchange balances and Robinhood brokerage balances are separate from connected EVM wallets.
4. Review and sign a new trading permission. Choose Any supported Robinhood token or selected ERC-20 addresses, total per-operation and UTC daily ETH budgets, gas reserve, slippage and expiry.
5. Send Buy 0.001 ETH of <0x token address> or Sell 100 of <0x token address> in the paired owner chat. An any-token grant permits later exact addresses without editing a list. Funds and executable supported routes are still required.

Private old agents may be selected, but their saved Solana addresses are not Robinhood assets. New grants explicitly name chain 4663 and cannot reuse a Solana signature. Portfolio's Add ETH action tops up the existing dedicated wallet without repeating setup or changing grants.

Wagent holds the dedicated signing key encrypted. Limits are application-enforced, not an on-chain spending contract. A service or encryption-key compromise could put deposits at risk. The main owner key is never requested. Personal agent chats are not end-to-end encrypted.

## Two WhatsApp connections, one trading wallet

Connections supports two slots, each with its own encrypted personal-agent key, pairing code, message cursor, fenced polling lease and creator chat. The existing connection remains Agent 1. Both use the same original owner and existing RHWallet; adding Agent 2 never creates a new funded wallet or copies Agent 1's permission. The saved platform agent configuration is shared, and changing it invalidates both trading approvals.

In WhatsApp trading, select Agent 1 or Agent 2 and review a separate owner-signed approval. Each review identifies the connection, chat and slot, individual per-operation and UTC daily limits, and combined wallet per-operation and UTC daily ceilings. Signing updates the displayed combined ceiling for both connections while granting execution access only to the selected connection. Trade and withdrawal budgets remain separate. A stale review cannot overwrite a more recent shared-budget approval. The combined ceiling is not execution authority and remains in force after revocation or disconnection. Existing Agent 1 consent remains bounded by its original daily budget until a new shared ceiling is signed.

Each order checks the selected agent's individual limits and the wallet's combined limits, including reserved gas, under the existing user lock before signing and sending. Usage does not reset on approval renewal, key replacement, disconnect or reconnect in the same slot. One unresolved wallet operation blocks another financial operation across both chats. Upstream message IDs are scoped by connection, with compatibility checks for previously recorded IDs. Activity and receipts identify the requesting connection, and Check trade only follows requests from that chat.

Agent 2 withdrawals start off. Enabling them requires separate owner-signed withdrawal consent. The fixed recipient remains the original owner, and confirmation codes, cancellation and status are scoped to the requesting connection. A code from Agent 1 cannot be used by Agent 2. Revoke trading, Revoke withdrawals and Revoke access affect the current chat; Stop all or Pause revokes both connections and activates the emergency stop. Website controls allow individual revocation or Revoke all access. Disconnecting or replacing one key revokes only that connection. Alert delivery currently uses Agent 1.

## Transaction safeguards

Amount plus reserved gas counts against both signed budgets. Daily usage continues across grant replacement. The app binds original owner, dedicated wallet, agent, paired chat, connection fingerprint, network, scope and expiry.

0x AllowanceHolder transactions are checked against the current on-chain Settler registry. Executable calldata must protect the intended recipient, input asset/amount, output asset and minimum receive. Unsupported layouts fail closed. Only the exact input amount may be approved to the verified AllowanceHolder, never unlimited approval or approval to the Settler itself.

Gas estimation uses an explicit buffered gas price and a gas ceiling bounded by the approved fee cap and the paying wallet's available ETH. Estimation and the final simulation must both succeed before signing. Missing 0x liquidity, insufficient balances, on-chain reverts and changed network gas prices produce distinct messages; none triggers an automatic financial retry. A token appearing in DEX Screener is discovery data, not proof that 0x can buy or sell it. When no executable route exists, the app cannot force a swap.

A sale may require a token approval and then a swap. Both must fit the gas reserve. If approval/submission is uncertain, processing stops at the saved hash. Check commands do not send or advance financial actions. An approval-only result explicitly says no swap was submitted; a fresh order is required after checking the result.

Hashes and nonces are persisted before a single network send. Unknown submissions retain reservations and are never blindly resent. Review links are NOT SUBMITTED and explain absent, expired or revoked permissions. Renewing access does not replay old requests. Status replies identify the exact request and timestamp.

## Withdrawals

Website recovery returns ETH or supported ERC-20s to the original owner under a fresh one-use signature. Reviewing recovery revokes advance chat permissions. The recipient, asset and amount are fixed; gas and nonce may refresh only within the signed maximum.

WhatsApp withdrawals require a separate native-ETH grant with per-operation/daily budgets, gas cap and expiry. Withdraw 0.001 ETH creates a preview to the fixed original owner. Send CONFIRM WITHDRAW <code> within two minutes. Codes are single use and bound to that permission and chat; users cannot supply a different recipient.

Cancel withdrawal cancels an unsigned preview. Revoke trading and Revoke withdrawals are independent. Revoke access and Stop all end both. Already submitted transactions cannot be recalled. Trading access alone never authorizes withdrawals.

## Preserved Solana funds

Migration 20261101100204_robinhood_chain.sql creates seven private RLS-enabled RH tables. It retires old advance Solana grants but preserves encrypted keys, original owners, operations and history. Apply it through the existing migration runner before deployment.

The Legacy Solana recovery screen and product links have been retired at the owner’s request; old page URLs redirect to Portfolio. Stored keys, balances and history remain intact, and owner-scoped compatibility APIs are retained. No assets were bridged or converted by removing the screen. New Solana trading remains disabled.

## Worker alerts and verification

The existing protected Vercel worker and Supabase Cron remain in use. Up to 20 alert rules per user and 20 due rules per cycle are processed. Discovery establishes a baseline and deduplicates later observations from the latest indexed profiles. Threshold checks skip stale/missing data. This is limited discovery coverage, not every launch.

Run npm test and npm run build. Tests use embedded PostgreSQL, ephemeral wallets and mocked providers. No live WhatsApp message or funded transfer is required. Provider-key readiness and authentication can be checked in production before keys are added; actual quote coverage requires the configured providers.

Sources: [Robinhood network](https://docs.robinhood.com/chain/connecting/), [0x contracts](https://docs.0x.org/docs/core-concepts/contracts), [0x fees](https://0x.org/pricing), [Alchemy pricing](https://www.alchemy.com/pricing), [DEX Screener API](https://docs.dexscreener.com/api/reference).
