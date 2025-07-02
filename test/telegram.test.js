const { sendTelegram } = require('../swapProcessor');

// Test function to verify the Telegram integration
async function testSendTelegram() {
  try {
    // Test message with Markdown formatting
    const testMessage = `🔔 *GoldStory Test Message* 🔔
    
✅ *Test Successful!* ✅

This is a test message from the GoldStory backend integration test.\n\n` +
      `*Timestamp:* ${new Date().toISOString()}\n` +
      `*Environment:* ${process.env.NODE_ENV || 'development'}`;

    console.log('🚀 Sending test message to Telegram...');
    await sendTelegram(testMessage);
    console.log('✅ Test message sent successfully!');
    console.log('📱 Check your Telegram chat to verify the message was received.');
  } catch (error) {
    console.error('❌ Error in test:', error.message);
    if (error.response) {
      console.error('Response data:', error.response.data);
      console.error('Response status:', error.response.status);
    }
  }
}

// Run the test if this file is executed directly
if (require.main === module) {
  // Check for required environment variables
  const requiredEnvVars = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID'];
  const missingVars = requiredEnvVars.filter(varName => !process.env[varName]);

  if (missingVars.length > 0) {
    console.error('❌ Missing required environment variables:');
    missingVars.forEach(varName => console.error(`- ${varName}`));
    console.log('\nPlease create a .env file with the required variables:');
    console.log('TELEGRAM_BOT_TOKEN=your_bot_token_here');
    console.log('TELEGRAM_CHAT_ID=your_chat_id_here');
    process.exit(1);
  }

  testSendTelegram();
}

module.exports = { testSendTelegram };
