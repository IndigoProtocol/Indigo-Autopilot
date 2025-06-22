# Strategy CLI Commands

Simple commands to manage your CDP strategies with per-asset configuration.

## Update Strategy

Update strategy parameters for specific assets in your wallet:

```bash
npm run strategy-cli update <wallet_address> --assets=<assets> [options]
```

**Options:**
- `--assets=iUSD,iBTC` - Assets to configure (comma-separated, **REQUIRED**)
- `--enabled=true|false` - Enable/disable strategy for specified assets
- `--target-cr=160` - Target collateral ratio (%)
- `--min-cr=140` - Minimum CR (bot deposits when below)
- `--max-cr=180` - Maximum CR (bot withdraws when above)

**Examples:**
```bash
# Set strategy for iBTC with 200% target CR
npm run strategy-cli update addr1... --assets=iBTC --target-cr=200 --min-cr=195 --max-cr=205

# Set different strategy for iUSD
npm run strategy-cli update addr1... --assets=iUSD --target-cr=160 --min-cr=150 --max-cr=170

# Configure multiple assets with same parameters
npm run strategy-cli update addr1... --assets=iETH,iSOL --target-cr=180 --min-cr=170 --max-cr=190

# Enable/disable specific assets
npm run strategy-cli update addr1... --assets=iBTC --enabled=false
```

## Get Strategy Status

View current per-asset strategies and CDP analysis:

```bash
npm run strategy-cli get <wallet_address>
```

This shows:
- Current strategy settings for each asset
- Your CDPs and their status per asset
- What actions the bot will take for each CDP

## Remove Strategy

Remove strategy configuration (entire wallet or specific assets):

```bash
# Remove specific asset strategies
npm run strategy-cli remove <wallet_address> <asset1> <asset2>

# Remove all strategies for wallet
npm run strategy-cli remove <wallet_address>
```

**Examples:**
```bash
# Remove strategies for specific assets
npm run strategy-cli remove addr1... iBTC iUSD

# Remove all strategies
npm run strategy-cli remove addr1...
```

## How It Works

**Strategy Flow:**
1. Bot checks each CDP's asset type
2. Looks up asset-specific strategy (if configured)
3. For each managed asset:
   - CR < minCR → Bot deposits collateral to reach targetCR
   - CR > maxCR → Bot withdraws collateral to reach targetCR
   - minCR ≤ CR ≤ maxCR → Bot takes no action 