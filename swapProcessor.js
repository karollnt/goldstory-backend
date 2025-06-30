const { ethers } = require("ethers");
const {
  ChainId,
  Token,
  CurrencyAmount,
  TradeType,
  Percent,
} = require("@uniswap/sdk-core");
const { AlphaRouter } = require("@uniswap/smart-order-router");
const axios = require("axios");
require("dotenv").config();

// Configuración del provider y wallet
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Tokens y direcciones
const USDC_ADDRESS = process.env.USDC_ADDRESS; // 6 decimales
const GS_TOKEN_ADDRESS = "0x9c2cd31784ffd13350058ac199f884bb166ce41c"; // 18 decimales
const RECEIVER_WALLET = process.env.RECEIVER_WALLET;
const BROKER_WALLET = process.env.BROKER_WALLET;

const router = new AlphaRouter({ chainId: ChainId.POLYGON, provider });
const usdcToken = new Token(ChainId.POLYGON, USDC_ADDRESS, 6);
const gsToken = new Token(ChainId.POLYGON, GS_TOKEN_ADDRESS, 18);

// Función para enviar mensaje a Telegram
async function sendTelegram(message) {
  try {
    await axios.post(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      chat_id: process.env.TELEGRAM_CHAT_ID,
      text: message,
      parse_mode: "Markdown",
    });
  } catch (error) {
    console.error("❌ Error enviando mensaje a Telegram:", error.message);
  }
}

async function processIncomingPayment(clientAddress, amountRaw) {
  const amountUSDC = parseFloat(ethers.utils.formatUnits(amountRaw, 6));
  console.log(`📥 Procesando pago de $${amountUSDC.toLocaleString()} USDC`);

  const amount60 = amountUSDC * 0.60;
  const amount15 = amountUSDC * 0.15;
  const amount25 = amountUSDC * 0.25;
  
  // Debug: Log all amounts with 6 decimal precision
  console.log('Amounts:', {
    total: amountUSDC.toFixed(6),
    '60%': amount60.toFixed(6),
    '15%': amount15.toFixed(6),
    '25%': amount25.toFixed(6)
  });

  // Conectar contrato USDC
  const usdcContract = new ethers.Contract(
    USDC_ADDRESS,
    ["function transfer(address to, uint amount) public returns (bool)", "function balanceOf(address) public view returns (uint)"],
    wallet
  );

  // Verificar saldo disponible
  const balance = await usdcContract.balanceOf(wallet.address);
  const amount15Parsed = ethers.utils.parseUnits(amount15.toFixed(6), 6);
  
  console.log('Balance check:', {
    'Wallet Address': wallet.address,
    'Current USDC Balance': ethers.utils.formatUnits(balance, 6),
    'Required USDC': amount15.toString(),
    'Parsed Amount': amount15Parsed.toString()
  });

  if (balance.lt(amount15Parsed)) {
    const msg = `❌ Saldo insuficiente en wallet para enviar ${amount15} USDC al broker. ` +
                `Disponible: ${ethers.utils.formatUnits(balance, 6)} USDC, ` +
                `Se requiere: ${ethers.utils.formatUnits(amount15Parsed, 6)} USDC`;
    console.error(msg);
    await sendTelegram(msg);
    return;
  }

  // 1. Transferir 15% al broker
  try {
    console.log(`Iniciando transferencia de ${ethers.utils.formatUnits(amount15Parsed, 6)} USDC a ${BROKER_WALLET}...`);
    
    // Estimate gas first
    const estimatedGas = await usdcContract.estimateGas.transfer(BROKER_WALLET, amount15Parsed)
      .catch(err => {
        console.error('Error estimando gas:', err);
        throw new Error(`No se pudo estimar el gas: ${err.reason || err.message}`);
      });
    
    console.log(`Gas estimado: ${estimatedGas.toString()}`);
    
    // Add 20% buffer to the estimated gas
    const gasWithBuffer = Math.floor(estimatedGas * 1.2);
    
    // Send the transaction with gas buffer
    const tx1 = await usdcContract.transfer(BROKER_WALLET, amount15Parsed, {
      gasLimit: gasWithBuffer
    });
    
    console.log(`Transacción enviada: ${tx1.hash}`);
    await sendTelegram(`⏳ Transacción enviada: ${tx1.hash}`);
    
    // Wait for confirmation
    const receipt = await tx1.wait();
    
    if (receipt.status === 1) {
      const msg = `✅ 15% (${ethers.utils.formatUnits(amount15Parsed, 6)} USDC) enviado al broker: ${BROKER_WALLET}\n` +
                 `📄 TX: https://polygonscan.com/tx/${tx1.hash}`;
      console.log(msg);
      await sendTelegram(msg);
    } else {
      throw new Error('La transacción falló');
    }
  } catch (err) {
    const errorMsg = `❌ Error enviando USDC al broker: ${err.reason || err.message}`;
    console.error(errorMsg);
    console.error('Detalles del error:', err);
    await sendTelegram(errorMsg);
    
    // If it's a known error, provide more specific guidance
    if (err.reason?.includes('insufficient funds for gas')) {
      const ethBalance = await provider.getBalance(wallet.address);
      const msg = `⚠️ Fondos insuficientes para gas. ` +
                 `Necesitas MATIC para pagar las tarifas de gas. ` +
                 `Balance actual: ${ethers.utils.formatEther(ethBalance)} MATIC`;
      console.error(msg);
      await sendTelegram(msg);
    }
    
    return;
  }

  // 2. Hacer swap del 60% a GS
  const amountIn = CurrencyAmount.fromRawAmount(usdcToken, ethers.utils.parseUnits(amount60.toString(), 6).toString());

  const route = await router.route(
    amountIn,
    gsToken,
    TradeType.EXACT_INPUT,
    {
      recipient: clientAddress,
      slippageTolerance: new Percent(50, 10_000), // 0.5%
      deadline: Math.floor(Date.now() / 1000 + 1800),
    }
  );

  if (!route) {
    const msg = "❌ No se pudo generar ruta de swap USDC → GS.";
    console.error(msg);
    await sendTelegram(msg);
    return;
  }

  try {
    const tx2 = await wallet.sendTransaction({
      to: route.methodParameters.to,
      data: route.methodParameters.calldata,
      value: route.methodParameters.value,
      gasLimit: ethers.utils.hexlify(600000),
    });

    await tx2.wait();
    const msg = `✅ Swap completado: ${amount60} USDC → GS para ${clientAddress}`;
    console.log(msg);
    await sendTelegram(msg);
  } catch (err) {
    const msg = `❌ Error ejecutando el swap USDC → GS: ${err.message}`;
    console.error(msg);
    await sendTelegram(msg);
    return;
  }

  // 3. Empresa retiene el 25%
  const retencionMsg = `🏦 Empresa retiene $${amount25} USDC`;
  console.log(retencionMsg);
  await sendTelegram(retencionMsg);
}

module.exports = { processIncomingPayment };
