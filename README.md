# flashnet-fees

A tiny CLI to **check** and **claim** the fees a [Flashnet](https://flashnet.xyz) integrator accrues: AMM integrator fees (swaps) and Orchestra affiliate fees (USDC/USDT orders).

Flashnet pays integrators a share of swap fees, but there's no automatic payout — fees accrue per AMM pool and have to be withdrawn explicitly. This tool does that withdrawal in one command.

## How it works

The tool derives a [Spark](https://www.spark.money/) wallet from your integrator mnemonic and wraps it in a `FlashnetClient`. Your Spark identity key *is* the integrator identity, so the client can read your accrued fees and sign withdrawals.

```
mnemonic ──> SparkWallet (MAINNET) ──> FlashnetClient
                                            │
                  ┌─────────────────────────┴─────────────────────────┐
                  ▼                                                     ▼
          getIntegratorFees()                              withdrawIntegratorFees()
       (accrued fees, per pool)                         (Spark transfer of fees back
                                                          to the same mnemonic's wallet)
```

- Fees accrue **per pool** and are denominated in the pool's **asset B** (typically USDB, 6 decimals — e.g. `2457359` = `2.457359`).
- `claim` loops over every pool with a non-zero balance and calls `withdrawIntegratorFees({ lpIdentityPublicKey: pool.poolId })`.
- A successful withdrawal is a **Spark transfer of the fee tokens back to the same mnemonic's Spark identity**. Nothing is converted or sent elsewhere — the tokens simply land in that wallet, where you can view or spend them with any Spark wallet loaded from the same mnemonic.

## Install

```bash
git clone https://github.com/kingonly/flashnet-fees.git
cd flashnet-fees
npm install
```

Requires Node.js 18+.

## Usage

```bash
# Show accrued fees across all pools + total
npx tsx src/index.ts fees "<your integrator mnemonic>"

# Withdraw all fees to the mnemonic's Spark wallet
npx tsx src/index.ts claim "<your integrator mnemonic>"
```

Or via the npm scripts:

```bash
npm run fees  -- "<your integrator mnemonic>"
npm run claim -- "<your integrator mnemonic>"
```

### Orchestra affiliate fees

[Orchestra](https://docs.flashnet.xyz/orchestra/quickstart) is Flashnet's cross-chain
USDC/USDT order service. A partner's affiliates earn a share of each order's fee,
which accrues per settlement bucket (for example USDC on Solana) and is paid out, on
claim, to the payout address configured for the affiliate in the Orchestra dashboard
or the partner portal. This is a separate pot from the AMM integrator fees above and
is read and claimed with the partner's Orchestra **server key** (`fn_...`), not a
mnemonic.

```bash
# Earned, paid-out and claimable balances for every affiliate on the account
npx tsx src/index.ts orchestra-fees "<server key>"

# Claim every claimable bucket to its configured payout address
npx tsx src/index.ts orchestra-claim "<server key>"

# See what would be claimed without claiming
npx tsx src/index.ts orchestra-claim "<server key>" --dry-run

# One affiliate only
npx tsx src/index.ts orchestra-fees "<server key>" --affiliate breez_sdk
```

The key can also be given as the `ORCHESTRA_SERVER_KEY` environment variable instead
of an argument, which keeps it out of shell history:

```bash
ORCHESTRA_SERVER_KEY=fn_... npx tsx src/index.ts orchestra-claim
```

Buckets under Orchestra's $1 minimum are listed and skipped. Each claim carries an
idempotency key made of the affiliate, settlement bucket and day, so re-running on
the same day cannot claim twice. The tool never changes payout addresses or fee settings.

### `fees` output

```
Integrator: 037e26d9...

Pool Fees:
--------------------------------------------------------------------------------
  Pool:      <lp identity pubkey>
  Asset B:   <asset B token pubkey>
  Fees:      2457359
  Namespace: <host namespace>
--------------------------------------------------------------------------------

Total fees (Asset B): 2457359
```

### `claim` output

Per pool it prints `accepted`, the withdrawn amount, and a `transferId`. Pools with `0` fees are skipped, so re-running after a successful claim is a no-op until new fees accrue.

## Security

- The Orchestra server key can read every order on the account and change affiliate payout settings; this tool only reads and claims. Pass it via `ORCHESTRA_SERVER_KEY` rather than as an argument when shell history matters.
- The mnemonic is passed as a **command-line argument**, never read from a file or env var, and is never written anywhere by this tool. It controls real funds — treat it like a private key. Be aware that CLI args can appear in your shell history and process list.
- This repo contains no secrets.

## Stack

- [`@flashnet/sdk`](https://www.npmjs.com/package/@flashnet/sdk) — `FlashnetClient.getIntegratorFees()` / `.withdrawIntegratorFees()`
- [`@buildonspark/spark-sdk`](https://www.npmjs.com/package/@buildonspark/spark-sdk) — `SparkWallet`
- TypeScript, run directly with [`tsx`](https://www.npmjs.com/package/tsx)

## References

- [Flashnet AMM fee docs](https://docs.flashnet.xyz/products/flashnet-amm/fees)
- [Flashnet API — Integrators](https://api.flashnet.xyz/v1/amm/swagger/#/Integrators)
