# Telegram Integration Test

This directory contains tests for the Telegram notification functionality in the GoldStory backend.

## Setup

1. Create a Telegram bot using [@BotFather](https://t.me/botfather)
2. Get your bot token from BotFather
3. Start a chat with your bot and send a message to it
4. Get your chat ID by visiting:
   ```
   https://api.telegram.org/bot<YOUR_BOT_TOKEN>/getUpdates
   ```
   Look for the `chat.id` in the response.

5. Create a `.env` file in the project root with:
   ```
   TELEGRAM_BOT_TOKEN=your_bot_token_here
   TELEGRAM_CHAT_ID=your_chat_id_here
   ```

## Running the Test

To test the Telegram notification:

```bash
# Make sure you're in the project root directory
node test/telegram.test.js
```

## Expected Output

On success, you should see:
```
🚀 Sending test message to Telegram...
✅ Test message sent successfully!
📱 Check your Telegram chat to verify the message was received.
```

## Troubleshooting

- If you get a "chat not found" error, make sure you've started a chat with your bot
- If you get a "bot was blocked by the user" error, unblock the bot in Telegram
- If you get a 404 error, double-check your bot token and chat ID
