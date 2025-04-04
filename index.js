require('dotenv').config();
const { ethers, parseUnits, JsonRpcProvider, Contract, Wallet } = require('ethers');

// Aerodrome Slipstream Router ABI (for exactInputSingle)
const SWAP_ROUTER_ABI = [
    "function exactInputSingle(tuple(address tokenIn, address tokenOut, address recipient, uint256 deadline, uint256 amountIn, uint256 amountOutMinimum, uint160 sqrtPriceLimitX96)) external returns (uint256 amountOut)"
];

// Aerodrome CL100 Pool ABI (Algebra V3-based)
const POOL_ABI = [
    "function slot0() external view returns (uint160 sqrtPriceX96, int24 tick, uint16 observationIndex, uint16 observationCardinality, uint16 observationCardinalityNext, bool unlocked)",
    "function token0() external view returns (address)",
    "function token1() external view returns (address)"
];

const provider = new JsonRpcProvider(`https://base-mainnet.g.alchemy.com/v2/${process.env.ALCHEMY_KEY}`);
const wallet = new Wallet(process.env.PRIVATE_KEY, provider);

const POOL_ADDRESS = '0x4e962BB3889Bf030368F56810A9c96B83CB3E778'; // USDC/cbBTC CL100 pool
const SWAP_ROUTER_ADDRESS = '0xcF77a3Ba9A5CA399B7c97c74d54e5b1Beb874E43'; // Aerodrome Slipstream Router
const TOKEN_IN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'; // USDC
const TOKEN_OUT = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf'; // cbBTC

const poolContract = new Contract(POOL_ADDRESS, POOL_ABI, provider);
const routerContract = new Contract(SWAP_ROUTER_ADDRESS, SWAP_ROUTER_ABI, wallet);

const AMOUNT_IN = parseUnits('25', 6); // 25 USDC
const PROFIT_TARGET = 0.02; // 2% profit target
const STOP_LOSS = -0.03; // -3% stop-loss
const FEE = 453; // 0.0453% fee tier
const SLIPPAGE_TOLERANCE = 0.995; // 0.5% slippage
const SMA_WINDOW = 60; // 5 minutes (60 intervals of 5 seconds)

let priceHistory = [];
let token0, token1;
let currentStatus = null; // Track the current status to reduce logging noise

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

async function getPrice() {
    const slot0 = await poolContract.slot0();
    const sqrtPriceX96 = slot0.sqrtPriceX96;
    // console.log(`sqrtPriceX96: ${sqrtPriceX96.toString()}`); // Commented out to reduce noise

    if (sqrtPriceX96 === 0n) {
        throw new Error('sqrtPriceX96 is 0, pool may not be initialized');
    }

    const Q96 = 2n ** 96n; // 2^96
    const sqrtPrice = Number(sqrtPriceX96) / Number(Q96);
    // console.log(`sqrtPrice: ${sqrtPrice}`);

    const priceToken1PerToken0Unadjusted = sqrtPrice * sqrtPrice;
    // console.log(`priceToken1PerToken0Unadjusted (cbBTC/USDC): ${priceToken1PerToken0Unadjusted}`);

    const decimalAdjustment = 10 ** (8 - 6); // 10^(8-6) = 10^2 (cbBTC/USDC)
    const priceToken1PerToken0 = priceToken1PerToken0Unadjusted / decimalAdjustment;
    // console.log(`priceToken1PerToken0 (cbBTC/USDC): ${priceToken1PerToken0}`);

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
                    const expectedOutRaw = 25 / price;
                    const expectedOutStr = expectedOutRaw.toFixed(8);
                    const expectedOut = parseUnits(expectedOutStr, 8);
                    const minAmountOut = expectedOut * BigInt(Math.floor(SLIPPAGE_TOLERANCE * 100)) / 100n;
                    await swap(AMOUNT_IN, minAmountOut, true);
                    lastBuyPrice = price;
                    cbbtcBalance = minAmountOut;
                    logStatus(`[DRY RUN] Bought at ${lastBuyPrice.toFixed(2)}, cbBTC: ${ethers.formatUnits(cbbtcBalance, 8)}`);
                } else {
                    logStatus('Waiting for buy signal...');
                }
            } else {
                const profit = (price - lastBuyPrice) / lastBuyPrice;
                if (prevAboveSma && !priceAboveSma || profit >= PROFIT_TARGET || profit <= STOP_LOSS) {
                    const amountOut = cbbtcBalance;
                    const expectedUsdcRaw = Number(ethers.formatUnits(amountOut, 8)) * price;
                    const expectedUsdcStr = expectedUsdcRaw.toFixed(6);
                    const expectedUsdc = parseUnits(expectedUsdcStr, 6);
                    const minAmountOut = expectedUsdc * BigInt(Math.floor(SLIPPAGE_TOLERANCE * 100)) / 100n;
                    await swap(amountOut, minAmountOut, false);
                    logStatus(`[DRY RUN] Sold at ${price.toFixed(2)}, Profit: ${(profit * 100).toFixed(2)}% ${profit < 0 ? '(Stop-Loss)' : (prevAboveSma && !priceAboveSma ? '(SMA Crossover)' : '')}`);
                    lastBuyPrice = null;
                    cbbtcBalance = parseUnits('0', 8);
                    lastProfitLogged = null; // Reset profit logging
                } else {
                    // Log profit only if it changes significantly (e.g., by 0.1%)
                    const profitPercent = (profit * 100).toFixed(2);
                    if (lastProfitLogged === null || Math.abs(profitPercent - lastProfitLogged) >= 0.1) {
                        logStatus(`Profit: ${profitPercent}%, waiting for SMA crossover, 2% profit, or -3% stop-loss...`, `Price: ${price.toFixed(2)}, SMA(${SMA_WINDOW}): ${sma.toFixed(2)}`);
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

console.log('Starting dry run with SMA for USDC/cbBTC (CL100) on Aerodrome Finance (Base)...');
scalp();