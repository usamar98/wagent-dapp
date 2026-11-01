# WhatsApp commands on Robinhood Chain

The creator's paired chat is the command channel. Pairing grants no spending or withdrawal permission. See [setup and controls](ROBINHOOD.md).

| Command | Behavior |
| --- | --- |
| Buy 0.001 ETH of <0x token address> | Buy with the stated ETH amount under an active trading grant. |
| Sell 100 of <0x token address> | Sell that quantity held by the dedicated wallet. |
| Balance | Native ETH, exact wallet and timestamp. |
| Portfolio | Native ETH and up to eight token holdings with original tickers, exact addresses, prices/value estimates and timestamps. |
| Token <address> or Token details <address> | DEX Screener Robinhood price, change, volume, liquidity and pool information. |
| Trade history | Five recent Wagent Robinhood trades and saved references. |
| My limits or Status | Separate grant states, scope, ETH budgets, expiry, daily usage and provider readiness. |
| Check trade | Read the latest attempted trade in this chat. No unrelated historical confirmation is used for a new review or rejection. |
| Check trade <reference> | Read one earlier request or trade; a legacy Solana result is labelled historical. |
| Withdraw 0.001 ETH | Preview native ETH to the fixed original owner under separate withdrawal approval. |
| CONFIRM WITHDRAW <code> | Confirm that preview within two minutes; the code is single use. |
| Cancel withdrawal | Cancel unsigned chat-withdrawal previews. |
| Check withdrawal | Read status without confirming or repeating a transfer. |
| Revoke trading | End advance trading authority. |
| Revoke withdrawals | End withdrawal authority and cancel unsigned previews. |
| Revoke access | End both advance permissions. |
| Stop all | End access and activate emergency stop. Clear it on the website before enabling new access. |
| Help | Show formats and requirements. |

The amount plus reserved gas must fit the total budget. Free API plans do not eliminate gas or applicable swap fees. Any-token permission still needs liquidity, sufficient funds and a supported executable route.

An approval-only result is distinct from a swap. Unknown submissions are never blindly repeated. Check commands never place, confirm or repeat financial actions.

Absent, revoked or expired access produces a NOT SUBMITTED website review link with a reason and request reference. New approval never replays old commands. Website recovery uses a fresh owner signature and revokes advance chat permissions. Legacy Solana recovery preserves access to old funds.
