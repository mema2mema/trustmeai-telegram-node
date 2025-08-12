# TrustMe AI — Phase 2 Frontend Snippets

## 1) Referral capture (paste near </body> on trustmeai.online)
```html
<script>
(function(){
  const qs = new URLSearchParams(location.search);
  const ref = qs.get('ref');
  if (ref) localStorage.setItem('tm_ref', ref);
  fetch('/api/referral/bind', {
    method: 'POST',
    headers: { 'Content-Type':'application/json' },
    body: JSON.stringify({ code: ref })
  }).catch(()=>{});
})();
</script>
```

## 2) Referral link UI
```html
<div class="ref-card">
  <label>Your link</label>
  <div style="display:flex;gap:8px;align-items:center;">
    <input id="myRefLink" readonly class="input" style="width:100%">
    <button onclick="navigator.clipboard.writeText(document.getElementById('myRefLink').value)">Copy</button>
  </div>
  <small>Tier1 5% • Tier2 2% • Tier3 1%</small>
</div>
<script>
(async function(){
  const res = await fetch('/api/referral/my');
  const j = await res.json();
  document.getElementById('myRefLink').value = j.link;
})();
</script>
```

## 3) Mock wallet UI
```html
<section id="wallet">
  <h3>Demo Wallet</h3>
  <div>Balance: <span id="w_bal">–</span></div>
  <div style="display:flex;gap:8px;align-items:center;margin-top:8px;">
    <input id="w_amt" type="number" value="50" min="1">
    <button onclick="wDeposit()">Deposit</button>
    <button onclick="wWithdraw()">Withdraw</button>
  </div>
  <div id="w_msg" style="margin-top:6px;font-size:12px;opacity:.8;"></div>
  <ul id="w_tx" style="margin-top:10px;"></ul>
</section>
<script>
async function wRefresh(){
  const j = await (await fetch('/api/wallet/balance')).json();
  document.getElementById('w_bal').textContent = '$' + Number(j.balance).toFixed(2);
  const tx = await (await fetch('/api/wallet/tx')).json();
  document.getElementById('w_tx').innerHTML = tx.map(t => '<li>' + t.type + ' ' + t.amount + ' — ' + t.txid + '</li>').join('');
}
async function wDeposit(){
  const amt = Number(document.getElementById('w_amt').value||0);
  const j = await (await fetch('/api/wallet/deposit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:amt})})).json();
  document.getElementById('w_msg').textContent = j.ok ? 'Deposit OK: '+j.tx.txid : 'Error: '+j.error;
  wRefresh();
}
async function wWithdraw(){
  const amt = Number(document.getElementById('w_amt').value||0);
  const j = await (await fetch('/api/wallet/withdraw',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount:amt})})).json();
  document.getElementById('w_msg').textContent = j.ok ? 'Withdraw OK: '+j.tx.txid : 'Error: '+j.error;
  wRefresh();
}
wRefresh();
</script>
```

> Note: This wallet & referrals are **mock/demo** (JSON file). Re-deploying the container resets the data.
