import {useEffect,useRef,useState} from 'react';
import type {Portfolio} from '../shared/portfolio';
import {availableWallets,observeWallets,type SolanaWallet} from './solana-wallet';
import {SolanaWalletPicker} from './solana-wallet-picker';
import {TradingFunding} from './solana-chat-funding';
import s from './solana.module.css';
import p from './solana-portfolio.module.css';
export function PortfolioFunding({data,error,balanceBusy,busy,onBusyChange,refresh,onClose}:{data:Portfolio;error:string;balanceBusy:boolean;busy:boolean;onBusyChange(busy:boolean):void;refresh():Promise<void>;onClose():void}){
  const [wallets,setWallets]=useState<SolanaWallet[]>([]),[selected,setSelected]=useState(''),heading=useRef<HTMLHeadingElement>(null),owner=data.wallet!.ownerAddress;
  useEffect(()=>{heading.current?.focus();},[]);
  useEffect(()=>observeWallets(()=>{const next=availableWallets();setWallets(next);setSelected(name=>name||next.find(w=>w.accounts.some(a=>a.address===owner))?.name||(next.length===1?next[0].name:''));}),[owner]);
  const wallet=wallets.find(w=>w.name===selected);
  return <section id="portfolio-add-sol" className={p.funding} aria-labelledby="portfolio-add-sol-title"><div className={s.sectionHeading}><div><p className={s.eyebrow}>DEPOSIT TO YOUR EXISTING TRADING WALLET</p><h2 id="portfolio-add-sol-title" tabIndex={-1} ref={heading}>Add SOL</h2></div><button type="button" className={s.linkButton} disabled={busy} onClick={onClose}>Close deposit</button></div>
    <p className={s.fine}>Transfer native SOL on Solana mainnet. Your wallet will show the amount and recipient before you approve. Adding funds keeps your existing trading and withdrawal permissions.</p>
    <p className={s.fine}>From your owner wallet: <code className={s.historyMint}>{owner}</code>To your trading wallet: <code className={s.historyMint}>{data.wallet!.address}</code></p>
    <SolanaWalletPicker wallets={wallets} selected={wallet} disabled={busy} onChange={setSelected} showSetupGuidance={!wallet?.accounts.some(a=>a.address===owner)}/>
    <TradingFunding address={data.wallet!.address} ownerAddress={owner} wallet={wallet} balances={error?null:{sol:data.sol.amount,tokens:data.tokens.map(t=>({mint:t.mint,amount:t.amount}))}} balanceError={error} balanceBusy={balanceBusy} refresh={refresh} onBusyChange={onBusyChange}/>
  </section>;
}
