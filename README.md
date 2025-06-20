# Indigo Autopilot

Automated CDP management for Indigo Protocol on Cardano. The bot automatically manages your Collateralized Debt Positions by adjusting collateral ratios based on your configured strategy.

## ⚠️ Security Disclaimer

**IMPORTANT**: This bot requires your wallet seed phrase to operate. For security reasons:

- **Run locally only** - Never deploy this bot to shared servers or cloud environments
- **Your seed phrase never leaves your machine** - The bot operates entirely within your local environment
- **You are responsible for your wallet security** - Keep your seed phrase and `.env` file secure
- **Intended for individual/institutional use** - Each user must run their own instance

We strongly recommend running this bot on a dedicated, secure machine that you control.


## How It Works

### Indigo Autopilot Logic
1. **Monitors** your CDPs every 2 minutes
2. **Calculates** current collateral ratio (CR) for each CDP
3. **Takes action** when CR moves outside your target range:
   - **CR < minCR**: Deposits ADA to increase CR to targetCR
   - **CR > maxCR**: Withdraws ADA to decrease CR to targetCR
   - **minCR ≤ CR ≤ maxCR**: No action needed

## Project Structure

- `packages/shared` - Shared types and utilities
- `packages/backend` - Node.js backend API and bot services

## Quick Start

### 1. Setup Environment

```bash
# Navigate to backend
cd packages/backend

# Copy environment template
cp env.example .env
```

**Required Configuration:**
- Database credentials (In the pilot phase will be provided by Indigo team, then confiuration will be changed)
- Blockfrost API key (After pilot phase, It will be changed with Ogmios configuration)
- Your wallet seed phrase and strategy - please check disclaimer above.

### 2. Configure Your Strategy

Add your wallet configuration to `packages/backend/.env`:

```bash
# Replace 'addr1qys3t6znptaw4z' with first 20 chars of your wallet address
WALLET_SEEDPHRASE_addr1qys3t6znptaw4z=your 24 word seed phrase here
STRATEGY_addr1qys3t6znptaw4zy={"walletAddress":"your_full_wallet_address","enabled":true,"targetCR":160,"minCR":150,"maxCR":175,"enabledAssets":["iUSD"]}
```

### 3. Start the Bot

```bash
# From project root
npm install
npm run build

# Start the bot
npm run dev:backend
```

The bot will automatically start managing your CDPs based on your strategy.

## Strategy Management

Use the strategy CLI to manage your configurations:

See `packages/backend/STRATEGY_CLI.md` for detailed commands.
