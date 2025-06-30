// index.js

require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const { processIncomingPayment } = require('./swapProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const RECEIVER_WALLET = "0xd93246390505e23789728e34a057E2fb9FF856fE"; // Tu wallet

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174"; // USDC en Polygon

// ABI mínimo para escuchar Transferencias
const usdcAbi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// Escucha las transferencias entrantes al wallet receptor
async function listenIncomingTransfers() {
    const contract = new ethers.Contract(USDC_ADDRESS, usdcAbi, provider);

    contract.on("Transfer", async (from, to, value) => {
        if (to.toLowerCase() === RECEIVER_WALLET.toLowerCase()) {
            console.log(`💰 Recibido ${ethers.utils.formatUnits(value, 6)} USDC de ${from}`);
            await processIncomingPayment(from, value);
        }
    });

    console.log("👂 Escuchando transferencias entrantes a:", RECEIVER_WALLET);
}

listenIncomingTransfers();

app.get('/', (req, res) => {
    res.send('✅ GoldStory backend activo');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en http://localhost:${PORT}`);
});
