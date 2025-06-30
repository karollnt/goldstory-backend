// swapProcessor.js

const { ethers } = require("ethers");
const {
  ChainId,
  Token,
  CurrencyAmount,
  TradeType,
  Percent,
} = require('@uniswap/sdk-core');
const { AlphaRouter } = require('@uniswap/smart-order-router');

require("dotenv").config();

const provider = new ethers.providers.JsonRpcProvider(process.env.RPC_URL);
const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);

const USDC_ADDRESS = "0x2791Bca1f2de4661ED88A30C99A7a9449Aa84174";
const GS_TOKEN_ADDRESS = "0x9c2cd31784ffd13350058ac199f884bb166ce41c";
const RECEIVER_WALLET = "0xd93246390505e23789728e34a057E2fb9FF856fE";
const BROKER_WALLET = process.env.BROKER_WALLET;

const router = new AlphaRouter({ chainId: ChainId.POLYGON, provider });

const usdcToken = new Token(ChainId.POLYGON, USDC_ADDRESS, 6);
const gsToken = new Token(ChainId.POLYGON, GS_TOKEN_ADDRESS, 18);

async function processIncomingPayment(clientAddress, amountRaw) {
  const amountUSDC = parseFloat(ethers.utils.formatUnits(amountRaw, 6));
  console.log(`📥 Procesando pago de $${amountUSDC.toLocaleString()} USDC`);

  const amount60 = amountUSDC * 0.60;
  const amount15 = amountUSDC * 0.15;
  const amount25 = amountUSDC * 0.25;

  // 1. Enviar 15% al broker
  const usdcContract = new ethers.Contract(
    USDC_ADDRESS,
    ["function transfer(address to, uint amount) public returns (bool)"],
    wallet
  );

  const tx1 = await usdcContract.transfer(BROKER_WALLET, ethers.utils.parseUnits(amount15.toString(), 6));
  await tx1.wait();
  console.log(`✅ 15% ($${amount15}) enviado al broker: ${BROKER_WALLET}`);

  // 2. Hacer swap de 60% en Uniswap
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
    console.error("❌ No se pudo generar una ruta de swap.");
    return;
  }

  const tx2 = await wallet.sendTransaction({
    to: route.methodParameters.to,
    data: route.methodParameters.calldata,
    value: route.methodParameters.value,
    gasLimit: ethers.utils.hexlify(600000),
  });

  await tx2.wait();
  console.log(`✅ Swap completado: USDC → GS para ${clientAddress}`);

  // 3. La empresa se queda con el 25% en USDC
  console.log(`🏦 Empresa retiene $${amount25} USDC`);
}

module.exports = { processIncomingPayment };
