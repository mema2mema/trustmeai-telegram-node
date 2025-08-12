import { getOrCreateUserById, getOrCreateReferralFor, linkReferral, calcReferralTree, save } from './db.js'
import { strictLimiter } from './rate.js'

export function referralRoutes(app) {
  app.use('/api/referral', strictLimiter)

  // Returns your referral code (creates if missing)
  app.get('/api/referral/my', (req,res)=>{
    const userId = req.visitorId
    const rec = getOrCreateReferralFor(userId)
    res.json({ code: rec.code, link: `${req.originBase}/?ref=${rec.code}` })
  })

  // Stats for your code
  app.get('/api/referral/stats', (req,res)=>{
    const userId = req.visitorId
    const rec = getOrCreateReferralFor(userId)
    const tree = calcReferralTree(rec.code)
    res.json({ code: rec.code, ...tree })
  })

  // For admins or future use: resolve by code
  app.get('/api/referral/by/:code', (req,res)=>{
    const code = req.params.code.toUpperCase()
    const tree = calcReferralTree(code)
    res.json({ code, ...tree })
  })

  // Middleware installed in server will capture ?ref=CODE and call linkReferral
  app.post('/api/referral/bind', async (req,res)=>{
    const { code } = req.body || {}
    if (!code) return res.status(400).json({ ok:false, error:'code required' })
    linkReferral(req.visitorId, code.toUpperCase())
    await save()
    res.json({ ok:true })
  })
}
