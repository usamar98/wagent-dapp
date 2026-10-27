import { isBinanceWallet, walletLabel, type SolanaWallet } from './solana-wallet';
import s from './solana.module.css';

export function SolanaWalletPicker({ wallets, selected, disabled, onChange }: {
  wallets: SolanaWallet[]; selected: SolanaWallet | undefined; disabled: boolean; onChange(name: string): void;
}) {
  const binanceDetected = wallets.some(isBinanceWallet);
  return <div className={s.walletPicker}>
    {wallets.length > 0 && <label className={s.field}>Wallet app
      <select value={selected?.name || ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="" disabled>Select a Solana wallet</option>
        {wallets.map(wallet => <option key={wallet.name} value={wallet.name}>{walletLabel(wallet)}</option>)}
      </select>
    </label>}
    <p className={s.fine}>{binanceDetected ? 'Binance Wallet detected. Select its Solana account when approving.' :
      'Use Binance Wallet, Phantom, or Solflare. For Binance, open this website in its DApp browser or a browser with its wallet extension installed.'}</p>
    {!binanceDetected && <a className={s.textLink} href="https://www.binance.com/en/support/faq/detail/ebfa9f504ec548968bf0c1ed591a3eaa" target="_blank" rel="noreferrer">Binance Wallet setup guide ↗</a>}
    <p className={s.fine}>Binance Wallet is separate from your Binance Exchange balance. No Binance API key is required.</p>
  </div>;
}
