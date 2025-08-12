import 'dotenv/config';
import express from 'express';
import helmet from 'helmet';
import morgan from 'morgan';
import cors from 'cors';
import basicAuth from 'express-basic-auth';
import { Telegraf } from 'telegraf';
import dayjs from 'dayjs';
import path from 'path';
import { fileURLToPath } from 'url';
import QuickChart from 'quickchart-js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ENV (compat)
const BOT_TOKEN = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN;
const PUBLIC_URL = process.env.PUBLIC_URL || process.env.WEBHOOK_URL;
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'hook';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin';
const PORT = process.env.PORT || 3000;

if (!BOT_TOKEN) {
  console.error('ERROR: BOT_TOKEN or TELEGRAM_BOT_TOKEN is required');
  process.exit(1);
}
console.log('[env] token from:', process.env.BOT_TOKEN ? 'BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN');
console.log('[env] public url from:', process.env.PUBLIC_URL ? 'PUBLIC_URL' : (process.env.WEBHOOK_URL ? 'WEBHOOK_URL' : 'not set -> polling'));

const app = express();
app.use(helmet());
app.use(cors());
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));
app.use(morgan('tiny'));

// Projection
function project({ amount, days, mode, dailyPct, perTradePct, tradesPerDay }) {
  amount = Number(amount || 0);
  days = Number(days || 0);
  dailyPct = Number(dailyPct || 0);
  perTradePct = Number(perTradePct || 0);
  tradesPerDay = Number(tradesPerDay || 1);
  const rows = [];
  let balance = amount;
  for (let d = 1; d <= days; d++) {
    const start = balance;
    const growth = mode === 'perTrade'
      ? Math.pow(1 + perTradePct / 100, tradesPerDay)
      : 1 + dailyPct / 100;
    const end = start * growth;
    rows.push({ day: d, start, profit: end - start, end });
    balance = end;
  }
  return rows;
}
const formatUSD = n => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits: 2 }).format(Number(n||0));

// Bot
const bot = new Telegraf(BOT_TOKEN);
const userState = new Map();
const defaultState = { mode:'perDay', amount:1000, dailyPct:2, perTradePct:1, tradesPerDay:5, days:30 };
const getState = (chatId) => { if (!userState.has(chatId)) userState.set(chatId, { ...defaultState }); return userState.get(chatId); };

bot.start(ctx => ctx.reply(`Welcome to TrustMe AI 📈
Use:
/mode perDay|perTrade
/amount 1000
/daily 2
/pertrade 1
/trades 5
/days 30
/log — projection table
/graph — chart image`));

bot.help(ctx => ctx.reply(`Commands:
/mode perDay|perTrade
/amount <number>
/daily <percent>
/pertrade <percent>
/trades <integer>
/days <1-120>
/log
/graph`));

bot.command('mode', ctx => { const v = ctx.message.text.split(/\s+/)[1]; if (!['perDay','perTrade'].includes(v)) return ctx.reply('Usage: /mode perDay|perTrade'); getState(ctx.chat.id).mode = v; ctx.reply(`Mode set to ${v}`); });
bot.command('amount', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!isFinite(v) || v<=0) return ctx.reply('Usage: /amount 1000'); getState(ctx.chat.id).amount = v; ctx.reply(`Amount set to ${v}`); });
bot.command('daily', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!isFinite(v) || v<0) return ctx.reply('Usage: /daily 2'); getState(ctx.chat.id).dailyPct = v; ctx.reply(`Daily % set to ${v}`); });
bot.command('pertrade', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!isFinite(v) || v<0) return ctx.reply('Usage: /pertrade 1'); getState(ctx.chat.id).perTradePct = v; ctx.reply(`Per trade % set to ${v}`); });
bot.command('trades', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!Number.isInteger(v) || v<=0) return ctx.reply('Usage: /trades 5'); getState(ctx.chat.id).tradesPerDay = v; ctx.reply(`Trades/day set to ${v}`); });
bot.command('days', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!Number.isInteger(v) || v<1 || v>120) return ctx.reply('Usage: /days 30 (1-120)'); getState(ctx.chat.id).days = v; ctx.reply(`Projection days set to ${v}`); });

bot.command('log', async ctx => {
  const s = getState(ctx.chat.id);
  const rows = project(s);
  const lines = rows.map(r => `${String(r.day).padStart(3,' ')} | start ${formatUSD(r.start)} | profit +${formatUSD(r.profit)} | end ${formatUSD(r.end)}`);
  const msg = `TrustMe AI — Projection Log\n${dayjs().format('YYYY-MM-DD HH:mm')}\n\n${lines.join('\n')}`;
  for (let i=0;i<msg.length;i+=3800) await ctx.reply('```\n'+msg.slice(i,i+3800)+'\n```',{parse_mode:'MarkdownV2'}).catch(()=>{});
});

// Graph via QuickChart (no native builds needed)
bot.command('graph', async ctx => {
  const s = getState(ctx.chat.id);
  const rows = project(s);
  const labels = rows.map(r=>r.day);
  const equity = rows.map(r=>r.end);
  const qc = new QuickChart();
  qc.setWidth(900).setHeight(480).setBackgroundColor('transparent');
  qc.setConfig({
    type:'line',
    data:{ labels, datasets:[{ label:'Equity', data:equity, tension:0.2, borderColor:'#60a5fa', fill:false }]},
    options:{ plugins:{ legend:{ labels:{ color:'#e5e7eb' }}},
              scales:{ x:{ ticks:{ color:'#9ca3af' }}, y:{ ticks:{ color:'#9ca3af' }}}}
  });
  // Telegram accepts direct image URLs
  await ctx.replyWithPhoto(qc.getUrl(), { caption:`Projection ${s.days}d — start ${formatUSD(s.amount)}` });
});

// Web server
app.get('/health', (_req,res)=>res.json({ ok:true, time:new Date().toISOString() }));

app.get('/api/projection', (req,res)=>{
  const params = {
    mode: req.query.mode || 'perDay',
    amount: Number(req.query.amount || 1000),
    dailyPct: Number(req.query.dailyPct || 2),
    perTradePct: Number(req.query.perTradePct || 1),
    tradesPerDay: Number(req.query.tradesPerDay || 5),
    days: Number(req.query.days || 30)
  };
  res.json(project(params));
});

const adminAuth = basicAuth({ users:{ admin: ADMIN_PASS }, challenge:true });
app.get('/admin', adminAuth, (_req,res)=>res.sendFile(path.join(__dirname,'views','admin.html')));
app.post('/admin/bot/:action', adminAuth, async (req,res)=>{
  try {
    const action = req.params.action;
    if (action==='start') { await setupWebhook(); return res.json({ ok:true, state:'started' }); }
    if (action==='stop')  { await bot.stop('manual stop'); try{ await bot.telegram.deleteWebhook(); }catch{} return res.json({ ok:true, state:'stopped' }); }
    return res.status(400).json({ ok:false, error:'unknown action' });
  } catch(e){ return res.status(500).json({ ok:false, error:String(e) }); }
});

app.use(`/webhook/${WEBHOOK_SECRET}`, (req,res,next)=>{
  if (req.method==='POST') return bot.webhookCallback(`/webhook/${WEBHOOK_SECRET}`)(req,res,next);
  res.status(405).end();
});

async function setupWebhook(){
  if (PUBLIC_URL){
    const url = `${PUBLIC_URL}/webhook/${WEBHOOK_SECRET}`;
    await bot.telegram.setWebhook(url);
    console.log('Webhook set:', url);
  } else {
    console.log('No PUBLIC_URL/WEBHOOK_URL. Using long polling.');
    await bot.telegram.deleteWebhook().catch(()=>{});
    await bot.launch();
  }
}

app.listen(PORT, async ()=>{
  console.log('HTTP server listening on', PORT);
  await setupWebhook();
});
process.once('SIGINT', ()=>bot.stop('SIGINT'));
process.once('SIGTERM', ()=>bot.stop('SIGTERM'));
