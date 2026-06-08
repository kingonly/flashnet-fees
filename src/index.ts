import { FlashnetClient } from "@flashnet/sdk";
import { SparkWallet } from "@buildonspark/spark-sdk";

const COMMANDS = ["fees", "claim"] as const;
type Command = (typeof COMMANDS)[number];

function usage(): never {
  console.log(`Usage: flashnet-fees <command> <mnemonic>

Commands:
  fees      Show accrued integrator fees across all pools
  claim     Withdraw all integrator fees to the mnemonic's Spark wallet

Arguments:
  mnemonic  Your Flashnet integrator mnemonic (quoted string)`);
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
  if (args.length < 2) usage();

  const command = args[0] as Command;
  const mnemonic = args.slice(1).join(" ");

  if (!COMMANDS.includes(command)) {
    console.error(`Unknown command: ${command}\n`);
    usage();
  }

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
