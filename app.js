// app.js
// Main application script (ES module)
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-app.js";
import { getAuth, RecaptchaVerifier, signInWithPhoneNumber, onAuthStateChanged, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, PhoneAuthProvider, linkWithCredential, EmailAuthProvider } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-auth.js";
import { getFirestore, doc, setDoc, getDoc, onSnapshot, collection, addDoc, query, where, orderBy, limit, getDocs, serverTimestamp, runTransaction, startAfter, Timestamp } from "https://www.gstatic.com/firebasejs/9.23.0/firebase-firestore.js";

const firebaseConfig = window.__FIREBASE_CONFIG;
if (!firebaseConfig) {
  alert("Missing Firebase config. Please copy firebase-config-sample.js and fill it with your project's config.");
  throw new Error("Missing Firebase config.");
}

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const db = getFirestore(app);

/* -------------------------
   Utilities
   ------------------------- */
const $ = (sel, root=document) => root.querySelector(sel);
const el = (tag, attrs={}, ...children) => {
  const n = document.createElement(tag);
  for (const k in attrs) {
    if (k.startsWith('on') && typeof attrs[k] === 'function') n.addEventListener(k.slice(2), attrs[k]);
    else if (k === 'html') n.innerHTML = attrs[k];
    else n.setAttribute(k, attrs[k]);
  }
  for (const c of children) if (c) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
  return n;
};
const fmtCurrency = (n) => new Intl.NumberFormat('en-BD',{ style:'currency', currency:'BDT', maximumFractionDigits:0 }).format(n);

/* Simple SHA-256 hashing using Web Crypto (client-side demo only) */
async function hashPin(pin){
  // Pin must be a 4-digit string. In production: do not trust client-side hashing; use server-side hashing + KMS.
  const encoder = new TextEncoder();
  const data = encoder.encode("myrocket-pin-v1:"+pin); // pepper locally (demo only)
  const digest = await crypto.subtle.digest('SHA-256', data);
  const hex = Array.from(new Uint8Array(digest)).map(b=>b.toString(16).padStart(2,'0')).join('');
  return hex;
}

/* Toasts */
function toast(msg, opts={timeout:3500}) {
  const container = $('#toast-container');
  const node = el('div',{class:'toast'}, msg);
  container.appendChild(node);
  setTimeout(()=> node.style.opacity = '0.0', opts.timeout-500);
  setTimeout(()=> node.remove(), opts.timeout);
}

/* Modal helper */
function showModal(contentEl) {
  const root = $('#modal-root');
  root.innerHTML = '';
  root.setAttribute('aria-hidden', 'false');
  const m = el('div', {class:'modal', role:'dialog', 'aria-modal':'true'});
  m.appendChild(contentEl);
  root.appendChild(m);
  // close on outside click
  root.addEventListener('pointerdown', (e)=>{
    if (e.target === root) { closeModal(); }
  }, {once:true});
}
function closeModal() {
  const root = $('#modal-root');
  root.setAttribute('aria-hidden','true');
  root.innerHTML = '';
}

/* Spinner */
function spinner(){ return el('div',{class:'spinner', role:'status', 'aria-label':'loading'}); }

/* Simple id generator */
function uid() { return 'r_'+Math.random().toString(36).slice(2,10); }
function txRefFor(uid){ return `${uid}_${Date.now()}_${Math.random().toString(36).slice(2,8)}`; }

/* -------------------------
   SPA Router & rendering
   ------------------------- */

const routes = {
  '/login': renderLogin,
  '/dashboard': renderDashboard,
  '/send': renderSend,
  '/receive': renderReceive,
  '/tx': renderTransactions,
  '/topup': renderTopup,
  '/profile': renderProfile,
  '/admin': renderAdmin
};

function routeFromHash() {
  const h = location.hash || '#/login';
  return h.replace(/^#/, '');
}

function navigateTo(hash) {
  location.hash = hash;
}

/* Wire top nav */
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-route]');
  if (btn) {
    e.preventDefault();
    const r = btn.getAttribute('data-route');
    navigateTo(r);
  }
});

window.addEventListener('hashchange', renderCurrentPage);

/* Auth state & UI */
let currentUser = null;
let currentUserDoc = null;
const authBtn = $('#auth-btn');

authBtn.addEventListener('click', ()=>{
  if (currentUser) {
    // Show signout option
    showModal(el('div',{}, el('h3',{}, 'Sign out?'), el('div',{class:'kv small-note'}, 'You will be signed out of this session.'), el('div',{style:'marginTop:12px',}, el('button',{class:'btn', onClick: async ()=>{
      await signOut(auth);
      closeModal();
      toast('Signed out.');
      navigateTo('#/login');
    }}, 'Sign out'))));
  } else {
    navigateTo('#/login');
  }
});

onAuthStateChanged(auth, async (user) => {
  currentUser = user;
  // update nav
  authBtn.textContent = user ? 'Account' : 'Login';
  if (user) {
    // ensure user doc exists
    const udocRef = doc(db, 'users', user.uid);
    const snap = await getDoc(udocRef);
    if (!snap.exists()) {
      // Create profile doc with default balance (demo)
      await setDoc(udocRef, {
        displayName: user.displayName || 'MyRocket User',
        phone: user.phoneNumber || '',
        email: user.email || '',
        balance: 1000,
        pinHash: '', // empty until set
        createdAt: serverTimestamp()
      });
    }
    // monitor user's doc
    if (currentUserDoc) currentUserDoc(); // unsubscribe if function available
    const unsub = onSnapshot(udocRef, (d)=> {
      currentUserDoc = unsub;
      renderCurrentPage();
    });
  } else {
    renderCurrentPage();
  }
});

/* -------------------------
   Pages
   ------------------------- */

function renderCurrentPage(){
  const path = routeFromHash();
  const root = $('#page-root');
  root.innerHTML = '';
  const mainPath = path.split('/')[1] ? '/'+path.split('/')[1] : '/login';
  const handler = routes[mainPath] || renderNotFound;
  handler(root);
}

/* Login / Signup */
function renderLogin(root){
  const page = el('div',{class:'page'});
  const card = el('div',{class:'card', style:'max-width:720px;margin:auto;'});
  const title = el('h2',{}, 'Welcome to MyRocket');
  const note = el('p',{class:'small-note'}, 'Demo wallet — phone OTP + email/password sign-in. Use your phone to try the OTP flow.');
  card.append(title,note);

  // Email sign-up
  const emailForm = el('form',{onSubmit: async (e)=>{
    e.preventDefault();
    const email = emailInput.value.trim();
    const pass = passInput.value.trim();
    const pass2 = pass2Input.value.trim();
    if (!email || !pass || pass !== pass2) return toast('Please validate email/password.');
    try {
      const cred = await createUserWithEmailAndPassword(auth, email, pass);
      toast('Account created, you are signed in.');
      navigateTo('#/dashboard');
    } catch(err){ console.error(err); toast('Error: '+err.message); }
  }});
  const emailInput = el('input',{class:'input', placeholder:'Email', type:'email', required:true});
  const passInput = el('input',{class:'input', placeholder:'Password', type:'password', required:true});
  const pass2Input = el('input',{class:'input', placeholder:'Confirm password', type:'password', required:true});
  const signupBtn = el('button',{class:'btn'}, 'Sign up (Email)');
  emailForm.append(el('div',{class:'form-row'}, emailInput, passInput, pass2Input, signupBtn));

  // Email sign-in
  const signinForm = el('form',{onSubmit: async (e)=>{
    e.preventDefault();
    try {
      await signInWithEmailAndPassword(auth, signinEmail.value.trim(), signinPass.value.trim());
      toast('Signed in.');
      navigateTo('#/dashboard');
    } catch(err){ toast('Sign-in error: '+err.message); }
  }});
  const signinEmail = el('input',{class:'input', placeholder:'Email', type:'email', required:true});
  const signinPass = el('input',{class:'input', placeholder:'Password', type:'password', required:true});
  const signinBtn = el('button',{class:'btn'}, 'Sign in (Email)');
  signinForm.append(el('div',{class:'form-row'}, signinEmail, signinPass, signinBtn));

  // Phone OTP
  const phoneForm = el('form',{onSubmit: async (e)=>{
    e.preventDefault();
    try {
      // reCAPTCHA verifier (invisible)
      const phoneNumber = phoneInput.value.trim();
      if (!/^\+?\d{8,15}$/.test(phoneNumber)) { toast('Enter phone with country code, e.g. +8801...'); return; }
      // create invisible recaptcha
      window.recaptchaVerifier = new RecaptchaVerifier('recaptcha-container', { 'size':'invisible' }, auth);
      const confirmation = await signInWithPhoneNumber(auth, phoneNumber, window.recaptchaVerifier);
      // Show code modal
      const codeInput = el('input',{class:'input', placeholder:'Enter OTP', type:'text', inputmode:'numeric'});
      showModal(el('div',{}, el('h3',{}, 'Enter OTP'), el('div',{class:'form-row'}, codeInput, el('div',{style:'display:flex;gap:8px'}, el('button',{class:'btn', onClick: async ()=>{
        const code = codeInput.value.trim();
        if (!code) return toast('Enter OTP');
        try {
          await confirmation.confirm(code);
          closeModal();
          toast('Phone signed-in');
          navigateTo('#/dashboard');
        } catch(err){ toast('Invalid code'); }
      }}, 'Confirm'), el('button',{class:'btn ghost', onClick: ()=>{ closeModal(); }}, 'Cancel')))));
    } catch(err){ console.error(err); toast('Phone sign-in error: '+err.message); }
  }});
  const phoneInput = el('input',{class:'input', placeholder:'Phone (with +country)', type:'tel', required:true, value:'+880'});
  const phoneBtn = el('button',{class:'btn'}, 'Send OTP');
  phoneForm.append(el('div',{class:'form-row'}, phoneInput, phoneBtn));

  card.append(el('div',{class:'grid'}, emailForm, signinForm, phoneForm));
  page.append(card);
  root.append(page);
}

/* Dashboard */
async function renderDashboard(root){
  if (!currentUser) return navigateTo('#/login');
  const uid = currentUser.uid;
  const userRef = doc(db,'users',uid);
  const userSnap = await getDoc(userRef);
  const userData = userSnap.exists() ? userSnap.data() : {};
  const page = el('div',{class:'page'});
  const headerCard = el('div',{class:'card'}, el('div',{style:'display:flex;justify-content:space-between;align-items:center'}, el('div',{}, el('div', {class:'small-note'}, 'Balance'), el('div',{class:'balance'}, fmtCurrency(userData.balance || 0)), el('div',{class:'small-note'}, userData.phone || currentUser.phoneNumber || '')) , el('div',{}, el('button',{class:'btn', onClick:()=>navigateTo('#/send')}, 'Send'), el('button',{class:'btn ghost', onClick:()=>navigateTo('#/topup')}, 'Top-up'))));
  page.append(headerCard);

  // Recent transactions (last 5)
  const txCard = el('div',{class:'card'});
  txCard.append(el('h3',{}, 'Recent Transactions'));
  const list = el('div',{class:'list'});
  txCard.append(list);
  page.append(txCard);

  // load recent transactions
  const q = query(collection(db,'transactions'), where('participants','array-contains', uid), orderBy('timestamp','desc'), limit(5));
  const snaps = await getDocs(q);
  snaps.forEach(snap => {
    const d = snap.data();
    const other = d.fromUid === uid ? d.toPhone || d.toUid : d.fromPhone || d.fromUid;
    const row = el('div',{class:'tx-row'}, el('div',{class:'tx-left'}, el('div',{class:'avatar'}, (d.fromUid===uid) ? '-' : '+'), el('div',{}, el('div',{class:'small-note'}, other), el('div',{}, fmtCurrency(d.amount)))), el('div',{}, el('div',{class:'small-note'}, new Date(d.timestamp?.toDate ? d.timestamp.toDate() : Date.now()).toLocaleString()), el('div',{class:'small-note'}, d.status)));
    list.append(row);
  });

  root.append(page);
}

/* Send Money */
function renderSend(root){
  if (!currentUser) return navigateTo('#/login');
  const page = el('div',{class:'page'});
  const card = el('div',{class:'card', style:'max-width:640px;margin:auto;'});
  card.append(el('h3',{}, 'Send Money'));

  const form = el('form',{onSubmit: async (e)=>{
    e.preventDefault();
    const phone = toPhone.value.trim();
    const amount = Number(amountInput.value);
    const note = noteInput.value.trim();
    if (!/^\+?\d{8,15}$/.test(phone)) return toast('Recipient phone invalid. Include country code.');
    if (!amount || amount <= 0) return toast('Enter an amount.');
    // require PIN
    showPinModal(async (pin)=>{
      // validate pin hash
      const meRef = doc(db,'users', currentUser.uid);
      const meSnap = await getDoc(meRef);
      const meData = meSnap.data();
      if (!meData.pinHash) { toast('Set a PIN in Profile first.'); return false; }
      const hash = await hashPin(pin);
      if (hash !== meData.pinHash) { toast('Incorrect PIN'); return false; }

      // perform Firestore transaction
      try {
        // Resolve recipient user by phone
        const usersCol = collection(db,'users');
        const q = query(usersCol, where('phone','==',phone)); // relies on indexed field
        const qsnap = await getDocs(q);
        if (qsnap.empty) { toast('Recipient not found'); return false; }
        const recipientDoc = qsnap.docs[0];
        const recipientRef = doc(db,'users',recipientDoc.id);
        const txRefString = txRefFor(currentUser.uid);

        await runTransaction(db, async (t)=>{
          const meDoc = await t.get(meRef);
          const recipDoc = await t.get(recipientRef);
          if (!meDoc.exists()) throw 'Sender profile missing';
          if (!recipDoc.exists()) throw 'Recipient profile missing';
          const meBal = meDoc.data().balance || 0;
          const recipBal = recipDoc.data().balance || 0;
          if (meBal < amount) throw 'Insufficient balance';
          // debit & credit
          t.update(meRef, { balance: meBal - amount });
          t.update(recipientRef, { balance: recipBal + amount });
          // create transaction doc
          const txDocRef = doc(collection(db,'transactions'));
          t.set(txDocRef, {
            fromUid: currentUser.uid,
            toUid: recipientDoc.id,
            fromPhone: meDoc.data().phone || '',
            toPhone: recipientDoc.data().phone || phone,
            amount,
            currency: 'BDT',
            status: 'success',
            timestamp: serverTimestamp(),
            note,
            txRef: txRefString,
            participants: [currentUser.uid, recipientDoc.id]
          });
        });

        toast('Transfer successful');
        closeModal();
        navigateTo('#/dashboard');
        return true;
      } catch(err){
        console.error(err);
        toast('Transfer failed: '+err);
        return false;
      }
    });
  }});

  const toPhone = el('input',{class:'input', placeholder:'Recipient phone +8801...', required:true});
  const amountInput = el('input',{class:'input', placeholder:'Amount', type:'number', min:1, required:true});
  const noteInput = el('input',{class:'input', placeholder:'Note (optional)'});
  const submit = el('button',{class:'btn'}, 'Send');
  form.append(el('div',{class:'form-row'}, toPhone, amountInput, noteInput, submit));
  card.append(form);
  page.append(card);
  root.append(page);
}

/* PIN modal helper */
function showPinModal(onConfirm){
  const input = el('input',{class:'input', placeholder:'Enter 4-digit PIN', type:'password', inputmode:'numeric', maxlength:4});
  const content = el('div',{}, el('h3',{}, 'Confirm with PIN'), el('div',{class:'form-row'}, input, el('div',{style:'display:flex;gap:8px'}, el('button',{class:'btn', onClick: async ()=>{
    const pin = input.value.trim();
    if (!/^\d{4}$/.test(pin)) { toast('PIN must be 4 digits'); return; }
    const ok = await onConfirm(pin);
    if (ok) closeModal();
  }}, 'Confirm'), el('button',{class:'btn ghost', onClick: ()=>closeModal()}, 'Cancel'))));
  showModal(content);
}

/* Receive page */
async function renderReceive(root){
  if (!currentUser) return navigateTo('#/login');
  const uid = currentUser.uid;
  const snap = await getDoc(doc(db,'users',uid));
  const data = snap.exists()?snap.data():{};
  const page = el('div',{class:'page'});
  const card = el('div',{class:'card', style:'max-width:520px;margin:auto;text-align:center;'});
  card.append(el('h3',{}, 'Receive Money'));
  const phone = data.phone || currentUser.phoneNumber || '—';
  card.append(el('div',{class:'small-note'}, 'Your number'), el('div',{style:'font-weight:700;margin:8px 0'}, phone));

  // Generate a simple QR code as data URI (canvas)
  const qrCanvas = document.createElement('canvas');
  qrCanvas.width = 220; qrCanvas.height = 220;
  const ctx = qrCanvas.getContext('2d');
  // Draw simple stylized QR placeholder (for demo we draw a code with text)
  ctx.fillStyle = '#071225'; ctx.fillRect(0,0,220,220);
  ctx.fillStyle = '#00d4ff'; ctx.font = '12px Inter';
  ctx.fillText('myrocket://pay?phone='+phone, 10, 110);
  const img = el('img',{src: qrCanvas.toDataURL(), alt:'QR code for receive', style:'width:220px;border-radius:8px;margin:8px 0'});
  card.append(img);
  const copyBtn = el('button',{class:'btn', onClick: async ()=>{ await navigator.clipboard.writeText(phone); toast('Number copied'); }}, 'Copy my number');
  card.append(copyBtn);
  page.append(card);
  root.append(page);
}

/* Transactions with "load more" */
let txPageCursor = null;
async function renderTransactions(root){
  if (!currentUser) return navigateTo('#/login');
  txPageCursor = null;
  const page = el('div',{class:'page'});
  const card = el('div',{class:'card'});
  card.append(el('h3',{}, 'Transactions'));
  const list = el('div',{class:'list'});
  const loadMore = el('button',{class:'btn ghost', onClick: async ()=> {
    loadMore.disabled = true; loadMore.textContent = 'Loading...';
    await loadMoreTx(list, loadMore);
    loadMore.disabled = false; loadMore.textContent = 'Load more';
  }}, 'Load more');
  card.append(list, loadMore);
  page.append(card);
  root.append(page);
  // initial load
  await loadMoreTx(list, loadMore);
}

async function loadMoreTx(list, loadMoreBtn){
  const uid = currentUser.uid;
  const txCol = collection(db,'transactions');
  let q;
  if (!txPageCursor) {
    q = query(txCol, where('participants','array-contains', uid), orderBy('timestamp','desc'), limit(8));
  } else {
    q = query(txCol, where('participants','array-contains', uid), orderBy('timestamp','desc'), startAfter(txPageCursor), limit(8));
  }
  const snaps = await getDocs(q);
  if (snaps.empty) { if (!txPageCursor) list.append(el('div',{}, el('div',{class:'small-note'}, 'No transactions yet.'))); loadMoreBtn.style.display='none'; return; }
  snaps.forEach(snap => {
    const d = snap.data();
    const other = d.fromUid === uid ? d.toPhone || d.toUid : d.fromPhone || d.fromUid;
    const row = el('div',{class:'tx-row'}, el('div',{class:'tx-left'}, el('div',{class:'avatar'}, (d.fromUid===uid) ? '-' : '+'), el('div',{}, el('div',{class:'small-note'}, other), el('div',{}, fmtCurrency(d.amount)))), el('div',{}, el('div',{class:'small-note'}, new Date(d.timestamp?.toDate ? d.timestamp.toDate() : Date.now()).toLocaleString()), el('div',{class:'small-note'}, d.txRef)));
    list.append(row);
  });
  txPageCursor = snaps.docs[snaps.docs.length-1];
}

/* Top-up (demo) */
function renderTopup(root){
  if (!currentUser) return navigateTo('#/login');
  const page = el('div',{class:'page'});
  const card = el('div',{class:'card', style:'max-width:520px;margin:auto;'});
  card.append(el('h3',{}, 'Top-up (Demo)'));
  const form = el('form',{onSubmit: async (e)=> {
    e.preventDefault();
    const amt = Number(amountInput.value);
    if (!amt || amt<=0) return toast('Enter valid amount');
    // Simulate payment processing
    showModal(el('div',{}, el('h3',{}, 'Processing payment...'), el('div',{}, spinner())));
    setTimeout(async ()=>{
      closeModal();
      // credit balance & create topup + transaction
      const txRef = txRefFor(currentUser.uid);
      const meRef = doc(db,'users',currentUser.uid);
      await runTransaction(db, async (t)=>{
        const meDoc = await t.get(meRef);
        if (!meDoc.exists()) throw 'User missing';
        const cur = meDoc.data().balance || 0;
        t.update(meRef, { balance: cur + amt });
        const topupRef = doc(collection(db,'topups'));
        t.set(topupRef, { uid: currentUser.uid, amount: amt, method: 'demo-card', status: 'success', timestamp: serverTimestamp() });
        const txRefDoc = doc(collection(db,'transactions'));
        t.set(txRefDoc, { fromUid: 'TOPUP', toUid: currentUser.uid, fromPhone: '', toPhone: meDoc.data().phone || '', amount: amt, currency: 'BDT', status: 'success', timestamp: serverTimestamp(), note: 'Demo topup', txRef });
      });
      toast('Top-up successful');
      navigateTo('#/dashboard');
    }, 2000);
  }});
  const amountInput = el('input',{class:'input', type:'number', placeholder:'Amount (BDT)', required:true, min:1});
  const btn = el('button',{class:'btn'}, 'Pay (Demo)');
  form.append(el('div',{class:'form-row'}, amountInput, btn));
  card.append(form);
  page.append(card);
  root.append(page);
}

/* Profile */
async function renderProfile(root){
  if (!currentUser) return navigateTo('#/login');
  const uid = currentUser.uid;
  const snap = await getDoc(doc(db,'users',uid));
  const data = snap.exists()?snap.data():{};
  const page = el('div',{class:'page'});
  const card = el('div',{class:'card', style:'max-width:640px;margin:auto;'});
  card.append(el('h3',{}, 'Profile'));

  const nameInput = el('input',{class:'input', value:data.displayName || '', placeholder:'Display name'});
  const phoneInput = el('input',{class:'input', value:data.phone || '', placeholder:'Phone (+880...)'});
  const saveBtn = el('button',{class:'btn', onClick: async ()=>{
    await setDoc(doc(db,'users',uid), { displayName: nameInput.value.trim(), phone: phoneInput.value.trim() }, { merge:true });
    toast('Profile updated');
  }}, 'Save');

  // Avatar upload (data URL)
  const avatarInput = el('input',{class:'input', type:'file', accept:'image/*'});
  avatarInput.addEventListener('change', async (e)=>{
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = async ()=> {
      await setDoc(doc(db,'users',uid), { avatarUrl: reader.result }, { merge:true });
      toast('Avatar updated');
    };
    reader.readAsDataURL(f);
  });

  // Set/change PIN
  const setPinBtn = el('button',{class:'btn ghost', onClick: async ()=>{
    const p1 = prompt('Enter new 4-digit PIN:');
    if (!p1 || !/^\d{4}$/.test(p1)) return toast('PIN must be 4 digits');
    const p2 = prompt('Confirm PIN:');
    if (p1 !== p2) return toast('PIN mismatch');
    const hash = await hashPin(p1);
    await setDoc(doc(db,'users',uid), { pinHash: hash }, { merge:true });
    toast('PIN set');
  }}, 'Set / Change PIN');

  card.append(el('div',{class:'form-row'}, nameInput, phoneInput, avatarInput, saveBtn, setPinBtn));
  page.append(card);
  root.append(page);
}

/* Admin (debug) */
async function renderAdmin(root){
  // simple secret check
  const secret = prompt('Enter admin secret (dev only):');
  if (secret !== window.__MYROCKET_ADMIN_SECRET) { toast('Not authorized'); return navigateTo('#/dashboard'); }
  const page = el('div',{class:'page'});
  const card = el('div',{class:'card'});
  card.append(el('h3',{}, 'Admin / Debug'));
  const userList = el('div',{class:'list'});
  // Fetch all users (requires Firestore rules permitting; or run in emulator)
  const snaps = await getDocs(collection(db,'users'));
  snaps.forEach(s => {
    const d = s.data();
    const row = el('div',{class:'tx-row'}, el('div',{class:'tx-left'}, el('div',{class:'avatar'}, d.displayName?.slice(0,1) || 'U'), el('div',{}, el('div',{}, d.displayName || '—'), el('div',{class:'small-note'}, d.phone || d.email || ''))), el('div',{}, el('button',{class:'btn', onClick: async ()=>{
      const amt = Number(prompt('Amount to credit (positive) or debit (negative):'));
      if (!amt) return;
      await runTransaction(db, async (t)=>{
        const ref = doc(db,'users',s.id);
        const docSnap = await t.get(ref);
        if (!docSnap.exists()) throw 'Missing';
        const curr = docSnap.data().balance || 0;
        t.update(ref, { balance: curr + amt });
        const txRef = txRefFor('admin');
        const tx = doc(collection(db,'transactions'));
        t.set(tx, { fromUid: amt>0 ? 'ADMIN' : s.id, toUid: amt>0 ? s.id : 'ADMIN', fromPhone:'', toPhone: d.phone||'', amount: Math.abs(amt), currency:'BDT', status:'success', timestamp: serverTimestamp(), note:'Admin adjustment', txRef, participants: [s.id] });
      });
      toast('Adjusted');
    }}, 'Adjust')));
    userList.append(row);
  });
  card.append(userList);
  page.append(card);
  root.append(page);
}

/* Not found */
function renderNotFound(root){
  root.append(el('div',{class:'page'}, el('div',{class:'card'}, el('h3',{}, 'Page not found'), el('p',{}, 'Use navigation to move around.'))));
}

/* initial render */
renderCurrentPage();

/* Service worker registration (for PWA) */
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/service-worker.js').then(()=> console.log('SW registered')).catch(()=>console.log('SW register failed'));
}

/* Extras: seed demo data script usage (seed-demo-data.js) */
