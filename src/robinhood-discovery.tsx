import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Star, RefreshCw, Copy, ArrowUpRight, Search, ChevronLeft, ChevronRight, SearchX } from 'lucide-react';
import { api, date } from './api';
import { LoadingRows, Notice, PageHeading, useResource, price, compact } from './solana-ui';
import { isEvmAddress, type RhFeed, type RhToken } from '../shared/robinhood';
import s from './solana.module.css';
import r from './robinhood.module.css';
import d from './robinhood-discovery.module.css';

export function RhMark({ small = false }: { small?: boolean }) {
  return <svg className={r.mark} style={small ? { width: 16, height: 20 } : undefined} viewBox="0 0 24 30" aria-hidden="true"><path d="m12 0 11 15-11 6L1 15z" fill="currentColor" opacity=".9"/><path d="m1 18 11 6 11-6-11 12z" fill="currentColor" opacity=".6"/></svg>;
}
export function RhTokenIdentityHint({ addresses }: { addresses: string[] }) {
  const tokens = [...new Set(addresses.filter(isEvmAddress).map(a => a.toLowerCase()))].slice(0, 10);
  const feed = useResource<RhFeed>('/robinhood/tokens?tokens=' + tokens.join(','), tokens.length > 0);
  return <>{feed.data?.tokens.map(t => <small key={t.address}>{t.symbol} · {t.name} · {t.address}</small>)}</>;
}
type Sort = 'liquidity' | 'newest' | 'volume' | 'change';
function poolAge(created: number | null) {
  if (created === null) return 'Unknown';
  const minutes = Math.max(0, Math.floor((Date.now() - created) / 60000));
  return minutes < 1 ? '<1m' : minutes < 60 ? `${minutes}m` : minutes < 2880 ? `${Math.floor(minutes / 60)}h` : `${Math.floor(minutes / 1440)}d`;
}
function TokenResults({ tokens, watched, signedIn, busy, onWatch, onCopy }: { tokens: RhToken[]; watched: string[]; signedIn: boolean; busy: string; onWatch: (address: string) => Promise<void>; onCopy: (token: RhToken) => Promise<void> }) {
  return <div className={d.tableScroll} role="region" aria-label="Robinhood token results" tabIndex={0}>
    <table className={d.table}>
      <caption className={d.visuallyHidden}>Indexed Robinhood Chain tokens. Pool age is not the token launch date.</caption>
      <thead><tr><th scope="col">Token / contract</th><th scope="col">Price <span>USD</span></th><th scope="col">24h change</th><th scope="col">Liquidity</th><th scope="col">24h volume</th><th scope="col">Pool age</th><th scope="col"><span className={d.visuallyHidden}>Token actions</span></th></tr></thead>
      <tbody>{tokens.map(t => <tr key={t.address}>
        <th scope="row"><div className={d.identity}><span className={d.avatar} aria-hidden="true">{(t.symbol || 'T').slice(0, 2).toUpperCase()}</span><div className={d.identityText}><strong title={t.symbol}>{t.symbol || 'Token'}</strong><span className={d.tokenName} title={t.name}>{t.name || 'Name unavailable'}</span></div></div>
          <button type="button" className={d.copyAddress} title={`Copy full token address: ${t.address}`} aria-label={`Copy ${t.symbol || 'token'} address ${t.address}`} onClick={() => void onCopy(t)}><code>{t.address}</code><Copy size={12} aria-hidden="true"/></button>
        </th>
        <td>{price(t.priceUsd)}</td><td className={t.change24h === null ? d.muted : t.change24h < 0 ? r.negative : r.positive}>{t.change24h === null ? 'Unavailable' : `${t.change24h > 0 ? '+' : ''}${t.change24h.toFixed(2)}%`}</td>
        <td>{compact(t.liquidityUsd)}{t.liquidityUsd !== null && t.liquidityUsd < 1000 && <small className={d.lowLiquidity}>Low liquidity</small>}</td><td>{compact(t.volume24h)}</td>
        <td><time dateTime={t.pairCreatedAt ? new Date(t.pairCreatedAt).toISOString() : undefined} title={t.pairCreatedAt ? date(new Date(t.pairCreatedAt).toISOString()) : 'Pool creation time unavailable'}>{poolAge(t.pairCreatedAt)}</time></td>
        <td><div className={d.rowActions}>{signedIn ? <button type="button" className={d.watchButton} aria-label={watched.includes(t.address) ? `Remove ${t.symbol} from watchlist` : `Watch ${t.symbol}`} aria-pressed={watched.includes(t.address)} disabled={!!busy} onClick={() => void onWatch(t.address)}><Star size={16} fill={watched.includes(t.address) ? 'currentColor' : 'none'}/></button> : <Link className={d.watchButton} to="/auth" aria-label={`Sign in to watch ${t.symbol}`}><Star size={16}/></Link>}
          <a className={d.marketLink} href={t.screenerUrl} target="_blank" rel="noreferrer" aria-label={`Research ${t.symbol} on DEX Screener`}>Chart <ArrowUpRight size={12}/></a><Link className={d.buyLink} to={`/trade?token=${t.address}&side=BUY`} aria-label={`Review buying ${t.symbol}`}>Buy <ArrowUpRight size={12}/></Link></div></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

export function RhDiscovery({ signedIn, watchlist = false, embedded: embeddedProp = false, preview = false }: { signedIn: boolean; watchlist?: boolean; embedded?: boolean; preview?: boolean }) {
  const embedded = embeddedProp || preview;
  const [params, setParams] = useSearchParams(), urlQuery = params.get('q') || '';
  const [query, setQuery] = useState(embedded ? '' : urlQuery), [search, setSearch] = useState(embedded ? '' : urlQuery);
  const [min, setMin] = useState('0'), [recent, setRecent] = useState(false), [sort, setSort] = useState<Sort>('liquidity');
  const [page, setPage] = useState(0), [pageSize, setPageSize] = useState(25), [failure, setFailure] = useState(''), [notice, setNotice] = useState(''), [busy, setBusy] = useState('');
  useEffect(() => { if (!embedded) { setQuery(urlQuery); setSearch(urlQuery); setPage(0); } }, [embedded, urlQuery]);
  const saved = useResource<{ tokens: string[] }>('/robinhood/watchlist', signedIn);
  const path = watchlist ? '/robinhood/tokens?tokens=' + (saved.data?.tokens.join(',') || '') : '/robinhood/tokens?q=' + encodeURIComponent(search);
  const feed = useResource<RhFeed>(path, !watchlist || signedIn && !!saved.data, 60000);
  const tokens = useMemo(() => {
    const found = (feed.data?.tokens || []).filter(t => (t.liquidityUsd ?? 0) >= Number(min || 0) && (!recent || t.pairCreatedAt !== null && Date.now() - t.pairCreatedAt < 86400000));
    const value = (t: RhToken) => sort === 'newest' ? t.pairCreatedAt : sort === 'volume' ? t.volume24h : sort === 'change' ? t.change24h : t.liquidityUsd;
    return found.sort((a, b) => (value(b) ?? -Infinity) - (value(a) ?? -Infinity) || a.address.localeCompare(b.address));
  }, [feed.data, min, recent, sort]);
  const pages = Math.max(1, Math.ceil(tokens.length / pageSize)), currentPage = Math.min(page, pages - 1), start = currentPage * pageSize;
  const visible = tokens.slice(start, start + pageSize), filtering = min !== '0' || recent || !!search;
  function submit(event: FormEvent) { event.preventDefault(); const next = query.trim(); setSearch(next); setPage(0); if (!embedded) setParams(next ? { q: next } : {}); if (next === search) void feed.reload(); }
  function reset() { setMin('0'); setRecent(false); setSearch(''); setQuery(''); setPage(0); if (!embedded) setParams({}); }
  async function toggle(address: string) { if (!signedIn) return; setBusy(address); setFailure(''); try { saved.setData(await api<{ tokens: string[] }>('/robinhood/watchlist', { address, watched: !saved.data?.tokens.includes(address) })); } catch (error) { setFailure((error as Error).message); } finally { setBusy(''); } }
  async function copy(token: RhToken) { try { await navigator.clipboard.writeText(token.address); setNotice(`${token.symbol || 'Token'} address copied: ${token.address}`); } catch { setNotice(`Copy this token address: ${token.address}`); } }

  return <section className={d.discovery} aria-label={watchlist ? 'Your Robinhood watchlist' : 'Robinhood token discovery'}>
    {!embedded ? <PageHeading label="ROBINHOOD CHAIN · TOKEN RESEARCH" title={watchlist ? 'Your watchlist' : 'Token explorer'} description="Explore indexed Robinhood Chain pools. Compare liquidity and activity, then review a trade using the exact token address."/> : <header className={d.heading}><div><p className={s.eyebrow}>THE ROBINHOOD RADAR</p><h2>Find your next token to follow.</h2><p className={d.description}>Robinhood Chain pools, prices and market activity in one place.</p></div><Link className={s.textLink} to="/tokens">Open token explorer <ArrowUpRight size={15}/></Link></header>}
    {(failure || feed.error || saved.error) && <Notice error>{failure || feed.error || saved.error}</Notice>}
    {watchlist && !signedIn ? <p className={r.empty}><Link to="/auth">Connect your account</Link> to save a private watchlist.</p> : <>
      <div className={d.filters}>
        <form className={`${d.searchForm} ${watchlist ? d.watchlistFilters : ''}`} onSubmit={submit} role="search" aria-label="Search Robinhood tokens">
          {!watchlist && <><label className={d.field}>Token search<span className={d.searchInput}><Search size={17} aria-hidden="true"/><input value={query} onChange={e => setQuery(e.target.value)} maxLength={80} placeholder="Name, ticker or 0x address" autoComplete="off" spellCheck={false}/></span></label><button className={`${s.button} ${d.searchButton}`} disabled={feed.busy}>Search</button></>}
          <label className={d.field}>Min. liquidity (USD)<input type="number" min="0" step="any" value={min} onChange={e => { setMin(e.target.value); setPage(0); }} inputMode="decimal"/></label>
          <button type="button" className={d.refreshButton} onClick={() => void feed.reload()} disabled={feed.busy}><RefreshCw size={15} aria-hidden="true" className={feed.busy ? d.spinning : undefined}/>{feed.busy ? 'Updating' : 'Refresh'}</button>
        </form>
        <div className={d.secondaryFilters}><label className={d.recentFilter}><input type="checkbox" checked={recent} onChange={e => { setRecent(e.target.checked); setPage(0); }}/><span>Pools under 24h</span><span className={d.filterHint}>Pool age, not token launch date</span></label><label className={d.sortLabel}>Sort by<select value={sort} onChange={e => { setSort(e.target.value as Sort); setPage(0); }}><option value="liquidity">Highest liquidity</option><option value="newest">Newest pools</option><option value="volume">Highest 24h volume</option><option value="change">Biggest 24h gain</option></select></label></div>
      </div>
      <div className={d.feedMeta}><p role="status" aria-live="polite"><strong>{tokens.length.toLocaleString()} {tokens.length === 1 ? 'token' : 'tokens'}</strong>{filtering && feed.data && <span> of {feed.data.tokens.length.toLocaleString()} indexed</span>}{feed.busy && <span> · Updating results…</span>}</p><div>{filtering && <button type="button" className={d.resetButton} onClick={reset}>Clear filters</button>}{feed.data && <span className={d.dataState} data-stale={feed.data.stale || feed.data.discovery?.partial || false}><span aria-hidden="true"/>{feed.data.stale ? 'Cached data' : feed.data.discovery?.partial ? 'Partial coverage' : 'Indexed market data'}</span>}</div></div>
      {notice && <p role="status" className={d.copyNotice}>{notice}</p>}
      {feed.busy && !feed.data ? <LoadingRows/> : !tokens.length ? <div className={d.empty}><SearchX size={25} aria-hidden="true"/><h3>{feed.error && !feed.data ? 'Token data is unavailable' : watchlist && !saved.data?.tokens.length ? 'Build your watchlist' : 'No tokens match this view'}</h3><p>{watchlist && !saved.data?.tokens.length ? 'Save tokens from the explorer to follow their price and liquidity here.' : filtering ? 'Try a lower liquidity threshold, include older pools, or search a full Robinhood token address.' : 'The data provider has not returned any indexed Robinhood pools. Refresh to try again or search an exact token address.'}</p>{watchlist ? <Link className={s.textLink} to="/tokens">Explore tokens <ArrowUpRight size={14}/></Link> : filtering ? <button type="button" className={d.resetButton} onClick={reset}>Clear filters</button> : <button type="button" className={d.resetButton} disabled={feed.busy} onClick={() => void feed.reload()}>Try again</button>}</div> : <TokenResults tokens={visible} watched={saved.data?.tokens || []} signedIn={signedIn} busy={busy} onWatch={toggle} onCopy={copy}/>}
      {tokens.length > 0 && <nav className={d.pagination} aria-label="Token result pages"><p>Showing {start + 1}–{Math.min(start + pageSize, tokens.length)} of {tokens.length.toLocaleString()}</p><div><label>Rows<select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(0); }}><option value={25}>25</option><option value={50}>50</option><option value={100}>100</option></select></label><button type="button" aria-label="Previous token page" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}><ChevronLeft size={16}/></button><span>{currentPage + 1} / {pages}</span><button type="button" aria-label="Next token page" disabled={currentPage + 1 >= pages} onClick={() => setPage(currentPage + 1)}><ChevronRight size={16}/></button></div></nav>}
      {feed.data && <footer className={d.coverage}><p>{feed.data.source} · Updated {date(feed.data.fetchedAt)}{feed.data.stale ? ' · Cached data' : ''}</p><details><summary>About this data</summary><p>{feed.data.coverage} {feed.data.discovery?.partial ? 'Some sources could not be checked or the scan limit was reached. ' : ''}Listings and liquidity do not certify token safety. {feed.data.discovery && `Scans are bounded to ${feed.data.discovery.limit} token addresses per refresh.`}</p></details></footer>}
    </>}
  </section>;
}
