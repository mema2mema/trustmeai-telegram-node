import { getWallet, addTx, listTx, save } from './db.js'
import { walletLimiter } from './rate.js'

export function walletRoutes(app) {
  app.use('/api/wallet', walletLimiter)

  app.get('/api/wallet/balance', (req,res)=>{
    const w = getWallet(req.visitorId)
    res.json({ balance: w.balance, pending: w.pending, address: `TMUSDT-DEMO-${String(req.visitorId).slice(0,6)}` })
  })

  app.get('/api/wallet/tx', (req,res)=>{
    const rows = listTx(req.visitorId, 100)
    res.json(rows)
  })

  app.post('/api/wallet/deposit', async (req,res)=>{
    const { amount } = req.body || {}
    const amt = Number(amount || 0)
    if (!isFinite(amt) || amt <= 0) return res.status(400).json({ ok:false, error:'invalid amount' })
    const w = getWallet(req.visitorId)
    w.balance += amt
    const tx = addTx({ userId: req.visitorId, type: 'deposit', amount: amt })
    await save()
    res.json({ ok:true, tx })
  })

  app.post('/api/wallet/withdraw', async (req,res)=>{
    const { amount } = req.body || {}
    const amt = Number(amount || 0)
    if (!isFinite(amt) || amt <= 0) return res.status(400).json({ ok:false, error:'invalid amount' })
    const w = getWallet(req.visitorId)
    if (w.balance < amt) return res.status(400).json({ ok:false, error:'insufficient balance' })
    w.balance -= amt
    const tx = addTx({ userId: req.visitorId, type: 'withdraw', amount: amt })
    await save()
    res.json({ ok:true, tx })
  })
}
