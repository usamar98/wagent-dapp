# Self-hosted Wagent Ai runner

Download your licensed version from My agents and save it as `runner/agent.json`.

From the project root:

```sh
docker compose -f runner/compose.yaml up --build
docker compose -f runner/compose.yaml run --rm runner status
docker compose -f runner/compose.yaml run --rm runner pause
docker compose -f runner/compose.yaml run --rm runner start
docker compose -f runner/compose.yaml run --rm runner stop
docker compose -f runner/compose.yaml run --rm runner emergency-stop
docker compose -f runner/compose.yaml run --rm runner clear-emergency
```

Emergency stop persists. Clearing it leaves the agent stopped. Start explicitly afterward. One runtime may write a ledger; a lock file rejects concurrent runtime processes. Control commands use a separate persisted control file. After an unclean host shutdown, inspect running processes before manually removing a stale `/data/runner.lock`.

The default source is a reproducible, simulated feed. All orders are paper only. No broker/exchange adapter can execute real orders. A $10,000 paper cash balance starts the ledger. Signals, paper orders, positions, execution errors, source and timestamps persist in the volume. Execution keys combine configuration fingerprint, timeframe bucket and symbol. Retry does not duplicate a run or order.

Without Docker, after `npm ci`, run `npm run runner`. Commands are `npm run runner -- pause` etc. The ledger uses `runner/data` by default; set `RUNNER_STATE_DIR` for a different agent/version. Set `RUNNER_ONCE=true` to perform one cycle and exit.

An optional buyer-operated HTTP market-data adapter uses `MARKET_DATA_URL` and `MARKET_DATA_API_KEY`. It sends `symbol` and `timeframe` query parameters with an optional Bearer header. It must return:

```json
{"symbol":"BTC/USD","source":"Your provider name","simulated":false,"candles":[{"timestamp":"2026-10-19T10:00:00.000Z","close":65000}]}
```

Supply at least 80 chronological candles at the configured timeframe for all strategies. Missing, stale, invalid or future data is rejected. This is a generic adapter contract, not a tested integration with an external market-data provider. Own provider and hosting usage fees remain your responsibility.

Console output is the **local notification simulator**; it sends no external messages. AI explanation instructions remain inert context. No AI provider is called. Real WhatsApp delivery is disabled because exact use-case eligibility is unverified. Website entitlements protect downloads; an already-downloaded offline configuration cannot be remotely erased after refund. Licenses prohibit resale or redistribution.

Configuration exports contain no connection credentials, buyer data, or private creator records. Never add secrets to the configuration JSON or commit them. Set provider credentials through your own process environment.
