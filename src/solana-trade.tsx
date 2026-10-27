import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowDownUp, ArrowUpRight, Wallet } from 'lucide-react';
import { api, date } from './api';
import { LoadingRows, Notice, PageHeading, SolMark, useResource } from './solana-ui';
import { availableWallets, observeWallets, linkWallet, signSwap, walletLabel, type SolanaWallet } from './solana-wallet';
import { SolanaWalletPicker } from './solana-wallet-picker';
import { walletError } from './wallet';
import s from './solana.module.css';

type Swap = { id: string; status: string; walletAddress: string; signature: string | null; error: string | null; expiresAt: string; createdAt: string; transaction?: string; quote: { input: string; output: string; minimumOutput: string; from: { symbol: string; id: string }; to: { symbol: string; id: string }; slippageBps: number; feeBps: number; feeMint: string | null; networkFeeLamports: number; priceImpact: number | null; router: string } };
type Desk = { wallet: { address: string } | null; swaps: Swap[]; providers: { swapsEnabled: boolean; jupiter: boolean } };
export default function SolanaTrade() {
  const desk = useResource<Desk>('/solana/swaps', true, 15000), [params] = useSearchParams();
  const [wallets, setWallets] = useState<SolanaWallet[]>([]), [selected, setSelected] = useState('');
  const [side, setSide] = useState(params.get('side') === 'SELL' ? 'SELL' : 'BUY'), [mint, setMint] = useState(params.get('mint') || ''), [amount, setAmount] = useState(params.get('amount') || ''), [slippage, setSlippage] = useState('1');
  const [quote, setQuote] = useState<Swap | null>(null), [busy, setBusy] = useState(''), [error, setError] = useState(''), [clock, setClock] = useState(Date.now());
  useEffect(() => observeWallets(() => { const next = availableWallets('transactions'); setWallets(next); setSelected(current => current || next[0]?.name || ''); setQuote(null); }), []);
  useEffect(() => { const timer = setInterval(() => setClock(Date.now()), 1000); return () => clearInterval(timer); }, []);
  const localWallet = wallets.find(w => w.name === selected), address = desk.data?.wallet?.address;
  async function act(label: string, work: () => Promise<void>) { setBusy(label); setError(''); try { await work(); } catch (e) { setError(walletError(e)); } finally { setBusy(''); void desk.reload(); } }
  async function requestQuote(event: FormEvent) { event.preventDefault(); setQuote(null); await act('quote', async () => setQuote(await api('/solana/swaps/quote', { side, mint: mint.trim(), amount: amount.trim(), slippageBps: Math.round(Number(slippage) * 100), requestId: crypto.randomUUID() }))); }
  async function execute() {
    if (!quote?.transaction || !address || !localWallet) return;
    await act('sign', async () => {
      const signedTransaction = await signSwap(localWallet, address, quote.transaction!);
      try { const result = await api<Swap>(`/solana/swaps/${quote.id}/execute`, { signedTransaction }); setQuote(result); }
      catch (failure) { setQuote(null); throw new Error(`${(failure as Error).message} Check swap history before trying another order.`); }
    });
  }
  const seconds = quote ? Math.max(0, Math.floor((Date.parse(quote.expiresAt) - clock) / 1000)) : 0;
  return <><PageHeading label="JUPITER · SOLANA MAINNET" title="Your wallet. Your next move." description="Swap SOL and Solana tokens. Review each quote and approve each transaction in your wallet."><Link className={s.textLink} to="/chat-trading">Set up WhatsApp trading <ArrowUpRight size={15}/></Link></PageHeading>
    {(error || desk.error) && <Notice error>{error || desk.error}</Notice>}{!desk.data ? <LoadingRows/> : <>
    {!desk.data.providers.swapsEnabled && <Notice>Trading setup required. The server needs a Jupiter API key and the swaps switch enabled. Your wallet remains under your control.</Notice>}
    <div className={s.tradeLayout}><section><div className={s.connectionSection}><div className={s.formTitle}><Wallet size={20}/><div><h2>Solana trading wallet</h2><p>This page spends from the linked Solana wallet, separate from your 0x workspace identity and your WhatsApp trading balance.</p></div></div>
      {address && <p className={s.walletAddress}>{address}</p>}
      <SolanaWalletPicker wallets={wallets} selected={localWallet} disabled={!!busy} onChange={name => { setSelected(name); setQuote(null); }}/>
      <div className={s.actions}>{localWallet && <button className={s.button} disabled={!!busy} onClick={() => void act('link', async () => { await linkWallet(localWallet); setQuote(null); })}>{busy === 'link' ? 'Check wallet…' : `${address ? 'Verify' : 'Connect'} ${walletLabel(localWallet)}`}</button>}
      {address && <button className={s.textLink} disabled={!!busy} onClick={() => void act('disconnect', async () => { await api('/solana/wallet/disconnect', {}); setQuote(null); })}>Unlink wallet</button>}</div><p className={s.fine}>Ownership verification signs a message. A swap requires a separate transaction signature. Keep SOL available for network fees.</p></div>
      <form onSubmit={event => void requestQuote(event)}><div className={s.formTitle}><ArrowDownUp size={20}/><div><h2>Prepare a swap</h2><p>Use the exact mint address. Symbols can be copied.</p></div></div><div className={s.tradeTabs} role="group" aria-label="Swap direction">{['BUY', 'SELL'].map(value => <button type="button" key={value} aria-pressed={side === value} onClick={() => { setSide(value); setQuote(null); }}>{value === 'BUY' ? 'Buy with SOL' : 'Sell for SOL'}</button>)}</div>
      <label className={s.field}>Token mint<input value={mint} maxLength={44} required onChange={e => { setMint(e.target.value); setQuote(null); }} placeholder="Paste a Solana token mint" autoComplete="off"/></label>
      <div className={s.formColumns}><label className={s.field}>{side === 'BUY' ? 'SOL to spend' : 'Token amount to sell'}<input value={amount} required inputMode="decimal" onChange={e => { setAmount(e.target.value); setQuote(null); }} placeholder="0.1" autoComplete="off"/></label><label className={s.field}>Slippage limit (%)<input type="number" min="0.01" max="5" step="0.01" value={slippage} required onChange={e => { setSlippage(e.target.value); setQuote(null); }}/></label></div>
      <button className={s.button} disabled={!!busy || !address || !desk.data.providers.swapsEnabled}>{busy === 'quote' ? 'Finding a route…' : 'Review Jupiter quote'}<ArrowUpRight size={15}/></button><p className={s.fine}>Exact input swaps only. An indexed token may have no executable route. Liquidity and network fees affect the result.</p></form>
    </section><aside className={s.quotePanel}><SolMark small/><h2>Review before signing</h2>{quote ? <><span className={s.chainBadge}>{quote.status === 'QUOTED' ? `${seconds}s remaining` : quote.status}</span><dl className={s.quoteDetails}><div><dt>You pay</dt><dd>{quote.quote.input} {quote.quote.from.symbol}</dd></div><div><dt>Estimated receive</dt><dd>{quote.quote.output} {quote.quote.to.symbol}</dd></div><div><dt>Minimum receive</dt><dd>{quote.quote.minimumOutput} {quote.quote.to.symbol}</dd></div><div><dt>Slippage</dt><dd>{quote.quote.slippageBps / 100}%</dd></div><div><dt>Provider fee</dt><dd>{quote.quote.feeBps / 100}%</dd></div><div><dt>Network + rent estimate</dt><dd>{quote.quote.networkFeeLamports / 1e9} SOL</dd></div><div><dt>Price impact</dt><dd>{quote.quote.priceImpact === null ? 'Unavailable' : `${quote.quote.priceImpact}%`}</dd></div><div><dt>Router</dt><dd>{quote.quote.router}</dd></div></dl><p className={s.fine}>From mint: <code>{quote.quote.from.id}</code><br/>To mint: <code>{quote.quote.to.id}</code><br/>Wallet: <code>{quote.walletAddress}</code></p>
      {quote.error && <Notice error>{quote.error}</Notice>}{quote.status === 'QUOTED' && <button className={s.button} disabled={!!busy || seconds === 0 || !localWallet || !desk.data.providers.swapsEnabled} onClick={() => void execute()}>{busy === 'sign' ? 'Check your wallet…' : seconds ? 'Approve in wallet & swap' : 'Quote expired'}</button>}
    </> : <><p className={s.quoteEmpty}>Your route, fees, and minimum output will appear here.</p><p className={s.fine}>No swap is submitted until you approve the transaction. Wallet warnings and simulation results deserve your attention.</p></>}</aside></div>
    <div className={s.sectionHeading}><h2>Swap history</h2><Link className={s.textLink} to="/alerts">Set a token alert <ArrowUpRight size={14}/></Link></div>{!desk.data.swaps.length ? <p className={s.fine}>Your submitted swaps and quote history will appear here.</p> : <ul className={s.swapList}>{desk.data.swaps.map(swap => <li key={swap.id}><div><strong>{swap.quote.input} {swap.quote.from.symbol} → {swap.quote.output} {swap.quote.to.symbol}</strong><p>{swap.status} · {date(swap.createdAt)}</p>{swap.error && <p>{swap.error}</p>}</div><div className={s.actions}>{['EXECUTING', 'UNKNOWN'].includes(swap.status) && <button className={s.textLink} disabled={!!busy} onClick={() => void act('status', async () => { await api(`/solana/swaps/${swap.id}/reconcile`, {}); })}>Check confirmation</button>}{swap.signature && <a className={s.textLink} href={`https://solscan.io/tx/${swap.signature}`} target="_blank" rel="noreferrer">View transaction <ArrowUpRight size={13}/></a>}</div></li>)}</ul>}
    <p className={s.fine}>An unknown confirmation is not a failed swap. Check its status before placing another order.</p></>}
  </>;
}
