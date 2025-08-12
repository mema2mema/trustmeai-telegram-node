import 'dotenv/config';
import { Telegraf } from 'telegraf';

const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'hook';

if (!BOT_TOKEN) throw new Error('BOT_TOKEN or TELEGRAM_BOT_TOKEN required');

const bot = new Telegraf(BOT_TOKEN);
const action = process.argv[2];

if (action === 'set') {
  if (!PUBLIC_URL) throw new Error('PUBLIC_URL or WEBHOOK_URL required to set webhook');
  const url = `${PUBLIC_URL}/webhook/${WEBHOOK_SECRET}`;
  const res = await bot.telegram.setWebhook(url);
  console.log('Webhook set:', url, res);
} else if (action === 'unset') {
  const res = await bot.telegram.deleteWebhook();
  console.log('Webhook removed', res);
} else {
  console.log('Usage: npm run set-webhook | unset-webhook');
}
process.exit(0);
