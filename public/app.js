"use strict";
/* ============================================================
   MAMS Audit AI — single-file app
   Sections: 1 State & storage · 2 Masters · 3 Rules engine
             4 Sample data · 5 Views · 6 Input & AI · 7 Export
   ============================================================ */

/* ---------- 1. State & storage ---------- */
const DEFAULT_MODEL = 'gpt-5-mini';
const TYPES = ['Cash','Insurance','Aarogyasri'];
const STATUSES = ['Correct','Missing','Excess','Error'];
const MODES = ['Elective / Planned','Emergency','Day Care','Referral / Transfer','MLC'];
const INSURERS = ['Star Health','HDFC Ergo','Care Health','Niva Bupa','ICICI Lombard','New India Assurance','United India','Aditya Birla Health','Medi Assist TPA','Paramount TPA','Vidal Health TPA','MD India TPA','CGHS','EHS / Employee Scheme','Aarogyasri Trust'];
const TYPE_COLOR = {Cash:'var(--cash)',Insurance:'var(--ins)',Aarogyasri:'var(--as)'};
const STATUS_COLOR = {Correct:'var(--ok)',Missing:'var(--miss)',Excess:'var(--exc)',Error:'var(--err)'};
const MONEY = ['roomRent','icuRent','ot','surgeon','implant','pharmacy','lab','radiology','consultation'];
const MONEY_LABEL = {roomRent:'Room Rent',icuRent:'ICU Rent',ot:'OT Charges',surgeon:'Surgeon',implant:'Implant / Consumables',pharmacy:'Pharmacy',lab:'Lab',radiology:'Radiology',consultation:'Consultation'};

const S = {
  bills: [], tariff: [], packages: [], users: [],
  me: null, aiReady: false,
  settings: {hospitalName:'', model:DEFAULT_MODEL, uplift:25, tolerance:1, riskHigh:10},
  ui: {tab:'dash', type:'All', status:'All', q:'', mode:'all', week:'', month:'', inputMode:'single', editId:null, bulk:[], tDraft:[], tSpeech:''}
};
const canWrite = () => S.me && S.me.role !== 'viewer';
const isAdmin  = () => S.me && S.me.role === 'admin';

/* ---------- server API ---------- */
async function apiFetch(path, opts = {}) {
  const res = await fetch(path, {credentials:'same-origin', headers:{'Content-Type':'application/json'}, ...opts});
  if (res.status === 401) { location.href = '/login.html'; throw new Error('Session expired'); }
  const d = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(d.error || ('Server error ' + res.status));
  return d;
}
const api = {
  state:       ()            => apiFetch('/api/state'),
  saveBills:   bills         => apiFetch('/api/bills', {method:'POST', body:JSON.stringify({bills})}),
  deleteBill:  id            => apiFetch('/api/bills/' + encodeURIComponent(id), {method:'DELETE'}),
  clearBills:  ()            => apiFetch('/api/bills', {method:'DELETE'}),
  putTariff:   tariff        => apiFetch('/api/tariff', {method:'PUT', body:JSON.stringify({tariff})}),
  putPackages: packages      => apiFetch('/api/packages', {method:'PUT', body:JSON.stringify({packages})}),
  putSettings: settings      => apiFetch('/api/settings', {method:'PUT', body:JSON.stringify({settings})}),
  addUser:     u             => apiFetch('/api/users', {method:'POST', body:JSON.stringify(u)}),
  delUser:     id            => apiFetch('/api/users/' + encodeURIComponent(id), {method:'DELETE'}),
  password:    (current,password) => apiFetch('/api/password', {method:'POST', body:JSON.stringify({current,password})}),
  logout:      ()            => apiFetch('/api/logout', {method:'POST'})
};

/* Changes are pushed to the server, so every user sees the same data. */
const snap = {bills:new Map(), tariff:'', packages:'', settings:''};
const pickSettings = () => ({hospitalName:S.settings.hospitalName, model:S.settings.model, uplift:S.settings.uplift, tolerance:S.settings.tolerance, riskHigh:S.settings.riskHigh});
function setSnap(){ snap.bills = new Map(S.bills.map(b => [b.id, JSON.stringify(b)])); snap.tariff = JSON.stringify(S.tariff); snap.packages = JSON.stringify(S.packages); snap.settings = JSON.stringify(pickSettings()); }
let syncT = null, syncing = false, pendingSync = false;
function save(){ if(!canWrite()) return; clearTimeout(syncT); syncT = setTimeout(syncNow, 350); }
async function syncNow(){
  if (syncing) { pendingSync = true; return; }
  syncing = true;
  try {
    const changed = S.bills.filter(b => snap.bills.get(b.id) !== JSON.stringify(b));
    if (changed.length) await api.saveBills(changed);
    const ids = new Set(S.bills.map(b => b.id));
    for (const id of [...snap.bills.keys()].filter(id => !ids.has(id))) await api.deleteBill(id);
    if (isAdmin()) {
      if (JSON.stringify(S.tariff)   !== snap.tariff)   await api.putTariff(S.tariff);
      if (JSON.stringify(S.packages) !== snap.packages) await api.putPackages(S.packages);
      if (JSON.stringify(pickSettings()) !== snap.settings) await api.putSettings(pickSettings());
    }
    setSnap();
  } catch (e) { toast('Could not save to the server: ' + e.message, 6000); }
  finally { syncing = false; if (pendingSync) { pendingSync = false; syncNow(); } }
}
async function pullState(quiet){
  const d = await api.state();
  S.me = d.user; S.bills = d.bills || []; S.tariff = d.tariff || []; S.packages = d.packages || [];
  S.settings = {...S.settings, ...d.settings}; S.users = d.users || []; S.aiReady = !!d.aiReady;
  setSnap();
  if (!quiet) render();
}

/* ---------- helpers ---------- */
const $ = (s,r=document)=>r.querySelector(s);
const $$ = (s,r=document)=>[...r.querySelectorAll(s)];
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const num = v => { if(v===null||v===undefined||v==='') return 0; const n = parseFloat(String(v).replace(/[₹,\s]/g,'')); return isFinite(n)?n:0; };
const r2 = n => Math.round(n*100)/100;
const inr = n => { n=Math.round(n||0); return (n<0?'−₹':'₹') + Math.abs(n).toLocaleString('en-IN'); };
const inrS = n => { n=Math.round(n||0); const a=Math.abs(n); if(a>=1e7) return '₹'+(n/1e7).toFixed(2)+' Cr'; if(a>=1e5) return '₹'+(n/1e5).toFixed(2)+' L'; return inr(n); };
const uid = () => 'b' + Date.now().toString(36) + Math.random().toString(36).slice(2,7);
const addDays = (iso,n)=>{ const d=new Date(iso+'T00:00:00Z'); d.setUTCDate(d.getUTCDate()+n); return d.toISOString().slice(0,10); };
const validDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s||'') && !isNaN(Date.parse(s));
function losDays(doa,dod){ if(!validDate(doa)||!validDate(dod)) return 0; const d=Math.round((Date.parse(dod)-Date.parse(doa))/864e5); return d<0? d : Math.max(1,d); }
function isoWeek(iso){ const d=new Date(iso+'T00:00:00Z'); const day=(d.getUTCDay()+6)%7; d.setUTCDate(d.getUTCDate()-day+3); const y=d.getUTCFullYear(); const f=new Date(Date.UTC(y,0,4)); const w=1+Math.round(((d-f)/864e5-3+((f.getUTCDay()+6)%7))/7); return y+'-W'+String(w).padStart(2,'0'); }
const fmtD = iso => validDate(iso) ? iso.slice(8,10)+'-'+iso.slice(5,7)+'-'+iso.slice(0,4) : (iso||'—');
function toast(msg,ms=2600){ const t=$('#toast'); t.textContent=msg; t.style.display='block'; clearTimeout(toast._t); toast._t=setTimeout(()=>t.style.display='none',ms); }
function parseDate(v){
  if(v===null||v===undefined||v==='') return '';
  if(v instanceof Date && !isNaN(v)) return new Date(Date.UTC(v.getFullYear(),v.getMonth(),v.getDate())).toISOString().slice(0,10);
  if(typeof v==='number' && v>20000 && v<80000){ const d=new Date(Date.UTC(1899,11,30)+v*864e5); return d.toISOString().slice(0,10); }
  const s=String(v).trim();
  let m=s.match(/^(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/); if(m) return `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
  m=s.match(/^(\d{1,2})[-\/.](\d{1,2})[-\/.](\d{2,4})/); if(m){ const y=m[3].length===2?'20'+m[3]:m[3]; return `${y}-${m[2].padStart(2,'0')}-${m[1].padStart(2,'0')}`; }
  const t=Date.parse(s); return isNaN(t)?'':new Date(t).toISOString().slice(0,10);
}
function normType(v,def='Cash'){ const s=String(v||'').toLowerCase(); if(/aaro|arog|\bas\b|trust|rajiv|ntr/.test(s)) return 'Aarogyasri'; if(/ins|tpa|claim|cashless/.test(s)) return 'Insurance'; if(/cash|self/.test(s)) return 'Cash'; return def; }

/* ---------- 2. Masters (editable; sample defaults) ---------- */
const DEFAULT_TARIFF = [
  ['General Ward','Room',1500,false],['Semi Private','Room',2500,false],['Special Room','Room',3000,true],['Deluxe Room','Room',3500,true],
  ['ICU / day','ICU',8000,false],['OT Major','OT',18000,false],['OT Minor','OT',8000,false],
  ['Surgeon Major','Surgeon',25000,false],['Surgeon Minor','Surgeon',10000,false],['Consultation / day','Consultation',800,false],
  ['CT Brain','Radiology',2500,false],['MRI Spine','Radiology',6000,false],['X-Ray Chest','Radiology',400,false],['USG Abdomen','Radiology',1200,false],['2D Echo','Radiology',2000,false],
  ['Knee Prosthesis (TKR)','Implant',95000,false],['Hip Prosthesis','Implant',85000,false],['Cardiac Stent (DES)','Implant',45000,false],['Interlocking Nail','Implant',18000,false],['Bone Plate & Screws','Implant',14000,false],['Hernia Mesh','Implant',6000,false],['IOL Foldable','Implant',12000,false],['Pacemaker (Single Chamber)','Implant',75000,false],
  ['CBC','Lab',350,false],['LFT','Lab',700,false],['RFT','Lab',650,false],['Blood Sugar','Lab',150,false],['Serology','Lab',900,false],['ECG','Lab',300,false]
].map(([service,category,price,premium])=>({service,category,price,premium}));
const DEFAULT_PACKAGES = [
  ['AS-ORT-01','Total Knee Replacement','Orthopaedics','Aarogyasri',80000],['AS-ORT-02','Fracture Femur – ORIF','Orthopaedics','Aarogyasri',45000],
  ['AS-GS-01','Lap Cholecystectomy','General Surgery','Aarogyasri',35000],['AS-GS-02','Inguinal Hernia Repair','General Surgery','Aarogyasri',25000],
  ['AS-CAR-01','PTCA – Single Stent','Cardiology','Aarogyasri',95000],['AS-CAR-02','Coronary Angiogram','Cardiology','Aarogyasri',12000],
  ['AS-NEU-01','Craniotomy','Neurosurgery','Aarogyasri',110000],['AS-OBG-01','LSCS','OBG','Aarogyasri',22000],['AS-GM-01','Medical Management – ICU','General Medicine','Aarogyasri',30000],
  ['INS-ORT-01','Total Knee Replacement','Orthopaedics','Insurance',150000],['INS-ORT-02','Fracture Femur – ORIF','Orthopaedics','Insurance',90000],
  ['INS-GS-01','Lap Cholecystectomy','General Surgery','Insurance',60000],['INS-GS-02','Inguinal Hernia Repair','General Surgery','Insurance',50000],
  ['INS-CAR-01','PTCA – Single Stent','Cardiology','Insurance',180000],['INS-NEU-01','Craniotomy','Neurosurgery','Insurance',200000],
  ['INS-OBG-01','LSCS','OBG','Insurance',45000],['INS-GM-01','Medical Management','General Medicine','Insurance',50000]
].map(([code,name,dept,scheme,amount])=>({code,name,dept,scheme,amount}));
const DEPTS = {'Orthopaedics':['Dr. R. Kumar','Dr. S. Reddy'],'General Surgery':['Dr. A. Rao','Dr. P. Sharma'],'Cardiology':['Dr. V. Menon','Dr. K. Iyer'],'Neurosurgery':['Dr. N. Varma'],'OBG':['Dr. L. Devi','Dr. M. Priya'],'General Medicine':['Dr. T. Naidu','Dr. H. Khan']};

const T = name => S.tariff.find(t=>t.service.trim().toLowerCase()===String(name||'').trim().toLowerCase());
const rooms = () => S.tariff.filter(t=>t.category==='Room');
const deptList = () => [...new Set([...Object.keys(DEPTS),...S.packages.map(p=>p.dept),...S.bills.map(b=>b.dept).filter(Boolean)])].sort();
const parseServices = s => String(s||'').split(/[,;\n]+/).map(x=>x.trim()).filter(Boolean);

/* ---------- 3. Rules engine ---------- */
function expectedFor(b){
  const L = losDays(b.doa,b.dod);
  const icuDays = Math.min(Math.max(0,num(b.icuDays)), Math.max(L,0));
  const roomDays = Math.max(0, L - icuDays);
  const room = T(b.roomType);
  const premium = !!(room && room.premium);
  const factor = premium ? 1 + num(S.settings.uplift)/100 : 1;
  const grade = b.surgery==='Major'||b.surgery==='Minor' ? b.surgery : null;
  const icuRate = T('ICU / day')?.price ?? 0;
  const consult = T('Consultation / day')?.price ?? 0;
  const svc = parseServices(b.services);
  let rad = 0, lab = 0; const unknown = [];
  svc.forEach(n=>{ const t=T(n); if(!t) unknown.push(n); else if(t.category==='Radiology') rad+=t.price; else if(t.category==='Lab') lab+=t.price; });
  return {
    L, icuDays, roomDays, room, premium, factor, grade, svc, unknown,
    roomRent: room ? roomDays*room.price : null,
    icuRent: icuDays*icuRate,
    ot: grade ? r2((T('OT '+grade)?.price||0)*factor) : 0,
    surgeon: grade ? r2((T('Surgeon '+grade)?.price||0)*factor) : 0,
    implantRow: b.implantName ? T(b.implantName) : null,
    implant: b.implantName ? (T(b.implantName)?.price ?? null) : null,
    radiology: svc.length ? rad : null,
    lab: svc.length ? lab : null,
    consultation: L>0 ? L*consult : null,
    pharmacy: null
  };
}

function audit(b){
  const tol = num(S.settings.tolerance)||1;
  const F = []; // {st, text, amt, bucket: 'leak'|'over'|null}
  const add = (st,text,amt=0,bucket=null)=>F.push({st,text,amt:r2(amt),bucket});
  const E = expectedFor(b);
  const v = k => num(b[k]);

  // Dates / LOS
  if(!validDate(b.doa)||!validDate(b.dod)) add('Error','Admission / discharge date missing — LOS cannot be verified');
  else if(E.L<0) add('Error','Discharge date is before admission date');

  // Room rent vs LOS
  if(E.L>0){
    if(!b.roomType) add('Error','Room type not recorded');
    else if(!E.room) add('Error',`Room type "${b.roomType}" not in tariff master`);
    else {
      const d = v('roomRent') - E.roomRent;
      if(v('roomRent')===0 && E.roomRent>0) add('Missing',`Room rent not billed (${E.roomDays} day × ${inr(E.room.price)} = ${inr(E.roomRent)})`,E.roomRent,'leak');
      else if(d < -tol) add('Missing',`Room rent short by ${inr(-d)} — LOS ${E.L} d, ${E.roomDays} room day(s) × ${inr(E.room.price)}`,-d,'leak');
      else if(d > tol) add('Excess',`Room rent exceeded by ${inr(d)} — only ${E.roomDays} room day(s) as per DOA→DOD`,d,'over');
    }
    // ICU
    const di = v('icuRent') - E.icuRent;
    if(E.icuDays>0 && v('icuRent')===0) add('Missing',`ICU rent not billed (${E.icuDays} d × ${inr(E.icuRent/E.icuDays)})`,E.icuRent,'leak');
    else if(E.icuDays===0 && v('icuRent')>0) add('Excess',`ICU rent ${inr(v('icuRent'))} billed but no ICU days recorded`,v('icuRent'),'over');
    else if(di < -tol) add('Missing',`ICU rent short by ${inr(-di)}`,-di,'leak');
    else if(di > tol) add('Excess',`ICU rent exceeded by ${inr(di)}`,di,'over');
  }

  // OT & Surgeon (Special Room Rule)
  if(E.grade){
    [['ot','OT'],['surgeon','Surgeon']].forEach(([k,lbl])=>{
      const exp = E[k], d = v(k) - exp;
      const tag = E.premium ? ` (incl. +${S.settings.uplift}% ${b.roomType} rule)` : '';
      if(v(k)===0) add('Missing',`${lbl} charges not billed — expected ${inr(exp)}${tag}`,exp,'leak');
      else if(d < -tol){
        const base = exp/E.factor;
        if(E.premium && Math.abs(v(k)-base)<=tol) add('Missing',`${lbl} short by ${inr(-d)} — +${S.settings.uplift}% ${b.roomType} uplift not applied`,-d,'leak');
        else add('Missing',`${lbl} short by ${inr(-d)} (expected ${inr(exp)}${tag})`,-d,'leak');
      }
      else if(d > tol) add('Excess',`${lbl} exceeded by ${inr(d)} (expected ${inr(exp)}${tag})`,d,'over');
    });
  } else if(v('ot')>0 || v('surgeon')>0){
    add('Error','OT / surgeon charged but surgery grade not recorded — cannot verify against tariff');
  }

  // Implants & high-value consumables vs market / tariff price
  if(b.implantName){
    if(E.implant===null) add('Error',`Implant "${b.implantName}" not in tariff master — market price cannot be checked`);
    else {
      const d = v('implant') - E.implant;
      if(v('implant')===0) add('Missing',`Implant ${b.implantName} not billed — market/tariff price ${inr(E.implant)}`,E.implant,'leak');
      else if(d < -tol) add('Missing',`Implant ${b.implantName} billed ${inr(v('implant'))} — ${inr(-d)} below market/tariff price ${inr(E.implant)}`,-d,'leak');
      else if(d > tol) add('Excess',`Implant ${b.implantName} billed ${inr(d)} above tariff ${inr(E.implant)} — payer may disallow`,d,'over');
    }
  } else if(v('implant')>0) add('Error','Implant amount billed but implant / consumable name not recorded');
  else if(E.grade==='Major' && /ortho|cardio|neuro/i.test(b.dept||'')) add('Missing','No implant billed for a major surgery — confirm whether an implant was used');

  // Services: duplicates, unknown, price check
  const cnt = {}; E.svc.forEach(n=>{ const k=n.toLowerCase(); cnt[k]=(cnt[k]||0)+1; });
  Object.entries(cnt).forEach(([k,c])=>{ if(c>1){ const t=T(k); add('Excess',`Duplicate billing: ${t?t.service:k} billed ${c}×`, t?t.price*(c-1):0,'over'); } });
  E.unknown.forEach(n=>add('Error',`Service "${n}" not in tariff master`));
  [['radiology','Radiology'],['lab','Lab']].forEach(([k,lbl])=>{
    if(E[k]===null) return;
    const d = v(k) - E[k];
    if(v(k)===0 && E[k]>0) add('Missing',`${lbl} not billed — tariff total ${inr(E[k])}`,E[k],'leak');
    else if(d < -tol) add('Missing',`${lbl} short by ${inr(-d)} vs tariff`,-d,'leak');
    else if(d > tol) add('Excess',`${lbl} exceeded tariff by ${inr(d)}`,d,'over');
  });

  // Missing charge detection
  if(E.consultation!==null){
    const d = v('consultation') - E.consultation;
    if(v('consultation')===0) add('Missing',`Consultation not billed (${E.L} d × ${inr(E.consultation/E.L)})`,E.consultation,'leak');
    else if(d < -tol) add('Missing',`Consultation short by ${inr(-d)}`,-d,'leak');
    else if(d > tol) add('Excess',`Consultation exceeded by ${inr(d)}`,d,'over');
  }
  if(E.L>0 && v('pharmacy')===0) add('Missing','Pharmacy not billed — verify indent / returns');
  if(E.L>=2 && v('lab')===0 && !E.svc.length) add('Missing','No investigations billed for a multi-day stay');

  // Total check
  const sum = MONEY.reduce((a,k)=>a+v(k),0);
  if(Math.abs(v('total')-sum) > tol) add('Error',`Total ${inr(v('total'))} ≠ sum of charges ${inr(sum)} (diff ${inr(v('total')-sum)})`);

  // Duplicate bill
  const dup = S.bills.find(o=>o.id!==b.id && o.uhid && o.uhid===b.uhid && o.doa===b.doa);
  if(dup) add('Error',`Duplicate bill — same UHID & DOA as ${dup.name||dup.uhid}`);

  // Payer-specific
  let pkg = null;
  if(b.type==='Cash'){
    if(v('insApproved')>0) add('Error','Insurance approved amount entered on a cash bill');
  }
  if(b.type==='Insurance'){
    if(v('insApproved')===0) add('Error','Insurance approved amount missing');
    else {
      const gap = v('total') - v('insApproved') - v('copay');
      if(gap > tol) add('Missing',`Unrecovered ${inr(gap)} — approved + copayment < total bill`,gap,'leak');
      else if(gap < -tol) add('Excess',`Approved + copayment exceed total by ${inr(-gap)}`,-gap,'over');
    }
  }
  if(b.type==='Aarogyasri' && v('copay')>0) add('Error',`Patient charged ${inr(v('copay'))} under Aarogyasri — must be nil`);

  if(b.type!=='Cash'){
    pkg = packageAudit(b);
    if(pkg.error) add('Error',pkg.error);
    if(pkg.exceeded > tol) add('Excess',`Bill exceeds package by ${inr(pkg.exceeded)} (${pkg.code} = ${inr(pkg.amount)})`,pkg.exceeded,'pkg');
    if(pkg.master && v('insApproved') > pkg.amount + tol) add('Error',`Approved ${inr(v('insApproved'))} is above package amount ${inr(pkg.amount)}`);
  }

  const rank = {Error:3,Excess:2,Missing:1};
  const status = F.length ? F.reduce((a,f)=>rank[f.st]>rank[a]?f.st:a,'Missing') : 'Correct';
  const leak = F.filter(f=>f.bucket==='leak'||f.bucket==='pkg').reduce((a,f)=>a+f.amt,0);
  const over = F.filter(f=>f.bucket==='over').reduce((a,f)=>a+f.amt,0);
  const out = {E, F, status, remarks: F.length ? F.map(f=>f.text).join('; ') : 'All charges valid', leak:r2(leak), over:r2(over), pkg, sum};
  out.sg = suggestBill(b,out);
  return out;
}

/* Suggested (correct) bill — what the bill should be at hospital tariff + market implant price */
function suggestBill(b,a){
  const E=a.E, v=k=>num(b[k]), pick=(exp,bill)=>exp===null||exp===undefined?bill:Math.max(exp,0);
  const lines=[
    ['Room Rent', pick(E.roomRent,v('roomRent'))], ['ICU Rent', E.icuDays>0?E.icuRent:v('icuRent')],
    ['OT', E.grade?E.ot:v('ot')], ['Surgeon', E.grade?E.surgeon:v('surgeon')],
    ['Implant', E.implant!==null?Math.max(E.implant,v('implant')):v('implant')],
    ['Pharmacy', v('pharmacy')], ['Lab', pick(E.lab,v('lab'))], ['Radiology', pick(E.radiology,v('radiology'))], ['Consultation', pick(E.consultation,v('consultation'))]
  ];
  const amount = r2(lines.reduce((x,[,n])=>x+n,0));
  const delta = r2(amount - v('total'));
  const notes=[];
  if(E.implant!==null && v('implant') < E.implant - 1) notes.push(`Bill implant ${b.implantName} at market price ${inr(E.implant)} (short ${inr(E.implant-v('implant'))})`);
  if(E.implant!==null && v('implant') > E.implant + 1) notes.push(`Implant ${inr(v('implant'))} is above tariff ${inr(E.implant)} — keep invoice/MRP sticker for the payer`);
  a.F.filter(f=>f.bucket==='leak' && !/implant/i.test(f.text)).slice(0,3).forEach(f=>notes.push(f.text));
  const p=a.pkg;
  if(p && p.master){
    if(amount > p.amount+1){
      const over = r2(amount - p.amount);
      notes.push(p.alt ? `${p.code} covers ${inr(p.amount)} only — ${inr(over)} short; consider ${p.alt.code} ${p.alt.name} (${inr(p.alt.amount)})`
                       : `${p.code} covers ${inr(p.amount)} only — ${inr(over)} above package; raise pre-auth enhancement or collect as non-medical/consumable`);
    } else notes.push(`Fits ${p.code} (${inr(p.amount)}) — claimable in full`);
    if(b.type==='Aarogyasri') notes.push('Aarogyasri: patient share must stay nil');
  } else if(b.type==='Insurance') notes.push('No package linked — claim itemised; attach implant invoice');
  return {amount, delta, lines, notes};
}

function packageAudit(b){
  const tol = num(S.settings.tolerance)||1;
  const code = String(b.pkgCode||'').trim();
  const out = {code, amount:0, bill:num(b.total), exceeded:0, alt:null, risk:'Low', error:null, master:null};
  if(!code){ out.error = b.type==='Aarogyasri' ? 'Package code missing (Aarogyasri requires a package)' : null; out.risk = b.type==='Aarogyasri'?'High':'Low'; return out; }
  const m = S.packages.find(p=>p.code.toLowerCase()===code.toLowerCase());
  if(!m){ out.error = `Package code ${code} not found in package master`; out.risk='High'; return out; }
  out.master = m; out.amount = m.amount; out.name = m.name;
  let wrong = false;
  if(m.scheme!==b.type){ out.error = `Wrong package selected — ${code} is a ${m.scheme} package`; wrong=true; }
  else if(b.dept && m.dept!==b.dept){ out.error = `Wrong package selected — ${code} (${m.name}) belongs to ${m.dept}, patient is in ${b.dept}`; wrong=true; }
  out.exceeded = Math.max(0, r2(out.bill - m.amount));
  const pct = m.amount ? out.exceeded/m.amount*100 : 0;
  out.pct = pct;
  // alternate package: same scheme + patient's dept, closest amount covering the bill
  const pool = S.packages.filter(p=>p.scheme===b.type && p.dept===b.dept && p.code!==m.code);
  if(wrong || out.exceeded>tol){
    const cover = pool.filter(p=>p.amount>=out.bill).sort((a,c)=>a.amount-c.amount)[0];
    out.alt = cover || pool.sort((a,c)=>c.amount-a.amount)[0] || null;
    if(out.alt && !wrong && out.alt.amount<=m.amount) out.alt = null;
  }
  out.risk = wrong || pct > num(S.settings.riskHigh) ? 'High' : out.exceeded>tol ? 'Medium' : 'Low';
  return out;
}

/* ---------- 4. Sample data ---------- */
function rng(seed){ return ()=>{ seed|=0; seed=seed+0x6D2B79F5|0; let t=Math.imul(seed^seed>>>15,1|seed); t=t+Math.imul(t^t>>>7,61|t)^t; return ((t^t>>>14)>>>0)/4294967296; }; }
function sampleBills(){
  const R = rng(20260921), pick = a=>a[Math.floor(R()*a.length)];
  const names = ['Ramesh Babu','Lakshmi Devi','Srinivas Rao','Anitha Kumari','Mohammed Irfan','Padma Priya','Venkatesh N','Sujatha Reddy','Kiran Kumar','Farzana Begum','Naveen Goud','Swathi M','Prakash Yadav','Kavitha S','Raju Naik','Bhavani P','Anil Varma','Saritha K','Gopal Krishna','Divya Teja','Harish Chandra','Meena Kumari','Suresh Patel','Rukmini Bai','Arjun Rao','Jyothi L','Imran Khan','Vani Sree','Chandra Sekhar','Pooja N'];
  const rad = ['CT Brain','MRI Spine','X-Ray Chest','USG Abdomen','2D Echo'], lab = ['CBC','LFT','RFT','Blood Sugar','Serology','ECG'];
  const depts = Object.keys(DEPTS), out = [];
  for(let i=0;i<30;i++){
    const type = TYPES[i%3];
    const dept = depts[(i*7+Math.floor(R()*3))%depts.length];
    const L = 1 + Math.floor(R()*6);
    const doa = addDays('2026-07-01', Math.floor(R()*80));
    const surgery = dept==='General Medicine' ? 'None' : dept==='Cardiology' ? pick(['Minor','Major']) : (R()<.75?'Major':'Minor');
    const roomType = type==='Aarogyasri' ? 'General Ward' : pick(['General Ward','Semi Private','Special Room','Deluxe Room']);
    const icuDays = ['General Medicine','Cardiology','Neurosurgery'].includes(dept) && L>1 ? Math.floor(R()*Math.min(3,L)) : 0;
    const svc = [pick(rad), pick(lab), pick(lab)].filter((x,j,a)=>a.indexOf(x)===j);
    const IMPL = {Orthopaedics:['Knee Prosthesis (TKR)','Interlocking Nail','Bone Plate & Screws'], Cardiology:['Cardiac Stent (DES)','Pacemaker (Single Chamber)'], 'General Surgery':['Hernia Mesh'], Neurosurgery:[], OBG:[], 'General Medicine':[]};
    const implantName = (surgery!=='None' && (IMPL[dept]||[]).length && R()<0.8) ? pick(IMPL[dept]) : '';
    const admitMode = ['General Medicine','Cardiology'].includes(dept) ? pick(['Emergency','Emergency','Elective / Planned','Referral / Transfer']) : L<=1 ? 'Day Care' : pick(['Elective / Planned','Elective / Planned','Emergency','Referral / Transfer','MLC']);
    const b = {id:'s'+i, implantName, admitMode, type, name:names[i], uhid:'MAMS'+(240100+i*37), dept, doctor:pick(DEPTS[dept]), doa, dod:addDays(doa,L), roomType, icuDays, surgery, services:svc.join(', '), insurer: type==='Insurance'?pick(['Star Health','HDFC Ergo','Care Health','Niva Bupa','Medi Assist TPA','Paramount TPA']):(type==='Aarogyasri'?'Aarogyasri Trust':''), pkgCode:'', insApproved:0, copay:0};
    const E = expectedFor(b);
    Object.assign(b,{roomRent:E.roomRent, icuRent:E.icuRent, ot:E.ot, surgeon:E.surgeon, implant:E.implant||0, radiology:E.radiology, lab:E.lab, consultation:E.consultation, pharmacy: Math.round((1500+R()*22000)/10)*10});
    const m = i%10;
    if(m===1){ if(b.icuDays>0) b.icuRent=0; else b.consultation=0; }
    if(m===2 && E.grade) b.ot += 3500;
    if(m===4 && E.grade && type!=='Aarogyasri'){ b.roomType='Special Room'; const E2=expectedFor(b); b.roomRent=E2.roomRent; b.ot=E2.ot/E2.factor; b.surgeon=E2.surgeon/E2.factor; }
    if(m===5){ const first=svc[0]; b.services += ', '+first; const t=T(first); if(t.category==='Radiology') b.radiology+=t.price; else b.lab+=t.price; }
    if(m===7 && T(b.roomType)) b.roomRent += T(b.roomType).price;
    if((m===6||m===9) && b.implantName) b.implant = Math.round(E.implant*0.7/10)*10;   // implant billed below market price
    b.total = MONEY.reduce((a,k)=>a+num(b[k]),0);
    if(m===8 && type==='Cash') b.total += 1000;
    if(type!=='Cash'){
      const pool = S.packages.filter(p=>p.scheme===type && p.dept===dept);
      const up = pool.filter(x=>x.amount>=b.total).sort((a,c)=>a.amount-c.amount), dn = pool.filter(x=>x.amount<b.total).sort((a,c)=>c.amount-a.amount);
      let p = (m===6 || m===9) ? (dn[0]||up[0]) : (up[0]||dn[0]);
      if(i===11||i===23){ p = S.packages.find(x=>x.scheme===type && x.dept!==dept); }
      b.pkgCode = p ? p.code : '';
      const pa = p ? p.amount : b.total;
      if(type==='Insurance'){ b.insApproved = Math.min(b.total, pa); b.copay = b.total - b.insApproved; if(m===3) b.copay = Math.max(0,b.copay-2000); }
      else { b.insApproved = Math.min(b.total, pa); b.copay = (m===8) ? 500 : 0; }
    }
    MONEY.concat(['total','insApproved','copay']).forEach(k=>b[k]=r2(num(b[k])));
    out.push(b);
  }
  return out;
}

/* ---------- period filtering ---------- */
const billDate = b => validDate(b.dod) ? b.dod : b.doa;
function inPeriod(b){
  const u=S.ui, d=billDate(b);
  if(u.mode==='week' && u.week) return validDate(d) && isoWeek(d)===u.week;
  if(u.mode==='month' && u.month) return validDate(d) && d.slice(0,7)===u.month;
  return true;
}
function periodLabel(){ const u=S.ui; if(u.mode==='week'&&u.week) return 'Week '+u.week; if(u.mode==='month'&&u.month){ const [y,m]=u.month.split('-'); return new Date(Date.UTC(+y,+m-1,1)).toLocaleString('en-IN',{month:'long',year:'numeric',timeZone:'UTC'}); } return 'All bills'; }
function rows(){ return S.bills.filter(inPeriod).map(b=>({b,a:audit(b)})); }

/* ---------- 5. Views ---------- */
function render(){
  $$('#tabs button').forEach(x=>x.classList.toggle('on',x.dataset.t===S.ui.tab));
  $$('#tabs button').forEach(x=>x.classList.toggle('hide', (x.dataset.t==='input' && !canWrite())));
  if (S.ui.tab==='input' && !canWrite()) S.ui.tab='sheet';
  const v = {dash:vDash, input:vInput, sheet:vSheet, pkg:vPkg, tariff:vTariff, settings:vSettings}[S.ui.tab];
  $('#main').innerHTML = v();
  (bind[S.ui.tab]||(()=>{}))();
}

function kpi(c,icon,k,v,s){ return `<div class="kpi" style="--c:${c}"><div class="k"><span class="dot">${icon}</span>${k}</div><div class="v num">${v}</div><div class="s">${s||''}</div></div>`; }

function vDash(){
  const R = rows();
  if(!R.length) return `<div class="card empty"><h2>No bills in ${esc(periodLabel())}</h2><p>Add bills from <b>Bill Input</b> or change the audit period.</p></div>`;
  const by = t => R.filter(r=>r.b.type===t);
  const rev = t => by(t).reduce((a,r)=>a+num(r.b.total),0);
  const total = R.reduce((a,r)=>a+num(r.b.total),0);
  const copay = R.reduce((a,r)=>a+num(r.b.copay),0);
  const leak = R.reduce((a,r)=>a+r.a.leak,0);
  const over = R.reduce((a,r)=>a+r.a.over,0);
  const sc = Object.fromEntries(STATUSES.map(s=>[s,R.filter(r=>r.a.status===s).length]));
  const underB = R.reduce((a,r)=>a+r.a.F.filter(f=>f.bucket==='leak').reduce((x,f)=>x+f.amt,0),0);
  const pkgL = leak-underB;

  // donut
  const C=2*Math.PI*52; let off=0;
  const seg = TYPES.map(t=>{ const f= total? rev(t)/total:0; const s=`<circle r="52" cx="70" cy="70" fill="none" stroke="${TYPE_COLOR[t]}" stroke-width="22" stroke-dasharray="${f*C} ${C}" stroke-dashoffset="${-off}" transform="rotate(-90 70 70)"/>`; off+=f*C; return s; }).join('');

  // dept & doctor summaries
  const group = key => { const m={}; R.forEach(({b,a})=>{ const k=b[key]||'—'; const g=m[k]||(m[k]={k,n:0,rev:0,cash:0,ins:0,as:0,leak:0,over:0,issues:0,copay:0}); g.n++; g.rev+=num(b.total); g.copay+=num(b.copay); g[b.type==='Cash'?'cash':b.type==='Insurance'?'ins':'as']+=num(b.total); g.leak+=a.leak; g.over+=a.over; if(a.status!=='Correct') g.issues++; }); return Object.values(m).sort((x,y)=>y.rev-x.rev); };
  const D = group('dept'), Dr = group('doctor');
  const maxD = Math.max(...D.map(d=>d.rev),1);

  // top issue types
  const it={}; R.forEach(({a})=>a.F.forEach(f=>{ const k=f.text.replace(/\s*(by|of|=)?\s*−?₹[\d,]+(\.\d+)?/g,'').replace(/\(.*?\)/g,'').replace(/".*?"/g,'…').split(/ — |:/)[0].trim(); const g=it[k]||(it[k]={k,st:f.st,n:0,amt:0}); g.n++; g.amt+=f.amt; }));
  const issues = Object.values(it).sort((a,b)=>b.n-a.n).slice(0,8);

  // trend by month
  const tm={}; S.bills.forEach(b=>{ const d=billDate(b); if(!validDate(d)) return; const k=d.slice(0,7); const a=audit(b); const g=tm[k]||(tm[k]={k,Cash:0,Insurance:0,Aarogyasri:0,leak:0}); g[b.type]+=num(b.total); g.leak+=a.leak; });
  const TM = Object.values(tm).sort((a,b)=>a.k.localeCompare(b.k)); const maxT=Math.max(...TM.map(t=>t.Cash+t.Insurance+t.Aarogyasri),1);

  return `
  <div class="kpis">
    ${kpi('#6366f1','#','Total Bills Audited',R.length,`${esc(periodLabel())} · ${inrS(total)} billed`)}
    ${kpi('var(--cash)','₹','Cash Revenue',inrS(rev('Cash')),by('Cash').length+' bills')}
    ${kpi('var(--ins)','🛡','Insurance Revenue',inrS(rev('Insurance')),by('Insurance').length+' bills')}
    ${kpi('var(--as)','✚','Aarogyasri Revenue',inrS(rev('Aarogyasri')),by('Aarogyasri').length+' bills')}
    ${kpi('#0891b2','%','Copayment Total',inrS(copay),'Collected from patients')}
    ${kpi('var(--exc)','!','Revenue Leakage',inrS(leak),`Under-billed ${inrS(underB)} · Package loss ${inrS(pkgL)}`)}
    ${kpi('var(--err)','↑','Excess Billed',inrS(over),'Over-charged vs tariff')}
  </div>
  <div class="two">
    <div class="card">
      <h2>Audit results</h2><p class="sub">AI remark status across ${R.length} bills</p>
      <div class="statgrid">${STATUSES.map(s=>`<div class="s-${s}"><span>${s}</span><strong class="num">${sc[s]}</strong><small>${R.length?Math.round(sc[s]/R.length*100):0}%</small></div>`).join('')}</div>
      <div class="bar" style="margin-top:14px;height:14px">${STATUSES.map(s=>`<i style="width:${sc[s]/R.length*100}%;background:${STATUS_COLOR[s]}" title="${s}: ${sc[s]}"></i>`).join('')}</div>
      <h3 style="margin-top:18px">By bill type</h3>
      ${TYPES.map(t=>{ const x=by(t); const n=x.length||1; return `<div class="hbar"><span><span class="chip t-${t}">${t}</span></span><div class="track">${STATUSES.map(s=>`<i style="width:${x.filter(r=>r.a.status===s).length/n*100}%;background:${STATUS_COLOR[s]}"></i>`).join('')}</div><span class="num" style="text-align:right">${x.length} bills</span></div>`; }).join('')}
      <div class="legend">${STATUSES.map(s=>`<span style="--c:${STATUS_COLOR[s]}">${s}</span>`).join('')}</div>
    </div>
    <div class="card">
      <h2>Revenue mix</h2><p class="sub">Share of billed amount by payer</p>
      <div class="donut">
        <svg width="140" height="140" viewBox="0 0 140 140"><circle r="52" cx="70" cy="70" fill="none" stroke="var(--soft)" stroke-width="22"/>${seg}<text x="70" y="66" text-anchor="middle" font-size="11" fill="var(--mut)">Total</text><text x="70" y="84" text-anchor="middle" font-size="14" font-weight="800" fill="var(--ink)">${inrS(total)}</text></svg>
        <div style="flex:1;min-width:180px">${TYPES.map(t=>`<div class="hbar" style="grid-template-columns:100px 1fr 70px"><span class="chip t-${t}">${t}</span><div class="track"><i style="width:${total?rev(t)/total*100:0}%;background:${TYPE_COLOR[t]}"></i></div><b class="num" style="text-align:right">${total?Math.round(rev(t)/total*100):0}%</b></div>`).join('')}</div>
      </div>
      <h3 style="margin-top:14px">Monthly trend (all data)</h3>
      ${TM.map(t=>`<div class="hbar" style="grid-template-columns:70px 1fr 90px"><span>${t.k}</span><div class="track">${TYPES.map(x=>`<i style="width:${t[x]/maxT*100}%;background:${TYPE_COLOR[x]}"></i>`).join('')}</div><span class="num" style="text-align:right">${inrS(t.Cash+t.Insurance+t.Aarogyasri)}</span></div>`).join('')}
    </div>
  </div>
  <div class="two" style="margin-top:16px">
    <div class="card">
      <h2>Department-wise summary</h2><p class="sub">Revenue split by payer, with leakage</p>
      ${D.map(d=>`<div class="hbar" style="grid-template-columns:130px 1fr 90px"><span>${esc(d.k)}</span><div class="track" style="width:${d.rev/maxD*100}%">${['cash','ins','as'].map((k,j)=>`<i style="width:${d.rev?d[k]/d.rev*100:0}%;background:${TYPE_COLOR[TYPES[j]]}"></i>`).join('')}</div><span class="num" style="text-align:right">${inrS(d.rev)}</span></div>`).join('')}
      <table class="tbl" style="margin-top:10px"><thead><tr><th>Department</th><th class="r">Bills</th><th class="r">Revenue</th><th class="r">Copay</th><th class="r">Leakage</th><th class="r">Excess</th><th class="r">Issues</th></tr></thead>
      <tbody>${D.map(d=>`<tr><td>${esc(d.k)}</td><td class="r num">${d.n}</td><td class="r num">${inr(d.rev)}</td><td class="r num">${inr(d.copay)}</td><td class="r num" style="color:var(--exc)">${inr(d.leak)}</td><td class="r num" style="color:var(--err)">${inr(d.over)}</td><td class="r num">${d.issues}</td></tr>`).join('')}</tbody></table>
    </div>
    <div class="card">
      <h2>Top audit findings</h2><p class="sub">Most frequent issues this period</p>
      <table class="tbl"><thead><tr><th>Finding</th><th>Status</th><th class="r">Count</th><th class="r">Amount</th></tr></thead>
      <tbody>${issues.map(i=>`<tr><td>${esc(i.k)}</td><td><span class="chip s-${i.st}">${i.st}</span></td><td class="r num">${i.n}</td><td class="r num">${i.amt?inr(i.amt):'—'}</td></tr>`).join('')||'<tr><td colspan="4">No issues 🎉</td></tr>'}</tbody></table>
    </div>
  </div>
  <div class="two" style="margin-top:16px">
    <div class="card"><h2>Insurer / TPA / scheme summary</h2><p class="sub">Insurance &amp; Aarogyasri bills by payer</p>
      <table class="tbl"><thead><tr><th>Insurer / TPA</th><th class="r">Bills</th><th class="r">Billed</th><th class="r">Approved</th><th class="r">Copay</th><th class="r">Leakage</th></tr></thead><tbody>
      ${(()=>{ const m={}; R.filter(r=>r.b.type!=='Cash').forEach(({b,a})=>{ const k=b.insurer||'(not recorded)'; const g=m[k]||(m[k]={k,n:0,rev:0,ap:0,cp:0,lk:0}); g.n++; g.rev+=num(b.total); g.ap+=num(b.insApproved); g.cp+=num(b.copay); g.lk+=a.leak; });
        const list=Object.values(m).sort((x,y)=>y.rev-x.rev);
        return list.length?list.map(d=>`<tr data-ins="${esc(d.k)}" style="cursor:pointer"><td>${esc(d.k)}</td><td class="r num">${d.n}</td><td class="r num">${inr(d.rev)}</td><td class="r num">${inr(d.ap)}</td><td class="r num">${inr(d.cp)}</td><td class="r num" style="color:var(--exc)">${inr(d.lk)}</td></tr>`).join('')
          :'<tr><td colspan="6" class="note">No insurance or Aarogyasri bills in this period.</td></tr>'; })()}
      </tbody></table></div>
    <div class="card"><h2>Mode of admission</h2><p class="sub">Bills and revenue by how the patient came in</p>
      ${(()=>{ const m={}; R.forEach(({b,a})=>{ const k=b.admitMode||'(not recorded)'; const g=m[k]||(m[k]={k,n:0,rev:0,lk:0}); g.n++; g.rev+=num(b.total); g.lk+=a.leak; });
        const list=Object.values(m).sort((x,y)=>y.rev-x.rev); const mx=Math.max(...list.map(d=>d.rev),1);
        return list.map(d=>`<div class="hbar" style="grid-template-columns:150px 1fr 95px"><span>${esc(d.k)}</span><div class="track"><i style="width:${d.rev/mx*100}%;background:${/Emerg|MLC/.test(d.k)?'var(--exc)':/Day Care/.test(d.k)?'var(--as)':'var(--ins)'}"></i></div><span class="num" style="text-align:right">${d.n} · ${inrS(d.rev)}</span></div>`).join(''); })()}
      <p class="note" style="margin-top:10px">Emergency and MLC cases are shown in red — these usually need post-admission intimation to the insurer within 24 hours.</p></div>
  </div>
  <div class="card" style="margin-top:16px">
    <h2>Doctor-wise summary</h2><p class="sub">Click a doctor to open their bills in the Audit Sheet</p>
    <table class="tbl"><thead><tr><th>Doctor</th><th class="r">Bills</th><th class="r">Cash</th><th class="r">Insurance</th><th class="r">Aarogyasri</th><th class="r">Total</th><th class="r">Leakage</th><th class="r">Issues</th></tr></thead>
    <tbody>${Dr.map(d=>`<tr style="cursor:pointer" data-doc="${esc(d.k)}"><td><b>${esc(d.k)}</b></td><td class="r num">${d.n}</td><td class="r num">${inr(d.cash)}</td><td class="r num">${inr(d.ins)}</td><td class="r num">${inr(d.as)}</td><td class="r num"><b>${inr(d.rev)}</b></td><td class="r num" style="color:var(--exc)">${inr(d.leak)}</td><td class="r num">${d.issues}/${d.n}</td></tr>`).join('')}</tbody></table>
  </div>`;
}

const COLS = [
  ['sn','S.No','g0'],['name','Patient Name','g0'],['uhid','UHID','g1'],['dept','Department','g1'],['doctor','Doctor','g1'],['doa','DOA','g1'],['dod','DOD','g1'],['los','LOS','g1'],['admitMode','Mode of Admission','g1'],['roomType','Room Type','g1'],
  ['roomRent','Room Rent','g2'],['icuRent','ICU Rent','g2'],['ot','OT Charges','g2'],['surgeon','Surgeon','g2'],['implant','Implant','g2'],['pharmacy','Pharmacy','g2'],['lab','Lab','g2'],['radiology','Radiology','g2'],['consultation','Consultation','g2'],
  ['insurer','Insurer / TPA / Scheme','g3'],['insApproved','Insurance Approved','g3'],['copay','Copayment','g3'],['total','Total Bill','g3'],['remarks','AI Remarks','g4'],['sgTotal','Suggested Bill','g5'],['sgNote','AI Suggestion — implant / package advice','g5']
];
function sheetRows(){
  const u=S.ui, q=u.q.trim().toLowerCase();
  return rows().filter(({b,a})=>(u.type==='All'||b.type===u.type)&&(u.status==='All'||a.status===u.status)&&(!q||[b.name,b.uhid,b.dept,b.doctor,b.pkgCode,b.insurer,b.admitMode,a.remarks].join(' ').toLowerCase().includes(q)))
    .sort((x,y)=>String(billDate(y.b)).localeCompare(String(billDate(x.b))));
}
function vSheet(){
  const R = sheetRows(), u=S.ui;
  const flag = (a,k)=>{ const t=MONEY_LABEL[k]; if(!t) return ''; const f=a.F.find(f=>f.text.toLowerCase().startsWith(t.toLowerCase().replace(' charges','')) || (k==='ot'&&f.text.startsWith('OT'))); return f ? (f.st==='Excess'?'bad':'low') : ''; };
  const tot = k => R.reduce((s,r)=>s+num(r.b[k]),0);
  const groups = [['g0','',2,'#475569'],['g1','Patient Details',8,'#6366f1'],['g2','Billing Details',9,'#0891b2'],['g3','Payer',4,'#0ea371'],['g4','Audit',1,'#db2777'],['g5','AI Suggested Bill',2,'#7c3aed']];
  return `<div class="card">
    <div class="toolbar">
      <div class="seg" id="fType">${['All',...TYPES].map(t=>`<button data-v="${t}" class="${u.type===t?'on':''} ${t==='Cash'?'tc':t==='Insurance'?'ti':t==='Aarogyasri'?'ta':''}">${t}</button>`).join('')}</div>
      <div class="seg" id="fStatus">${['All',...STATUSES].map(t=>`<button data-v="${t}" class="${u.status===t?'on':''}">${t}</button>`).join('')}</div>
      <input class="in" id="fQ" placeholder="Search patient, UHID, doctor, remark…" value="${esc(u.q)}" style="max-width:280px">
      <span style="margin-left:auto" class="note">${R.length} bills · ${esc(periodLabel())}</span>
      ${canWrite()?'<button class="btn g" id="btnAiSg">✨ AI suggested bills</button>':''}<button class="btn" id="btnCsv">CSV</button><button class="btn p" id="btnXl2">⬇ Excel</button>
    </div>
    <div class="sheetwrap"><table class="sheet">
      <thead><tr class="g">${groups.map(g=>`<th colspan="${g[2]}" style="background:${g[3]}" class="${g[0]==='g0'?'sn':''}">${g[1]}</th>`).join('')}</tr>
      <tr class="c">${COLS.map(c=>`<th class="${c[0]==='sn'?'sn':c[0]==='name'?'pn':''}">${c[1]}</th>`).join('')}</tr></thead>
      <tbody>${R.map((r,i)=>{ const {b,a}=r; return `<tr data-id="${b.id}">
        <td class="sn" style="border-left:4px solid ${TYPE_COLOR[b.type]}">${i+1}</td>
        <td class="pn">${esc(b.name)} <span class="chip t-${b.type}" style="margin-left:4px">${b.type==='Aarogyasri'?'AS':b.type==='Insurance'?'INS':'CASH'}</span></td>
        <td>${esc(b.uhid)}</td><td>${esc(b.dept)}</td><td>${esc(b.doctor)}</td><td>${fmtD(b.doa)}</td><td>${fmtD(b.dod)}</td><td class="m">${a.E.L}</td><td>${b.admitMode?`<span class="chip" style="background:${/Emerg|MLC/.test(b.admitMode)?'var(--excS)':'var(--soft)'};color:${/Emerg|MLC/.test(b.admitMode)?'var(--exc)':'var(--mut)'}">${esc(b.admitMode)}</span>`:'<span class="note">—</span>'}</td><td>${esc(b.roomType)}</td>
        ${MONEY.map(k=>`<td class="m ${flag(a,k)}">${inr(num(b[k]))}</td>`).join('')}
        <td>${b.type==='Cash'?'<span class="note">Self pay</span>':esc(b.insurer||'—')}</td><td class="m">${b.type==='Cash'?'—':inr(num(b.insApproved))}</td><td class="m">${inr(num(b.copay))}</td><td class="m"><b>${inr(num(b.total))}</b></td>
        <td class="rem"><span class="chip s-${a.status}">${a.status==='Correct'?'✔':a.status==='Missing'?'◔':a.status==='Excess'?'▲':'✖'} ${a.status}</span> ${esc(a.remarks)}</td>
        <td class="m"><b>${inr(b.ai?.total||a.sg.amount)}</b>${sgDelta(b,a)}</td>
        <td class="rem">${sgNote(b,a)}</td></tr>`; }).join('') || `<tr><td colspan="26" class="empty">No bills match these filters.</td></tr>`}</tbody>
      <tfoot><tr><td class="sn"></td><td class="pn">TOTAL (${R.length})</td><td colspan="8"></td>${MONEY.map(k=>`<td class="m">${inr(tot(k))}</td>`).join('')}<td></td><td class="m">${inr(tot('insApproved'))}</td><td class="m">${inr(tot('copay'))}</td><td class="m">${inr(tot('total'))}</td><td>Leakage ${inr(R.reduce((s,r)=>s+r.a.leak,0))}</td><td class="m">${inr(R.reduce((s,r)=>s+(r.b.ai?.total||r.a.sg.amount),0))}</td><td></td></tr></tfoot>
    </table></div>
    <p class="note" style="margin-top:8px">Cells outlined <span style="color:var(--exc)">red</span> are over tariff; <span style="color:var(--miss)">amber</span> are short / missing. Click any row for the full audit.</p>
  </div>`;
}

function sgDelta(b,a){
  const amt = b.ai?.total || a.sg.amount, d = r2(amt - num(b.total));
  if(Math.abs(d)<=1) return '<br><span class="chip s-Correct">as billed</span>';
  return `<br><span class="chip ${d>0?'s-Missing':'s-Excess'}">${d>0?'+':''}${inr(d)}</span>`;
}
function sgNote(b,a){
  const ai = b.ai?.remark ? `<span class="chip" style="background:var(--priS);color:var(--pri)">ChatGPT</span> ${esc(b.ai.remark)}<br>` : '';
  return ai + `<span class="note">${esc(a.sg.notes.join(' · ')||'No change suggested')}</span>`;
}
/* Ask ChatGPT for a suggested bill per patient (implant market price + package advice) */
async function aiSuggestBills(list, status=()=>{}){
  const tariff = S.tariff.map(t=>`${t.service}|${t.category}|${t.price}`).join('; ');
  let done=0;
  for(let i=0;i<list.length;i+=4){
    const batch = list.slice(i,i+4);
    status(`✨ ChatGPT is pricing bills ${i+1}–${Math.min(i+4,list.length)} of ${list.length}…`);
    const payload = batch.map(({b,a})=>({id:b.id, bill:{type:b.type,dept:b.dept,doctor:b.doctor,doa:b.doa,dod:b.dod,los:a.E.L,roomType:b.roomType,icuDays:b.icuDays,surgery:b.surgery,implantName:b.implantName,implant:num(b.implant),roomRent:num(b.roomRent),icuRent:num(b.icuRent),ot:num(b.ot),surgeon:num(b.surgeon),pharmacy:num(b.pharmacy),lab:num(b.lab),radiology:num(b.radiology),consultation:num(b.consultation),total:num(b.total),insApproved:num(b.insApproved),copay:num(b.copay),pkgCode:b.pkgCode},
      package: a.pkg?.master||null, alternatePackage: a.pkg?.alt||null, ruleFindings:a.F.map(f=>f.text), ruleSuggestedTotal:a.sg.amount}));
    try{
      const d = await ai([{text:`You are a senior hospital billing auditor in India (cash, insurance/TPA and Aarogyasri).
For EACH bill decide the correct amount the hospital should have billed.
Check especially: (1) implants and high-value consumables billed BELOW the usual Indian market/MRP band for that item — say the fair price and the shortfall; (2) whether a package applies, whether the bill fits inside it, and which package or pre-auth enhancement to use when it does not; (3) charges that are missing altogether (nursing, consumables, monitoring, investigations).
Hospital cash tariff (service|category|price): ${tariff}
Return ONLY JSON: {"suggestions":[{"id":"<id>","suggestedTotal":<number>,"remark":"<max 220 chars, plain English, rupee amounts>"}]}
BILLS: ${JSON.stringify(payload)}`}]);
      (d.suggestions||[]).forEach(x=>{ const b=S.bills.find(y=>y.id===x.id); if(b){ b.ai={total:r2(num(x.suggestedTotal)), remark:String(x.remark||'').slice(0,300), at:new Date().toISOString().slice(0,10), model:S.settings.model}; done++; } });
      save();
    }catch(e){ throw new Error(`Stopped after ${done} bills — ${e.message}`); }
  }
  return done;
}

function vPkg(){
  const R = rows().filter(r=>r.b.type!=='Cash');
  const sum = k => R.reduce((s,r)=>s+(r.a.pkg?.[k]||0),0);
  const risk = x => R.filter(r=>r.a.pkg?.risk===x).length;
  return `<div class="kpis">
    ${kpi('var(--ins)','#','Package bills',R.length,'Insurance + Aarogyasri')}
    ${kpi('#0891b2','₹','Package value',inrS(sum('amount')),'As per package master')}
    ${kpi('#6366f1','Σ','Hospital bill',inrS(R.reduce((s,r)=>s+num(r.b.total),0)),'Actual charges')}
    ${kpi('var(--exc)','▲','Exceeded',inrS(sum('exceeded')),'Not claimable')}
    ${kpi('var(--exc)','H','High risk',risk('High'),`Medium ${risk('Medium')} · Low ${risk('Low')}`)}
  </div>
  <div class="card"><h2>Insurance / Aarogyasri package audit</h2><p class="sub">Package amount vs hospital bill, with suggested alternate package and approval risk</p>
  <div style="overflow:auto"><table class="tbl"><thead><tr><th>Patient</th><th>Type</th><th>Insurer / TPA</th><th>Dept</th><th>Package</th><th class="r">Package Amount</th><th class="r">Hospital Bill</th><th class="r">Exceeded</th><th>Alternate Package</th><th>Approval Risk</th><th>Remark</th></tr></thead>
  <tbody>${R.sort((a,b)=>(b.a.pkg?.exceeded||0)-(a.a.pkg?.exceeded||0)).map(({b,a})=>{ const p=a.pkg; return `<tr data-id="${b.id}" style="cursor:pointer"><td><b>${esc(b.name)}</b><br><span class="note">${esc(b.uhid)}</span></td><td><span class="chip t-${b.type}">${b.type}</span><br><span class="note">${esc(b.admitMode||'')}</span></td><td>${esc(b.insurer||'—')}</td><td>${esc(b.dept)}</td>
    <td>${esc(p.code||'—')}<br><span class="note">${esc(p.name||'')}</span></td><td class="r num">${p.amount?inr(p.amount):'—'}</td><td class="r num">${inr(p.bill)}</td>
    <td class="r num" style="color:${p.exceeded?'var(--exc)':'var(--ok)'}"><b>${p.exceeded?inr(p.exceeded):'₹0'}</b>${p.exceeded?`<br><span class="note">${p.pct.toFixed(1)}%</span>`:''}</td>
    <td>${p.alt?`<b>${esc(p.alt.code)}</b><br><span class="note">${esc(p.alt.name)} · ${inr(p.alt.amount)}</span>`:'<span class="note">—</span>'}</td>
    <td><span class="chip r-${p.risk}">${p.risk}</span></td><td style="max-width:260px">${esc(p.error|| (p.exceeded?`Hospital bill exceeds package by ${inr(p.exceeded)} — not claimable`:'Within package'))}</td></tr>`; }).join('') || '<tr><td colspan="11" class="empty">No insurance or Aarogyasri bills in this period.</td></tr>'}</tbody></table></div></div>
  ${pkgMasterCard()}`;
}
function pkgMasterCard(){
  if(!isAdmin()) return `<div class="card" style="margin-top:16px"><h2>Package master</h2><div style="overflow:auto"><table class="tbl"><thead><tr><th>Code</th><th>Package</th><th>Department</th><th>Scheme</th><th class="r">Amount</th></tr></thead><tbody>${S.packages.map(p=>`<tr><td>${esc(p.code)}</td><td>${esc(p.name)}</td><td>${esc(p.dept)}</td><td>${esc(p.scheme)}</td><td class="r num">${inr(p.amount)}</td></tr>`).join('')}</tbody></table></div></div>`;
  return `<div class="card" style="margin-top:16px"><h2>Package master</h2><p class="sub">Sample packages — replace with your Aarogyasri / insurer package list. Codes are matched exactly.</p>
  <div style="overflow:auto"><table class="tbl" id="pkgTbl"><thead><tr><th>Code</th><th>Package name</th><th>Department</th><th>Scheme</th><th class="r">Amount (₹)</th><th></th></tr></thead><tbody>
  ${S.packages.map((p,i)=>`<tr data-i="${i}"><td><input class="in" data-k="code" value="${esc(p.code)}"></td><td><input class="in" data-k="name" value="${esc(p.name)}"></td><td><input class="in" data-k="dept" value="${esc(p.dept)}" list="dl-dept"></td><td><select class="in" data-k="scheme">${['Aarogyasri','Insurance'].map(s=>`<option ${p.scheme===s?'selected':''}>${s}</option>`).join('')}</select></td><td><input class="in num" data-k="amount" type="number" value="${p.amount}" style="text-align:right"></td><td><button class="btn d" data-del="${i}">✕</button></td></tr>`).join('')}
  </tbody></table></div><datalist id="dl-dept">${deptList().map(d=>`<option value="${esc(d)}">`).join('')}</datalist>
  <div class="toolbar" style="margin-top:10px"><button class="btn p" id="pkgAdd">+ Add package</button></div></div>`;
}

const TARIFF_CATS = ['Room','ICU','OT','Surgeon','Implant','Consultation','Radiology','Lab','Other'];
const TARIFF_PROMPT = `You are setting up the CASH TARIFF MASTER of an Indian hospital.
Convert the input into JSON: {"tariff":[{"service":"","category":"","price":0,"premium":false}]}
Rules:
- category is exactly one of: ${'${CATS}'}.
- Use these canonical names when an item means the same thing: "ICU / day", "OT Major", "OT Minor", "Surgeon Major", "Surgeon Minor", "Consultation / day".
- Room rows: keep the hospital's own room names (General Ward, Semi Private, Special Room, Deluxe Room, Suite...), category "Room", price per day, premium=true for special / deluxe / suite / VIP / private rooms and false for general or semi-private.
- Implants, stents, prostheses, meshes, lenses and other high-value consumables → category "Implant".
- Scans, X-ray, USG, CT, MRI, echo → "Radiology". Blood and pathology tests → "Lab".
- price = plain number of rupees, no symbols, no ranges (take the usual/base price).
- Ignore headings, page numbers, totals and duplicates. Keep every real priced item.
Return ONLY the JSON object.`;
async function aiTariff(parts, status=()=>{}){
  status('✨ ChatGPT is arranging the tariff…');
  const d = await ai([{text:TARIFF_PROMPT.replace('${CATS}',TARIFF_CATS.join(', '))}, ...parts]);
  const list = (Array.isArray(d)?d:(d.tariff||d.items||[]));
  return list.map(x=>({service:String(x.service||'').trim(), category:TARIFF_CATS.includes(x.category)?x.category:'Other', price:r2(num(x.price)), premium:!!x.premium}))
             .filter(x=>x.service);
}
function applyTariffDraft(mode){
  const d=S.ui.tDraft; if(!d.length) return;
  if(mode==='replace') S.tariff=[];
  let added=0, updated=0;
  d.forEach(row=>{ const ex=T(row.service); if(ex){ Object.assign(ex,row); updated++; } else { S.tariff.push({...row}); added++; } });
  S.ui.tDraft=[]; save(); render(); toast(`${added} services added, ${updated} updated`);
}
function tariffDraftCard(){
  const d=S.ui.tDraft; if(!d.length) return '';
  const byCat={}; d.forEach(r=>(byCat[r.category]=byCat[r.category]||[]).push(r));
  return `<div class="card" style="margin-top:16px;border-color:var(--pri)"><h2>AI arranged ${d.length} services</h2><p class="sub">Check them, then add to your tariff master. Categories and names were set by ChatGPT.</p>
  ${Object.entries(byCat).map(([c,rowsx])=>`<h3 style="margin-top:12px">${c} <span class="note">(${rowsx.length})</span></h3>
    <div style="overflow:auto"><table class="tbl"><thead><tr><th>Service</th><th class="r">Price (₹)</th><th>Premium</th></tr></thead><tbody>
    ${rowsx.map(r=>`<tr><td>${esc(r.service)}</td><td class="r num">${inr(r.price)}</td><td>${r.category==='Room'?(r.premium?'<span class="chip s-Excess">+'+S.settings.uplift+'%</span>':'<span class="note">no</span>'):'<span class="note">—</span>'}</td></tr>`).join('')}
    </tbody></table></div>`).join('')}
  <div class="toolbar" style="margin-top:12px"><button class="btn p" id="tMerge">✔ Add / update in tariff</button><button class="btn" id="tReplace">Replace whole tariff</button><button class="btn d" id="tDiscard">Discard</button></div></div>`;
}

function vTariff(){
  const cats = TARIFF_CATS;
  if(!isAdmin()) return `<div class="card"><h2>Cash tariff master</h2><p class="sub">Only an administrator can change the tariff. These are the prices every bill is checked against.</p>
    <div style="overflow:auto"><table class="tbl"><thead><tr><th>Service</th><th>Category</th><th class="r">Cash Price (₹)</th><th>Premium room</th></tr></thead><tbody>
    ${S.tariff.map(t=>`<tr><td>${esc(t.service)}</td><td>${esc(t.category)}</td><td class="r num">${inr(t.price)}</td><td>${t.category==='Room'?(t.premium?'+'+S.settings.uplift+'%':'—'):'—'}</td></tr>`).join('')}</tbody></table></div></div>`;
  return `<div class="card"><h2>Cash tariff master</h2><p class="sub">Department-wise cash prices. Every bill is compared with this tariff. Mark premium rooms — OT &amp; surgeon charges rise by <b>${S.settings.uplift}%</b> for them (Special Room Rule).</p>
  <div class="toolbar"><input class="in" id="tq" placeholder="Filter services…" style="max-width:240px"><button class="btn p" id="tAdd">+ Add service</button><button class="btn" id="tImp">Import Excel (exact columns)</button><input type="file" id="tFile" accept=".xlsx,.xls,.csv" class="hide"><span class="note">Service, Category, Price, Premium</span></div>
  <div style="overflow:auto"><table class="tbl" id="tTbl"><thead><tr><th>Service</th><th>Category</th><th class="r">Cash Price (₹)</th><th>Premium room</th><th></th></tr></thead><tbody>
  ${S.tariff.map((t,i)=>`<tr data-i="${i}"><td><input class="in" data-k="service" value="${esc(t.service)}"></td><td><select class="in" data-k="category">${cats.map(c=>`<option ${t.category===c?'selected':''}>${c}</option>`).join('')}</select></td><td><input class="in num" type="number" data-k="price" value="${t.price}" style="text-align:right"></td><td>${t.category==='Room'?`<label><input type="checkbox" data-k="premium" ${t.premium?'checked':''}> +${S.settings.uplift}% OT/Surgeon</label>`:'<span class="note">—</span>'}</td><td><button class="btn d" data-del="${i}">✕</button></td></tr>`).join('')}
  </tbody></table></div>
  <p class="note" style="margin-bottom:0">Rules use these exact names: room types (category Room), <b>ICU / day</b>, <b>OT Major</b>, <b>OT Minor</b>, <b>Surgeon Major</b>, <b>Surgeon Minor</b>, <b>Consultation / day</b>. Radiology and Lab items are matched against the services listed on each bill.</p></div>

  <div class="two" style="margin-top:16px">
    <div class="card"><h2>🎤 Speak your tariff</h2><p class="sub">Tap the mic and read out the prices — for example "ICU eight thousand per day, special room three thousand five hundred, OT major eighteen thousand". ChatGPT sorts them into the right categories.</p>
      <div class="toolbar"><button class="btn g" id="micBtn">🎤 Start speaking</button><button class="btn" id="micClear">Clear</button><span class="note" id="micNote"></span></div>
      <textarea class="in" id="speechBox" rows="6" placeholder="Speech appears here — you can also type or paste a price list">${esc(S.ui.tSpeech)}</textarea>
      <div class="toolbar" style="margin-top:8px"><button class="btn p" id="tAiText">✨ Arrange with AI</button></div>
      <div id="tAiStat" class="note"></div>
    </div>
    <div class="card"><h2>📥 Bulk import — AI arranged</h2><p class="sub">Drop the whole hospital tariff: Excel, CSV, PDF or a photo of the rate list. ChatGPT reads it, names each item properly and puts it in the right category.</p>
      <div class="drop" id="tDrop"><b>Drop tariff file(s)</b><br><span class="note">.xlsx · .csv · .pdf · image — any layout</span></div>
      <input type="file" id="tAiFile" accept=".xlsx,.xls,.csv,.pdf,image/*" multiple class="hide">
      <div id="tDropStat" class="note" style="margin-top:8px"></div>
      <p class="note">Large price lists are sent in batches of 120 rows, so a 1,000-line tariff takes a few minutes.</p>
    </div>
  </div>
  ${tariffDraftCard()}`;
}

function vSettings(){
  const st=S.settings, me=S.me||{};
  return `<div class="two"><div class="card"><h2>ChatGPT (OpenAI) connection</h2><p class="sub">The API key lives on the server (environment variable <b>OPENAI_API_KEY</b>) — it is never sent to the browser.</p>
    <p>${S.aiReady?'<span class="chip s-Correct">Server key configured</span>':'<span class="chip s-Error">No key on the server</span> <span class="note">set OPENAI_API_KEY and restart</span>'}</p>
    <div class="form" style="grid-template-columns:1fr 1fr">
      <div class="f"><label>Model</label><input class="in" id="sModel" value="${esc(st.model||'')}" list="dl-models" ${isAdmin()?'':'disabled'}><datalist id="dl-models"><option value="gpt-5-mini"><option value="gpt-5"><option value="gpt-4.1-mini"><option value="gpt-4o-mini"><option value="gpt-4o"></datalist></div>
      <div class="f" style="justify-content:flex-end">${isAdmin()?'<button class="btn g" id="sTest">Test connection</button>':''}</div>
    </div><div id="sOut" class="note" style="margin-top:8px"></div>
    <h3 style="margin-top:18px">Audit rules</h3>
    <div class="form" style="grid-template-columns:1fr 1fr">
      <div class="f"><label>Hospital name</label><input class="in" id="sHosp" value="${esc(st.hospitalName||'')}" ${isAdmin()?'':'disabled'}></div>
      <div class="f"><label>Special room uplift on OT &amp; Surgeon (%)</label><input class="in" id="sUp" type="number" value="${st.uplift}" ${isAdmin()?'':'disabled'}></div>
      <div class="f"><label>Rounding tolerance (₹)</label><input class="in" id="sTol" type="number" value="${st.tolerance}" ${isAdmin()?'':'disabled'}></div>
      <div class="f"><label>High approval risk above (% over package)</label><input class="in" id="sRisk" type="number" value="${st.riskHigh}" ${isAdmin()?'':'disabled'}></div>
    </div>
    ${isAdmin()?'':'<p class="note">Only an administrator can change these.</p>'}
    <h3 style="margin-top:18px">Your account</h3>
    <p class="note">${esc(me.name||'')} · ${esc(me.email||'')} · <span class="chip" style="background:var(--priS);color:var(--pri)">${esc(me.role||'')}</span></p>
    <div class="form" style="grid-template-columns:1fr 1fr 1fr">
      <div class="f"><label>Current password</label><input class="in" id="pwOld" type="password"></div>
      <div class="f"><label>New password (min 8)</label><input class="in" id="pwNew" type="password"></div>
      <div class="f" style="justify-content:flex-end"><button class="btn p" id="pwBtn">Change password</button></div>
    </div><div id="pwOut" class="note"></div>
  </div>
  <div class="card"><h2>Data</h2><p class="sub">${S.bills.length} bills on the server · shared by everyone who signs in</p>
    <div class="toolbar">
      ${canWrite()?'<button class="btn" id="dSample">Load sample bills</button>':''}
      ${isAdmin()?'<button class="btn d" id="dClear">Clear all bills</button><button class="btn" id="dReset">Reset tariff &amp; packages</button>':''}
      <button class="btn" id="dBackup">Backup JSON</button>
      ${isAdmin()?'<button class="btn" id="dRestore">Restore JSON</button><input type="file" id="dFile" accept=".json" class="hide">':''}
    </div>
    ${isAdmin()?`<h3 style="margin-top:16px">Users</h3>
    <table class="tbl"><thead><tr><th>Name</th><th>Email</th><th>Role</th><th></th></tr></thead><tbody>
    ${S.users.map(u=>`<tr><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><span class="chip" style="background:var(--priS);color:var(--pri)">${esc(u.role)}</span></td><td>${u.id===me.id?'<span class="note">you</span>':`<button class="btn d" data-udel="${esc(u.id)}">✕</button>`}</td></tr>`).join('')}
    </tbody></table>
    <h3 style="margin-top:14px">Add user</h3>
    <div class="form" style="grid-template-columns:1fr 1fr 1fr 1fr">
      <div class="f"><label>Name</label><input class="in" id="uName"></div>
      <div class="f"><label>Email</label><input class="in" id="uMail" type="email"></div>
      <div class="f"><label>Password (min 8)</label><input class="in" id="uPass" type="password"></div>
      <div class="f"><label>Role</label><select class="in" id="uRole"><option value="auditor">auditor — add &amp; audit bills</option><option value="admin">admin — everything</option><option value="viewer">viewer — read only</option></select></div>
    </div>
    <div class="toolbar" style="margin-top:8px"><button class="btn p" id="uAdd">+ Add user</button><span class="note" id="uOut"></span></div>`:''}
  </div></div>`;
}

/* ---------- 6. Bill input & AI ---------- */
const FIELDS = [
  ['Patient Details','lg1',[['type','Bill Type','select',TYPES],['name','Patient Name','text'],['uhid','UHID','text'],['dept','Department','dept'],['doctor','Consultant / Doctor','text']]],
  ['Stay','lg2',[['admitMode','Mode of Admission','select',MODES],['doa','Admission Date (DOA)','date'],['dod','Discharge Date (DOD)','date'],['los','Length of Stay','los'],['roomType','Room Type','room'],['icuDays','ICU Days','number'],['surgery','Surgery Grade','select',['None','Minor','Major']],['services','Investigations / services billed (comma separated)','wide']]],
  ['Billing Details','lg3',[['roomRent','Room Rent','money'],['icuRent','ICU Rent','money'],['ot','OT Charges','money'],['surgeon','Surgeon Charges','money'],['implantName','Implant / consumable used','implant'],['implant','Implant Charges','money'],['pharmacy','Pharmacy','money'],['lab','Lab','money'],['radiology','Radiology','money'],['consultation','Consultation','money']]],
  ['Payer & Package','lg4',[['insurer','Insurer / TPA / Scheme','insurer'],['pkgCode','Package Code','pkg'],['insApproved','Insurance / Trust Approved','money'],['copay','Copayment','money'],['total','Total Bill','total']]]
];
function fieldHtml([k,l,t,opt],b){
  const v = b[k] ?? '';
  let inp;
  if(t==='select') inp = `<select class="in" name="${k}">${opt.map(o=>`<option ${v===o?'selected':''}>${o}</option>`).join('')}</select>`;
  else if(t==='dept') inp = `<input class="in" name="${k}" value="${esc(v)}" list="dl-dept2">`;
  else if(t==='room') inp = `<select class="in" name="${k}"><option value="">—</option>${rooms().map(r=>`<option ${v===r.service?'selected':''}>${esc(r.service)}</option>`).join('')}</select>`;
  else if(t==='insurer') inp = `<input class="in" name="${k}" value="${esc(v)}" list="dl-insurer" placeholder="e.g. Star Health / Medi Assist TPA">`;
  else if(t==='implant') inp = `<input class="in" name="${k}" value="${esc(v)}" list="dl-implant" placeholder="e.g. Cardiac Stent (DES)">`;
  else if(t==='pkg') inp = `<input class="in" name="${k}" value="${esc(v)}" list="dl-pkg" placeholder="e.g. AS-GS-01">`;
  else if(t==='los') inp = `<div class="in num" id="losOut" style="background:var(--soft)">—</div>`;
  else if(t==='wide') inp = `<input class="in" name="${k}" value="${esc(v)}" list="dl-svc" placeholder="CT Brain, CBC, LFT">`;
  else if(t==='total') inp = `<div style="display:flex;gap:6px"><input class="in num" name="${k}" type="number" step="0.01" value="${esc(v)}"><button type="button" class="btn" id="autoSum" title="Sum of billing details">Σ</button></div>`;
  else inp = `<input class="in ${t==='money'||t==='number'?'num':''}" name="${k}" type="${t==='money'||t==='number'?'number':t}" ${t==='money'?'step="0.01"':''} value="${esc(v)}">`;
  return `<div class="f ${t==='wide'?'w4':''}"><label>${l}</label>${inp}</div>`;
}
function vInput(){
  const u=S.ui, b = u.editId ? (S.bills.find(x=>x.id===u.editId)||{}) : (u.draft||{type:'Cash',surgery:'None'});
  const hasKey = !!S.settings.apiKey;
  return `<div class="toolbar">
    <div class="seg" id="inMode"><button data-v="single" class="${u.inputMode==='single'?'on':''}">Single Bill Audit</button><button data-v="bulk" class="${u.inputMode==='bulk'?'on':''}">Bulk Bills Upload</button></div>
    <button class="btn" data-q="week">📅 Audit this week</button><button class="btn" data-q="month">🗓 Audit this month</button>
    ${hasKey?'<span class="chip s-Correct">ChatGPT connected</span>':'<span class="chip s-Missing">Add OpenAI key in Settings for AI extraction</span>'}
  </div>
  ${u.inputMode==='single' ? `
  <div class="two" style="grid-template-columns:2fr 1fr">
    <div class="card"><h2>${u.editId?'Edit bill':'Single bill audit'}</h2><p class="sub">Type or let AI extract the bill, then Save &amp; Audit</p>
      <form id="billForm">${FIELDS.map(([t,c,fs])=>`<fieldset><legend class="${c}">${t}</legend><div class="form">${fs.map(f=>fieldHtml(f,b)).join('')}</div></fieldset>`).join('')}
      <datalist id="dl-dept2">${deptList().map(d=>`<option value="${esc(d)}">`).join('')}</datalist>
      <datalist id="dl-pkg">${S.packages.map(p=>`<option value="${esc(p.code)}">${esc(p.name)} · ${p.scheme} · ${inr(p.amount)}</option>`).join('')}</datalist>
      <datalist id="dl-insurer">${[...new Set([...INSURERS,...S.bills.map(x=>x.insurer).filter(Boolean)])].map(x=>`<option value="${esc(x)}">`).join('')}</datalist>
      <datalist id="dl-implant">${S.tariff.filter(t=>t.category==='Implant').map(t=>`<option value="${esc(t.service)}">${inr(t.price)}</option>`).join('')}</datalist>
      <datalist id="dl-svc">${S.tariff.filter(t=>t.category==='Radiology'||t.category==='Lab').map(t=>`<option value="${esc(t.service)}">`).join('')}</datalist>
      <div class="toolbar"><button class="btn p" type="submit">✔ Save &amp; Audit</button><button class="btn" type="button" id="preview">Preview audit</button><button class="btn" type="button" id="resetForm">Clear</button>${u.editId?'<button class="btn" type="button" id="cancelEdit">Cancel edit</button>':''}</div>
      </form>
      <div id="livePrev"></div>
    </div>
    <div class="card"><h2>AI Data Extraction</h2><p class="sub">ChatGPT reads a bill PDF / photo and fills the form</p>
      <div class="drop" id="drop1"><b>Drop bill PDF / image</b><br><span class="note">or click to choose · PDF, JPG, PNG</span></div>
      <input type="file" id="file1" accept=".pdf,image/*" class="hide">
      <p class="note" style="margin:12px 0 6px">…or paste bill text:</p>
      <textarea class="in" id="paste1" rows="6" placeholder="Paste the bill summary here"></textarea>
      <div class="toolbar" style="margin-top:8px"><button class="btn g" id="aiText">✨ Extract with AI</button></div>
      <div id="aiStat" class="note"></div>
      <h3 style="margin-top:14px">AI extracts</h3>
      <table class="tbl"><thead><tr><th>Patient details</th><th>Billing details</th></tr></thead><tbody>
      ${[['Patient Name','Total Bill'],['UHID','OT Charges'],['Department','Surgeon Charges'],['Consultant','Room Rent'],['Admission Date','ICU Rent'],['Discharge Date','Pharmacy'],['Length of Stay','Investigations']].map(r=>`<tr><td>${r[0]}</td><td>${r[1]}</td></tr>`).join('')}</tbody></table>
    </div>
  </div>` : `
  <div class="two" style="grid-template-columns:1fr 1fr">
    <div class="card"><h2>Bulk upload — Excel / CSV</h2><p class="sub">One row per bill. Columns are matched by name (Patient Name, UHID, DOA, DOD, Room Rent, …).</p>
      <div class="toolbar"><label class="note">Default bill type</label><select class="in" id="bulkType" style="max-width:160px">${TYPES.map(t=>`<option>${t}</option>`).join('')}</select><button class="btn" id="tmpl">⬇ Download template</button></div>
      <div class="drop" id="dropX"><b>Drop Excel / CSV</b><br><span class="note">.xlsx · .xls · .csv</span></div><input type="file" id="fileX" accept=".xlsx,.xls,.csv" class="hide">
    </div>
    <div class="card"><h2>Bulk upload — PDF bills (AI)</h2><p class="sub">Select many bill PDFs / images. ChatGPT extracts each one.</p>
      <div class="drop" id="dropP"><b>Drop multiple PDFs / images</b><br><span class="note">Each file may contain one or more bills</span></div><input type="file" id="fileP" accept=".pdf,image/*" multiple class="hide">
      <div id="bulkStat" class="note" style="margin-top:8px"></div>
    </div>
  </div>
  <div class="card" style="margin-top:16px"><h2>Preview (${u.bulk.length})</h2><p class="sub">Check the extracted rows, then import. Audit runs automatically.</p>
    ${u.bulk.length?`<div style="overflow:auto"><table class="tbl"><thead><tr><th>#</th><th>Type</th><th>Patient</th><th>UHID</th><th>Dept</th><th>DOA</th><th>DOD</th><th class="r">Total</th><th>Audit preview</th></tr></thead><tbody>
    ${u.bulk.map((b,i)=>{ const a=audit(b); return `<tr><td>${i+1}</td><td><span class="chip t-${b.type}">${b.type}</span></td><td>${esc(b.name)}</td><td>${esc(b.uhid)}</td><td>${esc(b.dept)}</td><td>${fmtD(b.doa)}</td><td>${fmtD(b.dod)}</td><td class="r num">${inr(b.total)}</td><td><span class="chip s-${a.status}">${a.status}</span> <span class="note">${esc(a.remarks.slice(0,90))}${a.remarks.length>90?'…':''}</span></td></tr>`; }).join('')}</tbody></table></div>
    <div class="toolbar" style="margin-top:10px"><button class="btn p" id="bulkImp">✔ Import ${u.bulk.length} bills</button><button class="btn" id="bulkClr">Discard</button></div>`:'<div class="empty">Nothing uploaded yet.</div>'}
  </div>`}`;
}

function readForm(){
  const f=$('#billForm'), b={};
  FIELDS.forEach(([, ,fs])=>fs.forEach(([k,,t])=>{ if(t==='los') return; const el=f.elements[k]; if(!el) return; b[k] = (t==='money'||t==='number'||t==='total') ? r2(num(el.value)) : el.value.trim(); }));
  return b;
}
function fillForm(b){
  const f=$('#billForm'); if(!f) return;
  Object.entries(b).forEach(([k,v])=>{ const el=f.elements[k]; if(el && v!==undefined && v!==null && v!==''){ if(el.tagName==='SELECT' && ![...el.options].some(o=>o.value===String(v))){ const o=document.createElement('option'); o.textContent=v; el.appendChild(o);} el.value=v; } });
  updLos();
}
function updLos(){ const f=$('#billForm'); if(!f) return; const L=losDays(f.elements.doa.value,f.elements.dod.value); $('#losOut').textContent = L>0? L+' day(s)' : L<0 ? 'DOD before DOA!' : '—'; }
function auditCard(b){
  const a = audit(b);
  return `<div class="card" style="margin-top:14px;border-color:${STATUS_COLOR[a.status]}"><h3>Audit preview · <span class="chip s-${a.status}">${a.status}</span></h3>${findingsHtml(a)}</div>`;
}
function findingsHtml(a){ return a.F.length ? a.F.map(f=>`<div class="find ${f.st}"><b style="color:${STATUS_COLOR[f.st]}">${f.st}</b><span>${esc(f.text)}</span>${f.amt?`<span class="num" style="margin-left:auto;font-weight:700">${inr(f.amt)}</span>`:''}</div>`).join('') : `<div class="find Correct"><b style="color:var(--ok)">Correct</b><span>All charges valid</span></div>`; }

/* ChatGPT — the request goes to our server, which holds the OpenAI key */
const EXTRACT_PROMPT = `You are a hospital billing data extractor for an Indian hospital.
Read the bill(s) and return ONLY a JSON object: {"bills":[{...}]} — one object per patient bill.
Keys (use "" or 0 when absent, amounts as plain numbers in rupees, dates as YYYY-MM-DD):
type ("Cash" | "Insurance" | "Aarogyasri"), name, uhid, dept, doctor, doa, dod,
roomType (one of: ${'${ROOMS}'}), admitMode ("Elective / Planned" | "Emergency" | "Day Care" | "Referral / Transfer" | "MLC"), icuDays, surgery ("None" | "Minor" | "Major"),
services (comma separated names of investigations billed, matching: ${'${SVCS}'}),
roomRent, icuRent, ot, surgeon, implantName (implant or consumable used), implant (its amount), pharmacy, lab, radiology, consultation,
insurer (insurance company / TPA / scheme name), pkgCode, insApproved, copay, total.
Rules: roomRent excludes ICU; lab = laboratory total; radiology = imaging total; do not invent values.`;
let aiStatus = () => {};        // set by the screen that started the AI call
async function ai(parts, json = true){
  if (!S.aiReady) throw new Error('The server has no OpenAI key set (OPENAI_API_KEY) — ask your administrator.');
  aiStatus('✨ ChatGPT is working…');
  const out = await apiFetch('/api/ai', {method:'POST', body:JSON.stringify({parts, json})});
  if (out.model && out.model !== S.settings.model) toast('Model used: ' + out.model);
  const txt = out.text || '';
  if (!json) return txt;
  const clean = txt.replace(/^\s*```(json)?/i,'').replace(/```\s*$/,'').trim();
  try { return JSON.parse(clean); }
  catch(e){ const m = clean.match(/\{[\s\S]*\}|\[[\s\S]*\]/); if (m) return JSON.parse(m[0]); throw new Error('AI returned unreadable data — try again'); }
}

const fileB64 = f => new Promise((ok,no)=>{ const r=new FileReader(); r.onload=()=>ok(String(r.result).split(',')[1]); r.onerror=no; r.readAsDataURL(f); });
function promptText(){ return EXTRACT_PROMPT.replace('${ROOMS}',rooms().map(r=>r.service).join(', ')).replace('${SVCS}',S.tariff.filter(t=>t.category==='Radiology'||t.category==='Lab').map(t=>t.service).join(', ')); }
function cleanBill(x,defType){
  const b={id:uid(), type:normType(x.type,defType), name:String(x.name||'').trim(), uhid:String(x.uhid||'').trim(), dept:String(x.dept||'').trim(), doctor:String(x.doctor||'').trim(),
    doa:parseDate(x.doa), dod:parseDate(x.dod), roomType:String(x.roomType||'').trim(), icuDays:num(x.icuDays), surgery:/maj/i.test(x.surgery)?'Major':/min/i.test(x.surgery)?'Minor':'None', admitMode:(MODES.find(m=>m.toLowerCase().startsWith(String(x.admitMode||'').toLowerCase().slice(0,4)))|| (/emerg|casual/i.test(x.admitMode||'')?'Emergency':/day ?care/i.test(x.admitMode||'')?'Day Care':/refer|transfer/i.test(x.admitMode||'')?'Referral / Transfer':/mlc|police/i.test(x.admitMode||'')?'MLC':x.admitMode?'Elective / Planned':'')),
    services:String(x.services||'').trim(), implantName:String(x.implantName||'').trim(), insurer:String(x.insurer||'').trim(), pkgCode:String(x.pkgCode||'').trim()};
  MONEY.concat(['insApproved','copay','total']).forEach(k=>b[k]=r2(num(x[k])));
  const rm = rooms().find(r=>r.service.toLowerCase()===b.roomType.toLowerCase() || b.roomType.toLowerCase().includes(r.service.split(' ')[0].toLowerCase()));
  if(rm) b.roomType = rm.service;
  if(!b.total) b.total = MONEY.reduce((a,k)=>a+b[k],0);
  return b;
}
async function extractFiles(files, defType){
  const out=[];
  for(const f of files){
    const b64 = await fileB64(f);
    const mime = f.type || (f.name.toLowerCase().endsWith('.pdf')?'application/pdf':'image/jpeg');
    const d = await ai([{text:promptText()},{file:{mime,data:b64,name:f.name}}]);
    (Array.isArray(d)?d:(d.bills||[d])).forEach(x=>out.push(cleanBill(x,defType)));
  }
  return out;
}

/* Excel import */
const ALIAS = {name:['patientname','name','patient'],uhid:['uhid','uhidno','mrn','ipno','regno'],dept:['department','dept','speciality'],doctor:['doctor','consultant','doctorname','treatingdoctor'],
  doa:['doa','admissiondate','dateofadmission','admdate'],dod:['dod','dischargedate','dateofdischarge','disdate'],roomType:['roomtype','room','ward','category'],icuDays:['icudays','icu days'],
  surgery:['surgery','surgerygrade','surgerycategory','grade'],admitMode:['modeofadmission','admissionmode','admissiontype','admittype','mode','typeofadmission'],services:['services','investigations','items','servicesbilled'],roomRent:['roomrent','roomcharges'],icuRent:['icurent','icucharges'],
  ot:['otcharges','ot','otcharge'],surgeon:['surgeon','surgeoncharges','surgeonfee'],implant:['implant','implantcharges','implants','consumables'],implantName:['implantname','implantused','implantdetails','implanttype'],pharmacy:['pharmacy','medicines','drugs'],lab:['lab','laboratory','labcharges'],radiology:['radiology','imaging'],
  consultation:['consultation','consultationcharges','visits'],insApproved:['insuranceapproved','approved','approvedamount','trustapproved'],copay:['copayment','copay','patientshare'],total:['totalbill','total','billamount','netamount'],
  type:['billtype','type','payer','payertype'],pkgCode:['packagecode','package','pkgcode'],insurer:['insurer','tpa','insurancecompany']};
function mapRow(r,defType){
  const norm={}; Object.entries(r).forEach(([k,v])=>norm[k.toLowerCase().replace(/[^a-z]/g,'')]=v);
  const x={}; Object.entries(ALIAS).forEach(([k,al])=>{ for(const a of al){ const key=a.replace(/[^a-z]/g,''); if(norm[key]!==undefined && norm[key]!==''){ x[k]=norm[key]; break; } } });
  return cleanBill(x,defType);
}
// rows of a spreadsheet / CSV as plain text lines (CSV works even without the Excel library)
function sheetLines(file){
  return new Promise((ok,no)=>{
    const name=file.name.toLowerCase();
    if(name.endsWith('.csv')||!window.XLSX){
      if(!name.endsWith('.csv')) return no(new Error('Excel library not loaded — check the internet connection, or save the file as CSV'));
      file.text().then(t=>ok(t.split(/\r?\n/).map(l=>l.replace(/,+$/,'').replace(/,/g,' | ').trim()).filter(Boolean))).catch(no);
      return;
    }
    readExcel(file, rowsx=>ok(rowsx.map(r=>Object.values(r).filter(v=>v!=='').join(' | ')).filter(Boolean)));
  });
}
function readExcel(file,cb){
  if(!window.XLSX){ toast('Excel library did not load — check internet connection'); return; }
  const r=new FileReader();
  r.onload=e=>{ try{ const wb=XLSX.read(e.target.result,{type:'array',cellDates:true}); const ws=wb.Sheets[wb.SheetNames[0]]; cb(XLSX.utils.sheet_to_json(ws,{defval:''})); }catch(err){ toast('Could not read file: '+err.message); } };
  r.readAsArrayBuffer(file);
}

/* ---------- drawer ---------- */
function openBill(id){
  const b=S.bills.find(x=>x.id===id); if(!b) return;
  const a=audit(b), E=a.E;
  const rowsX = [['roomRent',E.roomRent,E.room?`${E.roomDays} d × ${inr(E.room.price)}`:''],['icuRent',E.icuRent,E.icuDays?`${E.icuDays} d ICU`:''],['ot',E.grade?E.ot:0,E.grade?`OT ${E.grade}${E.premium?' +'+S.settings.uplift+'%':''}`:''],['surgeon',E.grade?E.surgeon:0,E.grade?`Surgeon ${E.grade}${E.premium?' +'+S.settings.uplift+'%':''}`:''],['implant',E.implant,b.implantName?b.implantName+' — market/tariff':'no implant recorded'],['pharmacy',null,'as issued'],['lab',E.lab,'from services'],['radiology',E.radiology,'from services'],['consultation',E.consultation,`${E.L} d`]];
  const p=a.pkg;
  $('#drawer').innerHTML = `<div class="dh"><div style="display:flex;justify-content:space-between;gap:10px;align-items:flex-start"><div><div style="font-size:12px;opacity:.85">${esc(b.uhid)} · ${esc(b.dept)} · ${esc(b.doctor)}</div><h2 style="margin:2px 0 6px;font-size:20px">${esc(b.name)}</h2>
    <span class="chip t-${b.type}">${b.type}</span> <span class="chip s-${a.status}">${a.status}</span> <span class="chip" style="background:rgba(255,255,255,.2);color:#fff">${fmtD(b.doa)} → ${fmtD(b.dod)} · LOS ${E.L} d · ${esc(b.roomType||'—')}</span> ${b.admitMode?`<span class="chip" style="background:rgba(255,255,255,.2);color:#fff">${esc(b.admitMode)}</span>`:''} ${b.insurer?`<span class="chip" style="background:rgba(255,255,255,.2);color:#fff">${esc(b.insurer)}</span>`:''}</div>
    <button class="hbtn ghost" id="dClose">✕</button></div></div>
  <div class="db">
    <h3>Suggested bill <span class="note" style="font-weight:400">— tariff + market implant price</span></h3>
    <div class="pkgbox" style="grid-template-columns:repeat(3,1fr)">
      <div><small>Billed</small><strong class="num">${inr(b.total)}</strong></div>
      <div><small>Suggested${b.ai?' (ChatGPT)':' (rules)'}</small><strong class="num" style="color:var(--pri)">${inr(b.ai?.total||a.sg.amount)}</strong></div>
      <div><small>Difference</small><strong class="num" style="color:${(b.ai?.total||a.sg.amount)-num(b.total)>1?'var(--miss)':'var(--mut)'}">${inr((b.ai?.total||a.sg.amount)-num(b.total))}</strong></div>
    </div>
    <div class="find Missing" style="margin-top:8px"><b style="color:var(--miss)">Advice</b><span>${esc(a.sg.notes.join(' · ')||'No change suggested')}</span></div>
    ${b.ai?.remark?`<div class="find Correct"><b style="color:var(--pri)">ChatGPT</b><span>${esc(b.ai.remark)} <span class="note">(${esc(b.ai.at)})</span></span></div>`:''}
    <h3 style="margin-top:16px">AI remarks</h3>${findingsHtml(a)}
    ${p?`<h3 style="margin-top:16px">Package audit</h3><div class="pkgbox"><div><small>Package</small><strong>${esc(p.code||'—')}</strong><div class="note">${esc(p.name||'')}</div></div><div><small>Package amount</small><strong class="num">${p.amount?inr(p.amount):'—'}</strong></div><div><small>Hospital bill</small><strong class="num">${inr(p.bill)}</strong></div><div><small>Exceeded</small><strong class="num" style="color:${p.exceeded?'var(--exc)':'var(--ok)'}">${inr(p.exceeded)}</strong></div><div><small>Alternate package</small><strong>${p.alt?esc(p.alt.code):'—'}</strong><div class="note">${p.alt?esc(p.alt.name)+' · '+inr(p.alt.amount):''}</div></div><div><small>Approval risk</small><strong><span class="chip r-${p.risk}">${p.risk}</span></strong></div></div>`:''}
    <h3 style="margin-top:16px">Billed vs tariff</h3>
    <table class="tbl"><thead><tr><th>Head</th><th class="r">Billed</th><th class="r">Expected</th><th class="r">Diff</th><th>Basis</th></tr></thead><tbody>
    ${rowsX.map(([k,exp,basis])=>{ const bv=num(b[k]); const d= exp===null?null:bv-exp; return `<tr><td>${MONEY_LABEL[k]}</td><td class="r num">${inr(bv)}</td><td class="r num">${exp===null?'—':inr(exp)}</td><td class="r num" style="color:${d===null||Math.abs(d)<=1?'var(--mut)':d>0?'var(--exc)':'var(--miss)'}">${d===null?'—':(d>0?'+':'')+inr(d)}</td><td class="note">${esc(basis)}</td></tr>`; }).join('')}
    <tr><td><b>Total</b></td><td class="r num"><b>${inr(b.total)}</b></td><td class="r num">${inr(a.sum)}</td><td class="r num">${Math.abs(num(b.total)-a.sum)>1?inr(num(b.total)-a.sum):'—'}</td><td class="note">sum of heads</td></tr></tbody></table>
    ${b.type!=='Cash'?`<p class="note">Insurer: ${esc(b.insurer||'—')} · Approved ${inr(b.insApproved)} · Copay ${inr(b.copay)}</p>`:''}
    <p class="note">Services: ${esc(b.services||'—')}</p>
    <div id="aiOp"></div>
  </div>
  <div class="df">${canWrite()?'<button class="btn g" id="dSg">✨ AI suggested bill</button><button class="btn g" id="dAi">✨ AI second opinion</button><button class="btn" id="dEdit">✎ Edit</button><button class="btn d" id="dDel">🗑 Delete</button>':'<span class="note">Read-only account — you can view and export, but not change bills.</span>'}</div>`;
  $('#drawer').classList.add('open'); $('#scrim').classList.add('open');
  $('#dClose').onclick=closeDrawer;
  if(!canWrite()) return;
  $('#dEdit').onclick=()=>{ closeDrawer(); S.ui.tab='input'; S.ui.inputMode='single'; S.ui.editId=id; render(); };
  $('#dDel').onclick=()=>{ S.bills=S.bills.filter(x=>x.id!==id); save(); closeDrawer(); render(); toast('Bill deleted'); };
  $('#dSg').onclick=async()=>{ const btn=$('#dSg'), old=btn.textContent; btn.disabled=true;
    try{ await aiSuggestBills([{b,a}], m=>btn.textContent=m); openBill(id); render(); toast('ChatGPT suggestion added'); }
    catch(e){ btn.disabled=false; btn.textContent=old; toast(e.message,6000); } };
  $('#dAi').onclick=async()=>{ const o=$('#aiOp'); o.innerHTML='<div class="aiout">Asking ChatGPT…</div>'; aiStatus=m=>{ const x=$('#aiOp .aiout'); if(x) x.textContent=m; };
    try{ const txt=await ai([{text:`You are a senior hospital billing auditor in India (cash, insurance/TPA and Aarogyasri). Review this bill and the rule-based findings. In at most 8 short bullet points: confirm or challenge each finding, note anything else likely missed (e.g. nursing, consumables, implants, package inclusions), and state the recommended action. Be precise with rupee amounts.\n\nBILL: ${JSON.stringify(b)}\nTARIFF: ${JSON.stringify(S.tariff)}\nPACKAGE: ${JSON.stringify(p?.master||null)}\nFINDINGS: ${JSON.stringify(a.F)}`}],false); o.innerHTML=`<h3 style="margin-top:14px">ChatGPT second opinion</h3><div class="aiout">${esc(txt)}</div>`; }
    catch(e){ o.innerHTML=`<div class="aiout" style="color:var(--exc)">${esc(e.message)}</div>`; } };
}
function closeDrawer(){ $('#drawer').classList.remove('open'); $('#scrim').classList.remove('open'); }

/* ---------- 7. Export ---------- */
function sheetAoa(R){
  const head = ['S.No','Bill Type','Patient Name','UHID','Department','Doctor','Mode of Admission','DOA','DOD','LOS','Room Type','Implant / Consumable',
    ...MONEY.map(k=>MONEY_LABEL[k]),'Insurer / TPA / Scheme','Insurance Approved','Copayment','Total Bill','AI Remarks','Suggested Bill','AI Suggestion — implant / package advice','Audit Status','Leakage (₹)','Excess (₹)'];
  const body = R.map(({b,a},i)=>[i+1,b.type,b.name,b.uhid,b.dept,b.doctor,b.admitMode||'',fmtD(b.doa),fmtD(b.dod),a.E.L,b.roomType,b.implantName||'',
    ...MONEY.map(k=>num(b[k])), b.insurer||'', num(b.insApproved), num(b.copay), num(b.total), a.remarks,
    b.ai?.total||a.sg.amount, (b.ai?.remark?'ChatGPT: '+b.ai.remark+' | ':'')+a.sg.notes.join(' · '), a.status, a.leak, a.over]);
  const t = k => R.reduce((s,r)=>s+num(r.b[k]),0);
  body.push(['','TOTAL','','','','','','','','','','',...MONEY.map(t),'',t('insApproved'),t('copay'),t('total'),'',
    R.reduce((s,r)=>s+(r.b.ai?.total||r.a.sg.amount),0),'','',R.reduce((s,r)=>s+r.a.leak,0),R.reduce((s,r)=>s+r.a.over,0)]);
  return [head,...body];
}
function exportExcel(R=rows()){
  if(!R.length){ toast('No bills in this period'); return; }
  const name = 'MAMS_Audit_'+periodLabel().replace(/\s+/g,'_');
  if(!window.XLSX){ downloadCsv(R,name); return; }
  const wb = XLSX.utils.book_new();
  const add=(aoa,title,widths)=>{ const ws=XLSX.utils.aoa_to_sheet(aoa); if(widths) ws['!cols']=widths.map(w=>({wch:w})); XLSX.utils.book_append_sheet(wb,ws,title); };
  // Summary
  const rev=t=>R.filter(r=>r.b.type===t).reduce((s,r)=>s+num(r.b.total),0);
  add([['MAMS Audit AI — Summary'],['Period',periodLabel()],['Generated',new Date().toLocaleString('en-IN')],[],
    ['Total Bills Audited',R.length],['Cash Revenue',rev('Cash')],['Insurance Revenue',rev('Insurance')],['Aarogyasri Revenue',rev('Aarogyasri')],
    ['Copayment Total',R.reduce((s,r)=>s+num(r.b.copay),0)],['Revenue Leakage',R.reduce((s,r)=>s+r.a.leak,0)],['Excess Billed',R.reduce((s,r)=>s+r.a.over,0)],[],
    ['Status','Bills'],...STATUSES.map(s=>[s,R.filter(r=>r.a.status===s).length])],'Summary',[28,22]);
  add(sheetAoa(R),'Audit Sheet',[6,11,20,12,16,16,18,11,11,5,13,20,...MONEY.map(()=>12),20,14,11,12,70,13,70,10,12,12]);
  // Package audit
  add([['Patient','UHID','Type','Insurer / TPA / Scheme','Mode of Admission','Department','Package Code','Package Name','Package Amount','Hospital Bill','Exceeded','Alternate Package','Alt Amount','Approval Risk','Remark'],
    ...R.filter(r=>r.b.type!=='Cash').map(({b,a})=>{ const p=a.pkg; return [b.name,b.uhid,b.type,b.insurer||'',b.admitMode||'',b.dept,p.code,p.name||'',p.amount,p.bill,p.exceeded,p.alt?.code||'',p.alt?.amount||'',p.risk,p.error||(p.exceeded?'Exceeded package':'Within package')]; })],'Package Audit',[20,12,11,20,18,16,12,24,14,13,12,14,12,12,50]);
  // dept & doctor
  const grp=key=>{ const m={}; R.forEach(({b,a})=>{ const k=b[key]||'—'; const g=m[k]||(m[k]=[k,0,0,0,0,0,0,0,0]); g[1]++; g[b.type==='Cash'?2:b.type==='Insurance'?3:4]+=num(b.total); g[5]+=num(b.total); g[6]+=num(b.copay); g[7]+=a.leak; if(a.status!=='Correct') g[8]++; }); return Object.values(m).sort((a,b)=>b[5]-a[5]); };
  const gh=['Bills','Cash','Insurance','Aarogyasri','Total Revenue','Copayment','Leakage','Bills with Issues'];
  add([['Department',...gh],...grp('dept')],'Department Summary',[20,8,14,14,14,15,12,12,16]);
  add([['Doctor',...gh],...grp('doctor')],'Doctor Summary',[20,8,14,14,14,15,12,12,16]);
  const grp2=(key,filter=()=>true)=>{ const m={}; R.filter(filter).forEach(({b,a})=>{ const k=b[key]||'(not recorded)'; const g=m[k]||(m[k]=[k,0,0,0,0,0]); g[1]++; g[2]+=num(b.total); g[3]+=num(b.insApproved); g[4]+=num(b.copay); g[5]+=a.leak; }); return Object.values(m).sort((a,b)=>b[2]-a[2]); };
  add([['Insurer / TPA / Scheme','Bills','Billed','Approved','Copayment','Leakage'],...grp2('insurer',r=>r.b.type!=='Cash')],'Insurer Summary',[26,8,14,14,14,12]);
  add([['Mode of Admission','Bills','Billed','Approved','Copayment','Leakage'],...grp2('admitMode')],'Admission Mode Summary',[22,8,14,14,14,12]);
  add([['Service','Category','Cash Price','Premium Room'],...S.tariff.map(t=>[t.service,t.category,t.price,t.category==='Room'?(t.premium?'Yes':'No'):''])],'Tariff Master',[22,14,12,14]);
  XLSX.writeFile(wb, name+'.xlsx');
  toast('Excel exported — '+R.length+' bills');
}
function downloadCsv(R,name='MAMS_Audit'){
  const aoa=sheetAoa(R); const csv=aoa.map(r=>r.map(c=>{ const s=String(c??''); return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s; }).join(',')).join('\n');
  const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob(['﻿'+csv],{type:'text/csv'})); a.download=name+'.csv'; a.click();
}
function downloadTemplate(){
  const head=['Bill Type','Patient Name','UHID','Department','Doctor','Mode of Admission','DOA','DOD','Room Type','ICU Days','Surgery Grade','Services','Room Rent','ICU Rent','OT Charges','Surgeon','Implant Name','Implant','Pharmacy','Lab','Radiology','Consultation','Insurer','Package Code','Insurance Approved','Copayment','Total Bill'];
  const ex=['Insurance','Sample Patient','MAMS000001','General Surgery','Dr. A. Rao','Emergency','2026-09-01','2026-09-04','Semi Private',0,'Major','CT Brain, CBC',7500,0,18000,25000,'Hernia Mesh',6000,6200,350,2500,2400,'Star Health','INS-GS-01',60000,1950,61950];
  if(window.XLSX){ const wb=XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb,XLSX.utils.aoa_to_sheet([head,ex]),'Bills'); XLSX.writeFile(wb,'MAMS_Bulk_Template.xlsx'); }
  else { const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([head.join(',')+'\n'+ex.join(',')],{type:'text/csv'})); a.download='MAMS_Bulk_Template.csv'; a.click(); }
}

/* ---------- bindings ---------- */
function dropZone(zone,input,handler){
  const z=$(zone), i=$(input); if(!z) return;
  z.onclick=()=>i.click(); i.onchange=()=>{ if(i.files.length) handler([...i.files]); i.value=''; };
  z.ondragover=e=>{e.preventDefault(); z.classList.add('hot');}; z.ondragleave=()=>z.classList.remove('hot');
  z.ondrop=e=>{e.preventDefault(); z.classList.remove('hot'); if(e.dataTransfer.files.length) handler([...e.dataTransfer.files]);};
}
const bind = {
  dash(){ $$('[data-doc]').forEach(tr=>tr.onclick=()=>{ S.ui.q=tr.dataset.doc; S.ui.tab='sheet'; render(); });
    $$('[data-ins]').forEach(tr=>tr.onclick=()=>{ S.ui.q=tr.dataset.ins; S.ui.tab='sheet'; render(); }); },
  sheet(){
    $$('#fType button').forEach(x=>x.onclick=()=>{S.ui.type=x.dataset.v; render();});
    $$('#fStatus button').forEach(x=>x.onclick=()=>{S.ui.status=x.dataset.v; render();});
    const q=$('#fQ'); q.oninput=()=>{ S.ui.q=q.value; clearTimeout(q._t); q._t=setTimeout(()=>{ render(); const n=$('#fQ'); n.focus(); n.setSelectionRange(n.value.length,n.value.length); },250); };
    $$('.sheet tbody tr[data-id]').forEach(tr=>tr.onclick=()=>openBill(tr.dataset.id));
    if($('#btnAiSg')) $('#btnAiSg').onclick=async()=>{ const btn=$('#btnAiSg'), list=sheetRows(); if(!list.length){ toast('No bills to price'); return; }
      const old=btn.textContent; btn.disabled=true; aiStatus=m=>btn.textContent=m;
      try{ const n=await aiSuggestBills(list, m=>btn.textContent=m); toast(`ChatGPT suggested bills for ${n} patients`); render(); }
      catch(e){ btn.disabled=false; btn.textContent=old; toast(e.message,6000); } };
    $('#btnCsv').onclick=()=>downloadCsv(sheetRows(),'MAMS_Audit_Sheet'); $('#btnXl2').onclick=()=>exportExcel(sheetRows());
  },
  pkg(){
    $$('tr[data-id]').forEach(tr=>tr.onclick=()=>openBill(tr.dataset.id));
    if(!isAdmin()) return;
    bindMaster('#pkgTbl',S.packages,{amount:'n'});
    $('#pkgAdd').onclick=()=>{ S.packages.push({code:'NEW-'+(S.packages.length+1),name:'',dept:'',scheme:'Aarogyasri',amount:0}); save(); render(); };
  },
  tariff(){
    if(!isAdmin()) return;
    bindMaster('#tTbl',S.tariff,{price:'n',premium:'b'});
    // --- speech ---
    const SR = window.SpeechRecognition||window.webkitSpeechRecognition;
    const box=$('#speechBox'), note=$('#micNote');
    box.oninput=()=>S.ui.tSpeech=box.value;
    if(!SR){ $('#micBtn').disabled=true; note.textContent='Speech input needs Chrome or Edge — you can type or paste instead.'; }
    else {
      let rec=null;
      $('#micBtn').onclick=()=>{
        if(rec){ rec.stop(); return; }
        rec=new SR(); rec.lang='en-IN'; rec.continuous=true; rec.interimResults=true;
        let fixed=box.value;
        rec.onresult=e=>{ let interim=''; for(let i=e.resultIndex;i<e.results.length;i++){ const t=e.results[i][0].transcript; if(e.results[i].isFinal) fixed+=(fixed&&!/\s$/.test(fixed)?' ':'')+t.trim()+'. '; else interim+=t; } box.value=fixed+interim; S.ui.tSpeech=box.value; };
        rec.onerror=e=>{ note.textContent='Mic error: '+e.error+(e.error==='not-allowed'?' — allow microphone access; Chrome often blocks the mic on a file:// page, so open the app from a web address or a local server':''); };
        rec.onend=()=>{ rec=null; $('#micBtn').textContent='🎤 Start speaking'; note.textContent='Stopped. Now press "Arrange with AI".'; };
        rec.start(); $('#micBtn').textContent='⏹ Stop'; note.textContent='Listening… speak the service and its price.';
      };
      $('#micClear').onclick=()=>{ box.value=''; S.ui.tSpeech=''; note.textContent=''; };
    }
    $('#tAiText').onclick=async()=>{ const t=box.value.trim(); if(!t){ toast('Speak or paste a price list first'); return; }
      const st=$('#tAiStat'); aiStatus=m=>st.textContent=m;
      try{ const list=await aiTariff([{text:'PRICE LIST (spoken or typed):\n'+t}], m=>st.textContent=m); if(!list.length) throw new Error('Nothing recognised'); S.ui.tDraft=list; render(); toast(list.length+' services arranged'); }
      catch(e){ st.innerHTML='<span class="chip s-Error">Failed</span> '+esc(e.message); } };
    // --- AI bulk import ---
    dropZone('#tDrop','#tAiFile', async files=>{
      const st=$('#tDropStat'); aiStatus=m=>st.textContent=m; const out=[];
      try{
        for(const f of files){
          const name=f.name.toLowerCase();
          if(/\.(xlsx|xls|csv)$/.test(name)){
            const lines=await sheetLines(f);
            if(!lines.length) throw new Error(f.name+': no rows found');
            for(let i=0;i<lines.length;i+=120){
              st.textContent=`✨ ${f.name}: rows ${i+1}–${Math.min(i+120,lines.length)} of ${lines.length}…`;
              out.push(...await aiTariff([{text:'TARIFF ROWS:\n'+lines.slice(i,i+120).join('\n')}], m=>st.textContent=m));
            }
          } else {
            st.textContent='✨ Reading '+f.name+'…';
            const b64=await fileB64(f); const mime=f.type||(name.endsWith('.pdf')?'application/pdf':'image/jpeg');
            out.push(...await aiTariff([{text:'Read the tariff from this file.'},{file:{mime,data:b64,name:f.name}}], m=>st.textContent=m));
          }
        }
        const seen=new Set(); S.ui.tDraft=out.filter(r=>{ const k=r.service.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
        render(); toast(S.ui.tDraft.length+' services arranged by AI');
      }catch(e){ st.innerHTML='<span class="chip s-Error">Failed</span> '+esc(e.message); }
    });
    if($('#tMerge')){ $('#tMerge').onclick=()=>applyTariffDraft('merge'); $('#tReplace').onclick=()=>applyTariffDraft('replace'); $('#tDiscard').onclick=()=>{ S.ui.tDraft=[]; render(); }; }
    $('#tAdd').onclick=()=>{ S.tariff.push({service:'New service',category:'Other',price:0,premium:false}); save(); render(); };
    $('#tq').oninput=e=>{ const q=e.target.value.toLowerCase(); $$('#tTbl tbody tr').forEach(tr=>tr.style.display=tr.querySelector('input').value.toLowerCase().includes(q)?'':'none'); };
    $('#tImp').onclick=()=>$('#tFile').click();
    $('#tFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; readExcel(f,rs=>{ let n=0; rs.forEach(r=>{ const o={}; Object.entries(r).forEach(([k,v])=>o[k.toLowerCase().trim()]=v); const sv=String(o.service||o.name||'').trim(); if(!sv) return; const ex=T(sv); const row={service:sv,category:String(o.category||'Other').trim()||'Other',price:num(o.price||o['cash price']||o.rate),premium:/^(y|yes|true|1)$/i.test(String(o.premium||''))}; if(ex) Object.assign(ex,row); else S.tariff.push(row); n++; }); save(); render(); toast(n+' tariff rows imported'); }); };
  },
  settings(){
    const st=S.settings;
    if(isAdmin()){
      $('#sModel').onchange=e=>{st.model=e.target.value.trim()||DEFAULT_MODEL; save();};
      $('#sHosp').onchange=e=>{st.hospitalName=e.target.value.trim(); save();};
      $('#sUp').onchange=e=>{st.uplift=num(e.target.value); save(); render();};
      $('#sTol').onchange=e=>{st.tolerance=num(e.target.value)||1; save(); render();};
      $('#sRisk').onchange=e=>{st.riskHigh=num(e.target.value); save(); render();};
      $('#sTest').onclick=async()=>{ $('#sOut').textContent='Testing…';
        try{ const t=await ai([{text:'Reply with the single word OK'}],false); $('#sOut').innerHTML='<span class="chip s-Correct">Connected</span> '+esc(String(t).trim().slice(0,40)); }
        catch(e){ $('#sOut').innerHTML='<span class="chip s-Error">Failed</span> '+esc(e.message); } };
      $('#dClear').onclick=async()=>{ const b=$('#dClear'); if(!b.dataset.c){ b.dataset.c=1; b.textContent='Click again to confirm'; return; }
        try{ await api.clearBills(); await pullState(); toast('All bills cleared'); }catch(e){ toast(e.message,5000); } };
      $('#dReset').onclick=async()=>{ S.tariff=JSON.parse(JSON.stringify(DEFAULT_TARIFF)); S.packages=JSON.parse(JSON.stringify(DEFAULT_PACKAGES)); await syncNow(); await pullState(); toast('Tariff & packages reset'); };
      $('#dRestore').onclick=()=>$('#dFile').click();
      $('#dFile').onchange=e=>{ const f=e.target.files[0]; if(!f) return; f.text().then(async t=>{ const d=JSON.parse(t);
        if(d.tariff) S.tariff=d.tariff; if(d.packages) S.packages=d.packages; if(d.bills) S.bills=d.bills;
        await syncNow(); await pullState(); toast('Backup restored to the server'); }).catch(()=>toast('Invalid backup file')); };
      $('#uAdd').onclick=async()=>{ const out=$('#uOut');
        try{ await api.addUser({name:$('#uName').value, email:$('#uMail').value, password:$('#uPass').value, role:$('#uRole').value}); await pullState(); toast('User added'); }
        catch(e){ out.innerHTML='<span class="chip s-Error">'+esc(e.message)+'</span>'; } };
      $$('[data-udel]').forEach(b=>b.onclick=async()=>{ try{ await api.delUser(b.dataset.udel); await pullState(); toast('User removed'); }catch(e){ toast(e.message,5000); } });
    }
    if($('#dSample')) $('#dSample').onclick=async()=>{ const sm=sampleBills(); const ids=new Set(S.bills.map(b=>b.id)); S.bills.push(...sm.filter(b=>!ids.has(b.id))); save(); await syncNow(); render(); toast('Sample bills loaded'); };
    $('#dBackup').onclick=()=>{ const a=document.createElement('a'); a.href=URL.createObjectURL(new Blob([JSON.stringify({bills:S.bills,tariff:S.tariff,packages:S.packages,settings:pickSettings()},null,1)],{type:'application/json'})); a.download='MAMS_Audit_Backup.json'; a.click(); };
    $('#pwBtn').onclick=async()=>{ const out=$('#pwOut');
      try{ await api.password($('#pwOld').value, $('#pwNew').value); out.innerHTML='<span class="chip s-Correct">Password changed</span>'; $('#pwOld').value=$('#pwNew').value=''; }
      catch(e){ out.innerHTML='<span class="chip s-Error">'+esc(e.message)+'</span>'; } };
  },
  input(){
    $$('#inMode button').forEach(x=>x.onclick=()=>{ S.ui.inputMode=x.dataset.v; render(); });
    $$('[data-q]').forEach(x=>x.onclick=()=>{ const today=new Date().toISOString().slice(0,10); S.ui.mode=x.dataset.q; if(x.dataset.q==='week') S.ui.week=isoWeek(today); else S.ui.month=today.slice(0,7); syncPeriod(); S.ui.tab='sheet'; render(); });
    if(S.ui.inputMode==='single'){
      const f=$('#billForm'); updLos();
      f.elements.doa.onchange=f.elements.dod.onchange=updLos;
      $('#autoSum').onclick=()=>{ const b=readForm(); f.elements.total.value=r2(MONEY.reduce((a,k)=>a+num(b[k]),0)); };
      $('#preview').onclick=()=>{ const b={...readForm(),id:S.ui.editId||'__draft'}; $('#livePrev').innerHTML=auditCard(b); };
      $('#resetForm').onclick=()=>{ S.ui.draft=null; S.ui.editId=null; render(); };
      if($('#cancelEdit')) $('#cancelEdit').onclick=()=>{ S.ui.editId=null; render(); };
      f.onsubmit=e=>{ e.preventDefault(); const b=readForm(); if(!b.name&&!b.uhid){ toast('Enter patient name or UHID'); return; }
        if(!b.total) b.total=r2(MONEY.reduce((a,k)=>a+num(b[k]),0));
        if(S.ui.editId){ const i=S.bills.findIndex(x=>x.id===S.ui.editId); b.id=S.ui.editId; S.bills[i]=b; } else { b.id=uid(); S.bills.push(b); }
        save(); S.ui.editId=null; S.ui.draft=null; const a=audit(b); toast(`Saved — ${a.status}: ${a.remarks.slice(0,80)}`,4000); S.ui.tab='sheet'; render(); openBill(b.id); };
      const run=async(fn)=>{ const st=$('#aiStat'); st.innerHTML='✨ ChatGPT is reading the bill…'; aiStatus=m=>{ const x=$('#aiStat'); if(x) x.textContent=m; }; try{ const list=await fn(); if(!list.length) throw new Error('No bill found'); const {id,...x}=list[0]; fillForm(x); st.innerHTML=`<span class="chip s-Correct">Extracted</span> ${list.length>1?list.length+' bills found — first one loaded (use Bulk for all)':'Review the fields, then Save & Audit'}`; $('#livePrev').innerHTML=auditCard({...readForm(),id:'__draft'}); }catch(e){ st.innerHTML=`<span class="chip s-Error">Failed</span> ${esc(e.message)}`; } };
      dropZone('#drop1','#file1',files=>run(()=>extractFiles(files.slice(0,1),f.elements.type.value)));
      $('#aiText').onclick=()=>{ const t=$('#paste1').value.trim(); if(!t){ toast('Paste bill text first'); return; } run(async()=>{ const d=await ai([{text:promptText()+'\n\nBILL TEXT:\n'+t}]); return (Array.isArray(d)?d:(d.bills||[d])).map(x=>cleanBill(x,f.elements.type.value)); }); };
    } else {
      $('#tmpl').onclick=downloadTemplate;
      dropZone('#dropX','#fileX',files=>readExcel(files[0],rs=>{ const t=$('#bulkType').value; S.ui.bulk=rs.map(r=>mapRow(r,t)).filter(b=>b.name||b.uhid); render(); toast(S.ui.bulk.length+' rows read'); }));
      dropZone('#dropP','#fileP',async files=>{ const st=$('#bulkStat'); const t=$('#bulkType').value; aiStatus=m=>{ const x=$('#bulkStat'); if(x) x.textContent=m; }; const got=[]; for(let i=0;i<files.length;i++){ st.textContent=`✨ Extracting ${i+1} / ${files.length}: ${files[i].name}`; try{ got.push(...await extractFiles([files[i]],t)); }catch(e){ toast(files[i].name+': '+e.message,4000); } } S.ui.bulk=S.ui.bulk.concat(got); render(); toast(got.length+' bills extracted'); });
      if($('#bulkImp')) $('#bulkImp').onclick=()=>{ const n=S.ui.bulk.length; S.bills.push(...S.ui.bulk); S.ui.bulk=[]; save(); S.ui.tab='sheet'; render(); toast(n+' bills imported & audited'); };
      if($('#bulkClr')) $('#bulkClr').onclick=()=>{ S.ui.bulk=[]; render(); };
    }
  }
};
function bindMaster(sel,arr,types){
  $$(sel+' tbody tr').forEach(tr=>{ const i=+tr.dataset.i;
    $$('[data-k]',tr).forEach(el=>el.onchange=()=>{ const k=el.dataset.k; arr[i][k]= types[k]==='n'?num(el.value): types[k]==='b'?el.checked : el.value.trim(); save(); if(k==='category') render(); });
    const d=$('[data-del]',tr); if(d) d.onclick=()=>{ arr.splice(i,1); save(); render(); };
  });
}

/* ---------- global controls ---------- */
function syncPeriod(){ $('#pMode').value=S.ui.mode; $('#pWeek').classList.toggle('hide',S.ui.mode!=='week'); $('#pMonth').classList.toggle('hide',S.ui.mode!=='month'); $('#pWeek').value=S.ui.week; $('#pMonth').value=S.ui.month; }
$('#tabs').onclick=e=>{ const t=e.target.closest('button'); if(!t) return; S.ui.tab=t.dataset.t; closeDrawer(); render(); };
$('#pMode').onchange=e=>{ S.ui.mode=e.target.value; const today=new Date().toISOString().slice(0,10); if(S.ui.mode==='week'&&!S.ui.week) S.ui.week=isoWeek(today); if(S.ui.mode==='month'&&!S.ui.month) S.ui.month=today.slice(0,7); syncPeriod(); render(); };
$('#pWeek').onchange=e=>{ S.ui.week=e.target.value; render(); };
$('#pMonth').onchange=e=>{ S.ui.month=e.target.value; render(); };
$('#btnExport').onclick=()=>exportExcel();
$('#scrim').onclick=closeDrawer;
document.addEventListener('keydown',e=>{ if(e.key==='Escape') closeDrawer(); });
$('#btnTheme').onclick=()=>{ const r=document.documentElement; const dark = r.dataset.theme ? r.dataset.theme==='dark' : matchMedia('(prefers-color-scheme: dark)').matches; r.dataset.theme = dark?'light':'dark'; try{ localStorage.setItem('mams.theme',r.dataset.theme);}catch(e){} };
try{ const th=localStorage.getItem('mams.theme'); if(th) document.documentElement.dataset.theme=th; }catch(e){}

$('#btnLogout').onclick=async()=>{ try{ await api.logout(); }catch(e){} location.href='/login.html'; };
$('#btnRefresh').onclick=async()=>{ try{ await pullState(); toast('Reloaded from the server'); }catch(e){ toast(e.message,5000); } };
function paintUser(){ const u=S.me||{}; $('#userBox').innerHTML = `<b>${esc(u.name||u.email||'')}</b> <span class="role">${esc(u.role||'')}</span>`; if(S.settings.hospitalName) $('.brand p').textContent = S.settings.hospitalName + ' — Cash · Insurance · Aarogyasri'; }

/* ---------- boot ---------- */
(async () => {
  try { await pullState(true); }
  catch (e) { if(!/Session expired/.test(e.message)) toast('Could not load data: ' + e.message, 8000); return; }
  paintUser(); syncPeriod(); render();
  // keep long-open screens fresh (other users may add bills)
  setInterval(async () => {
    if (document.hidden || syncing || $('#drawer').classList.contains('open') || S.ui.tab === 'input') return;
    try { const before = JSON.stringify(S.bills); await pullState(true); if (JSON.stringify(S.bills) !== before) render(); } catch (e) {}
  }, 60000);
})();
