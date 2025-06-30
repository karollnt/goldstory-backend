require('dotenv').config();
const express = require('express');
const { JsonRpcProvider, formatUnits, Contract } = require('ethers');
const { processIncomingPayment } = require('./swapProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

// Variables seguras desde el entorno
const provider = new JsonRpcProvider(process.env.RPC_URL);
const RECEIVER_WALLET = process.env.RECEIVER_WALLET;
const USDC_ADDRESS = process.env.USDC_ADDRESS;

const usdcAbi = [
    "event Transfer(address indexed from, address indexed to, uint256 value)"
];

// Función para escuchar transferencias hacia tu wallet
async function listenIncomingTransfers() {
    const contract = new Contract(USDC_ADDRESS, usdcAbi, provider);

    contract.on("Transfer", async (from, to, value) => {
        if (to.toLowerCase() === RECEIVER_WALLET.toLowerCase()) {
            console.log(`💰 Recibido ${formatUnits(value, 6)} USDC de ${from}`);
            await processIncomingPayment(from, value);
        }
    });

    console.log("👂 Escuchando transferencias entrantes a:", RECEIVER_WALLET);
}

// Iniciar servidor HTTP y luego el listener
app.get('/', (req, res) => {
    res.send('✅ GoldStory backend activo');
});

app.listen(PORT, () => {
    console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
    listenIncomingTransfers().catch(err => {
        console.error("❌ Error iniciando listener de transferencias:", err);
    });
});
