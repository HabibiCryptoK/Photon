// PulseChain WebSocket URL and contract addresses
const PULSECHAIN_WS_URL = 'wss://ws.pulsechain.com';
const PULSEX_FACTORY_ADDRESS = '0x29ea7545def87022badc76323f373ea1e707c523';
const WPLS_ADDRESS = '0xA1077a294dDE1B09bB078844df40758a5D0f9a27';

// Initialize WebSocket provider and factory contract
const provider = new ethers.providers.WebSocketProvider(PULSECHAIN_WS_URL);
const factoryContract = new ethers.Contract(
    PULSEX_FACTORY_ADDRESS,
    ["event PairCreated(address indexed token0, address indexed token1, address pair, uint)"],
    provider
);

// Global variables
let newPairs = [];
let wplsPrice = 0;

// Fetch WPLS price in USD from CoinGecko
async function getWplsPrice() {
    try {
        const response = await fetch('https://api.coingecko.com/api/v3/simple/price?ids=pulsechain&vs_currencies=usd');
        const data = await response.json();
        wplsPrice = data.pulsechain.usd || 0; // Fallback to 0 if price unavailable
    } catch (error) {
        console.error('Error fetching WPLS price:', error);
        wplsPrice = 0; // Use 0 if fetch fails
    }
}

// Listen for new PairCreated events
factoryContract.on('PairCreated', async (token0, token1, pairAddress, event) => {
    // Check if the pair involves WPLS
    const wplsIndex = token0.toLowerCase() === WPLS_ADDRESS.toLowerCase() ? 0 : 
                     (token1.toLowerCase() === WPLS_ADDRESS.toLowerCase() ? 1 : -1);
    if (wplsIndex === -1) return; // Skip if not a WPLS pair

    const otherToken = wplsIndex === 0 ? token1 : token0;
    const otherTokenContract = new ethers.Contract(
        otherToken,
        ["function symbol() view returns (string)"],
        provider
    );

    try {
        // Fetch pair name
        const otherSymbol = await otherTokenContract.symbol();
        const pairName = `WPLS/${otherSymbol}`;

        // Get creation time
        const block = await provider.getBlock(event.blockNumber);
        const creationTime = block.timestamp * 1000; // Convert to milliseconds

        // Fetch initial reserves
        const pairContract = new ethers.Contract(
            pairAddress,
            ["function getReserves() view returns (uint112, uint112, uint32)"],
            provider
        );
        const reserves = await pairContract.getReserves();
        const reserveWPLS = wplsIndex === 0 ? reserves[0] : reserves[1];
        const initialLiquidityWPLS = reserveWPLS;

        // Add pair to the list (insert at the top)
        newPairs.unshift({
            pairAddress,
            pairName,
            creationTime,
            initialLiquidityWPLS,
            currentLiquidityWPLS: initialLiquidityWPLS, // Initially the same
            wplsIndex
        });

        // Limit to 100 pairs to prevent performance issues
        if (newPairs.length > 100) newPairs.pop();

        renderNewPairs();
    } catch (error) {
        console.error('Error processing new pair:', error);
    }
});

// Periodically update current liquidity (every 10 seconds)
setInterval(async () => {
    for (const pair of newPairs) {
        try {
            const pairContract = new ethers.Contract(
                pair.pairAddress,
                ["function getReserves() view returns (uint112, uint112, uint32)"],
                provider
            );
            const reserves = await pairContract.getReserves();
            pair.currentLiquidityWPLS = pair.wplsIndex === 0 ? reserves[0] : reserves[1];
        } catch (error) {
            console.error(`Error updating liquidity for ${pair.pairAddress}:`, error);
        }
    }
    renderNewPairs();
}, 10000);

// Render the table and update Time Created every second
function renderNewPairs() {
    const tableBody = document.getElementById('newPairsTable').querySelector('tbody');
    tableBody.innerHTML = '';
    const now = Date.now();

    newPairs.forEach(pair => {
        // Calculate elapsed time
        const elapsed = now - pair.creationTime;
        const seconds = Math.floor(elapsed / 1000);
        const minutes = Math.floor(seconds / 60);
        const timeCreated = seconds < 60 ? `${seconds}s` : `${minutes}m`;

        // Calculate liquidity values in USD (TVL = 2 * WPLS reserve * WPLS price)
        const initialTVL = (2 * Number(ethers.utils.formatEther(pair.initialLiquidityWPLS)) * wplsPrice).toFixed(2);
        const currentTVL = (2 * Number(ethers.utils.formatEther(pair.currentLiquidityWPLS)) * wplsPrice).toFixed(2);

        // Shorten contract address
        const shortAddress = `${pair.pairAddress.slice(0, 6)}...${pair.pairAddress.slice(-4)}`;

        // Create table row
        const row = document.createElement('tr');
        row.innerHTML = `
            <td>
                ${pair.pairName}<br>
                <a href="https://scan.pulsechain.com/address/${pair.pairAddress}" target="_blank" title="Click to copy or view on explorer">${shortAddress}</a>
            </td>
            <td>${timeCreated}</td>
            <td>$${currentTVL}</td>
            <td>$${initialTVL}</td>
        `;
        tableBody.appendChild(row);

        // Add click-to-copy functionality
        const link = row.querySelector('a');
        link.addEventListener('click', (e) => {
            e.preventDefault();
            navigator.clipboard.writeText(pair.pairAddress).then(() => {
                link.textContent = 'Copied!';
                setTimeout(() => { link.textContent = shortAddress; }, 1000);
            });
        });
    });
}

// Initialize WPLS price and update every minute
getWplsPrice();
setInterval(getWplsPrice, 60000);

// Update table every second for real-time Time Created
setInterval(renderNewPairs, 1000);