require('dotenv').config();
const express = require('express');
const { ethers } = require('ethers');
const { processIncomingPayment } = require('./swapProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

// Logs para verificar variables de entorno
console.log("🔍 Variables de entorno:");
console.log("USDC_ADDRESS:", process.env.USDC_ADDRESS);
console.log("RECEIVER_WALLET:", process.env.RECEIVER_WALLET);
console.log("RPC_URL:", process.env.RPC_URL);

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const RECEIVER_WALLET = process.env.RECEIVER_WALLET;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

const { formatUnits } = ethers.utils;
const { Contract } = ethers;

// ABI mínimo para escuchar evento Transfer
const usdcAbi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
];

async function listenIncomingTransfers() {
    if (!USDC_ADDRESS) {
        console.error("❌ USDC_ADDRESS no está definido. Verifica tu variable de entorno.");
        return;
    }
    if (!RECEIVER_WALLET) {
        console.error("❌ RECEIVER_WALLET no está definido. Verifica tu variable de entorno.");
        return;
    }
    const contract = new Contract(USDC_ADDRESS, usdcAbi, provider);

    contract.on("Transfer", async (from, to, value) => {
        if (to.toLowerCase() === RECEIVER_WALLET.toLowerCase()) {
            console.log(`💰 Recibido ${formatUnits(value, 6)} USDC de ${from}`);
            await processIncomingPayment(from, value);
        }
    });

    console.log("👂 Escuchando transferencias entrantes a:", RECEIVER_WALLET);
}

app.get('/', (req, res) => {
    res.send('✅ GoldStory backend activo');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
    listenIncomingTransfers().catch(err => {
        console.error("❌ Error iniciando listener de transferencias:", err);
    });
});
