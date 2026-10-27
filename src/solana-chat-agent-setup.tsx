import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, Check, MessageCircle } from 'lucide-react';
import { isSolanaAddress } from '../shared/solana';
import { Notice } from './solana-ui';
import s from './solana.module.css';

export type ChatAgentSetup = { selectedVersionId: string | null; agents: { id: string; name: string; number: number; mints: string[] }[] };
export function ChatTradingAgentSetup({ setup, paired, busy, onSave }: {
  setup: ChatAgentSetup; paired: boolean; busy: boolean; onSave(versionId: string, mints: string[]): Promise<void>;
}) {
  const [selected, setSelected] = useState(''), [draft, setDraft] = useState<string | null>(null), [error, setError] = useState('');
  const selectedId = selected || setup.selectedVersionId || setup.agents[0]?.id || '';
  const agent = setup.agents.find(candidate => candidate.id === selectedId);
  const tokens = draft ?? agent?.mints.join('\n') ?? '';
  async function save(event: FormEvent) {
    event.preventDefault(); setError('');
    const mints = tokens.split(/[\s,]+/).filter(Boolean);
    if (!agent || !mints.length || mints.length > 10 || new Set(mints).size !== mints.length || mints.some(mint => !isSolanaAddress(mint) || mint === 'So11111111111111111111111111111111111111112')) {
      setError('Enter 1–10 unique token mint addresses other than SOL. SOL is the currency you spend, not the token you are buying.'); return;
    }
    await onSave(agent.id, mints);
  }
  return <section className={s.setupPrerequisites} aria-labelledby="chat-agent-setup-title">
    <div className={s.setupConnectionState}><span className={paired ? s.available : s.soon}>{paired ? <Check size={14}/> : <MessageCircle size={14}/>} {paired ? 'WhatsApp already paired' : 'WhatsApp pairing required'}</span></div>
    <h2 id="chat-agent-setup-title">{setup.selectedVersionId ? 'Add a token to your agent' : 'Choose an agent to continue'}</h2>
    <p>SOL funds your trading wallet. Your agent also needs the exact mint of at least one Solana token you want to buy or sell.</p>
    {setup.agents.length ? <form onSubmit={event => void save(event)}>
      {error && <Notice error>{error}</Notice>}
      <label className={s.field}>Your saved agent<select value={selectedId} disabled={busy} onChange={event => { setSelected(event.target.value); setDraft(null); setError(''); }}>{setup.agents.map(candidate => <option key={candidate.id} value={candidate.id}>{candidate.name} · v{candidate.number}{candidate.id === setup.selectedVersionId ? ' · selected' : ''}</option>)}</select></label>
      {!agent?.mints.length && <p className={s.fine}>This version has no token mint ready for trading. Add one below; your previous version is kept.</p>}
      <label className={s.field}>Tokens this agent may trade<textarea rows={3} value={tokens} required spellCheck={false} maxLength={500} disabled={busy} onChange={event => { setDraft(event.target.value); setError(''); }} placeholder="Paste a token’s Solana mint address"/><small>One mint per line or comma. Up to 10. Use the token explorer to find the exact address.</small></label>
      <div className={s.actions}><button className={s.button} disabled={busy || !tokens.trim()}>{busy ? 'Saving agent…' : 'Save tokens & use agent'}<ArrowRight size={14}/></button><Link className={s.textLink} to="/tokens">Find a token mint</Link></div>
      <p className={s.fine}>This selects your configuration. It never enables trading on its own. Changing the token list revokes any previous trading permission; you will review new limits before trading.</p>
    </form> : <div className={s.actions}><Link className={s.button} to="/builder">Create a Solana agent <ArrowRight size={14}/></Link><Link className={s.textLink} to="/tokens">Find a token mint</Link></div>}
    {!paired && <p><Link className={s.textLink} to="/connections">Finish WhatsApp pairing <ArrowRight size={14}/></Link>. Your agent selection is kept.</p>}
  </section>;
}
