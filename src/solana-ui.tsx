import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ArrowUpRight, Check, Copy, RefreshCw, Search, Star, TriangleAlert } from 'lucide-react';
import { api } from './api';
import { type SolanaToken, type TokenFeed } from '../shared/solana';
import s from './solana.module.css';

export function useResource<T>(path: string, enabled = true, poll = 0) {
  const [data, setData] = useState<T | null>(null), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const generation = useRef(0), currentPath = useRef(path);
  if (currentPath.current !== path) { generation.current++; currentPath.current = path; }
  const reload = useCallback(async () => {
    if (!enabled) return;
    const request = ++generation.current; setBusy(true);
    try { const value = await api<T>(path); if (request === generation.current) { setData(value); setError(''); } }
    catch (failure) { if (request === generation.current) setError((failure as Error).message); }
    finally { if (request === generation.current) setBusy(false); }
  }, [path, enabled]);
  useEffect(() => { setData(null); setError(''); void reload(); const timer = poll ? setInterval(() => { if (document.visibilityState === 'visible') void reload(); }, poll) : undefined; return () => { generation.current++; clearInterval(timer); }; }, [reload, poll]);
  return { data, error, busy, reload, setData };
}
export function SolMark({ small = false }: { small?: boolean }) { return <svg className={small ? s.solSmall : s.solMark} viewBox="0 0 40 34" aria-hidden="true"><path d="M9 2h30l-8 8H1z" fill="currentColor"/><path d="M1 13h30l8 8H9z" fill="var(--violet)"/><path d="M9 24h30l-8 8H1z" fill="currentColor"/></svg>; }
export function Soon() { return <span className={s.soon}>Coming soon</span>; }
export function Notice({ error, children }: { error?: boolean; children: ReactNode }) { return <div className={`${s.notice} ${error ? s.error : ''}`} role={error ? 'alert' : 'status'}>{error ? <TriangleAlert size={17}/> : <Check size={17}/>}<div>{children}</div></div>; }
export function PageHeading({ label, title, description, children }: { label: string; title: string; description?: string; children?: ReactNode }) { return <header className={s.pageHeading}><div><p className={s.eyebrow}>{label}</p><h1>{title}</h1>{description && <p>{description}</p>}</div>{children}</header>; }
export function LoadingRows() { return <div className={s.skeleton} role="status" aria-label="Loading"><span/><span/><span/></div>; }
export const price = (value: number | null) => value === null ? 'Unavailable' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumSignificantDigits: value < 1 ? 4 : 6 }).format(value);
export const compact = (value: number | null) => value === null ? '—' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 }).format(value);
const age = (created: number | null) => { if (created === null) return 'Unknown'; const hours = Math.max(0, (Date.now() - created) / 3600000); return hours < 1 ? `${Math.floor(hours * 60)}m` : hours < 48 ? `${Math.floor(hours)}h` : `${Math.floor(hours / 24)}d`; };

export function TokenTable({ tokens, watched, onWatch, busyMint, limit }: { tokens: SolanaToken[]; watched: string[]; onWatch: (mint: string, watched: boolean) => Promise<void>; busyMint: string; limit?: number }) {
  const [notice, setNotice] = useState('');
  return <><div className={s.tokenTable}><table><thead><tr><th scope="col">Token / mint</th><th scope="col">Price <small>USD</small></th><th scope="col">24h change</th><th scope="col">Liquidity</th><th scope="col">24h volume</th><th scope="col">Pool age</th><th scope="col"><span className={s.srOnly}>Research and watch</span></th></tr></thead><tbody>{tokens.slice(0, limit).map(token => <tr key={token.mint}>
    <td><div className={s.tokenIdentity}><span className={s.tokenAvatar}>{token.symbol.slice(0, 2)}</span><div><strong>{token.symbol}</strong><span title={token.name}>{token.name}</span><button className={s.mintCopy} title={`Copy mint: ${token.mint}`} onClick={() => void navigator.clipboard.writeText(token.mint).then(() => setNotice(`Mint address copied for ${token.symbol}.`)).catch(() => setNotice(`Copy this mint address: ${token.mint}`))}>{token.mint.slice(0, 5)}…{token.mint.slice(-5)}<Copy size={10}/></button></div></div></td>
    <td className={s.numeric}>{price(token.priceUsd)}</td><td className={`${s.numeric} ${token.change24h === null ? '' : token.change24h >= 0 ? s.positive : s.negative}`}>{token.change24h === null ? '—' : `${token.change24h >= 0 ? '+' : ''}${token.change24h.toFixed(2)}%`}</td>
    <td className={s.numeric}>{compact(token.liquidityUsd)}{token.liquidityUsd !== null && token.liquidityUsd < 10000 && <small className={s.warningText}>Low liquidity</small>}</td><td className={s.numeric}>{compact(token.volume24h)}</td><td className={s.numeric}>{age(token.pairCreatedAt)}<small>{token.dex}</small></td>
    <td><div className={s.rowActions}><button className={`${s.iconButton} ${watched.includes(token.mint) ? s.starred : ''}`} aria-label={`${watched.includes(token.mint) ? 'Unwatch' : 'Watch'} ${token.symbol}`} aria-pressed={watched.includes(token.mint)} disabled={busyMint !== ''} onClick={() => void onWatch(token.mint, !watched.includes(token.mint))}><Star size={16} fill={watched.includes(token.mint) ? 'currentColor' : 'none'}/></button><a className={s.researchLink} href={token.screenerUrl} target="_blank" rel="noreferrer" aria-label={`Open ${token.symbol} on DEX Screener`} title="Open DEX Screener">DS<ArrowUpRight size={10}/></a><Link className={s.researchLink} to={`/trade?mint=${token.mint}`}>Swap</Link><Link className={s.researchLink} to={`/alerts?mint=${token.mint}`}>Alert</Link><Link className={s.iconButton} to={`/builder?mint=${token.mint}`} aria-label={`Create an agent for ${token.symbol}`}><ArrowUpRight size={14}/></Link></div></td>
  </tr>)}</tbody></table></div>{notice && <p className={s.inlineNotice} role="status">{notice}</p>}</>;
}

export function TokenDiscovery({ signedIn, preview = false, watchlist = false }: { signedIn: boolean; preview?: boolean; watchlist?: boolean }) {
  const [params, setParams] = useSearchParams();
  const query = preview ? '' : params.get('q') || '';
  const [search, setSearch] = useState(query), [view, setView] = useState('all'), [minLiquidity, setMinLiquidity] = useState('0'), [sort, setSort] = useState('liquidity'), [busyMint, setBusyMint] = useState(''), [failure, setFailure] = useState('');
  useEffect(() => setSearch(query), [query]);
  const watch = useResource<{ mints: string[] }>('/solana/watchlist', signedIn);
  const mints = watch.data?.mints || [];
  const path = watchlist ? `/solana/tokens?mints=${mints.join(',')}` : `/solana/tokens?q=${encodeURIComponent(query)}`;
  const { data, error, busy, reload } = useResource<TokenFeed>(path, !watchlist || (!!watch.data && signedIn), 60000);
  async function toggle(mint: string, watched: boolean) {
    if (!signedIn) { setFailure('Connect your account to save a private watchlist.'); return; }
    setBusyMint(mint); setFailure('');
    try { watch.setData(await api('/solana/watchlist', { mint, watched })); }
    catch (error) { setFailure((error as Error).message); }
    finally { setBusyMint(''); }
  }
  const filtered = (data?.tokens || []).filter(token => (Number(minLiquidity) === 0 || (token.liquidityUsd !== null && token.liquidityUsd >= Number(minLiquidity))) && (view !== 'new' || (token.pairCreatedAt !== null && Date.now() - token.pairCreatedAt <= 86400000)));
  filtered.sort((a, b) => sort === 'newest' ? (b.pairCreatedAt || 0) - (a.pairCreatedAt || 0) : sort === 'volume' ? (b.volume24h || 0) - (a.volume24h || 0) : (b.liquidityUsd || 0) - (a.liquidityUsd || 0));
  if (watchlist && !signedIn) return <Notice>Connect your account to keep a private Solana token watchlist. <Link to="/auth?next=/watchlist">Connect account</Link></Notice>;
  return <section className={s.discovery}>
    {preview ? <div className={s.sectionHeading}><div><p className={s.eyebrow}>THE SOLANA RADAR</p><h2>Find your next token to follow.</h2></div><Link className={s.textLink} to="/tokens">Open token explorer <ArrowUpRight size={15}/></Link></div> : <PageHeading label="SOLANA MAINNET" title={watchlist ? 'Your watchlist' : 'Token explorer'} description={watchlist ? 'Saved by mint address. Private to your account, available across your devices.' : 'Explore indexed Solana tokens. Check the mint, pool age, and liquidity before deciding what to follow.'}><span className={s.chainBadge}><SolMark small/> Solana only</span></PageHeading>}
    {!preview && <div className={s.tokenToolbar}>{!watchlist && <form className={s.searchForm} onSubmit={event => { event.preventDefault(); setParams(search.trim() ? { q: search.trim() } : {}); }}><Search size={16}/><input aria-label="Search Solana tokens" placeholder="Token name, symbol, or mint address" value={search} maxLength={80} onChange={event => setSearch(event.target.value)}/><button type="submit" className={s.subtleButton}>Search</button></form>}<label className={s.compactLabel}>Min. liquidity<select value={minLiquidity} onChange={e => setMinLiquidity(e.target.value)}><option value="0">Any liquidity</option><option value="10000">$10K+</option><option value="100000">$100K+</option><option value="1000000">$1M+</option></select></label><label className={s.compactLabel}>Sort by<select value={sort} onChange={e => setSort(e.target.value)}><option value="liquidity">Liquidity</option><option value="volume">24h volume</option><option value="newest">Newest pool</option></select></label></div>}
    <div className={s.feedBar}><div className={s.tabs}>{!watchlist && <><button aria-pressed={view === 'all'} className={view === 'all' ? s.selectedTab : ''} onClick={() => setView('all')}>Discovered tokens</button><button aria-pressed={view === 'new'} className={view === 'new' ? s.selectedTab : ''} onClick={() => setView('new')}>Pools under 24h</button></>}{watchlist && <span>{mints.length} of 30 tokens saved</span>}</div><button className={s.refreshButton} disabled={busy} onClick={() => void reload()} aria-label="Refresh token data"><RefreshCw size={13} className={busy ? s.spin : ''}/>{busy ? 'Fetching data' : 'Refresh'}</button></div>
    {(failure || watch.error) && <Notice error>{failure || watch.error}</Notice>}{error && <Notice error>{error} <button className={s.linkButton} onClick={() => void reload()}>Try again</button></Notice>}
    {data?.stale && <Notice error>Showing cached data from {new Date(data.fetchedAt).toLocaleTimeString()}. The provider could not refresh it. These are not current prices.</Notice>}
    {!data && !error && (!watchlist || mints.length > 0) ? <LoadingRows/> : filtered.length ? <TokenTable tokens={filtered} watched={mints} onWatch={toggle} busyMint={busyMint} limit={preview ? 5 : undefined}/> : !error ? <div className={s.empty}><Search size={25}/><h3>{watchlist && !mints.length ? 'Keep the tokens you care about.' : 'No tokens match this view.'}</h3><p>{watchlist && !mints.length ? 'Open the explorer and select the star beside a token to save its mint address.' : 'Try a mint address, another search, or a lower liquidity filter. Some new pools are not indexed yet.'}</p><Link className={s.textLink} to="/tokens">Explore Solana tokens <ArrowUpRight size={14}/></Link></div> : null}
    <div className={s.feedFoot}><span>{data ? `DEX Screener · Updated ${new Date(data.fetchedAt).toLocaleTimeString()} · ${data.stale ? 'Cached' : 'Refreshes every 60s'}` : 'Market data from DEX Screener'}</span><span>Prices in USD · Network currency: SOL</span></div><p className={s.fine}>Discovery uses recent token profiles, not every Solana launch. Pool age is not mint age. Symbols are unverified; liquidity and listings do not establish token safety.</p>
    {!preview && watchlist && data && data.tokens.length < mints.length && <p className={s.fine}>Some saved mints have no indexed pool. Their addresses remain on your watchlist: {mints.filter(mint => !data.tokens.some(token => token.mint === mint)).map(mint => <span className={s.missingMint} key={mint}><code>{mint}</code><button className={s.linkButton} disabled={!!busyMint} onClick={() => void toggle(mint, false)}>Remove</button></span>)}</p>}
  </section>;
}
