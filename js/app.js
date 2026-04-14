// CONFIG
const SUPABASE_URL = 'https://cxoqzzjjgzkaqwrggfdj.supabase.co';
const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_fAZV5BbLknce0IVc6DVjdQ_PWlymCuz';
const CLOUD_AUTH_STORAGE_KEY = 'fitmetdicky-auth';
const CLOUD_KLANTEN_TABLE = 'fmd_klanten';
const CLOUD_APPOINTMENTS_TABLE = 'fmd_afspraken';
const CLOUD_SETTINGS_TABLE = 'fmd_planner_settings';
const CLOUD_APP_KEY = 'fitmetdicky';
// Fill these if you want the Mail button to send automatically via EmailJS.
const EMAILJS_PUBLIC_KEY = '07cu9VEZUpFvwWk8T';
const EMAILJS_SERVICE_ID = 'service_k2ayy6s';
const EMAILJS_TEMPLATE_ID = 'template_3t77l9c';
const EMAILJS_AUTO_SEND = true;
// STATE
const today = new Date(); today.setHours(0,0,0,0);
let selectedDate = new Date(today);
let weekOffset = 0;
let selectedTime = null;
let pendingSendApt = null;
const WORK_START = 9, WORK_END = 21, SLOT_STEP = 30;
const DEFAULT_BEHANDELINGEN = [
  {id:'beh_massage_60', naam:'Massage 60 min', duur:60, uurtarief:50},
  {id:'beh_massage_90', naam:'Massage 90 min', duur:90, uurtarief:50},
  {id:'beh_consult_30', naam:'Consult 30 min', duur:30, uurtarief:50},
  {id:'beh_massage_120', naam:'Massage 2 uur', duur:120, uurtarief:50}
];

let appointments = JSON.parse(localStorage.getItem('fmd_apts')||'[]');
let klanten      = JSON.parse(localStorage.getItem('fmd_klanten')||'[]');
let behandelingen = safeJsonParse(localStorage.getItem('fmd_behandelingen'), DEFAULT_BEHANDELINGEN).map(normalizeBehandeling);
let blockedDays  = JSON.parse(localStorage.getItem('fmd_blocked_days')||'[]');
let ejsSettings  = JSON.parse(localStorage.getItem('fmd_ejs')||'{"pubkey":"","service":"","template":"","auto":false}');
let isHydrating = false;
let msgTemplate  = localStorage.getItem('fmd_msg') || 'Beste [voornaam],\\n\\nJe afspraak bij Fit met Dicky is bevestigd.\\n\\nDatum:       [datum]\\nTijd:        [tijd]\\nBehandeling: [behandeling]\\n\\nTot dan!\\nDicky';
let cloudUser = null;
let cloudSaveTimer = null;
let cloudReady = false;
let cloudLoading = false;
let cloudSaveInFlight = false;
let cloudSaveQueued = false;

// HELPERS
const fmtTime = m => String(Math.floor(m/60)).padStart(2,'0')+':'+String(m%60).padStart(2,'0');
// parseDate always uses LOCAL time to avoid UTC timezone shift
const parseDate = str => { const [y,m,d]=String(str).trim().substring(0,10).split('-').map(Number); return new Date(y,m-1,d); };
const dateKey   = d => d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
const fmtDate   = d => { const days=['Zo','Ma','Di','Wo','Do','Vr','Za'],months=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec']; return days[d.getDay()]+' '+d.getDate()+' '+months[d.getMonth()]; };
const initials  = n => n.split(' ').map(w=>w[0]).join('').toUpperCase().slice(0,2);
const avatarClr = n => { const c=['#6198f1','#c10017','#8bb4f7','#2f7d62','#f0c4cb']; let h=0; for(const ch of n) h=(h<<5)-h+ch.charCodeAt(0); return c[Math.abs(h)%c.length]; };
function safeJsonParse(value, fallback){
  try{ const parsed=JSON.parse(value||''); return parsed ?? fallback; }catch(e){ return fallback; }
}
function escapeHtml(value=''){
  return String(value).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
function normalizeBehandeling(b){
  const fallback=DEFAULT_BEHANDELINGEN[0];
  return {
    id:String(b?.id||('beh_'+Date.now()+'_'+Math.floor(Math.random()*100000))),
    naam:String(b?.naam||b?.name||fallback.naam).trim()||fallback.naam,
    duur:Math.max(5, Number(b?.duur||b?.duration||fallback.duur)||fallback.duur),
    uurtarief:Math.max(0, Number(b?.uurtarief ?? b?.hourlyRate ?? 50)||50)
  };
}
function defaultBehandeling(){
  if(!behandelingen.length) behandelingen=DEFAULT_BEHANDELINGEN.map(normalizeBehandeling);
  return behandelingen[0];
}
function treatmentLabel(b){
  return `${b.naam} · ${b.duur} min · € ${Number(b.uurtarief).toFixed(2).replace('.',',')}/uur ex btw`;
}
function populateTreatmentSelect(id, selectedId){
  const sel=document.getElementById(id); if(!sel) return;
  behandelingen=behandelingen.map(normalizeBehandeling);
  const current=selectedId || sel.value || defaultBehandeling().id;
  sel.innerHTML=behandelingen.map(b=>`<option value="${escapeHtml(b.id)}">${escapeHtml(treatmentLabel(b))}</option>`).join('');
  sel.value=behandelingen.some(b=>b.id===current)?current:defaultBehandeling().id;
}
function getSelectedTreatment(id){
  const sel=document.getElementById(id);
  return behandelingen.find(b=>b.id===sel?.value) || defaultBehandeling();
}
function setQuickTreatment(id){
  const treatment=behandelingen.find(b=>b.id===id) || defaultBehandeling();
  qa.treatmentId=treatment.id;
  qa.dur=treatment.duur;
  qa.treatment=treatment.naam;
  qa.hourlyRate=treatment.uurtarief;
  qa.time=null;
  qaRender();
}
function saveTreatmentsState(){
  behandelingen=behandelingen.map(normalizeBehandeling);
  localStorage.setItem('fmd_behandelingen', JSON.stringify(behandelingen));
  scheduleCloudSave();
}
function saveBehandeling(){
  const naam=document.getElementById('bh-naam')?.value.trim();
  const duur=Number(document.getElementById('bh-duur')?.value)||60;
  const uurtarief=Number(document.getElementById('bh-uurtarief')?.value)||50;
  if(!naam){ showToast('Vul een behandelingnaam in'); return; }
  behandelingen.push(normalizeBehandeling({id:'beh_'+Date.now(), naam, duur, uurtarief}));
  document.getElementById('bh-naam').value='';
  document.getElementById('bh-duur').value='60';
  document.getElementById('bh-uurtarief').value='50';
  saveTreatmentsState();
  renderBehandelingen();
  populateTreatmentSelect('f-type');
  showToast('Behandeling toegevoegd');
}
function deleteBehandeling(id){
  if(behandelingen.length<=1){ showToast('Laat minimaal 1 behandeling staan'); return; }
  if(!confirm('Behandeling verwijderen?')) return;
  behandelingen=behandelingen.filter(b=>b.id!==id);
  saveTreatmentsState();
  renderBehandelingen();
  populateTreatmentSelect('f-type');
  showToast('Behandeling verwijderd');
}
function renderBehandelingen(){
  const list=document.getElementById('behandeling-list'); if(!list) return;
  behandelingen=behandelingen.map(normalizeBehandeling);
  list.innerHTML=behandelingen.map(b=>`
    <div class="treatment-row">
      <div class="treatment-main">
        <div class="treatment-name">${escapeHtml(b.naam)}</div>
        <div class="treatment-meta">${b.duur} min · € ${Number(b.uurtarief).toFixed(2).replace('.',',')}/uur ex btw</div>
      </div>
      <button class="klant-btn delete" onclick="deleteBehandeling('${escapeHtml(b.id)}')">Verwijder</button>
    </div>`).join('');
}
function readCache(){
  try{
    return {
      appointments: JSON.parse(localStorage.getItem('fmd_apts')||'[]'),
      klanten: JSON.parse(localStorage.getItem('fmd_klanten')||'[]'),
      behandelingen: safeJsonParse(localStorage.getItem('fmd_behandelingen'), DEFAULT_BEHANDELINGEN).map(normalizeBehandeling),
      blockedDays: JSON.parse(localStorage.getItem('fmd_blocked_days')||'[]'),
      ejsSettings: JSON.parse(localStorage.getItem('fmd_ejs')||'{"pubkey":"","service":"","template":"","auto":false}'),
      msgTemplate: localStorage.getItem('fmd_msg') || msgTemplate
    };
  }catch(e){
    return {appointments:[], klanten:[], behandelingen:DEFAULT_BEHANDELINGEN.map(normalizeBehandeling), blockedDays:[], ejsSettings:{pubkey:'',service:'',template:'',auto:false}, msgTemplate};
  }
}
function writeCache(){
  localStorage.setItem('fmd_apts',JSON.stringify(appointments));
  localStorage.setItem('fmd_klanten',JSON.stringify(klanten));
  localStorage.setItem('fmd_behandelingen',JSON.stringify(behandelingen));
  localStorage.setItem('fmd_blocked_days',JSON.stringify(blockedDays));
  localStorage.setItem('fmd_ejs',JSON.stringify(ejsSettings));
  localStorage.setItem('fmd_msg',msgTemplate);
}
function plannerSettingsSnapshot(){
  return {
    blockedDays,
    behandelingen,
    ejsSettings,
    msgTemplate,
    updatedAt: new Date().toISOString()
  };
}
function applyCloudData(data){
  if(!data) return;
  isHydrating=true;
  appointments=(data.appointments||[]).map(normalizeAppointment);
  klanten=(data.klanten||[]).map(normalizeKlant);
  behandelingen=Array.isArray(data.settings?.behandelingen)?data.settings.behandelingen.map(normalizeBehandeling):behandelingen;
  blockedDays=Array.isArray(data.settings?.blockedDays)?data.settings.blockedDays:blockedDays;
  ejsSettings=data.settings?.ejsSettings||ejsSettings;
  msgTemplate=data.settings?.msgTemplate||msgTemplate;
  writeCache();
  isHydrating=false;
  populateKlantDropdown();
  populateTreatmentSelect('f-type');
  renderBehandelingen();
  renderAgenda();
}
async function withCloudTimeout(promise, label){
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(label+' duurde te lang. Controleer je Supabase project en RLS.')), 12000);
  });
  try{
    return await Promise.race([promise, timeout]);
  }finally{
    clearTimeout(timer);
  }
}
function normalizeCloudRows(rows){
  return (rows||[]).map(row => row.data || {}).filter(Boolean);
}
function ensureUniqueIds(items, prefix){
  const seen = new Set();
  let changed = false;
  const fixed = (items||[]).map((item, index) => {
    const copy = {...item};
    let id = String(copy.id || '');
    if(!id || seen.has(id)){
      id = `${prefix}_${Date.now()}_${index}_${Math.floor(Math.random()*100000)}`;
      copy.id = id;
      changed = true;
    }
    seen.add(id);
    return copy;
  });
  return {items:fixed, changed};
}
async function syncCloudRows(client, table, rows){
  const existing = await client.from(table).select('id').eq('user_id', cloudUser.id);
  if(existing.error) return existing;

  if(rows.length){
    const upsert = await client.from(table).upsert(rows, {onConflict:'user_id,id'});
    if(upsert.error) return upsert;
  }

  const currentIds = new Set(rows.map(row => row.id));
  const staleIds = (existing.data||[]).map(row => row.id).filter(id => !currentIds.has(id));
  if(staleIds.length){
    const cleanup = await client.from(table).delete().eq('user_id', cloudUser.id).in('id', staleIds);
    if(cleanup.error) return cleanup;
  }

  return {error:null};
}
function normalizeAppointment(a){
  const date=a?.date?String(a.date).trim().substring(0,10):'';
  return {...a,date,startMin:Number(a.startMin)||0,duration:Number(a.duration)||60};
}
function normalizeKlant(k){
  return {...k,apts:Number(k.apts)||0,lastDate:k.lastDate?String(k.lastDate).trim().substring(0,10):''};
}
function hideStartupOverlay(){
  const overlay=document.getElementById('startup-overlay');
  if(overlay) overlay.style.display='none';
}


function save(){
  writeCache();
  scheduleCloudSave();
}
// SUPABASE CLOUD
const cloudStorage = {
  getItem(key){ try{return localStorage.getItem(key);}catch(e){return null;} },
  setItem(key,value){ try{localStorage.setItem(key,value);}catch(e){} },
  removeItem(key){ try{localStorage.removeItem(key);}catch(e){} }
};
let supabaseClient = null;
function getSupabaseClient(){
  if(supabaseClient) return supabaseClient;
  if(!window.supabase) return null;
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth:{persistSession:true, autoRefreshToken:true, detectSessionInUrl:false, storageKey:CLOUD_AUTH_STORAGE_KEY, storage:cloudStorage}
  });
  supabaseClient.auth.onAuthStateChange(async (_event, session)=>{
    cloudUser=session?.user||null;
    updateCloudUi();
    if(cloudUser && !cloudReady) await loadFromCloud({silent:true});
  });
  return supabaseClient;
}
function setCloudStatus(state,msg){
  const dot=document.getElementById('cloud-dot'), label=document.getElementById('cloud-label');
  if(!dot||!label) return;
  const colors={ok:'#2d6a4f',error:'#d62828',loading:'#f77f00',off:'var(--muted)'};
  dot.style.background=colors[state]||colors.off;
  label.textContent=msg;
  label.style.color=colors[state]||colors.off;
}
function updateCloudUi(){
  const authed=!!cloudUser;
  const email=document.getElementById('cloud-email');
  const fields=document.getElementById('cloud-auth-fields');
  const login=document.getElementById('cloud-login-btn');
  const logout=document.getElementById('cloud-logout-btn');
  const refresh=document.getElementById('cloud-refresh-btn');
  if(email) email.textContent=authed ? 'Ingelogd als '+cloudUser.email : 'Owner login voor de Fit met Dicky planning.';
  if(fields) fields.style.display=authed?'none':'grid';
  if(login) login.style.display=authed?'none':'block';
  if(logout) logout.style.display=authed?'block':'none';
  if(refresh) refresh.style.display=authed?'inline-block':'none';
  if(authed) setCloudStatus(cloudReady?'ok':'loading', cloudReady?'Cloud verbonden':'Cloud verbinden...');
  else setCloudStatus('off','Niet ingelogd');
}
async function syncCloudSession(){
  const client=getSupabaseClient();
  if(!client){ setCloudStatus('error','Supabase library ontbreekt'); return false; }
  const { data } = await client.auth.getSession();
  cloudUser=data?.session?.user||null;
  updateCloudUi();
  return !!cloudUser;
}
async function cloudLogin(mode){
  const client=getSupabaseClient();
  const email=document.getElementById('cloud-email-input')?.value.trim();
  const password=document.getElementById('cloud-password-input')?.value;
  if(!client || !email || !password){ showToast('Vul e-mail en wachtwoord in'); return; }
  cloudLoading=true; setCloudStatus('loading','Inloggen...');
  const result = await client.auth.signInWithPassword({email,password});
  cloudLoading=false;
  if(result.error){ setCloudStatus('error',result.error.message); showToast(result.error.message); return; }
  cloudUser=result.data?.user||result.data?.session?.user||null;
  updateCloudUi();
  const loaded = await loadFromCloud({silent:true});
  if(loaded) scheduleCloudSave();
}
async function cloudLogout(){
  const client=getSupabaseClient();
  if(!client) return;
  await client.auth.signOut();
  cloudUser=null; cloudReady=false; updateCloudUi();
}
async function loadFromCloud(options={}){
  const client=getSupabaseClient();
  if(!client) return false;
  if(!cloudUser){ await syncCloudSession(); }
  if(!cloudUser) return false;
  setCloudStatus('loading','Cloud ophalen...');
  try{
    const [settingsResult, klantenResult, appointmentsResult] = await withCloudTimeout(Promise.all([
      client.from(CLOUD_SETTINGS_TABLE).select('data,updated_at').eq('user_id', cloudUser.id).maybeSingle(),
      client.from(CLOUD_KLANTEN_TABLE).select('data,updated_at').eq('user_id', cloudUser.id),
      client.from(CLOUD_APPOINTMENTS_TABLE).select('data,updated_at').eq('user_id', cloudUser.id)
    ]), 'Cloud ophalen');

    const firstError = settingsResult.error || klantenResult.error || appointmentsResult.error;
    if(firstError){
      setCloudStatus('error','Cloud fout: '+firstError.message.slice(0,60));
      if(!options.silent) showToast('Cloud fout: '+firstError.message);
      return false;
    }

    const cloudKlanten = normalizeCloudRows(klantenResult.data);
    const cloudAppointments = normalizeCloudRows(appointmentsResult.data);
    const hasCloudData = !!settingsResult.data?.data || cloudKlanten.length || cloudAppointments.length;

    if(hasCloudData){
      applyCloudData({
        settings: settingsResult.data?.data || {},
        klanten: cloudKlanten,
        appointments: cloudAppointments
      });
      cloudReady=true;
      setCloudStatus('ok','Cloud geladen · '+new Date().toLocaleTimeString('nl'));
      if(!options.silent) showToast('Cloud geladen');
      return true;
    }

    cloudReady=true;
    await saveToCloud(true, {silent:true});
    setCloudStatus('ok','Cloud gestart');
    return true;
  }catch(error){
    setCloudStatus('error','Cloud fout: '+error.message.slice(0,80));
    if(!options.silent) showToast('Cloud fout: '+error.message);
    return false;
  }
}
async function saveToCloud(force=false, options={}){
  if(isHydrating && !force) return false;
  const client=getSupabaseClient();
  if(!client) return false;
  if(!cloudUser){ await syncCloudSession(); }
  if(!cloudUser) return false;
  if(cloudSaveInFlight){
    cloudSaveQueued=true;
    return false;
  }
  cloudSaveInFlight=true;
  setCloudStatus('loading','Opslaan...');
  try{
    const now = new Date().toISOString();
    const fixedKlanten = ensureUniqueIds(klanten, 'klant');
    const fixedAppointments = ensureUniqueIds(appointments, 'afspraak');
    if(fixedKlanten.changed) klanten = fixedKlanten.items;
    if(fixedAppointments.changed) appointments = fixedAppointments.items;
    if(fixedKlanten.changed || fixedAppointments.changed) writeCache();

    const settingsPayload = {user_id:cloudUser.id, data:plannerSettingsSnapshot(), updated_at:now};
    const klantRows = klanten.map(k => ({user_id:cloudUser.id, id:String(k.id), data:k, updated_at:now}));
    const appointmentRows = appointments.map(a => ({user_id:cloudUser.id, id:String(a.id), data:a, updated_at:now}));

    const results = await withCloudTimeout(Promise.all([
      client.from(CLOUD_SETTINGS_TABLE).upsert(settingsPayload, {onConflict:'user_id'}),
      syncCloudRows(client, CLOUD_KLANTEN_TABLE, klantRows),
      syncCloudRows(client, CLOUD_APPOINTMENTS_TABLE, appointmentRows)
    ]), 'Opslaan');
    const firstError = results.find(result => result.error)?.error;
    if(firstError){
      setCloudStatus('error','Cloud fout: '+firstError.message.slice(0,60));
      if(!options.silent) showToast('Cloud fout: '+firstError.message);
      return false;
    }

    cloudReady=true;
    setCloudStatus('ok','Automatisch opgeslagen · '+new Date().toLocaleTimeString('nl'));
    if(force && !options.silent) showToast('Opgeslagen');
    return true;
  }catch(error){
    setCloudStatus('error','Cloud fout: '+error.message.slice(0,80));
    if(!options.silent) showToast('Cloud fout: '+error.message);
    return false;
  }finally{
    cloudSaveInFlight=false;
    if(cloudSaveQueued){
      cloudSaveQueued=false;
      setTimeout(()=>saveToCloud(false, {silent:true}), 250);
    }
  }
}
function scheduleCloudSave(){
  if(isHydrating || !cloudUser) return;
  clearTimeout(cloudSaveTimer);
  setCloudStatus('loading','Wijzigingen bewaren...');
  cloudSaveTimer=setTimeout(()=>saveToCloud(false, {silent:true}), 500);
}

// NAVIGATION
function goTab(name){
  const fab=document.getElementById('fab-btn');
  if(fab) fab.style.display = name==='agenda' ? 'flex' : 'none';
  document.querySelectorAll('.view').forEach(v=>v.classList.remove('active'));
  document.querySelectorAll('.nav-tab').forEach(t=>t.classList.remove('active'));
  document.getElementById('v-'+name).classList.add('active');
  const activeTab=document.querySelector('.nav-tab[data-tab="'+name+'"]');
  if(activeTab) activeTab.classList.add('active');
  document.querySelectorAll('.settings-gear-btn').forEach(btn=>btn.classList.toggle('active', name==='instellingen'));
  if(name==='agenda') renderAgenda();
  if(name==='nieuw') renderNieuw();
  if(name==='klanten') renderKlanten('');
  if(name==='behandelingen') renderBehandelingen();
  if(name==='instellingen') initSettings();
}

// AGENDA
function playDaySwitchFeedback(){
  const title = document.getElementById('day-title');
  const slots = document.getElementById('day-slots');
  [title, slots].forEach(el => {
    if(!el) return;
    el.classList.remove('day-switching');
    void el.offsetWidth;
    el.classList.add('day-switching');
  });
}
function shiftWeek(d){ weekOffset+=d; renderAgenda(); }

function renderAgenda(){
  const base = new Date(today); base.setDate(base.getDate()+weekOffset*7);
  const dow = base.getDay()===0?6:base.getDay()-1;
  const ws = new Date(base); ws.setDate(base.getDate()-dow);
  const we = new Date(ws); we.setDate(ws.getDate()+6);
  const months=['jan','feb','mrt','apr','mei','jun','jul','aug','sep','okt','nov','dec'];
  document.getElementById('week-label').textContent = ws.getDate()+' – '+we.getDate()+' '+months[we.getMonth()];
  const days = document.getElementById('week-days'); days.innerHTML='';
  const dayNames=['Ma','Di','Wo','Do','Vr','Za','Zo'];
  for(let i=0;i<7;i++){
    const d=new Date(ws); d.setDate(ws.getDate()+i);
    const dk=dateKey(d), isToday=dk===dateKey(today), isSel=dk===dateKey(selectedDate);
    const hasApt=appointments.some(a=>a.date===dk&&a.type!=='blocked');
    const chip=document.createElement('div');
    chip.className='day-chip'+(isToday?' today':'')+(isSel&&!isToday?' selected':'')+(hasApt?' has-apt':'');
    chip.innerHTML='<div class="day-num">'+d.getDate()+'</div><div class="day-name">'+dayNames[i]+'</div>';
    chip.onclick=()=>{selectedDate=new Date(d);renderAgenda();};
    days.appendChild(chip);
  }
  renderDaySlots(selectedDate);
  playDaySwitchFeedback();
}

function renderDaySlots(date){
  document.getElementById('day-title').textContent=fmtDate(date).toUpperCase();
  const dk=dateKey(date);
  const dayApts=appointments.filter(a=>a.date===dk).sort((a,b)=>a.startMin-b.startMin);
  const slots=document.getElementById('day-slots');
  if(!dayApts.length){ slots.innerHTML='<div class="empty-day"><div class="empty-icon">&#128197;</div><div>Geen afspraken</div></div>'; return; }
  slots.innerHTML='';
  dayApts.forEach(apt=>{
    const timeSlot=document.createElement('div');
    timeSlot.className='time-slot';
    const slotTime=document.createElement('div');
    slotTime.className='slot-time';
    slotTime.textContent=fmtTime(apt.startMin);
    const slotContent=document.createElement('div');
    slotContent.className='slot-content';
    const swipeWrapper=document.createElement('div');
    swipeWrapper.className='swipe-wrapper';
    const deleteBg=document.createElement('div');
    deleteBg.className='swipe-delete-bg';
    deleteBg.innerHTML='&#128465; Verwijder';
    const card=document.createElement('div');
    card.className=`apt-card ${apt.type==='blocked'?'blocked':'confirmed'}`;
    card.innerHTML=`<div class="apt-name">${apt.name}</div><div class="apt-meta">${fmtTime(apt.startMin)} \u2013 ${fmtTime(apt.startMin+apt.duration)} \u00b7 ${apt.treatment||'Massage'}</div><span class="apt-badge ${apt.type==='blocked'?'blocked':'confirmed'}">${apt.type==='blocked'?'Geblokkeerd':'Bevestigd'}</span>`;
    let startX=0,currentX=0,moved=false;
    const THRESHOLD=80;
    card.addEventListener('touchstart',e=>{
      startX=e.touches[0].clientX; currentX=0; moved=false;
      card.style.transition='none';
    },{passive:true});
    card.addEventListener('touchmove',e=>{
      const dx=e.touches[0].clientX-startX;
      if(dx<0){
        moved=true;
        currentX=Math.max(dx,-THRESHOLD*1.5);
        card.style.transform=`translateX(${currentX}px)`;
        deleteBg.style.opacity=String(Math.min(Math.abs(currentX)/THRESHOLD,1));
      }
    },{passive:true});
    card.addEventListener('touchend',()=>{
      card.style.transition='transform .3s ease';
      if(Math.abs(currentX)>=THRESHOLD){
        card.style.transform='translateX(-100%)';
        setTimeout(()=>deleteApt(apt.id),300);
      } else {
        card.style.transform='translateX(0)';
        deleteBg.style.opacity='0';
      }
      currentX=0;
    });
    card.addEventListener('click',()=>{ if(!moved) openAptModal(apt.id); moved=false; });
    swipeWrapper.appendChild(deleteBg);
    swipeWrapper.appendChild(card);
    slotContent.appendChild(swipeWrapper);
    timeSlot.appendChild(slotTime);
    timeSlot.appendChild(slotContent);
    slots.appendChild(timeSlot);
  });
  const realApts=dayApts.filter(a=>a.type!=='blocked');
  if(realApts.length){
    const exclTotal=realApts.reduce((sum,a)=>sum+(Number(a.hourlyRate||0)*Number(a.duration||0)/60),0);
    const fmt=v=>'€ '+v.toFixed(2).replace('.',',').replace(/(\d)(?=(\d{3})+,)/g,'$1.');
    const summary=document.createElement('div');
    summary.className='day-summary';
    const countEl=document.createElement('span');
    countEl.textContent=`${realApts.length} ${realApts.length!==1?'afspraken':'afspraak'}`;
    const right=document.createElement('div');
    right.className='day-summary-right';
    const totalEl=document.createElement('span');
    totalEl.className='day-summary-total';
    totalEl.textContent=fmt(exclTotal);
    const toggle=document.createElement('button');
    toggle.className='btw-toggle';
    toggle.textContent='excl. btw';
    let inclBtw=false;
    toggle.onclick=()=>{
      inclBtw=!inclBtw;
      toggle.textContent=inclBtw?'incl. btw':'excl. btw';
      toggle.classList.toggle('active',inclBtw);
      totalEl.textContent=fmt(inclBtw?exclTotal*1.21:exclTotal);
    };
    right.appendChild(totalEl);
    right.appendChild(toggle);
    summary.appendChild(countEl);
    summary.appendChild(right);
    slots.appendChild(summary);
  }
}

// ── QUICK ADD (slide-per-slide) ──
let qa = { step:1, klantId:'', voornaam:'', achternaam:'', tel:'', email:'',
           datum:'', time:null, dur:defaultBehandeling().duur, treatmentId:defaultBehandeling().id, treatment:defaultBehandeling().naam, hourlyRate:defaultBehandeling().uurtarief, notitie:'' };

function openQuickAdd(){
  const treatment=defaultBehandeling();
  qa = { step:1, klantId:'', voornaam:'', achternaam:'', tel:'', email:'',
         datum:dateKey(selectedDate), time:null, dur:treatment.duur, treatmentId:treatment.id, treatment:treatment.naam, hourlyRate:treatment.uurtarief, notitie:'' };
  document.getElementById('quick-overlay').style.display='flex';
  requestAnimationFrame(()=>{ document.getElementById('quick-sheet').style.transform='translateY(0)'; });
  qaRender();
}

function closeQuickAdd(){
  document.getElementById('quick-sheet').style.transform='translateY(100%)';
  setTimeout(()=>{ document.getElementById('quick-overlay').style.display='none'; }, 300);
}

function qaSetDots(step){
  [1,2,3].forEach(i=>{
    document.getElementById('qa-dot'+i).style.background = i===step ? 'var(--red)' : 'var(--border)';
  });
  const titles = ['Klantgegevens','Datum & tijd','Behandeling & notitie'];
  document.getElementById('qa-title').textContent = titles[step-1];
  document.getElementById('qa-back').style.display = step>1 ? 'block' : 'none';
  document.getElementById('qa-next').textContent = step===3 ? 'Inplannen' : 'Volgende';
}

function qaRender(){
  qaSetDots(qa.step);
  const body = document.getElementById('qa-body');

  if(qa.step===1){
    const sorted = [...klanten].sort((a,b)=>a.name.localeCompare(b.name));
    body.innerHTML = `
      <div style="margin-bottom:12px">
        <div class="form-label">Bestaande klant</div>
        <select class="form-select" id="qa-klant" onchange="qaSelectKlant(this.value)">
          <option value="">— Nieuwe klant —</option>
          ${sorted.map(k=>`<option value="${k.id}" ${qa.klantId===k.id?'selected':''}>${k.name}${k.tel?' · '+k.tel:''}</option>`).join('')}
        </select>
      </div>
      <div id="qa-klant-info" style="${qa.klantId ? '' : 'display:none'}">
        <div style="background:var(--off);border:1.5px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:12px;font-size:13px">
          <div style="font-weight:600;color:var(--blue)">${qa.voornaam} ${qa.achternaam}</div>
          <div style="color:var(--muted);margin-top:2px">${qa.tel || ''}${qa.tel&&qa.email?' · ':''}${qa.email || ''}</div>
        </div>
      </div>
      <div id="qa-klant-fields" style="${qa.klantId ? 'display:none' : ''}">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-bottom:10px">
          <div><div class="form-label">Voornaam</div><input class="form-input" id="qa-vn" type="text" placeholder="Voornaam" value="${qa.voornaam}" oninput="qa.voornaam=this.value" style="margin:0"></div>
          <div><div class="form-label">Achternaam</div><input class="form-input" id="qa-an" type="text" placeholder="Achternaam" value="${qa.achternaam}" oninput="qa.achternaam=this.value" style="margin:0"></div>
        </div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div><div class="form-label">Telefoon</div><input class="form-input" id="qa-tel" type="tel" placeholder="06-" value="${qa.tel}" oninput="qa.tel=this.value" style="margin:0"></div>
          <div><div class="form-label">E-mail</div><input class="form-input" id="qa-email" type="email" placeholder="@" value="${qa.email}" oninput="qa.email=this.value" style="margin:0"></div>
        </div>
      </div>`;

  } else if(qa.step===2){
    const dk = qa.datum || dateKey(selectedDate);
    const dur = qa.dur;
    const dayApts = appointments.filter(a=>a.date===dk);
    const slots = [];
    for(let m=WORK_START*60; m+dur<=WORK_END*60; m+=SLOT_STEP){
      const conflict = dayApts.some(a=>m<a.startMin+a.duration && m+dur>a.startMin);
      slots.push({min:m, conflict, label:fmtTime(m)});
    }
    body.innerHTML = `
      <div style="margin-bottom:14px">
        <div class="form-label">Datum</div>
        <input class="form-input" id="qa-datum" type="date" value="${dk}" onchange="qa.datum=this.value;qa.time=null;qaRender()" style="margin:0">
      </div>
      <div style="margin-bottom:8px">
        <div class="form-label">Behandeling duur</div>
        <select class="form-select" id="qa-type" onchange="setQuickTreatment(this.value)" style="margin:0">
          ${behandelingen.map(b=>`<option value="${escapeHtml(b.id)}" ${qa.treatmentId===b.id?'selected':''}>${escapeHtml(treatmentLabel(b))}</option>`).join('')}
        </select>
      </div>
      <div class="form-label">Beschikbare tijden</div>
      <div class="avail-strip">${slots.map(sl=>`
        <div class="avail-slot ${sl.conflict?'busy':'free'}${qa.time===sl.min?' selected':''}"
          onclick="${sl.conflict?'':'qaPickTime('+sl.min+')'}">${sl.label}</div>`).join('')}
      </div>
      ${qa.time!==null?`<div style="margin-top:10px;text-align:center;font-size:13px;color:var(--blue);font-weight:600">${fmtTime(qa.time)} – ${fmtTime(qa.time+qa.dur)} geselecteerd</div>`:''}`;

  } else if(qa.step===3){
    body.innerHTML = `
      <div style="background:var(--off);border-radius:14px;padding:14px 16px;margin-bottom:16px">
        <div style="font-size:15px;font-weight:700;color:var(--blue);margin-bottom:4px">${qa.voornaam} ${qa.achternaam}</div>
        <div style="font-size:13px;color:var(--muted)">${fmtDate(parseDate(qa.datum))} · ${fmtTime(qa.time)} – ${fmtTime(qa.time+qa.dur)}</div>
        <div style="font-size:13px;color:var(--muted)">${qa.treatment}</div>
      </div>
      <div style="margin-bottom:12px">
        <div class="form-label">Notitie (optioneel)</div>
        <textarea class="form-textarea" id="qa-notitie" placeholder="Bijv. rugklachten, voorkeur..." oninput="qa.notitie=this.value" style="height:80px">${qa.notitie}</textarea>
      </div>`;
  }
}

function qaSelectKlant(id){
  qa.klantId = id;
  if(!id){ qa.voornaam='';qa.achternaam='';qa.tel='';qa.email=''; qaRender(); return; }
  const k = klanten.find(c=>c.id===id);
  if(!k) return;
  qa.voornaam   = k.voornaam || k.name.split(' ')[0] || '';
  qa.achternaam = k.achternaam || k.name.split(' ').slice(1).join(' ') || '';
  qa.tel   = k.tel   || '';
  qa.email = k.email || '';
  qaRender();
}

function qaPickTime(min){
  qa.time = min;
  qaRender();
}

function qaBack(){ if(qa.step>1){ qa.step--; qaRender(); } }

function qaNext(){
  if(qa.step===1){
    if(!qa.voornaam){ showToast('Vul een voornaam in'); return; }
    qa.step=2; qaRender();
  } else if(qa.step===2){
    if(!qa.datum){ showToast('Kies een datum'); return; }
    if(qa.time===null){ showToast('Kies een tijdstip'); return; }
    qa.step=3; qaRender();
  } else {
    // Save appointment
    const naam = (qa.voornaam+' '+qa.achternaam).trim();
    const apt = {
      id: Date.now().toString(), name: naam,
      voornaam: qa.voornaam, achternaam: qa.achternaam,
      tel: qa.tel, email: qa.email,
      date: qa.datum, startMin: qa.time, duration: qa.dur,
      treatmentId: qa.treatmentId, treatment: qa.treatment, hourlyRate: qa.hourlyRate, notitie: qa.notitie,
      status:'confirmed', type:'appointment',
      notifMethod:'geen', createdAt: new Date().toISOString()
    };
    appointments.push(apt);
    // Auto-save klant
    const existing = klanten.find(k=>(k.tel&&k.tel===qa.tel)||(k.email&&k.email===qa.email));
    if(existing){ existing.apts=(existing.apts||0)+1; existing.lastDate=qa.datum; }
    else if(naam){ klanten.push({id:(Date.now()+1).toString(),name:naam,voornaam:qa.voornaam,achternaam:qa.achternaam,tel:qa.tel,email:qa.email,apts:1,lastDate:qa.datum}); }
    save();
    closeQuickAdd();
    selectedDate = parseDate(qa.datum);
    renderAgenda();
    showToast('Afspraak voor '+qa.voornaam+' ingepland!');
    if(apt.email||apt.tel) setTimeout(()=>openSendModal(apt), 400);
  }
}

async function syncKlanten(){
  const ok = await loadFromCloud();
  if(ok){
    renderKlanten('');
    showToast('Klanten bijgewerkt');
  }else{
    showToast(cloudUser ? 'Cloud ophalen mislukt' : 'Log eerst in');
  }
}

async function refreshAgenda(){
  const btn=document.querySelector('.week-btn[onclick*="refreshAgenda"]');
  if(btn){btn.style.opacity='.5';}
  const ok = await loadFromCloud();
  if(ok) showToast('Agenda bijgewerkt');
  else showToast(cloudUser ? 'Cloud ophalen mislukt' : 'Log eerst in');
  if(btn){btn.style.opacity='1';}
  renderAgenda();
}
// AVAILABILITY
function updateAvailability(){
  const dateVal=document.getElementById('f-datum').value;
  selectedTime=null;
  validateForm();
  if(!dateVal){document.getElementById('avail-strip').innerHTML='<span style="font-size:12px;color:var(--muted)">Kies eerst een datum</span>';return;}
  const dur=getSelectedTreatment('f-type').duur;
  const date=parseDate(dateVal);
  if(blockedDays.includes(date.getDay())){
    document.getElementById('avail-strip').innerHTML='<span style="font-size:12px;color:var(--red);font-weight:600">Deze dag is geblokkeerd</span>';
    return;
  }
  const dk=dateKey(date);
  const dayApts=appointments.filter(a=>a.date===dk);
  const slotsHtml=[];
  for(let min=WORK_START*60;min+dur<=WORK_END*60;min+=SLOT_STEP){
    const conflict=dayApts.some(a=>min<a.startMin+a.duration&&min+dur>a.startMin);
    const cls=conflict?(dayApts.find(a=>a.date===dk&&min>=a.startMin&&min<a.startMin+a.duration)?.type==='blocked'?'blocked':'busy'):'free';
    slotsHtml.push('<div class="avail-slot '+cls+'" onclick="'+(conflict?'':('selectTime('+min+',this)'))+'">'+fmtTime(min)+'</div>');
  }
  document.getElementById('avail-strip').innerHTML=slotsHtml.join('');
}

function selectTime(min,el){
  selectedTime=min;
  document.querySelectorAll('.avail-slot.free').forEach(s=>s.classList.remove('selected'));
  el.classList.add('selected');
  validateForm();
}

// VALIDATION
function validateForm(){
  const vn=document.getElementById('f-voornaam')?.value.trim();
  const tel=document.getElementById('f-tel')?.value.trim();
  const email=document.getElementById('f-email')?.value.trim();
  const btn=document.getElementById('submit-btn');
  const hint=document.getElementById('form-hint');
  if(!btn) return;
  const missing=[];
  if(!vn) missing.push('voornaam');
  if(selectedTime===null) missing.push('tijdstip');
  if(!tel&&!email) missing.push('telefoon of e-mail');
  if(missing.length===0){
    btn.disabled=false; btn.style.opacity='1'; if(hint) hint.textContent='';
  } else {
    btn.disabled=true; btn.style.opacity='.4';
    if(hint) hint.textContent='Nog invullen: '+missing.join(', ');
  }
}

// MAIL PREVIEW
function buildMailBody(apt){
  const dateStr=fmtDate(parseDate(apt.date));
  const tijdStr=fmtTime(apt.startMin)+' - '+fmtTime(apt.startMin+apt.duration);
  const firstName=apt.voornaam||apt.name.split(' ')[0]||'';
  const rawTemplate=String(msgTemplate||'').replace(/\\n/g,'\n');
  return rawTemplate
    .replace(/\[voornaam\]/g,firstName)
    .replace(/\[achternaam\]/g,apt.achternaam||'')
    .replace(/\[naam\]/g,apt.name||firstName)
    .replace(/\[datum\]/g,dateStr)
    .replace(/\[tijd\]/g,tijdStr)
    .replace(/\[behandeling\]/g,apt.treatment||'Massage');
}
function buildMailHtmlBody(apt){
  return escapeHtml(buildMailBody(apt)).replace(/\n/g,'<br>');
}
function updateSettingsPreview(){
  const p=document.getElementById('msg-preview-settings'); if(!p) return;
  const demo={voornaam:'Sanne', achternaam:'Jansen', name:'Sanne Jansen', date:dateKey(selectedDate), startMin:10*60, duration:60, treatment:'Massage 60 min'};
  p.textContent=buildMailBody(demo);
}

// SAVE APPOINTMENT
function saveAppointment(){
  const voornaam=document.getElementById('f-voornaam').value.trim();
  const achternaam=document.getElementById('f-achternaam').value.trim();
  const naam=(voornaam+' '+achternaam).trim();
  const tel=document.getElementById('f-tel').value.trim();
  const email=document.getElementById('f-email').value.trim();
  const datum=document.getElementById('f-datum').value;
  const treatment=getSelectedTreatment('f-type');
  const dur=treatment.duur;
  const type=treatment.naam;
  const notitie=document.getElementById('f-notitie').value.trim();
  if(!voornaam||!datum||selectedTime===null) return;
  const apt={id:Date.now().toString(),name:naam,voornaam,achternaam,tel,email,date:datum,startMin:selectedTime,duration:dur,treatmentId:treatment.id,treatment:type,hourlyRate:treatment.uurtarief,notitie,status:'confirmed',type:'appointment',createdAt:new Date().toISOString()};
  appointments.push(apt);
  // Save/update klant
  const existing=klanten.find(k=>(k.tel&&k.tel===tel)||(k.email&&k.email===email));
  if(existing){existing.apts=(existing.apts||0)+1;existing.lastDate=datum;existing.voornaam=voornaam;existing.achternaam=achternaam;existing.name=naam;if(tel)existing.tel=tel;if(email)existing.email=email;}
  else{klanten.push({id:(Date.now()+1).toString(),name:naam,voornaam,achternaam,tel,email,apts:1,lastDate:datum});}
  save();
  // Reset form
  ['f-voornaam','f-achternaam','f-tel','f-email','f-notitie'].forEach(id=>{const el=document.getElementById(id);if(el)el.value='';});
  document.getElementById('f-datum').value=''; document.getElementById('f-klant-select').value='';
  document.getElementById('avail-strip').innerHTML='<span style="font-size:12px;color:var(--muted)">Kies eerst een datum</span>';
  // Reset klant summary
  const summary=document.getElementById('klant-summary');
  const velden=document.getElementById('klant-velden');
  if(summary) summary.style.display='none';
  if(velden)  velden.style.display='';
  selectedTime=null; validateForm();
  selectedDate=parseDate(datum);
  goTab('agenda');
  openSendModal(apt);
}

// SEND MODAL
function openSendModal(apt){
  pendingSendApt=apt;
  const dateStr=fmtDate(parseDate(apt.date));
  document.getElementById('send-apt-line').textContent=(apt.voornaam||apt.name)+' '+(apt.achternaam||'')+' · '+dateStr+' '+fmtTime(apt.startMin);
  const container=document.getElementById('send-options'); container.innerHTML='';
  const calContainer=document.getElementById('send-calendar-btn'); calContainer.innerHTML='';
  if(apt.email){
    const btn=document.createElement('button'); btn.className='send-opt'; btn.onclick=()=>confirmSendEmail(apt);
    btn.innerHTML='<span class="send-opt-icon">\u2709\ufe0f</span><div class="send-opt-text"><div class="send-opt-label">Bevestigingsmail sturen</div><div class="send-opt-sub">'+apt.email+'</div></div><span class="send-opt-arrow">\u203a</span>';
    container.appendChild(btn);
  } else {
    const d=document.createElement('div'); d.className='send-info'; d.textContent='Geen e-mailadres bekend';
    container.appendChild(d);
  }
  if(window.innerWidth<768){
    const calBtn=document.createElement('button'); calBtn.className='send-opt'; calBtn.onclick=()=>doExportCalendar(apt.id);
    calBtn.innerHTML='<span class="send-opt-icon">\ud83d\udcc5</span><div class="send-opt-text"><div class="send-opt-label">Toevoegen aan Agenda</div><div class="send-opt-sub">Voeg toe aan agenda</div></div><span class="send-opt-arrow">\u203a</span>';
    calContainer.appendChild(calBtn);
  }
  document.getElementById('send-overlay').style.display='flex';
}

function confirmSendEmail(apt){
  const c=document.getElementById('send-options'); c.innerHTML='';
  const msg=document.createElement('div'); msg.className='send-confirm-msg';
  msg.innerHTML='Bevestigingsmail sturen naar <strong>'+apt.email+'</strong>?';
  const row=document.createElement('div'); row.className='send-confirm-row';
  const no=document.createElement('button'); no.className='send-confirm-no'; no.textContent='Annuleer'; no.onclick=()=>openSendModal(apt);
  const yes=document.createElement('button'); yes.className='send-confirm-yes'; yes.textContent='Ja, verstuur'; yes.onclick=()=>sendViaEmail(apt.id);
  row.appendChild(no); row.appendChild(yes);
  c.appendChild(msg); c.appendChild(row);
}

function closeSendModal(){ document.getElementById('send-overlay').style.display='none'; pendingSendApt=null; }

async function sendViaEmail(id){
  const apt=appointments.find(a=>a.id===id)||pendingSendApt; if(!apt) return;
  const c=document.getElementById('send-options'); c.innerHTML='';
  const d=document.createElement('div'); d.className='send-info'; d.textContent='E-mail voorbereiden...';
  c.appendChild(d);
  const result=await sendConfirmationMail(apt);
  if(result.method==='emailjs'){ d.textContent='Bevestigingsmail verstuurd.'; return; }
  d.textContent=result.message||'Automatisch mailen lukte niet.';
  if(apt.email){
    const a=document.createElement('a'); a.className='send-opt'; a.href=buildMailtoHref(apt);
    a.innerHTML='<span class="send-opt-icon">&#9993;</span><div class="send-opt-text"><div class="send-opt-label">Open mail-app handmatig</div><div class="send-opt-sub">Alleen als automatisch niet werkt</div></div><span class="send-opt-arrow">&#8250;</span>';
    c.appendChild(a);
  }
}

function doExportCalendar(id){
  const apt=appointments.find(a=>a.id===id)||pendingSendApt; if(apt) exportToCalendar(apt);
  closeSendModal();
}

// APT MODAL
function openAptModal(id){
  const apt=appointments.find(a=>a.id===id); if(!apt) return;
  document.getElementById('apt-modal-title').textContent=apt.type==='blocked'?'Geblokkeerd':apt.name;
  const dateObj=parseDate(apt.date);
  document.getElementById('apt-modal-body').innerHTML=`
    <div class="detail-row"><span class="detail-label">Datum</span><span class="detail-value">${fmtDate(dateObj)}</span></div>
    <div class="detail-row"><span class="detail-label">Tijd</span><span class="detail-value">${fmtTime(apt.startMin)} – ${fmtTime(apt.startMin+apt.duration)}</span></div>
    ${apt.type!=='blocked'?`
    <div class="detail-row"><span class="detail-label">Behandeling</span><span class="detail-value">${apt.treatment}</span></div>
    <div class="detail-row"><span class="detail-label">Telefoon</span><span class="detail-value">${apt.tel||'&#8212;'}</span></div>
    <div class="detail-row"><span class="detail-label">E-mail</span><span class="detail-value">${apt.email||'&#8212;'}</span></div>
    ${apt.notitie?'<div class="detail-row"><span class="detail-label">Notitie</span><span class="detail-value">'+apt.notitie+'</span></div>':''}`:''}
    <div class="modal-action-row">
      ${apt.type!=='blocked'&&(apt.email||apt.tel)?`<button class="modal-btn primary" onclick="openSendModal(appointments.find(a=>a.id==='${apt.id}'))">Stuur bericht</button>`:''}\n      <button class="modal-btn danger" onclick="deleteApt('${apt.id}')">Verwijder</button>
    </div>`;
  document.getElementById('apt-overlay').classList.add('open');
}
function closeAptModal(){ document.getElementById('apt-overlay').classList.remove('open'); }
function deleteApt(id){ appointments=appointments.filter(a=>a.id!==id); save(); closeAptModal(); renderAgenda(); showToast('Afspraak verwijderd.'); }

// CALENDAR EXPORT
async function exportToCalendar(apt){
  const [y,mo,d]=apt.date.split('-').map(Number);
  const sH=Math.floor(apt.startMin/60),sM=apt.startMin%60;
  const em=apt.startMin+apt.duration,eH=Math.floor(em/60),eMi=em%60;
  const pad=n=>String(n).padStart(2,'0');
  const dtStart=y+''+pad(mo)+pad(d)+'T'+pad(sH)+pad(sM)+'00';
  const dtEnd=y+''+pad(mo)+pad(d)+'T'+pad(eH)+pad(eMi)+'00';
  const dtStamp=new Date().toISOString().replace(/[-:]/g,'').split('.')[0]+'Z';
  const ics=['BEGIN:VCALENDAR','VERSION:2.0','PRODID:-//Fit met Dicky//NL','CALSCALE:GREGORIAN','METHOD:PUBLISH','BEGIN:VEVENT','UID:'+apt.id+'@fitmetdicky','DTSTAMP:'+dtStamp,'DTSTART:'+dtStart,'DTEND:'+dtEnd,'SUMMARY:'+apt.name+' \u2014 '+apt.treatment,'DESCRIPTION:'+apt.treatment+(apt.tel?'\\nTel: '+apt.tel:''),'LOCATION:Fit met Dicky','END:VEVENT','END:VCALENDAR'].join('\r\n');
  const filename='afspraak-'+apt.name.split(' ')[0].toLowerCase()+'-'+apt.date+'.ics';

  // Web Share API — werkt op iOS Safari en geeft native "Voeg toe aan Agenda" optie
  if(navigator.share && navigator.canShare){
    const file=new File([ics],filename,{type:'text/calendar'});
    if(navigator.canShare({files:[file]})){
      try{
        await navigator.share({files:[file],title:'Afspraak '+apt.name});
        showToast('Kalenderitem aangemaakt!');
        return;
      }catch(e){ if(e.name==='AbortError') return; }
    }
  }

  // Fallback: data URI (werkt in Safari waar blob-URL geblokkeerd wordt)
  const dataUri='data:text/calendar;charset=utf-8,'+encodeURIComponent(ics);
  const a=document.createElement('a'); a.href=dataUri;
  if(window.innerWidth>=768) a.download=filename;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  showToast('Kalenderitem aangemaakt!');
}

// MAIL
function getEmailAutomationConfig(){
  return {
    pubkey: EMAILJS_PUBLIC_KEY || ejsSettings.pubkey,
    service: EMAILJS_SERVICE_ID || ejsSettings.service,
    template: EMAILJS_TEMPLATE_ID || ejsSettings.template,
    auto: EMAILJS_AUTO_SEND || ejsSettings.auto
  };
}
function isEmailAutomationReady(){
  const cfg=getEmailAutomationConfig();
  return !!(cfg.auto && cfg.pubkey && cfg.service && cfg.template && window.emailjs);
}
function formatEmailJsError(e){
  if(!e) return 'Onbekende fout';
  if(typeof e === 'string') return e;
  return e.text || e.message || JSON.stringify(e);
}
function buildMailtoHref(apt){
  const subject=encodeURIComponent('Bevestiging afspraak - '+fmtDate(parseDate(apt.date)));
  return 'mailto:'+apt.email+'?subject='+subject+'&body='+encodeURIComponent(buildMailBody(apt));
}
async function sendConfirmationMail(apt){
  const body=buildMailBody(apt);
  const cfg=getEmailAutomationConfig();
  if(!apt.email) return {method:'none',message:'Geen e-mailadres beschikbaar.'};
  if(!(cfg.auto && cfg.pubkey && cfg.service && cfg.template)){
    return {method:'not-ready',message:'EmailJS is nog niet volledig ingesteld.'};
  }
  if(!window.emailjs){
    return {method:'not-ready',message:'EmailJS script is niet geladen. Check je internetverbinding of browserblokkering.'};
  }
  try{
        const templateParams={
      to_email: apt.email,
      email: apt.email,
      recipient_email: apt.email,
      reply_to: apt.email,
      to_name: apt.name,
      name: apt.name,
      message: body,
      message_html: buildMailHtmlBody(apt),
      appointment_date: apt.date,
      appointment_time: fmtTime(apt.startMin),
      treatment: apt.treatment
    };
    await emailjs.send(cfg.service,cfg.template,templateParams,{publicKey:cfg.pubkey});
    showToast('Bevestigingsmail verstuurd!');
    return {method:'emailjs'};
  }catch(e){
    console.error('EmailJS:',e);
    const msg=formatEmailJsError(e);
    showToast('Automatisch mailen mislukt.');
    return {method:'failed',message:'EmailJS fout: '+msg};
  }
}
// KLANTEN
function populateKlantDropdown(){
  const sel=document.getElementById('f-klant-select'); if(!sel) return;
  const sorted=[...klanten].sort((a,b)=>a.name.localeCompare(b.name));
  sel.innerHTML='<option value="">— Nieuwe klant —</option>'+sorted.map(k=>'<option value="'+k.id+'">'+k.name+(k.tel?' · '+k.tel:'')+'</option>').join('');
}

function selectKlant(id){
  const velden  = document.getElementById('klant-velden');
  const summary = document.getElementById('klant-summary');

  if(!id){
    // Nieuwe klant — toon velden, verberg samenvatting, leeg velden
    velden.style.display  = '';
    summary.style.display = 'none';
    ['f-voornaam','f-achternaam','f-tel','f-email'].forEach(i=>{
      const el=document.getElementById(i); if(el) el.value='';
    });
    validateForm();
    return;
  }

  const k = klanten.find(c=>c.id===id);
  if(!k) return;

  // Vul hidden velden in voor saveAppointment
  document.getElementById('f-voornaam').value  = k.voornaam || k.name.split(' ')[0] || '';
  document.getElementById('f-achternaam').value = k.achternaam || k.name.split(' ').slice(1).join(' ') || '';
  document.getElementById('f-tel').value   = k.tel   || '';
  document.getElementById('f-email').value = k.email || '';

  // Toon samenvatting, verberg velden
  document.getElementById('klant-summary-naam').textContent = k.name;
  document.getElementById('klant-summary-sub').textContent  =
    [k.tel, k.email].filter(Boolean).join(' · ') || 'Geen contactgegevens';
  velden.style.display  = 'none';
  summary.style.display = '';

  validateForm();
}

function clearKlantSelect(){
  document.getElementById('f-klant-select').value = '';
  selectKlant('');
}

function toggleKlantForm(){
  const form=document.getElementById('klant-form'), btn=document.getElementById('klant-add-btn');
  const open=form.style.display==='none';
  form.style.display=open?'block':'none'; btn.textContent=open?'\u2715 Sluiten':'+ Klant';
  if(open) document.getElementById('nk-voornaam').focus();
}

function saveNewKlant(){
  const vn=document.getElementById('nk-voornaam').value.trim(), an=document.getElementById('nk-achternaam').value.trim(), tel=document.getElementById('nk-tel').value.trim(), email=document.getElementById('nk-email').value.trim();
  if(!vn){showToast('Vul minimaal een voornaam in');return;}
  const naam=(vn+' '+an).trim();
  klanten.push({id:Date.now().toString(),name:naam,voornaam:vn,achternaam:an,tel,email,apts:0,lastDate:''});
  save(); ['nk-voornaam','nk-achternaam','nk-tel','nk-email'].forEach(id=>document.getElementById(id).value='');
  toggleKlantForm(); renderKlanten(''); showToast(naam+' toegevoegd!');
}

function renderKlanten(q){
  const list=document.getElementById('klant-list-items');
  const filtered=klanten.filter(k=>!q||k.name.toLowerCase().includes(q.toLowerCase()));
  if(!filtered.length){list.innerHTML='<div style="text-align:center;padding:40px 0;color:var(--muted)"><div style="font-size:36px;margin-bottom:8px">👤</div><div style="font-size:14px">'+(q?'Geen resultaten':'Nog geen klanten')+'</div></div>';return;}
  list.innerHTML=filtered.map((k,index)=>{
    const fullName=((k.voornaam||'')+' '+(k.achternaam||'')).trim()||k.name||'Zonder naam';
    const contact=[k.tel||'',k.email||''].filter(Boolean).join(' · ')||'Geen contactgegevens';
    const aptLabel=(k.apts||0)===1?'1 afspraak':(k.apts||0)+' afspraken';
    const lastLabel=k.lastDate?fmtDate(parseDate(k.lastDate)):'Nog geen afspraak';
    return `
      <div class="klant-card">
        <div class="klant-avatar" style="background:${avatarClr(fullName)}">${initials(fullName)}</div>
        <div class="klant-main">
          <div class="klant-card-top">
            <div class="klant-name-wrap">
              <div class="klant-name">${fullName}</div>
              <div class="klant-meta">${contact}</div>
            </div>
            <div class="klant-actions">
              <button onclick="openEditKlantByIndex(${index},event)" class="klant-btn edit">Wijzig</button>
              <button onclick="deleteKlantByIndex(${index},event)" class="klant-btn delete">Verwijder</button>
            </div>
          </div>
          <div class="klant-apts">${aptLabel} · ${lastLabel}</div>
        </div>
      </div>`;
  }).join('');
}

function openEditKlantByIndex(index, e){
  if(e) e.stopPropagation();
  const k = klanten[index]; if(!k) return;
  const esc = (v='') => String(v).replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;');
  const overlay = document.createElement('div');
  overlay.id = 'edit-klant-overlay';
  overlay.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.48);z-index:400;display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(8px)';
  overlay.innerHTML = `
    <div style="background:var(--white);border-radius:24px 24px 0 0;width:100%;max-width:520px;margin:0 auto;padding-bottom:calc(env(safe-area-inset-bottom,0px)+24px)">
      <div style="width:36px;height:4px;background:var(--border);border-radius:99px;margin:12px auto"></div>
      <div style="padding:0 24px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between">
        <div style="font-family:'Playfair Display',serif;font-size:18px;font-weight:700;color:var(--blue)">Klant bewerken</div>
        <div style="width:30px;height:30px;background:var(--off);border:1px solid var(--border);border-radius:50%;display:flex;align-items:center;justify-content:center;cursor:pointer;color:var(--muted);font-size:16px" onclick="document.getElementById('edit-klant-overlay').remove()">×</div>
      </div>
      <div style="padding:20px 24px;display:flex;flex-direction:column;gap:12px">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text);margin-bottom:5px">Voornaam</div>
            <input id="ek-voornaam" class="form-input" type="text" value="${esc(k.voornaam||String(k.name||'').split(' ')[0]||'')}" style="margin-bottom:0">
          </div>
          <div>
            <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text);margin-bottom:5px">Achternaam</div>
            <input id="ek-achternaam" class="form-input" type="text" value="${esc(k.achternaam||String(k.name||'').split(' ').slice(1).join(' ')||'')}" style="margin-bottom:0">
          </div>
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text);margin-bottom:5px">Telefoon</div>
          <input id="ek-tel" class="form-input" type="tel" value="${esc(k.tel||'')}" style="margin-bottom:0">
        </div>
        <div>
          <div style="font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;color:var(--text);margin-bottom:5px">E-mail</div>
          <input id="ek-email" class="form-input" type="email" value="${esc(k.email||'')}" style="margin-bottom:0">
        </div>
        <button onclick="saveEditKlantByIndex(${index})" style="width:100%;background:var(--blue);color:white;border:none;border-radius:14px;padding:15px;font-family:'DM Sans',sans-serif;font-size:15px;font-weight:700;cursor:pointer;margin-top:4px">
          Opslaan
        </button>
      </div>
    </div>`;
  overlay.addEventListener('click', ev => { if(ev.target===overlay) overlay.remove(); });
  document.body.appendChild(overlay);
}

function saveEditKlantByIndex(index){
  const k = klanten[index]; if(!k) return;
  const old = {...k};
  const vn = document.getElementById('ek-voornaam').value.trim();
  const an = document.getElementById('ek-achternaam').value.trim();
  if(!vn){ showToast('Voornaam is verplicht'); return; }
  k.voornaam = vn;
  k.achternaam = an;
  k.name = (vn+' '+an).trim();
  k.tel = document.getElementById('ek-tel').value.trim();
  k.email = document.getElementById('ek-email').value.trim();

  appointments = appointments.map(a=>{
    const sameByEmail = old.email && a.email && String(a.email).trim().toLowerCase()===String(old.email).trim().toLowerCase();
    const sameByTel = old.tel && a.tel && String(a.tel).replace(/\D/g,'')===String(old.tel).replace(/\D/g,'');
    const sameByName = String(a.name||'').trim()===String(old.name||'').trim();
    if(sameByEmail || sameByTel || sameByName){
      return {...a, name:k.name, voornaam:k.voornaam, achternaam:k.achternaam, tel:k.tel, email:k.email};
    }
    return a;
  });

  save();
  document.getElementById('edit-klant-overlay')?.remove();
  renderKlanten(document.querySelector('.klant-list input')?.value||'');
  populateKlantDropdown();
  showToast(k.name+' bijgewerkt!');
}

function deleteKlantByIndex(index,e){
  if(e) e.stopPropagation();
  const k=klanten[index];
  if(!k) return;
  if(!confirm('Klant verwijderen?')) return;
  klanten.splice(index,1);
  save();
  renderKlanten(document.querySelector('.klant-list input')?.value||'');
  populateKlantDropdown();
  showToast('Klant verwijderd.');
}

// FORM INIT
function renderNieuw(){
  const d=new Date(); d.setHours(0,0,0,0);
  document.getElementById('f-datum').min=dateKey(d);
  document.getElementById('f-datum').value=dateKey(selectedDate);
  populateKlantDropdown(); populateTreatmentSelect('f-type'); updateAvailability(); validateForm();
}

// SETTINGS
function initSettings(){
  updateCloudUi();
}


// TOAST
function showToast(msg){
  const t=document.createElement('div');
  t.textContent=msg; t.style.cssText='position:fixed;bottom:calc(env(safe-area-inset-bottom,0px)+24px);left:50%;transform:translateX(-50%);background:var(--blue);color:white;padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600;z-index:999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,.2);font-family:DM Sans,sans-serif';
  document.body.appendChild(t); setTimeout(()=>t.remove(),2500);
}

// INIT
function registerServiceWorker(){
  if(!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.register('sw.js').catch(err=>console.warn('Service worker registratie mislukt:', err));
}

async function initApp(){
  registerServiceWorker();
  const savedLogo=localStorage.getItem('fmd_logo');
  if(savedLogo) document.getElementById('logo-wrap').innerHTML='<img src="'+savedLogo+'" style="width:100%;height:100%;object-fit:cover">';

  // Load from localStorage immediately — no network wait
  const cache=readCache();
  appointments=cache.appointments.map(normalizeAppointment);
  klanten=cache.klanten.map(normalizeKlant);
  behandelingen=(cache.behandelingen||DEFAULT_BEHANDELINGEN).map(normalizeBehandeling);
  blockedDays=cache.blockedDays||blockedDays;
  ejsSettings=cache.ejsSettings||ejsSettings;
  msgTemplate=cache.msgTemplate||msgTemplate;
  renderAgenda();
  hideStartupOverlay(); // UI instant zichtbaar

  // Cloud sync op de achtergrond (blokkeert startup niet meer)
  const hasCloudSession=await syncCloudSession();
  if(hasCloudSession) await loadFromCloud({silent:true});
}
document.addEventListener('DOMContentLoaded', initApp);
