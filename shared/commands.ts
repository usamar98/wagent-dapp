export type ParsedCommand =
  | { kind: 'trade'; side: 'BUY' | 'SELL'; amountCents: number; symbol: string }
  | { kind: 'confirm' | 'cancel'; code: string }
  | { kind: 'help' | 'status' | 'portfolio' | 'start' | 'pause' | 'stop' | 'emergency' }
  | { kind: 'invalid'; reason: string };

export const commandExamples = ['Buy $100 of BTC', 'Show portfolio', 'Pause agent', 'Help'];

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
  const trade = text.match(/^(buy|sell) \$?(\d{1,7}(?:\.\d{1,2})?)(?: usd)? (?:of )?([a-z0-9]{2,12})(?:[/-]usd)?$/i);
  if (trade) {
    const amountCents = Math.round(Number(trade[2]) * 100);
    if (amountCents < 100 || amountCents > 100000000) return { kind: 'invalid', reason: 'Enter a USD amount between $1 and $1,000,000.' };
    return { kind: 'trade', side: trade[1].toUpperCase() as 'BUY' | 'SELL', amountCents, symbol: `${trade[3].toUpperCase()}/USD` };
  }
  return { kind: 'invalid', reason: 'Try “Buy $100 of BTC”, “Sell $25 of BTC”, “Show portfolio”, “Start agent”, “Pause agent”, or “Stop all”. Every order needs its own confirmation. Live orders are unavailable.' };
}
