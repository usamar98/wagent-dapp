import { isSupportedSolanaWallet, walletLabel, type SolanaWallet } from './solana-wallet';
import s from './solana.module.css';

export function SolanaWalletPicker({ wallets, selected, disabled, onChange, showSetupGuidance=true }: {
  wallets: SolanaWallet[]; selected: SolanaWallet | undefined; disabled: boolean; onChange(name: string): void; showSetupGuidance?:boolean;
}) {
  const supported = wallets.filter(isSupportedSolanaWallet), chosen = selected && isSupportedSolanaWallet(selected) ? selected : undefined;
  return <div className={s.walletPicker}>
    {supported.length > 0 && <label className={s.field}>Wallet app
      <select value={chosen?.name || ''} disabled={disabled} onChange={event => onChange(event.target.value)}>
        <option value="" disabled>Select a Solana wallet</option>
        {supported.map(wallet => <option key={wallet.name} value={wallet.name}>{walletLabel(wallet)}</option>)}
      </select>
    </label>}
    <p className={s.fine}>{chosen ? `${walletLabel(chosen)} detected. Select its Solana account when approving.` : 'Open this website in MetaMask or Phantom’s DApp browser, or install its browser extension and refresh this page.'}</p>
    {showSetupGuidance&&!supported.length&&<a className={s.textLink} href="https://help.phantom.com/articles/how-to-connect-phantom-to-a-dapp-29995498642195" target="_blank" rel="noreferrer">Set up Phantom ↗</a>}
    {showSetupGuidance&&chosen?.name==='MetaMask'&&<p className={s.fine}>Your 0x address signs you into Wagent. Solana swaps use a separate Solana address. In MetaMask, open the address dropdown below your account name to find it. <a className={s.textLink} href="https://support.metamask.io/configure/networks/navigating-solana/" target="_blank" rel="noreferrer">Find your Solana address ↗</a></p>}
  </div>;
}
