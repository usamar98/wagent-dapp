import { useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, ArrowUpRight, Copy, RefreshCw, Wallet } from 'lucide-react';
import { api } from './api';
import { canFundWithWallet, fundSolanaWallet, solFundingLamports, walletLabel, type SolanaWallet } from './solana-wallet';
import { walletError } from './wallet';
import { Notice } from './solana-ui';
import s from './solana.module.css';
import { useTokenIdentities } from './token-identity';

export type TradingBalance = { sol: string; tokens: { mint: string; amount: string }[] };
type Deposit = { from: string; to: string; amount: string; lamports: string; feeSol: string; ownerBalanceSol: string; transaction: string; expiresAt: string };
export function TradingFunding({ address, ownerAddress, wallet, balances, balanceError, balanceBusy, refresh, onContinue }: {
  address: string; ownerAddress: string; wallet: SolanaWallet | undefined; balances: TradingBalance | null; balanceError: string; balanceBusy: boolean; refresh(): Promise<void>; onContinue(): void;
}) {
  const [amount, setAmount] = useState(''), [quote, setQuote] = useState<Deposit | null>(null), [signature, setSignature] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState(''), [uncertain, setUncertain] = useState(false), [copied, setCopied] = useState(false);
  const sending = useRef(false);
  const tokenInfo = useTokenIdentities(balances?.tokens.map(t=>t.mint)||[]);
  const hasFunds = !balanceError && Number(balances?.sol) > 0;
  useEffect(() => { setQuote(null); setSignature(''); setUncertain(false); }, [address, ownerAddress, wallet]);
  async function review(event: FormEvent) {
    event.preventDefault(); setBusy(true); setError(''); setQuote(null);
    try {
      const lamports = solFundingLamports(amount.trim()), next = await api<Deposit>('/solana/chat-trading/funding/prepare', { amount: amount.trim() });
      if (next.from !== ownerAddress || next.to !== address || next.lamports !== String(lamports)) throw new Error('The deposit review does not match your wallets and amount. Reconnect and review again.');
      setQuote(next);
    } catch (failure) { setError(walletError(failure)); } finally { setBusy(false); }
  }
  async function deposit() {
    if (!wallet || !quote || busy || sending.current) return;
    sending.current = true; const reviewed = quote; setQuote(null); setBusy(true); setError('');
    let submittedToWallet = false;
    try { setSignature(await fundSolanaWallet(wallet, reviewed, () => { submittedToWallet = true; })); await refresh(); }
    catch (failure) { setError(walletError(failure)); if (submittedToWallet && (failure as { code?: number }).code !== 4001) setUncertain(true); }
    finally { sending.current = false; setBusy(false); }
  }
  return <div className={s.fundingPanel}>
    <div className={s.fundingBalance}><span>Available for WhatsApp trading</span><strong>{balanceError ? 'Balance unavailable' : balances ? `${balances.sol} SOL` : balanceBusy ? 'Checking balance…' : 'Balance unavailable'}</strong><button className={s.textLink} disabled={busy || balanceBusy} onClick={() => void refresh()}><RefreshCw size={13}/>Check balance</button></div>
    {balanceError && <Notice error>{balanceError} Use Check balance to retry.</Notice>}
    {error && <Notice error>{error}</Notice>}
    {signature || uncertain ? <div className={s.permissionReview} role="status"><h3>{signature ? 'Deposit submitted' : 'Check your wallet before trying again'}</h3><p>{signature ? 'Check the transaction and refresh the balance. A submitted signature is not a confirmation.' : 'A transfer may have been submitted. Check your wallet’s Activity and the trading balance. No transfer will be retried automatically.'}</p>{signature && <a className={s.textLink} href={`https://solscan.io/tx/${signature}`} target="_blank" rel="noreferrer">View deposit <ArrowUpRight size={13}/></a>}<button className={s.textLink} disabled={busy} onClick={() => { setSignature(''); setUncertain(false); setAmount(''); setError(''); }}>Start a new transfer</button></div> : <>
      {canFundWithWallet(wallet) ? <form onSubmit={event => void review(event)}><label className={s.field}>SOL to add<input inputMode="decimal" value={amount} placeholder="Enter an amount" required disabled={busy} onChange={event => { setAmount(event.target.value); setQuote(null); }}/></label><button className={s.button} disabled={busy || !amount.trim()}><Wallet size={15}/>{busy ? 'Check your wallet…' : 'Review SOL deposit'}</button><p className={s.fine}>Move SOL from {walletLabel(wallet!)} to your trading wallet. Your wallet asks you to approve this one transfer. Keep SOL for trading fees.</p></form> : <p className={s.fine}>Send SOL to the deposit address below. Your selected wallet does not offer in-app transaction sending.</p>}
      {quote && <div className={s.permissionReview}><h3>Review your deposit</h3><dl className={s.quoteDetails}><div><dt>SOL to add</dt><dd>{quote.amount} SOL</dd></div><div><dt>Estimated network fee</dt><dd>{quote.feeSol} SOL</dd></div><div><dt>In your owner wallet</dt><dd>{quote.ownerBalanceSol} SOL</dd></div></dl><p className={s.fine}>From your owner wallet: <code>{quote.from}</code><br/>To your Wagent trading wallet: <code>{quote.to}</code></p><button className={s.button} disabled={busy || !wallet} onClick={() => void deposit()}>Approve deposit in {wallet ? walletLabel(wallet) : 'wallet'}</button><p className={s.fine}>Review the amount and recipient in your wallet. This transfer does not enable WhatsApp spending.</p></div>}
    </>}
    <details className={s.setupDetails}><summary>Transfer from Binance Exchange or another wallet</summary><p>Withdraw native SOL using the Solana network to this address. Check the address, fee, and withdrawal minimum. Send a small test first. Cash and other networks are not supported here.</p><label className={s.field}>Deposit address · Solana mainnet<code className={s.depositAddress}>{address}</code></label><button className={`${s.button} ${s.secondary}`} onClick={() => void navigator.clipboard.writeText(address).then(() => setCopied(true)).catch(() => setError('Could not copy the address. Select and copy it manually.'))}><Copy size={14}/>{copied ? 'Address copied' : 'Copy deposit address'}</button></details>
    {balances && balances.tokens.length > 0 && <details className={s.setupDetails}><summary>Tokens in this trading wallet ({balances.tokens.length})</summary>{balances.tokens.map((token, i) => <p className={s.fine} key={`${token.mint}-${i}`}>{token.amount} {tokenInfo.find(t=>t.mint===token.mint)?.symbol||'tokens'} <code>{token.mint}</code></p>)}</details>}
    <button className={`${s.button} ${hasFunds ? '' : s.secondary}`} disabled={busy} onClick={onContinue}>{hasFunds ? 'Continue to trading limits' : 'Set limits before adding SOL'}<ArrowRight size={15}/></button>
  </div>;
}
