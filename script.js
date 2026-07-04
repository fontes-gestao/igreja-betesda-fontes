import { initializeApp } from "https://www.gstatic.com/firebasejs/12.15.0/firebase-app.js";
import {
  getFirestore,
  doc,
  getDoc,
  setDoc,
  onSnapshot,
  serverTimestamp,
  enableIndexedDbPersistence
} from "https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js";

/* ============================================================
   Firebase / Firestore
   Projeto: betesda-fontes
   A aplicação continua usando localStorage como cache offline,
   mas a fonte compartilhada entre navegadores/dispositivos é o
   documento sistema/dados no Firestore.
   ============================================================ */
const firebaseConfig = {
  apiKey: "AIzaSyB1jSYfufjI_LOYD3YSQq1dWN4TANeji-4",
  authDomain: "betesda-fontes.firebaseapp.com",
  projectId: "betesda-fontes",
  storageBucket: "betesda-fontes.firebasestorage.app",
  messagingSenderId: "936563356475",
  appId: "1:936563356475:web:86061f6da68cc82e77bd1e"
};

const firebaseApp = initializeApp(firebaseConfig);
const db = getFirestore(firebaseApp);

// Ativa cache offline do Firestore quando o navegador permitir.
// Em alguns navegadores/abas simultâneas ele pode recusar; nesse caso o app continua funcionando online.
enableIndexedDbPersistence(db).catch((err) => {
  console.warn('Persistência offline do Firestore não ativada:', err?.code || err);
});

const cloudDoc = doc(db, 'sistema', 'dados');
const CLOUD_KEYS = ['profiles', 'members', 'escalas', 'eventos', 'manut', 'financeiro', 'doacoes', 'settings'];
let applyingRemoteData = false;
let cloudLoaded = false;
let cloudSaveTimer = null;
let unsubscribeCloud = null;

const LS={
  get:(k,d)=>{try{return JSON.parse(localStorage.getItem('igreja_'+k))??d}catch(e){return d}},
  set:(k,v)=>{
    localStorage.setItem('igreja_'+k,JSON.stringify(v));
    if(CLOUD_KEYS.includes(k) && !applyingRemoteData) scheduleCloudSave();
  }
};

function localHasCloudData(){
  return CLOUD_KEYS.some(k=>{
    const v=LS.get(k,null);
    if(Array.isArray(v)) return v.length>0;
    if(v && typeof v==='object') return Object.keys(v).length>0;
    return !!v;
  });
}

function collectCloudData(){
  return {profiles, members, escalas, eventos, manut, financeiro, doacoes, settings, updatedAt: serverTimestamp()};
}

function scheduleCloudSave(){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(saveCloudData,500);
}

async function saveCloudData(){
  if(!cloudLoaded) return;
  try{
    await setDoc(cloudDoc, collectCloudData(), {merge:true});
    console.info('Dados salvos na nuvem.');
  }catch(e){
    console.error('Erro ao salvar no Firebase:', e);
    toast('Erro ao salvar na nuvem');
  }
}

function applyCloudData(data){
  if(!data) return;
  applyingRemoteData=true;
  profiles=Array.isArray(data.profiles)?data.profiles:[];
  members=Array.isArray(data.members)?data.members:[];
  escalas=Array.isArray(data.escalas)?data.escalas:[];
  eventos=Array.isArray(data.eventos)?data.eventos:[];
  manut=Array.isArray(data.manut)?data.manut:[];
  financeiro=Array.isArray(data.financeiro)?data.financeiro:[];
  doacoes=Array.isArray(data.doacoes)?data.doacoes:[];
  settings=(data.settings&&typeof data.settings==='object')?data.settings:{churchName:'Igreja Betesda Fontes',theme:'dark'};
  const adminChanged=ensureAdminProfile(false);
  CLOUD_KEYS.forEach(k=>localStorage.setItem('igreja_'+k,JSON.stringify({profiles,members,escalas,eventos,manut,financeiro,doacoes,settings}[k])));
  applyingRemoteData=false;
  refreshAfterCloudUpdate();
  if(adminChanged) scheduleCloudSave();
}

function refreshAfterCloudUpdate(){
  applyTheme();
  if(activeProfile && !profiles.find(p=>p.id===activeProfile)){
    activeProfile=null;
    LS.set('active_profile',null);
    $('#app')?.classList.add('hidden');
    $('#profile-screen')?.classList.remove('hidden');
  }
  if(!$('#profile-screen')?.classList.contains('hidden')) renderProfiles();
  if(!$('#app')?.classList.contains('hidden')){
    refreshSettingsUI();
    const active=document.querySelector('[data-view].active')?.dataset.view || 'home';
    switchView(active);
  }
}

async function startCloudSync(){
  if(unsubscribeCloud) return;
  try{
    const snap=await getDoc(cloudDoc);
    if(snap.exists()){
      applyCloudData(snap.data());
      console.info('Dados carregados do Firebase.');
    }else if(localHasCloudData()){
      cloudLoaded=true;
      await saveCloudData();
      console.info('Documento inicial criado no Firebase com os dados locais.');
    }
    cloudLoaded=true;
    unsubscribeCloud=onSnapshot(cloudDoc,(s)=>{
      cloudLoaded=true;
      if(s.exists()) applyCloudData(s.data());
    },(e)=>{
      console.error('Erro ao sincronizar Firebase:', e);
      toast('Sem conexão com a nuvem');
    });
  }catch(e){
    // Continua utilizável com localStorage/cache. Quando a internet voltar, tentamos reconectar.
    cloudLoaded=true;
    console.error('Erro ao iniciar Firebase:', e);
    toast('Usando dados locais. Verifique sua conexão.');
  }
}

window.addEventListener('online', () => {
  if(!unsubscribeCloud) startCloudSync();
});

async function resetCloudData(){
  const clean={profiles:[adminProfileTemplate()],members:[],escalas:[],eventos:[],manut:[],financeiro:[],doacoes:[],settings:{churchName:'Igreja Betesda Fontes',theme:'dark'},updatedAt:serverTimestamp()};
  await setDoc(cloudDoc, clean, {merge:true});
}

const NOW=new Date();
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const $=s=>document.querySelector(s);
const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Titles for the top bar per view (labels sourced from the sidebar config-driven nav)
const VIEW_TITLES={home:'nav-home',escalas:'nav-escalas',eventos:'nav-eventos',manut:'nav-manut',membros:'nav-membros',financeiro:'nav-financeiro',doacoes:'nav-doacoes',config:'nav-config'};

const getAvatars = () => Array.from({length:9}, (_,i)=>document.querySelector(`[data-template-id="avatar-${i+1}"]`)?.src || '').filter(Boolean);
let pfAvatar='';

let profiles=LS.get('profiles',[]),activeProfile=LS.get('active_profile',null);
let members=LS.get('members',[]),escalas=LS.get('escalas',[]),eventos=LS.get('eventos',[]),manut=LS.get('manut',[]),financeiro=LS.get('financeiro',[]),doacoes=LS.get('doacoes',[]);
let settings=LS.get('settings',{churchName:'Igreja Betesda Fontes',theme:'dark'});
let sidebarCollapsed=LS.get('sidebar_collapsed',false);

function toast(m){const t=$('#toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.add('hidden'),2200);}
function icons(){lucide.createIcons();}
function avatarImg(url,cls){
  const fallback = getAvatars()[0] || '';
  return `<img src="${url || fallback}" alt="Avatar" class="${cls}">`;
}

function money(n){
  const v=Number(String(n||0).replace(',', '.')) || 0;
  return v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
}
function hashPassword(password){
  const str=String(password||'');
  let h1=0x811c9dc5;
  for(let i=0;i<str.length;i++){
    h1^=str.charCodeAt(i);
    h1+=(h1<<1)+(h1<<4)+(h1<<7)+(h1<<8)+(h1<<24);
  }
  return 'pwa-'+(h1>>>0).toString(16);
}
function currentProfile(){return profiles.find(p=>p.id===activeProfile)||null;}
function profileHasPassword(p){return !!(p && p.passwordHash);}
const ADMIN_PROFILE_ID='adm-betesda-fontes';
const ADMIN_USERNAME='ADM';
const ADMIN_PASSWORD_HASH=hashPassword('757130');
function isAdminProfile(p=currentProfile()){
  return !!(p && p.id===ADMIN_PROFILE_ID && p.name===ADMIN_USERNAME && p.passwordHash===ADMIN_PASSWORD_HASH);
}
function adminProfileTemplate(){
  return {id:ADMIN_PROFILE_ID,name:ADMIN_USERNAME,ministry:'Sistema',role:'Administrador',avatar:getAvatars()[0]||'',passwordHash:ADMIN_PASSWORD_HASH,isAdmin:true};
}
function ensureAdminProfile(save=false){
  let changed=false;
  let adm=profiles.find(p=>p.id===ADMIN_PROFILE_ID) || profiles.find(p=>(p.name||'').trim().toUpperCase()===ADMIN_USERNAME);
  if(!adm){profiles.push(adminProfileTemplate());changed=true;}
  else {
    if(adm.id!==ADMIN_PROFILE_ID){adm.id=ADMIN_PROFILE_ID;changed=true;}
    if(adm.name!==ADMIN_USERNAME){adm.name=ADMIN_USERNAME;changed=true;}
    if(adm.role!=='Administrador'){adm.role='Administrador';changed=true;}
    if(adm.ministry!=='Sistema'){adm.ministry='Sistema';changed=true;}
    if(!adm.avatar){adm.avatar=getAvatars()[0]||'';changed=true;}
    if(adm.passwordHash!==ADMIN_PASSWORD_HASH){adm.passwordHash=ADMIN_PASSWORD_HASH;changed=true;}
    if(adm.isAdmin!==true){adm.isAdmin=true;changed=true;}
  }
  if(save && changed) LS.set('profiles',profiles);
  return changed;
}
function setActiveProfile(id){activeProfile=id;LS.set('active_profile',id);openApp();}
function requireSensitiveAccess(view){
  if(!['financeiro','doacoes'].includes(view)) return true;
  const p=currentProfile();
  if(profileHasPassword(p)) return true;
  toast('Defina uma senha no seu perfil para acessar esta área.');
  switchView('config');
  setTimeout(()=>openEditProfileModal(),250);
  return false;
}
ensureAdminProfile(true);

/* THEME */
function applyTheme(){
  const isLight = settings.theme==='light';
  document.documentElement.classList.toggle('light', isLight);
  const topIcon = $('#topbar-theme-icon');
  if (topIcon) {
    topIcon.setAttribute('data-lucide', isLight ? 'moon' : 'sun');
  }
  // Force update to CSS variables scope
  document.body.style.color = 'var(--text)';
  document.body.style.background = 'var(--bg)';
  syncThemeColorMeta(isLight);
  icons();
}
// Mantém a cor da barra do navegador/PWA igual ao tema ativo (não altera o tema em si, só reflete ele).
function syncThemeColorMeta(isLight){
  const meta = document.getElementById('meta-theme-color');
  if (!meta) return;
  meta.setAttribute('content', isLight ? '#ffffff' : '#0A0B13');
}
applyTheme();

/* SIDEBAR COLLAPSE */
function applySidebarState(){
  $('#app').classList.toggle('collapsed',sidebarCollapsed);
  const icon=sidebarCollapsed?'panel-left-open':'panel-left-close';
  $('#collapse-toggle').innerHTML=`<i data-lucide="${icon}"></i>`;
  icons();
}
$('#collapse-toggle').onclick=()=>{sidebarCollapsed=!sidebarCollapsed;LS.set('sidebar_collapsed',sidebarCollapsed);applySidebarState();};

function isMobileView(){return window.matchMedia('(max-width: 767px)').matches;}
function openMobileSidebar(){
  const a=document.querySelector('.app-sidebar');
  if(!a)return;
  a.classList.remove('hidden');
  a.classList.add('flex','fixed','z-50','inset-y-0','left-0');
  document.body.classList.add('mobile-sidebar-open');
}
function closeMobileSidebar(){
  const a=document.querySelector('.app-sidebar');
  if(!a)return;
  a.classList.add('hidden');
  a.classList.remove('flex','fixed','z-50','z-40','inset-y-0','left-0');
  document.body.classList.remove('mobile-sidebar-open');
}
function toggleMobileSidebar(){
  const a=document.querySelector('.app-sidebar');
  if(!a)return;
  if(a.classList.contains('hidden')) openMobileSidebar(); else closeMobileSidebar();
}
$('#mobile-menu').onclick=(e)=>{e.stopPropagation();toggleMobileSidebar();};
document.addEventListener('click',(e)=>{
  if(!isMobileView())return;
  const a=document.querySelector('.app-sidebar');
  if(!a || a.classList.contains('hidden'))return;
  if(a.contains(e.target) || $('#mobile-menu')?.contains(e.target))return;
  closeMobileSidebar();
});
document.addEventListener('keydown',(e)=>{if(e.key==='Escape')closeMobileSidebar();});
window.addEventListener('resize',()=>{if(!isMobileView())closeMobileSidebar();});

/* PROFILES */
function renderProfiles(){
  const w=$('#profile-list');w.innerHTML='';
  profiles.forEach(p=>{
    const b=document.createElement('button');
    b.className='card2 rounded-2xl p-4 flex items-center gap-3 text-left hover:opacity-90 text-current';
    b.innerHTML=`<div class="w-12 h-12 rounded-full overflow-hidden shrink-0 card2">${avatarImg(p.avatar,'av-img')}</div>
      <div class="min-w-0 flex-1"><p class="font-medium truncate">${esc(p.name)}</p><p class="text-xs muted truncate">${esc(p.role||'')} · ${esc(p.ministry||'')}</p></div>
      ${profileHasPassword(p)?'<i data-lucide="lock" class="muted shrink-0" style="width:16px;height:16px"></i>':''}`;
    b.onclick=()=>openProfileLogin(p);
    w.appendChild(b);
  });
  if(!profiles.length)w.innerHTML='<p class="muted text-sm col-span-2">Nenhum perfil ainda. Crie o primeiro.</p>';
  icons();
}
function openProfileLogin(p){
  if(!profileHasPassword(p)){setActiveProfile(p.id);return;}
  openModal('Entrar no perfil', [
    {k:'password',l:'Senha *',type:'password',wide:true}
  ], v=>{
    if(hashPassword(v.password)!==p.passwordHash){toast('Senha incorreta');return false;}
    setActiveProfile(p.id);
  });
}
function renderAvatarOptions(){
  const w=$('#avatar-options');w.innerHTML='';
  const list = getAvatars();
  if (!pfAvatar) pfAvatar = list[0];
  list.forEach(a=>{
    const b=document.createElement('button');b.type='button';
    b.className='avatar-opt w-11 h-11'+(a===pfAvatar?' sel':'');
    b.innerHTML=avatarImg(a,'av-img');
    b.onclick=()=>{pfAvatar=a;updatePfPreview();renderAvatarOptions();};
    w.appendChild(b);
  });
}
function updatePfPreview(){$('#pf-avatar-preview').innerHTML=avatarImg(pfAvatar,'av-img');}
$('#show-create-btn').onclick=()=>{$('#profile-list-wrap').classList.add('hidden');$('#profile-form').classList.remove('hidden');pfAvatar=getAvatars()[0];$('#profile-form').reset();updatePfPreview();renderAvatarOptions();icons();};
$('#cancel-create').onclick=()=>{$('#profile-form').classList.add('hidden');$('#profile-list-wrap').classList.remove('hidden');};
$('#pf-upload').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{pfAvatar=r.result;updatePfPreview();renderAvatarOptions();};r.readAsDataURL(f);};
$('#profile-form').onsubmit=e=>{
  e.preventDefault();
  const pass=$('#pf-password').value;
  const pass2=$('#pf-password-confirm').value;
  if(pass.length<4){toast('A senha precisa ter pelo menos 4 caracteres');return;}
  if(pass!==pass2){toast('As senhas não conferem');return;}
  const p={id:uid(),name:$('#pf-name').value.trim(),ministry:$('#pf-min').value.trim(),role:$('#pf-role').value.trim(),avatar:pfAvatar || getAvatars()[0],passwordHash:hashPassword(pass)};
  profiles.push(p);LS.set('profiles',profiles);activeProfile=p.id;LS.set('active_profile',p.id);$('#profile-form').classList.add('hidden');$('#profile-list-wrap').classList.remove('hidden');openApp();
};
$('#switch-profile').onclick=()=>{activeProfile=null;LS.set('active_profile',null);$('#app').classList.add('hidden');$('#profile-screen').classList.remove('hidden');renderProfiles();icons();};
$('#edit-profile').onclick=()=>openEditProfileModal();
$('#topbar-user-profile') && ($('#topbar-user-profile').onclick=()=>openEditProfileModal());
/* APP */
function openApp(){
  $('#profile-screen').classList.add('hidden');$('#app').classList.remove('hidden');
  applySidebarState();
  const p=profiles.find(x=>x.id===activeProfile);
  if(p){
    const roleLine=(p.role||'')+(p.ministry?' · '+p.ministry:'');
    $('#side-pname').textContent=p.name;$('#side-prole').textContent=roleLine;
    $('#side-avatar').innerHTML=avatarImg(p.avatar,'av-img');
    $('#topbar-pname') && ($('#topbar-pname').textContent=p.name||'');
    $('#topbar-prole') && ($('#topbar-prole').textContent=roleLine||'Perfil ativo');
    $('#topbar-avatar') && ($('#topbar-avatar').innerHTML=avatarImg(p.avatar,'av-img'));
    $('#home-greeting').textContent=p.name+' 👋';
  }
  refreshSettingsUI();switchView('home');icons();
}
function updateTopTitle(v){
  const key=VIEW_TITLES[v];
  const src=document.querySelector('[data-template-id="'+key+'"]');
  $('#topbar-page-title').textContent=src?src.textContent:'';
}
function switchView(v){
  if(!requireSensitiveAccess(v)) return;
  ['home','escalas','eventos','manut','membros','financeiro','doacoes','config'].forEach(x=>$('#view-'+x)?.classList.toggle('hidden',x!==v));
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  updateTopTitle(v);
  if(v==='home')renderHome();if(v==='membros')renderMembers();if(v==='escalas')renderEscalas();if(v==='eventos')renderEventos();if(v==='manut')renderManut();if(v==='financeiro')renderFinanceiro();if(v==='doacoes')renderDoacoes();
  icons();
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{switchView(b.dataset.view);if(isMobileView())closeMobileSidebar();});
document.querySelectorAll('[data-card-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.cardView));
$('#add-quick').onclick=()=>{switchView('escalas');openEscalaModal();};
$('#bell-btn').onclick=()=>toast('Sem novas notificações');
$('#topbar-theme').onclick=()=>{
  settings.theme = settings.theme==='light'?'dark':'light';
  LS.set('settings',settings);
  applyTheme();
  updateThemeButtons();
  toast(settings.theme==='light'?'Tema Claro aplicado':'Tema Escuro aplicado');
};
$('#cta-btn').onclick=()=>switchView('membros');

/* SETTINGS */
function refreshSettingsUI(){
  $('#sidebar-church-name').textContent=settings.churchName||'Igreja Betesda Fontes';
  $('#cfg-church').value=settings.churchName||'';
  const p=currentProfile();
  if(p){
    const roleLine=(p.role||'')+(p.ministry?' · '+p.ministry:'');
    $('#cfg-profile-avatar') && ($('#cfg-profile-avatar').innerHTML=avatarImg(p.avatar,'av-img'));
    $('#cfg-profile-name') && ($('#cfg-profile-name').textContent=p.name||'');
    $('#cfg-profile-role') && ($('#cfg-profile-role').textContent=roleLine);
    $('#topbar-pname') && ($('#topbar-pname').textContent=p.name||'');
    $('#topbar-prole') && ($('#topbar-prole').textContent=roleLine||'Perfil ativo');
    $('#topbar-avatar') && ($('#topbar-avatar').innerHTML=avatarImg(p.avatar,'av-img'));
  }
  const risk=$('#risk-zone');
  if(risk) risk.classList.toggle('hidden', !isAdminProfile(p));
  updateThemeButtons();
}
function updateThemeButtons(){
  const isLight = settings.theme === 'light';
  const lightBtn = $('#theme-light');
  const darkBtn = $('#theme-dark');
  if (isLight) {
    lightBtn.classList.add('accent-grad', 'text-white');
    lightBtn.classList.remove('card2');
    darkBtn.classList.remove('accent-grad', 'text-white');
    darkBtn.classList.add('card2');
  } else {
    darkBtn.classList.add('accent-grad', 'text-white');
    darkBtn.classList.remove('card2');
    lightBtn.classList.remove('accent-grad', 'text-white');
    lightBtn.classList.add('card2');
  }
}
$('#theme-dark').onclick=()=>{settings.theme='dark';LS.set('settings',settings);applyTheme();updateThemeButtons();toast('Tema Escuro aplicado');};
$('#theme-light').onclick=()=>{settings.theme='light';LS.set('settings',settings);applyTheme();updateThemeButtons();toast('Tema Claro aplicado');};
$('#save-config').onclick=()=>{settings.churchName=$('#cfg-church').value.trim()||'Igreja Betesda Fontes';LS.set('settings',settings);refreshSettingsUI();toast('Configurações salvas');};
$('#edit-current-profile').onclick=()=>openEditProfileModal();
let resetArmed=false;
$('#reset-data').onclick=async e=>{
  if(!isAdminProfile()){toast('Ação permitida apenas para o usuário ADM');return;}
  if(!resetArmed){resetArmed=true;e.currentTarget.querySelector('span').textContent='Clique novamente para apagar tudo';setTimeout(()=>{resetArmed=false;e.currentTarget.querySelector('span').textContent='Apagar todos os dados';},3000);return;}
  ['active_profile','members','escalas','eventos','manut','financeiro','doacoes','settings','sidebar_collapsed'].forEach(k=>localStorage.removeItem('igreja_'+k));
  profiles=[adminProfileTemplate()];LS.set('profiles',profiles);
  try{await resetCloudData();}catch(err){console.error('Erro ao apagar dados na nuvem:',err);}
  activeProfile=ADMIN_PROFILE_ID;LS.set('active_profile',activeProfile);
  location.reload();
};

/* DATES */
function fmtDate(d){if(!d)return'—';const[y,m,day]=d.split('-');return`${day}/${m}/${y}`;}
function parse(d){return d?new Date(d+'T00:00:00'):null;}

/* HOME */
function statusChip(s){const map={'Confirmado':'#4fd18f','Pendente':'#ffb15c','Concluído':'#5bb8ff'};const c=map[s]||'var(--accent)';return `<span class="text-xs px-2 py-0.5 rounded-full font-medium" style="color:${c};background:${c}22">${esc(s)}</span>`;}
function renderHome(){
  const upEsc=escalas.filter(e=>parse(e.date)>=new Date(NOW.toDateString())).sort((a,b)=>a.date.localeCompare(b.date));
  const upEvt=eventos.filter(e=>parse(e.date)>=new Date(NOW.toDateString())).sort((a,b)=>a.date.localeCompare(b.date));
  $('#stat-culto').textContent=upEsc[0]?`${fmtDate(upEsc[0].date)} ${upEsc[0].time||''}`:'Sem escalas';
  $('#stat-evento').textContent=upEvt[0]?upEvt[0].name:'Sem eventos';
  $('#stat-membros').textContent=members.length;
  $('#stat-pend').textContent=manut.filter(m=>m.status!=='Concluído').length;

  const next=upEsc[0]||{};
  $('#role-louvor-info').textContent=next.worship||'A definir';
  $('#role-oracao-info').textContent=next.openingPrayer||'A definir';
  $('#role-dizimos-info').textContent=next.tithePrayer||'A definir';
  $('#role-pregacao-info').textContent=next.preacher||'A definir';

  const ev=$('#home-eventos-list');ev.innerHTML='';
  if(!upEvt.length)ev.innerHTML='<p class="muted text-sm">Nenhum evento próximo.</p>';
  upEvt.slice(0,4).forEach(e=>{const d=document.createElement('div');d.className='card2 rounded-xl p-3 text-sm flex items-center gap-3';d.innerHTML=`<div class="w-9 h-9 rounded-lg accent-grad flex items-center justify-center text-white text-xs font-bold shrink-0">${fmtDate(e.date).slice(0,2)}</div><div class="min-w-0"><p class="font-medium truncate">${esc(e.name)}</p><p class="muted text-xs">${fmtDate(e.date)} · ${esc(e.location||'')}</p></div>`;ev.appendChild(d);});

  const mn=$('#home-manut-list');mn.innerHTML='';
  const pend=manut.filter(m=>m.status!=='Concluído');
  if(!pend.length)mn.innerHTML='<p class="muted text-sm">Nenhuma pendência.</p>';
  pend.slice(0,4).forEach(m=>{const d=document.createElement('div');d.className='card2 rounded-xl p-3 text-sm flex items-center justify-between gap-2';d.innerHTML=`<div class="min-w-0"><p class="font-medium truncate">${esc(m.title)}</p><p class="muted text-xs truncate">${esc(m.location||'')}</p></div>${statusChip(m.priority||'Pendente')}`;mn.appendChild(d);});

  const wk=$('#home-semana-list');wk.innerHTML='';
  const weekEnd=new Date(NOW);weekEnd.setDate(weekEnd.getDate()+7);
  const inWk=escalas.filter(e=>{const d=parse(e.date);return d>=new Date(NOW.toDateString())&&d<=weekEnd;});
  if(!inWk.length)wk.innerHTML='<p class="muted text-sm">Nenhuma escala esta semana.</p>';
  inWk.forEach(e=>{const d=document.createElement('div');d.className='card2 rounded-xl p-3 text-sm flex flex-wrap items-center justify-between gap-2';d.innerHTML=`<div class="flex items-center gap-2 min-w-0"><i data-lucide="calendar-check" style="width:16px;height:16px;color:var(--accent)"></i><span class="font-medium">${fmtDate(e.date)} · ${esc(e.time||'')}</span></div><span class="muted text-xs truncate">${esc(e.preacher||'—')}</span>${statusChip('Confirmado')}`;wk.appendChild(d);});
  icons();
}

/* MEMBERS */
function renderMembers(){
  const q=$('#member-search').value.toLowerCase();
  const list=members.filter(m=>(m.name+m.ministry+m.role).toLowerCase().includes(q));
  const c=$('#member-list');c.innerHTML='';$('#member-empty').classList.toggle('hidden',list.length>0);
  list.forEach(m=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    d.innerHTML=`<div class="flex items-start gap-3">
      <div class="w-11 h-11 rounded-full overflow-hidden card2 shrink-0">${avatarImg(m.avatar,'av-img')}</div>
      <div class="min-w-0 flex-1"><p class="font-semibold truncate">${esc(m.name)}</p><p class="text-xs muted">${esc(m.role||'')} · ${esc(m.ministry||'')}</p></div>
      <div class="flex gap-1 shrink-0"><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div>
      <div class="mt-3 space-y-1 text-sm muted">${m.phone?`<p class="flex items-center gap-2"><i data-lucide="phone" style="width:14px;height:14px"></i>${esc(m.phone)}</p>`:''}${m.email?`<p class="flex items-center gap-2"><i data-lucide="mail" style="width:14px;height:14px"></i>${esc(m.email)}</p>`:''}${m.notes?`<p class="text-xs mt-1">${esc(m.notes)}</p>`:''}</div>`;
    d.querySelector('.ed').onclick=()=>openMemberModal(m);
    d.querySelector('.dl').onclick=e=>confirmDelete(e.currentTarget,()=>{members=members.filter(x=>x.id!==m.id);LS.set('members',members);renderMembers();toast('Membro excluído');});
    c.appendChild(d);
  });
  icons();
}
$('#member-search').oninput=renderMembers;
$('#add-member').onclick=()=>openMemberModal();

/* ESCALAS */
function renderEscalas(){
  const q=$('#escala-search').value.toLowerCase();
  const list=escalas.filter(e=>(e.date+e.preacher+e.worship).toLowerCase().includes(q)).sort((a,b)=>b.date.localeCompare(a.date));
  const c=$('#escala-list');c.innerHTML='';$('#escala-empty').classList.toggle('hidden',list.length>0);
  list.forEach(e=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    const row=(l,v)=>v?`<p class="muted"><span class="role-di">${l}:</span> ${esc(v)}</p>`:'';
    d.innerHTML=`<div class="flex items-start justify-between gap-2 mb-2">
      <p class="font-semibold flex items-center gap-2"><i data-lucide="calendar" style="width:16px;height:16px;color:var(--accent)"></i>${fmtDate(e.date)} · ${esc(e.time||'')}</p>
      <div class="flex gap-1 shrink-0"><button class="dup muted hover:text-[var(--accent)]" title="Duplicar" aria-label="Duplicar"><i data-lucide="copy"></i></button><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div>
      <div class="text-sm space-y-1">${row('Louvor',e.worship)}${row('Pregador',e.preacher)}${row('Oração inicial',e.openingPrayer)}${row('Oração dízimos',e.tithePrayer)}${row('Recepção',e.reception)}${row('Mídia',e.media)}${row('Som',e.sound)}${e.notes?`<p class="text-xs mt-1 muted">${esc(e.notes)}</p>`:''}</div>`;
    d.querySelector('.ed').onclick=()=>openEscalaModal(e);
    d.querySelector('.dup').onclick=()=>{escalas.push({...e,id:uid()});LS.set('escalas',escalas);renderEscalas();toast('Escala duplicada');};
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{escalas=escalas.filter(x=>x.id!==e.id);LS.set('escalas',escalas);renderEscalas();toast('Escala excluída');});
    c.appendChild(d);
  });
  icons();
}
$('#escala-search').oninput=renderEscalas;
$('#add-escala').onclick=()=>openEscalaModal();

/* EVENTOS */
function renderEventos(){
  const list=[...eventos].sort((a,b)=>(a.date||'').localeCompare(b.date||''));
  const c=$('#evento-list');c.innerHTML='';$('#evento-empty').classList.toggle('hidden',list.length>0);
  list.forEach(e=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    d.innerHTML=`<div class="flex items-start justify-between gap-2">
      <p class="font-semibold truncate flex items-center gap-2"><i data-lucide="party-popper" style="width:16px;height:16px" class="role-di"></i>${esc(e.name)}</p>
      <div class="flex gap-1 shrink-0"><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div>
      <div class="mt-2 text-sm muted space-y-1"><p><i data-lucide="calendar" style="width:14px;height:14px;display:inline"></i> ${fmtDate(e.date)} ${esc(e.time||'')}</p>${e.location?`<p><i data-lucide="map-pin" style="width:14px;height:14px;display:inline"></i> ${esc(e.location)}</p>`:''}${e.responsible?`<p><i data-lucide="user" style="width:14px;height:14px;display:inline"></i> ${esc(e.responsible)}</p>`:''}${e.description?`<p class="text-xs mt-1">${esc(e.description)}</p>`:''}</div>`;
    d.querySelector('.ed').onclick=()=>openEventoModal(e);
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{eventos=eventos.filter(x=>x.id!==e.id);LS.set('eventos',eventos);renderEventos();toast('Evento excluído');});
    c.appendChild(d);
  });
  icons();
}
$('#add-evento').onclick=()=>openEventoModal();

/* MANUTENÇÕES */
function renderManut(){
  const list=[...manut].sort((a,b)=>(a.status==='Concluído')-(b.status==='Concluído'));
  const c=$('#manut-list');c.innerHTML='';$('#manut-empty').classList.toggle('hidden',list.length>0);
  list.forEach(m=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    d.innerHTML=`<div class="flex items-start justify-between gap-2">
      <p class="font-semibold truncate flex items-center gap-2"><i data-lucide="wrench" style="width:16px;height:16px" class="role-or"></i>${esc(m.title)}</p>
      <div class="flex gap-1 shrink-0"><button class="tg muted hover:text-[var(--accent)]" title="Alternar status" aria-label="Alternar status"><i data-lucide="check-circle"></i></button><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div>
      <div class="mt-2 text-sm muted space-y-1">${m.location?`<p><i data-lucide="map-pin" style="width:14px;height:14px;display:inline"></i> ${esc(m.location)}</p>`:''}${m.responsible?`<p><i data-lucide="user" style="width:14px;height:14px;display:inline"></i> ${esc(m.responsible)}</p>`:''}<p class="mt-1">${statusChip(m.status||'Pendente')} ${statusChip(m.priority||'Média')}</p>${m.notes?`<p class="text-xs mt-1">${esc(m.notes)}</p>`:''}</div>`;
    d.querySelector('.tg').onclick=()=>{m.status=m.status==='Concluído'?'Pendente':'Concluído';LS.set('manut',manut);renderManut();};
    d.querySelector('.ed').onclick=()=>openManutModal(m);
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{manut=manut.filter(x=>x.id!==m.id);LS.set('manut',manut);renderManut();toast('Manutenção excluída');});
    c.appendChild(d);
  });
  icons();
}
$('#add-manut').onclick=()=>openManutModal();


/* FINANCEIRO */
function renderFinanceiro(){
  const list=[...financeiro].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const entradas=list.filter(x=>x.type==='Entrada').reduce((s,x)=>s+(Number(String(x.value||0).replace(',','.'))||0),0);
  const saidas=list.filter(x=>x.type==='Saída').reduce((s,x)=>s+(Number(String(x.value||0).replace(',','.'))||0),0);
  $('#fin-entradas').textContent=money(entradas);$('#fin-saidas').textContent=money(saidas);$('#fin-saldo').textContent=money(entradas-saidas);
  const c=$('#financeiro-list');c.innerHTML='';$('#financeiro-empty').classList.toggle('hidden',list.length>0);
  list.forEach(f=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    const isEntrada=f.type==='Entrada';
    d.innerHTML=`<div class="flex items-start justify-between gap-2"><div><p class="font-semibold flex items-center gap-2"><i data-lucide="${isEntrada?'arrow-down-circle':'arrow-up-circle'}" class="${isEntrada?'role-di':'role-or'}"></i>${esc(f.title||f.category||f.type)}</p><p class="muted text-sm">${fmtDate(f.date)} · ${esc(f.category||'')}</p></div><div class="flex gap-1 shrink-0"><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div><p class="font-bold text-xl mt-3 ${isEntrada?'role-di':'role-or'}">${money(f.value)}</p>${f.notes?`<p class="muted text-xs mt-2">${esc(f.notes)}</p>`:''}`;
    d.querySelector('.ed').onclick=()=>openFinanceiroModal(f);
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{financeiro=financeiro.filter(x=>x.id!==f.id);LS.set('financeiro',financeiro);renderFinanceiro();toast('Movimentação excluída');});
    c.appendChild(d);
  });
  icons();
}
$('#add-financeiro').onclick=()=>openFinanceiroModal();
function openFinanceiroModal(f){f=f||{};openModal(f.id?'Editar movimentação':'Nova movimentação',[
  {k:'title',l:'Descrição *',v:f.title,wide:true},{k:'type',l:'Tipo',v:f.type||'Entrada',type:'select',opts:['Entrada','Saída']},
  {k:'value',l:'Valor',v:f.value,type:'number'},{k:'date',l:'Data',v:f.date,type:'date'},{k:'category',l:'Categoria',v:f.category},{k:'notes',l:'Observações',v:f.notes,type:'textarea',wide:true}
],v=>{if(f.id)Object.assign(f,v);else financeiro.push({id:uid(),...v});LS.set('financeiro',financeiro);renderFinanceiro();toast('Movimentação salva');});}

/* DOAÇÕES */
function renderDoacoes(){
  const list=[...doacoes].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const total=list.reduce((s,x)=>s+(Number(String(x.value||0).replace(',','.'))||0),0);
  $('#doacoes-total').textContent=money(total);
  const c=$('#doacoes-list');c.innerHTML='';$('#doacoes-empty').classList.toggle('hidden',list.length>0);
  list.forEach(dn=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    d.innerHTML=`<div class="flex items-start justify-between gap-2"><p class="font-semibold truncate flex items-center gap-2"><i data-lucide="heart" class="role-di"></i>${esc(dn.donor||'Doador não informado')}</p><div class="flex gap-1 shrink-0"><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div><p class="font-bold text-xl mt-3 role-di">${money(dn.value)}</p><p class="muted text-sm">${fmtDate(dn.date)} · ${esc(dn.method||'')}</p>${dn.notes?`<p class="muted text-xs mt-2">${esc(dn.notes)}</p>`:''}`;
    d.querySelector('.ed').onclick=()=>openDoacaoModal(dn);
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{doacoes=doacoes.filter(x=>x.id!==dn.id);LS.set('doacoes',doacoes);renderDoacoes();toast('Doação excluída');});
    c.appendChild(d);
  });
  icons();
}
$('#add-doacao').onclick=()=>openDoacaoModal();
function openDoacaoModal(d){d=d||{};openModal(d.id?'Editar doação':'Nova doação',[
  {k:'donor',l:'Doador *',v:d.donor,wide:true},{k:'value',l:'Valor',v:d.value,type:'number'},
  {k:'date',l:'Data',v:d.date,type:'date'},{k:'method',l:'Forma',v:d.method||'Pix',type:'select',opts:['Pix','Dinheiro','Cartão','Transferência','Outro']},
  {k:'notes',l:'Observações',v:d.notes,type:'textarea',wide:true}
],v=>{if(d.id)Object.assign(d,v);else doacoes.push({id:uid(),...v});LS.set('doacoes',doacoes);renderDoacoes();toast('Doação salva');});}

/* DELETE CONFIRM */
function confirmDelete(btn,cb){if(btn._armed){cb();return;}btn._armed=true;const orig=btn.innerHTML;btn.innerHTML='<span class="text-xs text-red-400 font-semibold">Confirmar?</span>';setTimeout(()=>{if(btn._armed){btn._armed=false;btn.innerHTML=orig;icons();}},2500);}

/* MODAL */
function fieldHtml(f){
  const wide=f.wide?'sm:col-span-2':'';
  let inner;
  if(f.type==='textarea')inner=`<textarea id="fld-${f.k}" rows="2" class="w-full rounded-xl px-3 py-2">${esc(f.v||'')}</textarea>`;
  else if(f.type==='select')inner=`<select id="fld-${f.k}" class="w-full rounded-xl px-3 py-2">${f.opts.map(o=>`<option ${o===f.v?'selected':''}>${o}</option>`).join('')}</select>`;
  else inner=`<input id="fld-${f.k}" type="${f.type||'text'}" value="${esc(f.v||'')}" class="w-full rounded-xl px-3 py-2">`;
  return `<div class="${wide}"><label for="fld-${f.k}" class="text-sm muted block mb-1">${f.l}</label>${inner}</div>`;
}
function openModal(title,fields,onsave){
  $('#modal-title').textContent=title;
  $('#modal-form').innerHTML=fields.map(fieldHtml).join('');
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  $('#modal-save').onclick=()=>{const vals={};fields.forEach(f=>vals[f.k]=$('#fld-'+f.k).value.trim());if(!vals[fields[0].k]){toast('Preencha o campo obrigatório');return;}const result=onsave(vals);if(result!==false)closeModal();};
  icons();
}
function closeModal(){$('#modal').classList.add('hidden');$('#modal').classList.remove('flex');}
$('#modal-close').onclick=closeModal;$('#modal-cancel').onclick=closeModal;
$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal();};

function openMemberModal(m){m=m||{};openModal(m.id?'Editar Membro':'Novo Membro',[
  {k:'name',l:'Nome *',v:m.name,wide:true},{k:'phone',l:'Telefone',v:m.phone},{k:'email',l:'E-mail',v:m.email,type:'email'},
  {k:'ministry',l:'Ministério',v:m.ministry},{k:'role',l:'Cargo',v:m.role},{k:'notes',l:'Observações',v:m.notes,type:'textarea',wide:true}
],v=>{if(m.id)Object.assign(m,v);else {
  const avs = getAvatars();
  members.push({id:uid(),avatar:avs[Math.floor(Math.random()*avs.length)] || '',...v});
}LS.set('members',members);renderMembers();toast('Membro salvo');});}

function openEscalaModal(e){e=e||{};openModal(e.id?'Editar Escala':'Nova Escala',[
  {k:'date',l:'Data *',v:e.date,type:'date'},{k:'time',l:'Horário',v:e.time,type:'time'},
  {k:'worship',l:'Louvor',v:e.worship},{k:'preacher',l:'Pregador',v:e.preacher},
  {k:'openingPrayer',l:'Oração inicial',v:e.openingPrayer},{k:'tithePrayer',l:'Oração dos dízimos',v:e.tithePrayer},
  {k:'reception',l:'Recepção',v:e.reception},{k:'media',l:'Mídia',v:e.media},
  {k:'sound',l:'Som',v:e.sound},{k:'notes',l:'Observações',v:e.notes,type:'textarea',wide:true}
],v=>{if(e.id)Object.assign(e,v);else escalas.push({id:uid(),...v});LS.set('escalas',escalas);renderEscalas();toast('Escala salva');});}

function openEventoModal(e){e=e||{};openModal(e.id?'Editar Evento':'Novo Evento',[
  {k:'name',l:'Nome *',v:e.name,wide:true},{k:'date',l:'Data',v:e.date,type:'date'},{k:'time',l:'Horário',v:e.time,type:'time'},
  {k:'location',l:'Local',v:e.location},{k:'responsible',l:'Responsável',v:e.responsible},
  {k:'description',l:'Descrição',v:e.description,type:'textarea',wide:true}
],v=>{if(e.id)Object.assign(e,v);else eventos.push({id:uid(),...v});LS.set('eventos',eventos);renderEventos();toast('Evento salvo');});}

function openManutModal(m){m=m||{};openModal(m.id?'Editar Manutenção':'Nova Manutenção',[
  {k:'title',l:'Título *',v:m.title,wide:true},{k:'location',l:'Local',v:m.location},{k:'responsible',l:'Responsável',v:m.responsible},
  {k:'priority',l:'Prioridade',v:m.priority||'Média',type:'select',opts:['Baixa','Média','Alta']},
  {k:'status',l:'Status',v:m.status||'Pendente',type:'select',opts:['Pendente','Concluído']},
  {k:'notes',l:'Observações',v:m.notes,type:'textarea',wide:true}
],v=>{if(m.id)Object.assign(m,v);else manut.push({id:uid(),...v});LS.set('manut',manut);renderManut();toast('Manutenção salva');});}


function openEditProfileModal(){
  const p=currentProfile();
  if(!p){toast('Selecione um perfil primeiro');return;}
  let editAvatar=p.avatar || getAvatars()[0] || '';
  $('#modal-title').textContent='Editar usuário';
  const adm=isAdminProfile(p);
  $('#modal-form').innerHTML=`
    <div class="sm:col-span-2 flex flex-col items-center gap-3">
      <div id="edit-avatar-preview" class="w-24 h-24 rounded-full overflow-hidden card2">${avatarImg(editAvatar,'av-img')}</div>
      <label for="edit-avatar-upload" class="text-sm cursor-pointer muted hover:text-[var(--accent)] flex items-center gap-2"><i data-lucide="upload" style="width:16px;height:16px"></i>Trocar foto</label>
      <input id="edit-avatar-upload" type="file" accept="image/*" class="hidden">
    </div>
    ${adm?'<div class="sm:col-span-2 rounded-xl p-3 card2 text-sm"><strong>Usuário administrador fixo:</strong> ADM. A senha padrão é 757130.</div>':''}
    <div class="sm:col-span-2"><label class="text-sm muted block mb-1" for="edit-name">Nome *</label><input id="edit-name" class="w-full rounded-xl px-3 py-2" value="${esc(p.name||'')}" ${adm?'disabled':''}></div>
    <div><label class="text-sm muted block mb-1" for="edit-ministry">Ministério</label><input id="edit-ministry" class="w-full rounded-xl px-3 py-2" value="${esc(p.ministry||'')}" ${adm?'disabled':''}></div>
    <div><label class="text-sm muted block mb-1" for="edit-role">Cargo</label><input id="edit-role" class="w-full rounded-xl px-3 py-2" value="${esc(p.role||'')}" ${adm?'disabled':''}></div>
    ${adm?'':'<div class="sm:col-span-2"><p class="text-sm font-semibold mt-2">Alterar senha</p><p class="muted text-xs">Deixe em branco se não quiser trocar.</p></div>'}
    ${(!adm && profileHasPassword(p))?'<div class="sm:col-span-2"><label class="text-sm muted block mb-1" for="edit-current-password">Senha atual</label><input id="edit-current-password" type="password" class="w-full rounded-xl px-3 py-2"></div>':''}
    ${adm?'':'<div><label class="text-sm muted block mb-1" for="edit-new-password">Nova senha</label><input id="edit-new-password" type="password" minlength="4" class="w-full rounded-xl px-3 py-2"></div><div><label class="text-sm muted block mb-1" for="edit-new-password-confirm">Confirmar nova senha</label><input id="edit-new-password-confirm" type="password" minlength="4" class="w-full rounded-xl px-3 py-2"></div>'}`;
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  const up=$('#edit-avatar-upload');
  up.onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{editAvatar=r.result;$('#edit-avatar-preview').innerHTML=avatarImg(editAvatar,'av-img');};r.readAsDataURL(f);};
  $('#modal-save').onclick=()=>{
    const adm=isAdminProfile(p);
    const name=adm?ADMIN_USERNAME:$('#edit-name').value.trim();
    if(!name){toast('Informe o nome');return;}
    if(!adm){
      const newPass=$('#edit-new-password').value;
      const newPass2=$('#edit-new-password-confirm').value;
      if(newPass || newPass2){
        if(profileHasPassword(p) && hashPassword($('#edit-current-password').value)!==p.passwordHash){toast('Senha atual incorreta');return;}
        if(newPass.length<4){toast('A nova senha precisa ter pelo menos 4 caracteres');return;}
        if(newPass!==newPass2){toast('As novas senhas não conferem');return;}
        p.passwordHash=hashPassword(newPass);
      }
      p.ministry=$('#edit-ministry').value.trim();p.role=$('#edit-role').value.trim();
    } else {
      p.passwordHash=ADMIN_PASSWORD_HASH;p.ministry='Sistema';p.role='Administrador';p.id=ADMIN_PROFILE_ID;p.isAdmin=true;
    }
    p.name=name;p.avatar=editAvatar;
    LS.set('profiles',profiles);
    closeModal();
    openApp();
    toast('Usuário atualizado');
  };
  icons();
}

/* BOOT */
async function boot(){
  // Carrega primeiro a nuvem; se falhar, segue com o cache local para manter o PWA utilizável.
  await startCloudSync();
  renderProfiles();
  if(activeProfile&&profiles.find(p=>p.id===activeProfile)) {
    openApp();
  } else {
    $('#profile-screen').classList.remove('hidden');
    updateThemeButtons();
  }
  icons();
}
boot();

// Atalhos do PWA (manifest "shortcuts"): ?view=escalas abre direto na tela certa, se já houver perfil ativo.
(function applyShortcutView(){
  const params = new URLSearchParams(location.search);
  const v = params.get('view');
  if (v && ['home','escalas','eventos','manut','membros','financeiro','doacoes','config'].includes(v) && !$('#app').classList.contains('hidden')) {
    switchView(v);
  }
})();


/* ============================================================
   PWA — Service Worker, instalação e status online/offline
   (Bloco adicionado sem alterar nenhuma tela, cor ou lógica
   do sistema de gestão acima.)
   ============================================================ */

/* ---------- Registro do Service Worker com atualização automática ---------- */
const APP_VERSION = '20260704-admin-risk-v9';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js?v=' + APP_VERSION)
      .then((reg) => {
        // Procura atualização logo que abre e depois de tempos em tempos.
        reg.update();
        setInterval(() => reg.update(), 15 * 60 * 1000); // a cada 15 min

        // Se já houver uma versão nova esperando, ativa automaticamente.
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              newWorker.postMessage({ type: 'SKIP_WAITING' });
            }
          });
        });
      })
      .catch((err) => console.warn('Falha ao registrar o Service Worker:', err));

    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });

    navigator.serviceWorker.addEventListener('message', (event) => {
      if (event.data?.type === 'APP_UPDATED') {
        console.info('App atualizado:', event.data.version);
      }
    });
  });
}

function showUpdateToast(){
  // Mantido apenas para compatibilidade com versões antigas do service worker.
  toast('Nova versão aplicada automaticamente');
}

/* ---------- Botão "Instalar aplicativo" ---------- */
let deferredInstallPrompt = null;
const installBtn = document.getElementById('pwa-install-btn');

function isStandalone(){
  return window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true; // iOS
}

function isIos(){
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent);
}

window.addEventListener('beforeinstallprompt', (e) => {
  e.preventDefault();
  deferredInstallPrompt = e;
  if (installBtn && !isStandalone()) {
    installBtn.classList.remove('hidden');
  }
});

if (installBtn) {
  installBtn.addEventListener('click', async () => {
    if (deferredInstallPrompt) {
      installBtn.classList.add('hidden');
      deferredInstallPrompt.prompt();
      await deferredInstallPrompt.userChoice;
      deferredInstallPrompt = null;
    } else if (isIos()) {
      showIosInstallInstructions();
    } else {
      showGenericInstallInstructions();
    }
  });
}

window.addEventListener('appinstalled', () => {
  if (installBtn) installBtn.classList.add('hidden');
  deferredInstallPrompt = null;
});

function showIosInstallInstructions(){
  const el = document.getElementById('ios-install-hint');
  if (el) el.classList.remove('hidden');
}

function showGenericInstallInstructions(){
  toast('Use o menu do navegador → "Instalar aplicativo" ou "Adicionar à tela inicial"');
}

// No iPhone/iPad (Safari não dispara beforeinstallprompt), mostra o botão
// e, ao tocar, exibe a instrução manual de "Compartilhar → Adicionar à Tela de Início".
document.addEventListener('DOMContentLoaded', () => {
  if (isIos() && !isStandalone() && installBtn) {
    installBtn.classList.remove('hidden');
  }
});

const iosHintClose = document.getElementById('ios-install-hint-close');
if (iosHintClose) {
  iosHintClose.addEventListener('click', () => {
    document.getElementById('ios-install-hint')?.classList.add('hidden');
  });
}

/* ============================================================
   PRONTO PARA O FUTURO (estrutura-base, nada ativado agora):
   - Push Notifications: pedir permissão com Notification.requestPermission()
     e usar reg.pushManager.subscribe(...) quando houver backend de push.
   - Background Sync: navigator.serviceWorker.ready.then(reg => reg.sync.register('tag')).
   - IndexedDB: pode coexistir com o localStorage atual sem conflito, para
     armazenar volumes maiores de dados (ex.: anexos, fotos em alta resolução).
   - Firebase: se adotado futuramente, o registro do Service Worker acima
     pode ser combinado com o Firebase Cloud Messaging sem reescrever esta base.
   ============================================================ */
