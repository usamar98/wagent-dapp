import { isBinanceWallet, walletLabel, type SolanaWallet } from './solana-wallet';
import s from './solana.module.css';

export function SolanaWalletPicker({ wallets, selected, disabled, onChange }: {
  wallets: SolanaWallet[]; selected: SolanaWallet | undefined; disabled: boolean; onChange(name: string): void;
}) {
  const binanceDetected = wallets.some(isBinanceWallet), selectedBinance = !!selected && isBinanceWallet(selected);
  return <div className={s.walletPicker}>
    {wallets.length > 0 && <label className={s.field}>Wallet app
      <select value={selected?.name || ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="" disabled>Select a Solana wallet</option>
        {wallets.map(wallet => <option key={wallet.name} value={wallet.name}>{walletLabel(wallet)}</option>)}
      </select>
    </label>}
    <p className={s.fine}>{selected ? `${walletLabel(selected)} detected. Select its Solana account when approving.` : binanceDetected ? 'Binance Wallet detected. Choose it above to continue.' :
      'On your phone, open this website inside the Binance Wallet or Phantom DApp browser. On desktop, install a wallet extension and refresh this page.'}</p>
    {!wallets.length && <div className={s.actions}><a className={s.textLink} href="https://www.binance.com/en/support/faq/detail/ebfa9f504ec548968bf0c1ed591a3eaa" target="_blank" rel="noreferrer">Set up Binance Wallet ↗</a><a className={s.textLink} href="https://help.phantom.com/articles/how-to-connect-phantom-to-a-dapp-29995498642195" target="_blank" rel="noreferrer">Set up Phantom ↗</a></div>}
    {(selectedBinance || !wallets.length) && <p className={s.fine}>Binance Wallet is separate from your Binance Exchange balance. No Binance API key is required.</p>}
  </div>;
}
