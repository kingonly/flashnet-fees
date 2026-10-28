import { FlashnetClient } from "@flashnet/sdk";
import { SparkWallet } from "@buildonspark/spark-sdk";
import { orchestraFees, orchestraClaim } from "./orchestra.js";

const COMMANDS = ["fees", "claim", "orchestra-fees", "orchestra-claim"] as const;
type Command = (typeof COMMANDS)[number];

function usage(): never {
  console.log(`Usage: flashnet-fees <command> <mnemonic>
       flashnet-fees orchestra-fees  [server-key] [--affiliate <id>]
       flashnet-fees orchestra-claim [server-key] [--affiliate <id>] [--dry-run]

AMM integrator fees (signed by the integrator wallet):
  fees      Show accrued integrator fees across all pools
  claim     Withdraw all integrator fees to the mnemonic's Spark wallet

Orchestra affiliate fees (USDC/USDT orders; needs the partner server key):
  orchestra-fees   Show earned, paid-out and claimable balances per affiliate
  orchestra-claim  Claim every claimable bucket to its configured payout address

Arguments:
  mnemonic    Your Flashnet integrator mnemonic (quoted string)
  server-key  Orchestra server key (fn_...); or set ORCHESTRA_SERVER_KEY`);
  process.exit(1);
}

async function createClient(mnemonic: string): Promise<FlashnetClient> {
  console.log("Initializing Flashnet client...");
  const { wallet } = await SparkWallet.initialize({
    mnemonicOrSeed: mnemonic,
    options: { network: "MAINNET" },
  });

  const client = new FlashnetClient(wallet);
  await client.initialize();
  console.log("Connected.\n");
  return client;
}

async function showFees(client: FlashnetClient) {
  const fees = await client.getIntegratorFees();
  if (!fees.pools || fees.pools.length === 0) {
    console.log("No integrator fees found.");
    return;
  }

  console.log(`Integrator: ${fees.integratorPublicKey}\n`);
  console.log("Pool Fees:");
  console.log("-".repeat(80));
  for (const pool of fees.pools) {
    console.log(`  Pool:      ${pool.poolId}`);
    console.log(`  Asset B:   ${pool.assetBPubkey}`);
    console.log(`  Fees:      ${pool.assetBFees}`);
    console.log(`  Namespace: ${pool.hostNamespace}`);
    console.log("-".repeat(80));
  }
  console.log(`\nTotal fees (Asset B): ${fees.totalAssetBFees}`);
}

async function claimAll(client: FlashnetClient) {
  const fees = await client.getIntegratorFees();
  if (!fees.pools || fees.pools.length === 0) {
    console.log("No integrator fees to claim.");
    return;
  }

  console.log(`Found fees in ${fees.pools.length} pool(s). Total: ${fees.totalAssetBFees}\n`);

  for (const pool of fees.pools) {
    if (pool.assetBFees === "0") {
      console.log(`Skipping pool ${pool.poolId} (0 fees)`);
      continue;
    }

    console.log(`Claiming ${pool.assetBFees} from pool ${pool.poolId}...`);
    const res = await client.withdrawIntegratorFees({
      lpIdentityPublicKey: pool.poolId,
    });
    console.log(`  Accepted: ${res.accepted}`);
    if (res.assetBWithdrawn) console.log(`  Withdrawn: ${res.assetBWithdrawn}`);
    if (res.transferId) console.log(`  Transfer ID: ${res.transferId}`);
    if (res.error) console.log(`  Error: ${res.error}`);
    console.log();
  }

  console.log("Done. Funds have been transferred to the mnemonic's Spark wallet.");
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 1) usage();

  const command = args[0] as Command;

  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command: ${command}\n`);
    usage();
  }

  if (command === "orchestra-fees" || command === "orchestra-claim") {
    const flags = args.slice(1);
    const dryRun = flags.includes("--dry-run");
    const affIdx = flags.indexOf("--affiliate");
    const only = affIdx >= 0 ? flags[affIdx + 1] : undefined;
    const positional = flags.filter((f, i) => !f.startsWith("--") && (affIdx < 0 || i !== affIdx + 1));
    const key = positional[0] ?? process.env.ORCHESTRA_SERVER_KEY ?? "";
    if (!/^fn_[A-Za-z0-9_.-]{16,}$/.test(key)) {
      console.error("Orchestra server key (fn_...) is required, as an argument or ORCHESTRA_SERVER_KEY.\n");
      usage();
    }
    if (command === "orchestra-fees") await orchestraFees(key, only);
    else await orchestraClaim(key, { dryRun, only });
    return;
  }

  if (args.length < 2) usage();
  const mnemonic = args.slice(1).join(" ");

  if (!mnemonic.trim()) {
    console.error("Mnemonic is required.\n");
    usage();
  }

  const client = await createClient(mnemonic);

  try {
    switch (command) {
      case "fees":
        await showFees(client);
        break;
      case "claim":
        await claimAll(client);
        break;
    }
  } finally {
    await (client.wallet as SparkWallet).cleanupConnections();
  }
}

main().catch((err) => {
  console.error("Error:", err.message || err);
  process.exit(1);
});
