import { Low } from 'lowdb'
import { JSONFile } from 'lowdb/node'
import { nanoid } from 'nanoid'
import fs from 'fs'
import path from 'path'

const DATA_DIR = path.resolve('data')
if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })

const file = path.join(DATA_DIR, 'mockdb.json')
const adapter = new JSONFile(file)
export const db = new Low(adapter, { users: [], wallets: [], tx: [], referrals: [], refLinks: [] })
await db.read()
if (!db.data) db.data = { users: [], wallets: [], tx: [], referrals: [], refLinks: [] }

export function getOrCreateUserById(id) {
  const { users, wallets } = db.data
  let u = users.find(x => x.id === id)
  if (!u) {
    u = { id, createdAt: new Date().toISOString() }
    users.push(u)
    wallets.push({ userId: id, balance: 0, pending: 0 })
  }
  return u
}

export function getWallet(userId) {
  const { wallets } = db.data
  let w = wallets.find(x => x.userId === userId)
  if (!w) {
    w = { userId, balance: 0, pending: 0 }
    wallets.push(w)
  }
  return w
}

export function addTx({ userId, type, amount, status='confirmed' }) {
  const txid = 'TX-' + nanoid(10)
  const rec = { id: nanoid(12), userId, type, amount: Number(amount||0), status, txid, createdAt: new Date().toISOString() }
  db.data.tx.push(rec)
  return rec
}

export function listTx(userId, limit=50) {
  return db.data.tx.filter(t => t.userId === userId).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice(0, limit)
}

export function getOrCreateReferralFor(userId) {
  let rec = db.data.referrals.find(r => r.userId === userId)
  if (!rec) {
    const code = userId.slice(0,6).toUpperCase()
    rec = { userId, code, createdAt: new Date().toISOString() }
    db.data.referrals.push(rec)
  }
  return rec
}

export function linkReferral(childUserId, code) {
  // create link only if not exists
  if (db.data.refLinks.find(l => l.child === childUserId)) return
  const owner = db.data.referrals.find(r => r.code === code)
  if (!owner) return
  db.data.refLinks.push({ child: childUserId, code, createdAt: new Date().toISOString() })
}

export function calcReferralTree(code) {
  // tier1: direct children of code
  const tier1 = db.data.refLinks.filter(l => l.code === code).map(l => l.child)
  // codes owned by tier1 users
  const tier1Codes = db.data.referrals.filter(r => tier1.includes(r.userId)).map(r => r.code)
  const tier2 = db.data.refLinks.filter(l => tier1Codes.includes(l.code)).map(l => l.child)
  const tier2Codes = db.data.referrals.filter(r => tier2.includes(r.userId)).map(r => r.code)
  const tier3 = db.data.refLinks.filter(l => tier2Codes.includes(l.code)).map(l => l.child)
  return { tier1, tier2, tier3, counts: { t1: tier1.length, t2: tier2.length, t3: tier3.length } }
}

export async function save() { await db.write() }
