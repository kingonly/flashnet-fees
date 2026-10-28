// Flashnet Orchestra affiliate fees: the share of USDC/USDT cross-chain order
// fees that accrues to a partner's affiliates. A separate pot from the AMM
// integrator fees in index.ts: it is read and claimed with the partner's
// Orchestra server key (fn_...), not with a wallet mnemonic.
//
// A claim moves one bucket's full available balance to the affiliate's
// configured payout address (set in the Orchestra dashboard or the partner
// portal); nothing here can change that address.

const BASE = "https://orchestration.flashnet.xyz";

type Affiliate = { affiliateId: string; enabled: boolean; feeBps: number; payoutChain: string; payoutAsset: string; payoutAddress: string };
type ClaimBalance = {
  claimBucketId: string; settlementChain: string; settlementAsset: string;
  payoutChain: string; payoutAsset: string; payoutAddress: string;
  availableBalanceUsdSmallest: string; claimable: boolean; unclaimableReason?: string;
  isCurrentPayoutDestination: boolean;
};
type Stats = { availableBalance: string; totalEarnedAmount: string; thisMonthEarnedAmount: string; thisMonthOrderCount: number; paidOutAmount: string; paidOutCount: number; claimBalances: ClaimBalance[] };

const usd = (smallest: string) => `$${(Number(smallest) / 1e6).toFixed(2)}`;

async function api<T>(key: string, method: "GET" | "POST", path: string, body?: unknown, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = { authorization: `Bearer ${key}`, accept: "application/json", "user-agent": "flashnet-fees/1" };
  if (body !== undefined) headers["content-type"] = "application/json";
  if (idempotencyKey) headers["x-idempotency-key"] = idempotencyKey;
  const res = await fetch(BASE + path, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(60000) });
  if (!res.ok) {
    // The error body is Flashnet's own text; it never echoes the key.
    const text = (await res.text()).slice(0, 300);
    throw new Error(`Orchestra ${method} ${path} returned ${res.status}: ${text}`);
  }
  return (await res.json()) as T;
}

async function affiliates(key: string): Promise<Affiliate[]> {
  return (await api<{ affiliates: Affiliate[] }>(key, "GET", "/v1/affiliates?limit=1000")).affiliates;
}

async function stats(key: string, affiliateId: string): Promise<Stats> {
  return (await api<{ stats: Stats }>(key, "GET", `/v1/affiliate-dashboard/${encodeURIComponent(affiliateId)}/stats`)).stats;
}

// Every affiliate on the account, or just one, with its claimable buckets.
async function balances(key: string, only?: string) {
  const list = only ? [{ affiliateId: only }] : await affiliates(key);
  return Promise.all(list.map(async (a) => ({ affiliateId: a.affiliateId, stats: await stats(key, a.affiliateId) })));
}

export async function orchestraFees(key: string, only?: string) {
  for (const { affiliateId, stats: s } of await balances(key, only)) {
    console.log(`Affiliate: ${affiliateId}`);
    console.log(`  Earned all-time: ${usd(s.totalEarnedAmount)}  paid out: ${usd(s.paidOutAmount)} in ${s.paidOutCount} claim(s)  this month: ${usd(s.thisMonthEarnedAmount)} over ${s.thisMonthOrderCount} orders`);
    console.log(`  Available: ${usd(s.availableBalance)}`);
    for (const b of s.claimBalances) {
      const to = `${b.payoutAsset} on ${b.payoutChain} -> ${b.payoutAddress}${b.isCurrentPayoutDestination ? "" : " (NOT the current payout destination)"}`;
      console.log(`    ${b.settlementAsset} on ${b.settlementChain}: ${usd(b.availableBalanceUsdSmallest)}  ${b.claimable ? "claimable" : `not claimable: ${b.unclaimableReason ?? "unknown reason"}`}`);
      console.log(`      pays out as ${to}`);
    }
    console.log();
  }
}

// Claims every claimable bucket. The idempotency key is the bucket id plus
// the day, so re-running the same day cannot double-claim.
export async function orchestraClaim(key: string, opts: { dryRun: boolean; only?: string }) {
  const day = new Date().toISOString().slice(0, 10);
  let claimed = 0;
  for (const { affiliateId, stats: s } of await balances(key, opts.only)) {
    for (const b of s.claimBalances) {
      if (!b.claimable) {
        console.log(`Skipping ${affiliateId} ${b.settlementAsset}/${b.settlementChain} ${usd(b.availableBalanceUsdSmallest)}: ${b.unclaimableReason ?? "not claimable"}`);
        continue;
      }
      const what = `${usd(b.availableBalanceUsdSmallest)} ${b.settlementAsset}/${b.settlementChain} of ${affiliateId} as ${b.payoutAsset} on ${b.payoutChain} to ${b.payoutAddress}`;
      if (opts.dryRun) { console.log(`Would claim ${what}`); claimed++; continue; }
      console.log(`Claiming ${what}...`);
      // Same body the partner portal sends (settlement + payout fields); the
      // claimBucketId-only form returned a 500 from Orchestra on 2026-10-28.
      const body = { settlementChain: b.settlementChain, settlementAsset: b.settlementAsset, payoutChain: b.payoutChain, payoutAsset: b.payoutAsset, payoutAddress: b.payoutAddress };
      const res = await api<{ claim: Record<string, unknown> }>(key, "POST", `/v1/affiliates/${encodeURIComponent(affiliateId)}/claim`, body, `flashnet-fees:${affiliateId}:${b.settlementChain}:${b.settlementAsset}:${day}`);
      const c = res.claim ?? res;
      console.log(`  id: ${c.id ?? "?"}  status: ${c.status ?? "?"}  amount: ${c.amountUsdSmallest ? usd(String(c.amountUsdSmallest)) : c.amount ?? "?"}${c.txHash ? `  tx: ${c.txHash}` : ""}`);
      claimed++;
    }
  }
  console.log(claimed ? (opts.dryRun ? `${claimed} bucket(s) would be claimed.` : `Done: ${claimed} claim(s) submitted. Check status with orchestra-fees.`) : "Nothing claimable.");
}
