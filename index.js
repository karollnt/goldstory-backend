require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { ethers } = require('ethers');
const axios = require('axios');
const { processIncomingPayment } = require('./swapProcessor');

const app = express();
const PORT = process.env.PORT || 3000;

// Configure CORS with specific origins
const allowedOrigins = [
  'https://goldstory.site',
  'http://localhost:3000',
  'http://localhost:5173'
];

const corsOptions = {
  origin: function (origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    if (allowedOrigins.indexOf(origin) === -1) {
      const msg = 'The CORS policy for this site does not allow access from the specified Origin.';
      console.warn(`Blocked request from origin: ${origin}`);
      return callback(new Error(msg), false);
    }
    return callback(null, true);
  },
  methods: ['GET', 'POST', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true,
  maxAge: 600 // Cache preflight request for 10 minutes
};

// Apply CORS middleware
app.use(cors(corsOptions));

// Handle preflight requests
app.options('*', cors(corsOptions));

// Función para enviar notificaciones por Telegram
async function sendTelegram(message) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const url = `https://api.telegram.org/bot${token}/sendMessage`;

  try {
    await axios.post(url, {
      chat_id: chatId,
      text: message,
      parse_mode: 'Markdown',
    });
    console.log("📲 Mensaje enviado a Telegram");
  } catch (error) {
    console.error("❌ Error enviando a Telegram:", error.message);
  }
}

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
    const msg = "❌ USDC_ADDRESS no está definido. Verifica tu variable de entorno.";
    console.error(msg);
    await sendTelegram(msg);
    return;
  }

  if (!RECEIVER_WALLET) {
    const msg = "❌ RECEIVER_WALLET no está definido. Verifica tu variable de entorno.";
    console.error(msg);
    await sendTelegram(msg);
    return;
  }

  const contract = new Contract(USDC_ADDRESS, usdcAbi, provider);

  contract.on("Transfer", async (from, to, value) => {
    if (to.toLowerCase() === RECEIVER_WALLET.toLowerCase()) {
      const amount = formatUnits(value, 6);
      const log = `💰 Recibido ${amount} USDC de ${from}`;
      console.log(log);
      await sendTelegram(`💰 *Pago recibido:*\n${amount} USDC\n👤 De: \`${from}\``);
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
  listenIncomingTransfers().catch(async (err) => {
    console.error("❌ Error iniciando listener de transferencias:", err);
    await sendTelegram(`⚠️ *Error crítico en backend:*\n\`${err.message}\``);
  });
});
