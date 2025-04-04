# USDC/cbBTC Scalping Bot on Aerodrome Finance (Base)

## Currently in developement mode so no permissions to trade funds in wallet

This project is a trading bot designed to scalp various token pairs on Aerodrome Finance, a decentralized exchange (DEX) on the Base blockchain. The bot uses a Simple Moving Average (SMA) crossover strategy to identify buy opportunities and a configurable profit target with a stop-loss mechanism to determine sell points. It supports both Slipstream (concentrated liquidity) and VAMM (Uniswap V2-style) pools, making it versatile for different token pairs such as USDC/cbBTC, VAMM-USDC/AERO, and more.

## Features
- ***SMA Crossover for Buying***: Buys when the price crosses above the SMA (indicating a potential local low).
- ***Configurable Profit Target and Stop-Loss***: Set a target profit percentage (e.g., 1%) and a stop-loss percentage (e.g., -2%) to manage risk and lock in gains.
- **Support for Multiple Pool Types**:
    - Slipstream pools (Algebra V3-based, e.g., USDC/cbBTC).
    - VAMM pools (Uniswap V2-style, e.g., VAMM-USDC/AERO).
- **Dynamic Capital Management**:
  - Uses 100% of the token-in balance (e.g., USDC) for trades by default.
  - Configurable to adjust trade size based on balance thresholds (optional, can be enabled in the pool configuration).
- **Reduced Logging**: Only logs status changes (e.g., "Waiting for buy signal...", buy/sell events) and significant profit updates (changes of 0.1% or more) to minimize noise.
- **Price Source**:
    - For Slipstream pools: Fetches the current price using the sqrtPriceX96 value.
    - For VAMM pools: Fetches the price using the pool’s reserves.
- **Configurable Parameters**: Easily adjust the SMA window, profit target, stop-loss, slippage tolerance, polling interval, and capital management thresholds.

## Prerequisites
- **Node.js**: Version 14.x or higher.
- **npm**: For installing dependencies.
- **Alchemy API Key**: To interact with the Base blockchain via Alchemy’s RPC endpoint.
- **Wallet Private Key**: A wallet with a private key to execute trades.
- **USDC and ETH**: At least 25 USDC for initial trading and some ETH for gas fees on Base (~$1 worth should be enough for several trades).

## Installation
1. **Clone the Repository**:
   ```bash
   git clone https://github.com/0xJayOnchain/Base-Scalping-Bot.git
   cd aerodrome-usdc-cbbtc-scalper
   ```

2. **Install Dependencies**:
    ```bash
    yarn
    ```

3. **Set Up Environment Variables**:
 - Create a .env file in the project root:
 ```bash
 touch .env
 ```

- Add your Alchemy API key and wallet private key:
``` javascript
ALCHEMY_KEY=your_alchemy_key
PRIVATE_KEY=your_private_key
```

## Usage

1. **Fund Your Wallet**:
   - Ensure your wallet has at least 25 USDC for initial trading and some ETH for gas fees on Base.

2. **Run the Bot**:
   ```bash
   node index.js
   ```
   - The bot will start trading on Aerodrome Finance, executing buy and sell orders based on the SMA crossover for buying and the dynamic profit target/stop-loss for selling.
    - Example output:

```bash
Starting trading bot for USDC/cbBTC (CL100) on Aerodrome Finance (Base)...
Tokens approved for router
token0: 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913, token1: 0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf
Waiting for enough data...
Waiting for buy signal...
Current USDC balance: $25.00, Trading with: $25.00
[LIVE] Bought at 80000.00 USDC per cbBTC, cbBTC: 0.00031236
Profit: 3.00%, waiting for trailing profit floor or -5% stop-loss... Price: 82400.00 USDC per cbBTC, SMA(60): 81000.00
New profit floor set: 3.00%
Profit: 5.00%, waiting for trailing profit floor or -5% stop-loss... Price: 84000.00 USDC per cbBTC, SMA(60): 82000.00
New profit floor set: 5.00%
Profit: 10.00%, waiting for trailing profit floor or -5% stop-loss... Price: 88000.00 USDC per cbBTC, SMA(60): 85000.00
New profit floor set: 10.00%
Profit: 7.00%, waiting for trailing profit floor or -5% stop-loss... Price: 85600.00 USDC per cbBTC, SMA(60): 86000.00
[LIVE] Sold at 85600.00 USDC per cbBTC, Profit: 7.00% (Trailing Profit Floor)
Current USDC balance: $600.00, Trading with: $300.00
[LIVE] Bought at 86000.00 USDC per cbBTC, cbBTC: 0.00348837
```

3. **Monitor the Bot:**:
- The bot logs only when the status changes (e.g., from "Waiting for buy signal..." to a buy event) or when the profit changes by at least 0.1%.

- Errors are always logged to ensure you don’t miss critical issues.

## Configuration

The bot’s behavior can be customized by adjusting the following parameters in `index.js`:

**SMA Window**:
  ```javascript
  const SMA_WINDOW = 60;
  ``` 

  - Controls the number of intervals for the SMA calculation. A larger window (e.g., 180 for 15 minutes) makes the SMA smoother but slower to react.

**Profit Target and Stop-Loss**:
```javascript
const INITIAL_PROFIT_TARGET = 0.03; // 3% initial profit target
const STOP_LOSS = -0.05; // -5% stop-loss
```

The bot starts with a 3% profit target and adjusts dynamically with a 2% trailing stop at 5% increments. It sells at a -5% loss if the stop-loss is hit.

**Capital Management**:
```javascript
const BALANCE_THRESHOLD = 500;  // $500 threshold for switching to 50% trading
```

Controls the balance threshold for switching between 100% and 50% trading. Adjust this to change the point at which the bot starts using 50% of the balance.

**Slippage Tolerance**:
```javascript
const SLIPPAGE_TOLERANCE = 0.995; // 0.5% slippage
```

Adjusts the minimum amount out for swaps to account for slippage.

**Polling Interval**:
``` javascript
await new Promise(resolve => setTimeout(resolve, 5000));// 5 seconds
```

Controls how often the bot checks the price and updates the SMA.

***Troubleshooting***
- Swap Failures: If swaps fail due to slippage, increase the SLIPPAGE_TOLERANCE (e.g., to 0.99 for 1% slippage).

- Gas Issues: Ensure your wallet has enough ETH for gas fees. Gas on Base is typically cheap (~$0.05-$0.10 per swap), but monitor your balance.

- Price Stagnation: If the pool price doesn’t update, consider switching to a Chainlink oracle for price data (requires code modification).

- Insufficient Balance: If the bot logs “Insufficient USDC balance to trade,” ensure your wallet has enough USDC to continue trading.