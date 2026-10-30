# WhatsApp information and SOL withdrawals

All commands must come from the creator in their paired personal WhatsApp agent chat. Pairing proves chat ownership; it does not grant spending or withdrawal permission.

| Command | Response |
| --- | --- |
| `Balance` | Native SOL in the dedicated trading wallet, estimated USD value, token count and balance timestamp. If no dedicated wallet exists, the verified owner wallet is explicitly labelled. |
| `Portfolio` | Native SOL, token amounts, exact addresses, price/value estimates and missing-price notices. Replies show up to eight tokens. |
| `Token <address>` or `Token details <address>` | Exact-address DEX Screener data: ticker/name, price, 24h change/volume, liquidity, market cap and pool creation time where indexed. |
| `Trade history` | Five recent Wagent buys/sells for the selected user wallet, statuses and transaction links. This is not all wallet activity. |
| `My limits` | Independent trading/withdrawal status, limits, remaining UTC daily budgets, reserved fees and expiry. |
| `Check trade` | Checks the latest buy/sell request in this paired chat. Review-only or rejected requests show that no WhatsApp order was submitted. An unrelated historical confirmation is never used as their result. |
| `Check trade <reference>` | Checks a particular trade or request reference, with its original request timestamp. It never submits or repeats an order. |
| `Help` | Commands and permission requirements. |

USD values are estimates from indexed pools. Missing metrics stay unavailable; cached data keeps its original timestamp. Pool creation time is not token creation time or a safety endorsement. No external API key is added for these information commands.

A website review link does not place an order. If chat trading permission is absent, revoked or expired, the review explains why and links directly to reviewing/signing new permission for the existing trading wallet. Reactivating permission never executes old review requests automatically. Send a fresh buy/sell command after approval. If a rejected retry was blocked by an unresolved earlier order, Check trade clearly separates the rejected request from the earlier order's status.

## Approve WhatsApp withdrawals once

In **WhatsApp trading**, open **Withdraw SOL from WhatsApp → Set up WhatsApp withdrawals**. Verify the fixed original owner address, set a per-withdrawal total budget, UTC daily budget, fee cap and expiry, and review the exact permission before signing with that Solana owner account in MetaMask, Binance Wallet or another supported wallet. Approval moves no funds. Existing trading grants never automatically authorize withdrawals.

The recipient cannot be supplied through chat. Only native SOL can be withdrawn this way. Binance Wallet is distinct from Binance Exchange; exchange deposit addresses cannot replace the original signing owner.

1. Send `Withdraw 0.001 SOL`.
2. Read the amount, trading wallet, original recipient, maximum fee and expiry in the reply.
3. Send the exact `CONFIRM WITHDRAW <12-character code>` within two minutes.
4. Use `Check withdrawal` for the transaction result. Never repeat an uncertain financial command.

`Cancel withdrawal` cancels an unsigned preview. A new request cancels the previous preview. Codes are single use and bound to the user, fixed recipient, signed permission and paired chat. Transfer amount plus the full fee reserve must fit both budgets. Expired, cancelled and rejected unsigned requests release their reservation. Failed, confirmed and uncertain submissions retain it for the UTC day. Replacing approval does not reset daily usage.

`Revoke withdrawals` revokes withdrawal access only. `Revoke trading` revokes trading only. `Revoke access`, `Stop all` and workspace pause revoke both. Changing/disconnecting the WhatsApp connection or original verified wallet invalidates withdrawal access. Submitted transactions cannot be recalled. Reviewing a website withdrawal revokes both advance chat permissions; the website's fresh owner-signed recovery flow remains available.

Keys remain encrypted on the server. Limits are enforced by Wagent software, not by an on-chain spending contract. Set `SOLANA_CHAT_WITHDRAWALS_ENABLED=false` as an independent server kill switch. The default is enabled capability with **no user access until a separate owner-signed grant exists**.

## Operations and testing

Migration `20261030094135_whatsapp_information_and_sol_withdrawals.sql` adds two server-only tables with RLS and revoked browser-role access. Apply committed SQL migrations before deploying the code. The existing cloud worker and paired-chat credentials handle the new commands.

Withdrawal preparation checks funds, fee cap, simulation, ownership, permission and unresolved operations. A fenced per-user lock coordinates final validation, revocation and the single network send. Unknown submissions are never retried automatically. Status checks use the saved signature and can mark finalized failures or safely observed expiry.

Regression tests use disposable in-memory PostgreSQL and mocked network providers. No funded production transfer is required to verify this feature.
