const { ethers } = require('ethers');

const { ChainId, Token, CurrencyAmount, TradeType, Percent } = require('@uniswap/sdk-core');
const { AlphaRouter } = require('@uniswap/smart-order-router');
const axios = require('axios');
require('dotenv').config();

// Configuración del provider y wallet
const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

// Tokens y direcciones
const USDC_ADDRESS = process.env.USDC_ADDRESS; // 6 decimales
const GS_TOKEN_ADDRESS = '0x9c2cd31784ffd13350058ac199f884bb166ce41c'; // 18 decimales
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
      parse_mode: 'Markdown'
    });
  } catch (error) {
    console.error('❌ Error enviando mensaje a Telegram:', error.message);
  }
}

async function processIncomingPayment(clientAddress, amountRaw) {
  console.log('🔍 processIncomingPayment called with:', {
    clientAddress,
    amountRaw: amountRaw.toString(),
    amountInUSDC: ethers.utils.formatUnits(amountRaw, 6) + ' USDC'
  });

  console.log('🧾 amountRaw recibido:', amountRaw.toString());
  console.log('💲 Formateado a USDC:', ethers.utils.formatUnits(amountRaw, 6));

  const amountUSDC = parseFloat(ethers.utils.formatUnits(amountRaw, 6));
  console.log(`📥 Procesando pago de $${amountUSDC.toLocaleString()} USDC`);

  const amount60 = amountUSDC * 0.6;
  const amount15 = amountUSDC * 0.15;
  const amount25 = amountUSDC * 0.25;

  console.log('Amounts:', {
    total: amountUSDC.toFixed(6),
    '60%': amount60.toFixed(6),
    '15%': amount15.toFixed(6),
    '25%': amount25.toFixed(6)
  });

  const usdcContract = new ethers.Contract(
    USDC_ADDRESS,
    [
      'function transfer(address to, uint amount) public returns (bool)',
      'function balanceOf(address) public view returns (uint)'
    ],
    wallet
  );

  const balance = await usdcContract.balanceOf(wallet.address);
  const amount15Parsed = ethers.utils.parseUnits(amount15.toFixed(6), 6);

  console.log('Balance check:', {
    'Wallet Address': wallet.address,
    'Current USDC Balance': ethers.utils.formatUnits(balance, 6),
    'Required USDC': amount15.toString(),
    'Parsed Amount': amount15Parsed.toString()
  });

  if (balance.lt(amount15Parsed)) {
    const msg =
      `❌ Saldo insuficiente en wallet para enviar ${amount15} USDC al broker. ` +
      `Disponible: ${ethers.utils.formatUnits(balance, 6)} USDC, ` +
      `Se requiere: ${ethers.utils.formatUnits(amount15Parsed, 6)} USDC`;
    console.error(msg);
    await sendTelegram(msg);
    return;
  }

  try {
    console.log(`Iniciando transferencia de ${ethers.utils.formatUnits(amount15Parsed, 6)} USDC a ${BROKER_WALLET}...`);
    const estimatedGas = await usdcContract.estimateGas.transfer(BROKER_WALLET, amount15Parsed).catch((err) => {
      console.error('Error estimando gas:', err);
      throw new Error(`No se pudo estimar el gas: ${err.reason || err.message}`);
    });
    console.log(`Gas estimado: ${estimatedGas.toString()}`);
    const gasWithBuffer = Math.floor(estimatedGas * 1.2);
    const tx1 = await usdcContract.transfer(BROKER_WALLET, amount15Parsed, {
      gasLimit: gasWithBuffer
    });
    console.log(`Transacción enviada: ${tx1.hash}`);
    try {
      await sendTelegram(`⏳ Transacción enviada: ${tx1.hash}`);
    } catch (telegramErr) {
      console.error('❌ Error enviando notificación a Telegram:', telegramErr);
    }

    console.log('Esperando confirmación de la transacción (tiempo máximo: 2 minutos)...');
    try {
      // Add a timeout to the transaction wait
      const receipt = await Promise.race([
        tx1.wait(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Tiempo de espera agotado (2 minutos)')), 2 * 60 * 1000)
        )
      ]);
      console.log('Transacción minada. Estado:', receipt.status === 1 ? 'Éxito' : 'Falló');

      if (receipt.status === 1) {
        const msg =
          `✅ 15% (${ethers.utils.formatUnits(amount15Parsed, 6)} USDC) enviado al broker: ${BROKER_WALLET}\n` +
          `📄 TX: https://polygonscan.com/tx/${tx1.hash}`;
        console.log(msg);
        try {
          await sendTelegram(msg);
        } catch (telegramErr) {
          console.error('❌ Error enviando notificación de éxito a Telegram:', telegramErr);
        }
      } else {
        throw new Error('La transacción falló');
      }
    } catch (waitError) {
      console.error('❌ Error esperando la transacción:', waitError);
      console.error('Detalles del error:', {
        hash: tx1.hash,
        blockNumber: waitError.receipt?.blockNumber,
        status: waitError.receipt?.status,
        reason: waitError.reason
      });
      throw waitError; // Re-throw to be caught by the outer catch
    }
  } catch (err) {
    const errorMsg = `❌ Error enviando USDC al broker: ${err.reason || err.message}`;
    console.error(errorMsg);
    console.error('Detalles del error:', err);
    await sendTelegram(errorMsg);
    if (err.reason?.includes('insufficient funds for gas')) {
      const ethBalance = await provider.getBalance(wallet.address);
      const msg =
        `⚠️ Fondos insuficientes para gas. ` +
        `Necesitas MATIC para pagar las tarifas de gas. ` +
        `Balance actual: ${ethers.utils.formatEther(ethBalance)} MATIC`;
      console.error(msg);
      await sendTelegram(msg);
    }
    return;
  }

  // 2. Hacer swap del 60% a GS
  const amountIn = CurrencyAmount.fromRawAmount(usdcToken, ethers.utils.parseUnits(amount60.toString(), 6).toString());

  const route = await router.route(amountIn, gsToken, TradeType.EXACT_INPUT, {
    recipient: clientAddress,
    slippageTolerance: new Percent(50, 10_000),
    deadline: Math.floor(Date.now() / 1000 + 1800)
  });

  if (route) {
    console.log('Gas estimado swap:', route.estimatedGasUsed.toString());
    console.log('Calldata:', route.methodParameters.calldata.slice(0, 20) + '...');
  } else {
    const msg =
      `❌ No se pudo generar ruta de swap USDC → GS. \n` +
      `Verifica si el pool en Uniswap tiene liquidez activa:\n` +
      `👉 https://app.uniswap.org/#/swap?inputCurrency=${USDC_ADDRESS}&outputCurrency=${GS_TOKEN_ADDRESS}`;
    console.error(msg);
    await sendTelegram(msg);
    return;
  }

  const maticBalance = await provider.getBalance(wallet.address);
  if (maticBalance.lt(ethers.utils.parseEther('0.01'))) {
    const msg =
      `⚠️ Balance de MATIC insuficiente para ejecutar el swap. \n` +
      `Necesitas al menos 0.01 MATIC.\n` +
      `Balance actual: ${ethers.utils.formatEther(maticBalance)} MATIC`;
    console.error(msg);
    await sendTelegram(msg);
    return;
  }

  try {
    const tx2 = await wallet.sendTransaction({
      to: route.methodParameters.to,
      data: route.methodParameters.calldata,
      value: route.methodParameters.value,
      gasLimit: ethers.utils.hexlify(600000)
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

  const retencionMsg = `🏦 Empresa retiene $${amount25} USDC`;
  console.log(retencionMsg);
  await sendTelegram(retencionMsg);
}

module.exports = { processIncomingPayment, sendTelegram };
