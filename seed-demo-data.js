// seed-demo-data.js
// OPTIONAL: run this manually in developer console (after replacing firebase-config-sample and allowing writes)
// This is a client-side convenience script to pre-seed demo users and transactions into Firestore.
// If your Firestore rules prevent unauthenticated writes, run using emulator or temporary test rules.

(async function seedDemo(){
  if (!confirm('Seed demo data? This will write to your Firestore. Run only in dev/test projects.')) return;
  const demoUsers = [
    { id:'demo_user_1', displayName:'Alice', phone:'+8801711111111', email:'alice@example.com', balance:1000},
    { id:'demo_user_2', displayName:'Bob', phone:'+8801722222222', email:'bob@example.com', balance:5000},
    { id:'demo_user_3', displayName:'Charlie', phone:'+8801733333333', email:'charlie@example.com', balance:250}
  ];
  for (const u of demoUsers){
    await setDoc(doc(db,'users',u.id), {...u, pinHash:'', createdAt: serverTimestamp()});
  }
  // sample transactions
  await addDoc(collection(db,'transactions'), { fromUid:'demo_user_2', toUid:'demo_user_1', fromPhone:'+8801722222222', toPhone:'+8801711111111', amount:250, currency:'BDT', status:'success', timestamp: serverTimestamp(), note:'Lunch', txRef: txRefFor('seed'), participants:['demo_user_2','demo_user_1'] });
  await addDoc(collection(db,'transactions'), { fromUid:'demo_user_1', toUid:'demo_user_3', fromPhone:'+8801711111111', toPhone:'+8801733333333', amount:120, currency:'BDT', status:'success', timestamp: serverTimestamp(), note:'Taxi', txRef: txRefFor('seed'), participants:['demo_user_1','demo_user_3'] });
  alert('Seeded demo users & sample transactions. If Firestore rules block you, run this in emulator or loosen rules temporarily.');
})();
