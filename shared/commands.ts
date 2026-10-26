import { isSolanaAddress, isSolanaAsset } from './solana.js';
export type ParsedCommand =
  | { kind: 'trade'; side: 'BUY' | 'SELL'; amountCents: number; symbol: string }
  | { kind: 'confirm' | 'cancel'; code: string }
  | { kind: 'help' | 'status' | 'portfolio' | 'start' | 'pause' | 'stop' | 'emergency' }
  | { kind: 'invalid'; reason: string };

export const commandExamples = ['Status', 'Show portfolio', 'Pause agent', 'Help'];

export function parseCommand(input: string): ParsedCommand {
  const text = input.trim().replace(/\s+/g, ' ');
  if (/^(help|commands|what can you do)\??$/i.test(text)) return { kind: 'help' };
  if (/^(status|agent status|show status)\??$/i.test(text)) return { kind: 'status' };
  if (/^(portfolio|show (my )?portfolio|positions|balance)$/i.test(text)) return { kind: 'portfolio' };
  if (/^(emergency[ -]stop|stop all( agents)?)$/i.test(text)) return { kind: 'emergency' };
  const control = text.match(/^(start|pause|stop)( (my )?agent)?$/i);
  if (control) return { kind: control[1].toLowerCase() as 'start' | 'pause' | 'stop' };
  const approval = text.match(/^(confirm|cancel) ([A-F0-9]{8})$/i);
  if (approval) return { kind: approval[1].toLowerCase() as 'confirm' | 'cancel', code: approval[2].toUpperCase() };
  const trade = text.match(/^(buy|sell) \$?(\d{1,7}(?:\.\d{1,2})?)(?: usd)? (?:of )?([a-z0-9]{2,44})(?:[/-]usd)?$/i);
  if (trade) {
    const amountCents = Math.round(Number(trade[2]) * 100);
    if (amountCents < 100 || amountCents > 100000000) return { kind: 'invalid', reason: 'Enter a USD amount between $1 and $1,000,000.' };
    const symbol = isSolanaAddress(trade[3]) ? trade[3] : `${trade[3].toUpperCase()}/USD`;
    if (!isSolanaAsset(symbol)) return { kind: 'invalid', reason: 'This workspace supports Solana tokens only. Use a supported Solana asset or its exact mint address.' };
    return { kind: 'trade', side: trade[1].toUpperCase() as 'BUY' | 'SELL', amountCents, symbol };
  }
  return { kind: 'invalid', reason: 'Try “Help”, “Status”, or “Stop all”. For a swap review, use “Buy 0.1 SOL of <mint>” or “Sell 100 of <mint>”. Approve each real swap in your Solana wallet on the website. Configure token discovery, price, and liquidity alerts on the website.' };
}
