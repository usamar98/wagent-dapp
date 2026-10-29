import { useEffect } from 'react';
import { BatteryFull, CheckCheck, ChevronLeft, LockKeyhole, Mic, Plus, Signal, Wifi, X } from 'lucide-react';
import s from './whatsapp-connection-preview.module.css';

export function WhatsAppConnectionPreview({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  useEffect(() => {
    const timeout = window.setTimeout(onDismiss, 15000);
    return () => window.clearTimeout(timeout);
  }, [onDismiss]);

  return <aside className={s.preview} aria-label="WhatsApp connection confirmation">
    <div className={s.caption}><span>YOUR CHAT IS CONNECTED</span><button type="button" onClick={onDismiss} aria-label="Dismiss WhatsApp connection preview"><X size={17}/></button></div>
    <div className={s.phone}>
      <div className={s.screen}>
        <div className={s.statusBar} aria-hidden="true"><span>9:41</span><span className={s.island}/><span><Signal size={12}/><Wifi size={12}/><BatteryFull size={17}/></span></div>
        <header className={s.chatHeader}>
          <ChevronLeft size={23} aria-hidden="true"/>
          <span className={s.avatar}><img src="/brand-logo.png" alt=""/></span>
          <div><strong title={label}>{label}</strong><span>Connected to Wagent Ai</span></div>
        </header>
        <div className={s.conversation}>
          <span className={s.today}>Today</span>
          <p className={s.privacy}><LockKeyhole size={11} aria-hidden="true"/>Your personal agent is now paired.</p>
          <div className={s.message} role="status" aria-live="polite" aria-atomic="true">
            <p>WhatsApp connected successfully</p>
            <span className={s.receipt}>Just now <CheckCheck size={18} aria-label="Blue double tick"/></span>
          </div>
          <p className={s.next}>Your conversation is ready.<br/>Connect your wallet to set up trading.</p>
        </div>
        <div className={s.composer} aria-hidden="true"><Plus size={21}/><span>Message</span><Mic size={18}/></div>
        <div className={s.homeIndicator} aria-hidden="true"/>
      </div>
    </div>
    <p className={s.footnote}>Connection preview · Closes after 15 seconds</p>
  </aside>;
}
