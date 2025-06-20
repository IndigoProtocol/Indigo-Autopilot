# Strategy CLI Commands

Simple commands to manage your CDP strategies.

## Update Strategy

Update strategy parameters for your wallet:

```bash
npm run strategy-cli update <wallet_address> [options]
```

**Options:**
- `--enabled=true|false` - Enable/disable strategy
- `--target-cr=160` - Target collateral ratio (%)
- `--min-cr=140` - Minimum CR (bot deposits when below)
- `--max-cr=180` - Maximum CR (bot withdraws when above)
- `--assets=iUSD,iBTC` - Assets to manage (comma-separated)

**Examples:**
```bash
# Set strategy for iUSD with 160% target CR
npm run strategy-cli update addr1... --target-cr=160 --min-cr=150 --max-cr=170 --assets=iUSD

# Enable multiple assets
npm run strategy-cli update addr1... --assets=iUSD,iBTC --enabled=true

# Disable strategy
npm run strategy-cli update addr1... --enabled=false
```

## Get Strategy Status

View current strategy and CDP analysis:

```bash
npm run strategy-cli get <wallet_address>
```

This shows:
- Current strategy settings
- Your CDPs and their status
- What actions the bot will take

## Remove Strategy

Remove strategy configuration:

```bash
npm run strategy-cli remove <wallet_address>
```

## How It Works

- **Target CR**: Where bot tries to maintain your collateral ratio
- **Min CR**: Bot deposits ADA when CR drops below this
- **Max CR**: Bot withdraws ADA when CR goes above this
- **Assets**: Only manage CDPs for specified assets (iUSD, iBTC, iETH, iSOL) 