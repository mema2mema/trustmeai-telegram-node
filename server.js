import 'dotenv/config'
import express from 'express'
import helmet from 'helmet'
import morgan from 'morgan'
import cors from 'cors'
import basicAuth from 'express-basic-auth'
import cookieParser from 'cookie-parser'
import { Telegraf } from 'telegraf'
import dayjs from 'dayjs'
import path from 'path'
import { fileURLToPath } from 'url'
import QuickChart from 'quickchart-js'
import { nanoid } from 'nanoid'

// Local libs
import { db, getOrCreateUserById, getOrCreateReferralFor, linkReferral, save } from './lib/db.js'
import { referralRoutes } from './lib/referral.js'
import { walletRoutes } from './lib/wallet.js'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// ENV (compat)
const BOT_TOKEN      = process.env.BOT_TOKEN || process.env.TELEGRAM_BOT_TOKEN
const PUBLIC_URL     = process.env.PUBLIC_URL || process.env.WEBHOOK_URL
const WEBHOOK_SECRET = process.env.WEBHOOK_SECRET || 'hook'
const ADMIN_PASS     = process.env.ADMIN_PASS || 'admin'
const PORT           = process.env.PORT || 3000
const CORS_ORIGINS   = (process.env.CORS_ORIGINS || '').split(',').map(s=>s.trim()).filter(Boolean)

if (!BOT_TOKEN) { console.error('ERROR: BOT_TOKEN/TELEGRAM_BOT_TOKEN required'); process.exit(1) }
console.log('[env] token from:', process.env.BOT_TOKEN ? 'BOT_TOKEN' : 'TELEGRAM_BOT_TOKEN')
console.log('[env] public url from:', process.env.PUBLIC_URL ? 'PUBLIC_URL' : (process.env.WEBHOOK_URL ? 'WEBHOOK_URL' : 'not set -> polling'))

const ADMIN_URL = (PUBLIC_URL || process.env.WEBHOOK_URL) ? `${(PUBLIC_URL || process.env.WEBHOOK_URL)}/admin` : null

const app = express()
app.use(helmet())
app.use(cookieParser())
app.use(express.json({ limit: '1mb' }))
app.use(express.urlencoded({ extended: true }))
app.use(morgan('tiny'))
app.use(cors({
  origin: (origin, cb)=>{
    if (!origin || CORS_ORIGINS.length===0 || CORS_ORIGINS.includes(origin)) return cb(null, true)
    return cb(null, false)
  },
  credentials: true
}))

// ----- Visitor cookie + referral capture -----
app.use((req,res,next)=>{
  // compute origin base for links
  const proto = req.headers['x-forwarded-proto'] || req.protocol || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  req.originBase = `${proto}://${host}`

  // set or get visitor cookie
  let id = req.cookies?.tm_uid
  if (!id) {
    id = nanoid(10)
    res.cookie('tm_uid', id, { httpOnly: true, sameSite: 'lax', maxAge: 1000*60*60*24*365 })
  }
  req.visitorId = id
  getOrCreateUserById(id)

  // referral capture (?ref=CODE)
  const ref = (req.query?.ref || '').toString().trim()
  if (ref) {
    linkReferral(id, ref.toUpperCase())
    save().catch(()=>{})
  }
  next()
})

// ===== Projection (same as before, used by Telegram) =====
function project({ amount, days, mode, dailyPct, perTradePct, tradesPerDay }) {
  amount = Number(amount || 0)
  days = Number(days || 0)
  dailyPct = Number(dailyPct || 0)
  perTradePct = Number(perTradePct || 0)
  tradesPerDay = Number(tradesPerDay || 1)
  const rows = []
  let balance = amount
  for (let d = 1; d <= days; d++) {
    const start = balance
    const growth = mode === 'perTrade' ? Math.pow(1 + perTradePct / 100, tradesPerDay) : 1 + dailyPct / 100
    const end = start * growth
    rows.push({ day: d, start, profit: end - start, end })
    balance = end
  }
  return rows
}
const formatUSD = n => new Intl.NumberFormat('en-US', { style:'currency', currency:'USD', maximumFractionDigits: 2 }).format(Number(n||0))

// ===== Telegram Bot =====
const bot = new Telegraf(BOT_TOKEN)
bot.use(async (ctx, next)=>{
  console.log('update:', ctx.updateType, ctx.message?.text || ctx.callbackQuery?.data || '')
  try{ await next() }catch(e){ console.error('handler error', e) }
})
bot.catch((err, ctx)=> console.error('Telegraf error', err))

const HELP_TEXT = `📘 Commands
• /mode <perDay|perTrade> — switch mode
• /amount <number> — set starting USDT
• /daily <percent> — daily % (Per Day mode)
• /pertrade <percent> — per‑trade % (Per Trade mode)
• /trades <integer> — trades per day (Per Trade mode)
• /days <1-120> — projection days
• /log — projection table
• /graph — projection chart
• /admin — admin link`

bot.start(ctx => ctx.reply(HELP_TEXT))
bot.command('help', ctx => ctx.reply(HELP_TEXT))
bot.command('admin', ctx => ADMIN_URL ? ctx.reply(`🔐 Admin panel:\n${ADMIN_URL}\nUser: admin`) : ctx.reply('Admin is web-only; set PUBLIC_URL/WEBHOOK_URL'))

bot.command('mode', ctx => { const v = ctx.message.text.split(/\s+/)[1]; if (!['perDay','perTrade'].includes(v)) return ctx.reply('Usage: /mode perDay|perTrade'); ctx.reply(`Mode set to ${v}`) })
bot.command('amount', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!isFinite(v) || v<=0) return ctx.reply('Usage: /amount 1000'); ctx.reply(`Amount set to ${v}`) })
bot.command('daily', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!isFinite(v) || v<0) return ctx.reply('Usage: /daily 2'); ctx.reply(`Daily % set to ${v}`) })
bot.command('pertrade', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!isFinite(v) || v<0) return ctx.reply('Usage: /pertrade 1'); ctx.reply(`Per trade % set to ${v}`) })
bot.command('trades', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!Number.isInteger(v) || v<=0) return ctx.reply('Usage: /trades 5'); ctx.reply(`Trades/day set to ${v}`) })
bot.command('days', ctx => { const v = Number(ctx.message.text.split(/\s+/)[1]); if (!Number.isInteger(v) || v<1 || v>120) return ctx.reply('Usage: /days 30'); ctx.reply(`Projection days set to ${v}`) })

bot.command('log', async ctx=>{
  const s = { mode:'perDay', amount:1000, dailyPct:2, perTradePct:1, tradesPerDay:5, days:30 }
  const rows = project(s)
  const lines = rows.map(r => `${String(r.day).padStart(3,' ')} | start ${formatUSD(r.start)} | profit +${formatUSD(r.profit)} | end ${formatUSD(r.end)}`)
  const msg = `TrustMe AI — Projection Log\n${dayjs().format('YYYY-MM-DD HH:mm')}\n\n${lines.join('\n')}`
  for (let i=0;i<msg.length;i+=3800) await ctx.reply('```\n'+msg.slice(i,i+3800)+'\n```',{parse_mode:'MarkdownV2'}).catch(()=>{})
})

bot.command('graph', async ctx=>{
  const s = { mode:'perDay', amount:1000, dailyPct:2, perTradePct:1, tradesPerDay:5, days:30 }
  const rows = project(s)
  const labels = rows.map(r=>r.day)
  const equity = rows.map(r=>r.end)
  const qc = new QuickChart()
  qc.setWidth(900).setHeight(480).setBackgroundColor('transparent')
  qc.setConfig({ type:'line', data:{ labels, datasets:[{ label:'Equity', data:equity, tension:0.2, borderColor:'#60a5fa', fill:false }]}})
  await ctx.replyWithPhoto(qc.getUrl(), { caption:`Projection ${s.days}d — start ${formatUSD(s.amount)}` })
})

bot.hears(/^[^/].+/, ctx=> ctx.reply('✅ Got it! Send /help for commands.'))

// ===== Basic web pages =====
app.get('/health', (_req,res)=>res.json({ ok:true, time:new Date().toISOString() }))
app.get('/', (_req,res)=>res.type('html').send('<h2>TrustMe AI — API</h2><p><a href=/admin>/admin</a> • <a href=/health>/health</a></p>'))
app.get('/favicon.ico', (_req,res)=>res.status(204).end())

// ===== Public API (projection) =====
app.get('/api/projection', (req,res)=>{
  const params = {
    mode: req.query.mode || 'perDay',
    amount: Number(req.query.amount || 1000),
    dailyPct: Number(req.query.dailyPct || 2),
    perTradePct: Number(req.query.perTradePct || 1),
    tradesPerDay: Number(req.query.tradesPerDay || 5),
    days: Number(req.query.days || 30)
  }
  res.json(project(params))
})

// ===== Admin =====
import fs from 'fs'
import url from 'url'
import { fileURLToPath as furl } from 'url'
import { dirname as dname } from 'path'
import basicAuth from 'express-basic-auth'
const adminAuth = basicAuth({ users:{ admin: ADMIN_PASS }, challenge:true })
app.get('/admin', adminAuth, (_req,res)=>res.sendFile(path.join(__dirname,'views','admin.html')))
app.post('/admin/bot/:action', adminAuth, async (req,res)=>{
  try{
    const action = req.params.action
    if (action==='start') { await setupWebhook(); return res.json({ ok:true, state:'started' }) }
    if (action==='stop')  { await bot.stop('manual stop'); try{ await bot.telegram.deleteWebhook() }catch{} return res.json({ ok:true, state:'stopped' }) }
    return res.status(400).json({ ok:false, error:'unknown action' })
  }catch(e){ return res.status(500).json({ ok:false, error:String(e) }) }
})

// ===== Wallet & Referral APIs =====
referralRoutes(app)
walletRoutes(app)

// ===== Webhook =====
app.all(`/webhook/${WEBHOOK_SECRET}`, (req,res,next)=>{
  if (req.method !== 'POST') return res.status(405).end()
  next()
})
app.use(bot.webhookCallback(`/webhook/${WEBHOOK_SECRET}`))

async function setupWebhook(){
  if (PUBLIC_URL){
    const url = `${PUBLIC_URL}/webhook/${WEBHOOK_SECRET}`
    await bot.telegram.setWebhook(url)
    console.log('Webhook set:', url)
  } else {
    console.log('No PUBLIC_URL/WEBHOOK_URL. Using long polling.')
    await bot.telegram.deleteWebhook().catch(()=>{})
    await bot.launch()
  }
}

app.listen(PORT, async ()=>{
  console.log('HTTP server listening on', PORT)
  await setupWebhook()
})
process.once('SIGINT', ()=>bot.stop('SIGINT'))
process.once('SIGTERM', ()=>bot.stop('SIGTERM'))
