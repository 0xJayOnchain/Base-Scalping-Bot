require('dotenv').config();
const { ethers, parseUnits, formatUnits, JsonRpcProvider, Contract, Wallet } = require('ethers');

// Aerodrome Slipstream Router ABI (for exactInputSingle)
const SWAP_ROUTER_ABI = [
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)"
];

// Aerodrome CL Pool ABI (Algebra V3-based)
const POOL_ABI = [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

// ERC20 ABI for balance checks
const ERC20_ABI = [
    "function balanceOf(address account) external view returns (uint256)",
    "function decimals() external view returns (uint8)"
];

const provider = new JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`);
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

const POOL_ADDRESS = '0x4e962BB3889Bf030368F56810A9c96B83CB3E778'; // USDC/cbBTC pool
const SWAP_ROUTER_ADDRESS = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'; // Aerodrome Slipstream Router
const TOKEN_IN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC
const TOKEN_OUT = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'; // cbBTC

const poolContract = new Contract(POOL_ADDRESS, POOL_ABI, provider);
const routerContract = new Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, wallet);
const usdcContract = new Contract(TOKEN_IN, ERC20_ABI, provider);

const INITIAL_PROFIT_TARGET = 0.01; // 1% profit target
const STOP_LOSS = -0.02; // -2% stop-loss
const FEE = 453; // 0.0453% fee tier
const SLIPPAGE_TOLERANCE = 0.995; // 0.5% slippage
const SMA_WINDOW = 36; // 3 minutes (36 intervals of 5 seconds)

let priceHistory = [];
let token0, token1;
let currentStatus = null; // Track the current status to reduce logging noise
let simulatedUsdcBalance = 25; // Simulate initial USDC balance (in USDC, not wei)

// Log token ordering to determine price direction
async function logTokenOrdering() {
    try {
        token0 = await poolContract.token0();
        token1 = await poolContract.token1();
        console.log(`token0: ${token0}, token1: ${token1}`);
    } catch (error) {
        console.error(`Error fetching token ordering: ${error.message}`);
        throw error;
    }
}

// Fetch USDC balance (simulated for dry run)
async function getUsdcBalance() {
    // In live trading, fetch the actual balance:
    // const balance = await usdcContract.balanceOf(wallet.address);
    // return Number(formatUnits(balance, 6));
    
    // For dry run, return the simulated balance
    return simulatedUsdcBalance;
}

// Calculate the amount to trade (always 100% of the balance)
async function calculateTradeAmount() {
    const balance = await getUsdcBalance();
    console.log(`Current USDC balance: $${balance.toFixed(2)}, Trading with: $${balance.toFixed(2)}`);
    return parseUnits(balance.toFixed(6), 6); // Convert to wei (USDC has 6 decimals)
}

async function getPrice() {
    const slot0 = await poolContract.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96;

    if (sqrtPriceX96 === 0n) {
        throw new Error('sqrtPriceX96 is 0, pool may not be initialized');
    }

    const Q96 = 2n ** 96n; // 2^96
    const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
    const priceToken1PerToken0Unadjusted = sqrtPrice * sqrtPrice;
    const decimalAdjustment = 10 ** (8 - 6); // 10^(8-6) = 10^2 (cbBTC/USDC)
    const priceToken1PerToken0 = priceToken1PerToken0Unadjusted / decimalAdjustment;

    if (priceToken1PerToken0 === 0) {
        throw new Error('Price calculation resulted in 0, cannot compute USDC per cbBTC');
    }
    const priceUsdcPerCbBtc = 1 / priceToken1PerToken0;

    return priceUsdcPerCbBtc;
}

function calculateSMA(prices) {
    if (prices.length < SMA_WINDOW) return null;
    const sum = prices.slice(-SMA_WINDOW).reduce((a, b) => a + b, 0);
    return sum / SMA_WINDOW;
}

async function swap(amountIn, minAmountOut, isBuy = true) {
    const tokenIn = isBuy ? TOKEN_IN : TOKEN_OUT;
    const tokenOut = isBuy ? TOKEN_OUT : TOKEN_IN;
    const decimalsIn = isBuy ? 6 : 8;
    const decimalsOut = isBuy ? 8 : 6;

    const amountStr = ethers.formatUnits(amountIn, decimalsIn);
    const minOutStr = ethers.formatUnits(minAmountOut, decimalsOut);
    console.log(`[DRY RUN] Swap ${amountStr} ${isBuy ? 'USDC' : 'cbBTC'} -> ${minOutStr} ${isBuy ? 'cbBTC' : 'USDC'}`);

    // Simulate balance update for dry run
    if (isBuy) {
        simulatedUsdcBalance -= Number(formatUnits(amountIn, 6));
    } else {
        simulatedUsdcBalance += Number(formatUnits(minAmountOut, 6));
    }

    return { amountOut: minAmountOut };
}

// Helper function to log status only when it changes
function logStatus(newStatus, additionalInfo = '') {
    if (newStatus !== currentStatus) {
        console.log(newStatus + (additionalInfo ? ` ${additionalInfo}` : ''));
        currentStatus = newStatus;
    }
}

async function scalp() {
    await logTokenOrdering();

    let lastBuyPrice = null;
    let cbbtcBalance = parseUnits('0', 8);
    let lastProfitLogged = null; // Track the last profit percentage logged to reduce noise

    while (true) {
        try {
            const price = await getPrice();
            priceHistory.push(price);
            if (priceHistory.length > SMA_WINDOW + 1) priceHistory.shift();

            const sma = calculateSMA(priceHistory);

            if (!sma) {
                logStatus('Waiting for enough data...');
                await new Promise(resolve => setTimeout(resolve, 5000));
                continue;
            }

            const prevPrice = priceHistory[priceHistory.length - 2];
            const priceAboveSma = price > sma;
            const prevAboveSma = prevPrice > sma;

            if (!lastBuyPrice) {
                if (!prevAboveSma && priceAboveSma) {
                    const amountIn = await calculateTradeAmount();
                    if (Number(formatUnits(amountIn, 6)) <= 0) {
                        console.log('Insufficient USDC balance to trade');
                        await new Promise(resolve => setTimeout(resolve, 5000));
                        continue;
                    }
                    const expectedOutRaw = Number(formatUnits(amountIn, 6)) / price;
                    const expectedOutStr = expectedOutRaw.toFixed(8);
                    const expectedOut = parseUnits(expectedOutStr, 8);
                    const minAmountOut = expectedOut * BigInt(Math.floor(SLIPPAGE_TOLERANCE * 100)) / 100n;
                    await swap(amountIn, minAmountOut, true);
                    lastBuyPrice = price;
                    cbbtcBalance = minAmountOut;
                    logStatus(`[DRY RUN] Bought at ${lastBuyPrice.toFixed(2)} USDC per cbBTC, cbBTC: ${ethers.formatUnits(cbbtcBalance, 8)}`);
                } else {
                    logStatus('Waiting for buy signal...');
                }
            } else {
                const profit = (price - lastBuyPrice) / lastBuyPrice;
                if (profit >= INITIAL_PROFIT_TARGET || profit <= STOP_LOSS) {
                    const amountOut = cbbtcBalance;
                    const expectedUsdcRaw = Number(ethers.formatUnits(amountOut, 8)) * price;
                    const expectedUsdcStr = expectedUsdcRaw.toFixed(6);
                    const expectedUsdc = parseUnits(expectedUsdcStr, 6);
                    const minAmountOut = expectedUsdc * BigInt(Math.floor(SLIPPAGE_TOLERANCE * 100)) / 100n;
                    await swap(amountOut, minAmountOut, false);
                    logStatus(`[DRY RUN] Sold at ${price.toFixed(2)} USDC per cbBTC, Profit: ${(profit * 100).toFixed(2)}% ${profit <= STOP_LOSS ? '(Stop-Loss)' : ''}`);
                    lastBuyPrice = null;
                    cbbtcBalance = parseUnits('0', 8);
                    lastProfitLogged = null; // Reset profit logging
                } else {
                    const profitPercent = (profit * 100).toFixed(2);
                    if (lastProfitLogged === null || Math.abs(profitPercent - lastProfitLogged) >= 0.1) {
                        logStatus(`Profit: ${profitPercent}%, waiting for 1% profit or -2% stop-loss...`, `Price: ${price.toFixed(2)} USDC per cbBTC, SMA(${SMA_WINDOW}): ${sma.toFixed(2)}`);
                        lastProfitLogged = profitPercent;
                    }
                }
            }

            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error(`Error: ${error.message}`);
        }
    }
}

console.log('Starting dry run with SMA for USDC/cbBTC on Aerodrome Finance (Base)...');
scalp();