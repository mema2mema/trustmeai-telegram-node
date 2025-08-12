import rateLimit from 'express-rate-limit'

export const strictLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false
})

export const walletLimiter = rateLimit({
  windowMs: 15 * 1000,
  limit: 10,
  standardHeaders: 'draft-7',
  legacyHeaders: false
})
