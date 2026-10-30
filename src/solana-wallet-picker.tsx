import { isBinanceWallet, walletLabel, type SolanaWallet } from './solana-wallet';
import s from './solana.module.css';

export function SolanaWalletPicker({ wallets, selected, disabled, onChange, showSetupGuidance=true }: {
  wallets: SolanaWallet[]; selected: SolanaWallet | undefined; disabled: boolean; onChange(name: string): void; showSetupGuidance?:boolean;
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
    {showSetupGuidance&&!binanceDetected && <><p className={s.fine}>To connect Binance Wallet, open Wagent Ai in its DApp browser or install the Binance Wallet extension, then refresh this page. It appears in the wallet list when detected.</p><div className={s.actions}><a className={s.textLink} href="https://www.binance.com/en/support/faq/detail/99532b46a51b454a9fd2e061a99619bd" target="_blank" rel="noreferrer">Set up Binance Wallet ↗</a>{!wallets.length&&<a className={s.textLink} href="https://help.phantom.com/articles/how-to-connect-phantom-to-a-dapp-29995498642195" target="_blank" rel="noreferrer">Set up Phantom ↗</a>}</div></>}
    {showSetupGuidance&&(selectedBinance || !binanceDetected) && <p className={s.fine}>Binance Wallet is separate from your Binance Exchange balance. No Binance API key is required.</p>}
    {showSetupGuidance&&selected?.name==='MetaMask'&&<p className={s.fine}>Your 0x address signs you into Wagent. Solana swaps use a separate Solana address. In MetaMask, open the address dropdown below your account name to find it. <a className={s.textLink} href="https://support.metamask.io/configure/networks/navigating-solana/" target="_blank" rel="noreferrer">Find your Solana address ↗</a></p>}
  </div>;
}
