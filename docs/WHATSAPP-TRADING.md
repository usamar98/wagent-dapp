# WhatsApp trading

## User setup

1. Create a private agent with exact token mint addresses and select it in Connections.
2. Pair your own personal WhatsApp agent. Pairing alone never enables spending.
3. Select **Set up wallet & add SOL** in Connections. The guided flow has three steps: **Connect wallet**, **Add SOL**, and **Approve limits**. Binance Wallet, Phantom, Solflare, and compatible Wallet Standard wallets can verify the original Solana owner account.
4. Accept the custody disclosure and create a dedicated trading wallet. Wagent holds its signing key encrypted; the main wallet’s private key is never requested. Enter a SOL amount, review the recipient and estimated fee, then approve the one-time deposit in the connected wallet. Alternatively, expand **Transfer from Binance Exchange or another wallet**, copy the address, and send native SOL on Solana mainnet. Balance checks use real RPC data.
5. Continue to **Approve limits**. Agent mints are initially selected and remain editable before consent; select permitted tokens, per-trade and UTC daily SOL budgets, and expiry. Fee/rent and slippage controls are available in an expandable section, with their current values always summarized. Review the exact complete message and sign with the original owner wallet. A deposit or WhatsApp pairing never grants spending permission.
6. Setup is complete when WhatsApp is paired, a token agent is selected, the original owner is verified, the trading wallet has SOL, permission is active, and the worker/provider are ready. The page shows missing requirements without inventing balances or permissions. It is possible to approve limits before adding SOL; the funding step stays incomplete until a real balance is detected.
7. In the paired chat send `Buy 0.01 SOL of <mint>` or `Sell 100 of <mint>`. These commands submit real trades immediately when permission is active. `Check trade` reads confirmation without submitting a new order. Without permission, requests return website review links.

The current chat policy accepts user-paid Metis exact-input v2 routes with one dedicated-wallet signer. Unsupported routers, route layouts, authority changes, unsafe simulations, and routes without verified expiry are blocked. Use the manual Buy & sell flow for unsupported routes. Not every listed token has an executable route.

### Deposit handling

`POST /api/solana/chat-trading/funding/prepare` requires a fresh authenticated session and the verified original owner of the user's dedicated wallet. It accepts only an amount, fixes the recipient to that trading wallet, checks the original owner's SOL balance and fee, simulates exactly one native SOL System transfer, and returns an unsigned transaction with a 60-second review expiry. It does not sign, broadcast, store wallet keys, or revoke existing permissions. No database migration or extra provider/API key is needed.

The browser independently checks the full transfer layout, sole signer, recipient, amount, and absence of extra instructions. The wallet's `solana:signAndSendTransaction` feature shows the one-time approval and handles submission on mainnet with preflight enabled. Wallets without that feature use the copy-address alternative. Funding requests are never automatically retried. A returned signature is shown as submitted, with an explorer link and real balance refresh; an ambiguous wallet response requires checking Activity before starting another transfer. Withdrawals and revocation remain available outside the setup steps.

## Binance Wallet

Open the website in the Binance Wallet DApp browser or a desktop browser with Binance Wallet Extension installed. Choose **Continue with Binance Wallet** to sign in with its EVM account, then choose **Binance Wallet** in the Solana wallet selector in WhatsApp trading. Phantom users can choose **Continue with Phantom** in Phantom's browser or extension, using its documented EVM provider for sign-in and Wallet Standard for the separate Solana owner account. Existing workspaces belong to their original EVM address; a different address creates a separate workspace, without copying permissions or funds. MetaMask sign-in remains available.

Connect the Solana account, approve the ownership message, create the dedicated wallet, fund its displayed Solana mainnet address, and review/sign the spending permission. Binance may require confirmation in its mobile app for keyless-wallet signatures. The same original Solana account signs withdrawals. Never enter a seed phrase or private key on this website.

There is no Binance Exchange API integration or API key. Binance Exchange can fund the dedicated address using a SOL withdrawal on the Solana network. Trading still uses Jupiter from the separately funded Wagent wallet. No QR pairing or remote WalletConnect session is offered; open the site in the supported wallet browser/extension. A detected wallet must support Solana mainnet and the requested account-level signing feature. Account changes invalidate open reviews, and signatures are checked against the exact message and original owner before submission; the API independently verifies every proof.

Provider references: [Binance Solana Wallet Standard](https://developers.binance.com/en/docs/products/web3-connect/solana-provider), [Binance EVM provider for workspace sign-in](https://developers.binance.com/en/docs/products/web3-connect/evm-compatible-provider), [Binance Wallet setup](https://www.binance.com/en/support/faq/detail/ebfa9f504ec548968bf0c1ed591a3eaa).

## Limits and revocation

- Buy SOL input or sell quoted SOL output is the trade value. The full network-fee/rent cap is added for budget reservation. This is a quoted-value trading budget, not a valuation guarantee.
- Both buys and sells count. Daily usage is reserved in UTC when preparing the signed transaction, across all permissions for the account. Replacing a permission does not reset usage. Failed and uncertain submissions retain their reservation conservatively.
- Per-trade budget supports up to 10 SOL, daily budget up to 100 SOL. Fee/rent cap is 0.000005–0.01 SOL and below the trade budget. Slippage is at most 2%; the supported on-chain route’s provider fee is at most 1%.
- Permission is bound to the website, account, original owner wallet, dedicated address, paired WhatsApp owner and connection fingerprint, selected agent instance, mint list, limits, and expiry. A one-use, session-bound signature approves the exact stored message.
- **Revoke trading access**, chat `Revoke trading`, `Pause`, `Stop`, or `Stop all` blocks new submissions. Changing the selected agent, replacing/disconnecting WhatsApp, or changing/unlinking the owner wallet also revokes. Clearing emergency stop never re-enables a grant.
- Revoke and final submission serialize on the same user database lock. An already submitted transaction cannot be recalled. An uncertain transaction blocks further trading until read-only chain reconciliation resolves it; it is never automatically rebroadcast.

## Custody and withdrawals

This is a server-managed hot wallet, not an on-chain spending contract or a hardware-wallet session key. Limits are enforced by Wagent’s backend. Anyone who compromises the trusted signing service and original encryption key may be able to bypass those software limits. The UI and signed consent disclose this before enabling trading. Fund only the dedicated wallet; the service cannot sign transactions for the main wallet.

The wallet key uses AES-256-GCM with a per-user derived encryption key and user/address authenticated context. Public responses never contain the seed or signing key. Preserve the original `CREDENTIAL_ENCRYPTION_KEY`, including during deployment and database migration. Losing it loses access to the dedicated wallet.

Withdrawals require a new message signature from the **original owner wallet**, even if it has since been unlinked. The destination is fixed to that original wallet; arbitrary recipients and unsigned chat withdrawals are unavailable. Reviewing a withdrawal revokes chat trading. SOL and supported SPL/Token-2022 tokens can be transferred; tokens requiring unsupported transfer hooks can fail simulation and are not submitted. A transfer can use one source token account at a time. Keep SOL for network fees and destination-account rent. Withdrawal history exposes read-only confirmation checks and never retries an uncertain transfer.

## Hosting and configuration

No additional API service or shared signing key is required. Keep the verified `DATABASE_URL`, original `CREDENTIAL_ENCRYPTION_KEY`, canonical production `APP_URL`, `JUPITER_API_KEY` with Swap and Tokens permissions, and `SOLANA_SWAPS_ENABLED=true`. `SOLANA_RPC_URL` is used for account checks, transaction simulation, fee estimates, withdrawal submission, and confirmation. The default public mainnet RPC can be rate-limited; a reliable HTTPS RPC is appropriate for a busy deployment.

`SOLANA_CHAT_TRADING_ENABLED=false` is an optional server-wide kill switch. Otherwise chat trading is available when Jupiter swaps are enabled; each user still needs a signed grant. There is no default spending permission for existing users.

The persistent worker still polls WhatsApp. For a production channel, it dispatches the saved command to that production website with a short-lived HMAC using the existing per-user WhatsApp credential. The website checks the live lease, paired owner, stored command, and origin before execution. The Jupiter API key stays on the website API and is not required on a shared local polling worker. Vercel alone does not keep the polling worker alive.

Apply `20261026172252_whatsapp_trading_permissions.sql` before deploying the API. It adds five RLS-enabled backend-only tables without changing existing customer records. No funds should be moved as part of deployment or automated testing.

References: [Jupiter order and execution](https://developers.jup.ag/docs/swap/order-and-execute), [Solana simulation](https://solana.com/docs/rpc/http/simulatetransaction), [Jupiter CPI IDL](https://github.com/jup-ag/jupiter-cpi/blob/main/idl.json), [Metis v2 instruction layout](https://github.com/sevenlabs-hq/carbon/blob/main/decoders/jupiter-swap-decoder/src/instructions/route_v2.rs).
