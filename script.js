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
const CLOUD_KEYS = ['profiles', 'members', 'escalas', 'eventos', 'manut', 'financeiro', 'doacoes', 'devocionais', 'avisos', 'oracoes', 'settings'];
let applyingRemoteData = false;
let cloudLoaded = false;
let cloudSaveTimer = null;
let unsubscribeCloud = null;

// Controle de versão local para evitar que um snapshot antigo da nuvem
// apague dados recém-criados neste navegador antes do Firestore terminar de salvar.
const LOCAL_UPDATE_KEY = 'igreja_cloud_updated_ms';
let lastLocalWrite = Number(localStorage.getItem(LOCAL_UPDATE_KEY) || '0') || 0;
function currentLocalUpdatedAt(){
  return Number(localStorage.getItem(LOCAL_UPDATE_KEY) || lastLocalWrite || '0') || 0;
}
function markLocalDataChanged(){
  lastLocalWrite = Date.now();
  localStorage.setItem(LOCAL_UPDATE_KEY, String(lastLocalWrite));
}
function remoteClientUpdatedAt(data){
  return Number(data?.clientUpdatedAt || 0) || 0;
}


// Mesclagem defensiva: evita que um navegador com dados antigos sobrescreva
// perfis, membros, escalas ou lançamentos criados por outro dispositivo.
// A fonte continua sendo Firestore, mas antes de salvar unimos os dados locais
// com os dados já existentes na nuvem.
const RECORD_ARRAY_KEYS = ['profiles','members','escalas','eventos','manut','financeiro','doacoes','devocionais','avisos','oracoes'];
function recordUpdatedAt(item){
  return Number(item?._updatedAt || item?.updatedAt || item?.createdAt || 0) || 0;
}
function mergeArrayById(remoteArr=[], localArr=[]){
  const map=new Map();
  const put=(item, source)=>{
    if(!item || typeof item!=='object') return;
    const key=String(item.id || item.email || item.name || JSON.stringify(item));
    const next={...item};
    const cur=map.get(key);
    if(!cur){ map.set(key,next); return; }
    const curTs=recordUpdatedAt(cur), nextTs=recordUpdatedAt(next);
    if(nextTs>curTs) map.set(key,{...cur,...next});
    else if(nextTs===curTs && source==='local') map.set(key,{...cur,...next});
  };
  (Array.isArray(remoteArr)?remoteArr:[]).forEach(x=>put(x,'remote'));
  (Array.isArray(localArr)?localArr:[]).forEach(x=>put(x,'local'));
  return Array.from(map.values()).filter(x=>!x._deleted);
}
function localCloudSnapshot(){
  return {profiles,members,escalas,eventos,manut,financeiro,doacoes,devocionais,avisos,oracoes,settings,clientUpdatedAt:lastLocalWrite};
}
function mergeCloudPayload(remote={}, local={}){
  const merged={...remote,...local};
  RECORD_ARRAY_KEYS.forEach(k=>{
    merged[k]=mergeArrayById(remote[k], local[k]);
  });
  merged.settings={...(remote.settings||{}),...(local.settings||{})};
  // Perfis excluídos ficam registrados em settings.deletedProfileIds.
  // Isso evita que outro navegador com cache antigo traga o perfil de volta na próxima sincronização.
  const deletedProfiles = new Set(Array.isArray(merged.settings.deletedProfileIds) ? merged.settings.deletedProfileIds.map(String) : []);
  if(deletedProfiles.size && Array.isArray(merged.profiles)){
    merged.profiles = merged.profiles.filter(p => p && (String(p.id) === ADMIN_PROFILE_ID || !deletedProfiles.has(String(p.id))));
  }
  merged.clientUpdatedAt=Math.max(remoteClientUpdatedAt(remote), remoteClientUpdatedAt(local), currentLocalUpdatedAt(), Date.now());
  merged.updatedAt=serverTimestamp();
  return merged;
}
function stampRecord(obj){
  return {...obj,_updatedAt:Date.now()};
}
function isFreshLocalChange(){
  const t=currentLocalUpdatedAt();
  return !!t && (Date.now()-t) < 120000; // protege alterações feitas nos últimos 2 minutos
}

const LS={
  get:(k,d)=>{try{return JSON.parse(localStorage.getItem('igreja_'+k))??d}catch(e){return d}},
  set:(k,v)=>{
    localStorage.setItem('igreja_'+k,JSON.stringify(v));
    if(CLOUD_KEYS.includes(k) && !applyingRemoteData) {
      markLocalDataChanged();
      scheduleCloudSave();
    }
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
  if(!lastLocalWrite){
    lastLocalWrite = Date.now();
    localStorage.setItem(LOCAL_UPDATE_KEY, String(lastLocalWrite));
  }
  return {profiles, members, escalas, eventos, manut, financeiro, doacoes, devocionais, avisos, oracoes, settings, clientUpdatedAt:lastLocalWrite, updatedAt: serverTimestamp()};
}

function scheduleCloudSave(){
  clearTimeout(cloudSaveTimer);
  cloudSaveTimer=setTimeout(saveCloudData,500);
}

async function saveCloudData(){
  if(!cloudLoaded) return;
  try{
    const localPayload = collectCloudData();
    const snap = await getDoc(cloudDoc);
    const payload = snap.exists() ? mergeCloudPayload(snap.data(), localPayload) : localPayload;
    await setDoc(cloudDoc, payload, {merge:false});
    console.info('Dados salvos na nuvem com mesclagem segura.');
  }catch(e){
    console.error('Erro ao salvar no Firebase:', e);
    toast('Erro ao salvar na nuvem');
  }
}

function applyCloudData(data){
  if(!data) return;
  const remoteTs = remoteClientUpdatedAt(data);
  const localTs = currentLocalUpdatedAt();
  // Se o usuário acabou de criar/editar algo localmente, não deixa um snapshot antigo
  // da nuvem sobrescrever a tela. Em vez disso, reenviamos a versão local.
  if(localHasCloudData() && isFreshLocalChange() && localTs > (remoteTs + 1000)){
    console.warn('Snapshot antigo ignorado; mantendo alteração local mais recente.');
    cloudLoaded = true;
    scheduleCloudSave();
    return;
  }
  applyingRemoteData=true;
  const mergedRemote = mergeCloudPayload(data, localCloudSnapshot());
  profiles=Array.isArray(mergedRemote.profiles)?mergedRemote.profiles:[];
  members=Array.isArray(mergedRemote.members)?mergedRemote.members:[];
  escalas=Array.isArray(mergedRemote.escalas)?mergedRemote.escalas:[];
  eventos=Array.isArray(mergedRemote.eventos)?mergedRemote.eventos:[];
  manut=Array.isArray(mergedRemote.manut)?mergedRemote.manut:[];
  financeiro=Array.isArray(mergedRemote.financeiro)?mergedRemote.financeiro:[];
  doacoes=Array.isArray(mergedRemote.doacoes)?mergedRemote.doacoes:[];
  devocionais=Array.isArray(mergedRemote.devocionais)?mergedRemote.devocionais:[];
  avisos=Array.isArray(mergedRemote.avisos)?mergedRemote.avisos:[];
  oracoes=Array.isArray(mergedRemote.oracoes)?mergedRemote.oracoes:[];
  settings=(mergedRemote.settings&&typeof mergedRemote.settings==='object')?mergedRemote.settings:{churchName:'Igreja Betesda Fontes',theme:'dark'};
  const adminChanged=ensureAdminProfile(false);
  CLOUD_KEYS.forEach(k=>localStorage.setItem('igreja_'+k,JSON.stringify({profiles,members,escalas,eventos,manut,financeiro,doacoes,devocionais,avisos,oracoes,settings}[k])));
  if(remoteTs){
    lastLocalWrite = remoteTs;
    localStorage.setItem(LOCAL_UPDATE_KEY, String(remoteTs));
  }
  applyingRemoteData=false;
  refreshAfterCloudUpdate();
  if(adminChanged) scheduleCloudSave();
}

function refreshAfterCloudUpdate(){
  applyTheme();
  if(activeProfile && !profiles.find(p=>p.id===activeProfile)){
    activeProfile=null;
    localStorage.setItem('igreja_active_profile', JSON.stringify(null));
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
    cloudLoaded=true;
    if(snap.exists()){
      applyCloudData(snap.data());
      console.info('Dados carregados do Firebase.');
    }else if(localHasCloudData()){
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
  markLocalDataChanged();
  const clean={profiles:[adminProfileTemplate()],members:[],escalas:[],eventos:[],manut:[],financeiro:[],doacoes:[],devocionais:[],avisos:[],oracoes:[],settings:{churchName:'Igreja Betesda Fontes',theme:'dark'},clientUpdatedAt:lastLocalWrite,updatedAt:serverTimestamp()};
  await setDoc(cloudDoc, clean, {merge:true});
}

const NOW=new Date();
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const $=s=>document.querySelector(s);
const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Titles for the top bar per view (labels sourced from the sidebar config-driven nav)
const VIEW_TITLES={home:'nav-home',escalas:'nav-escalas',eventos:'nav-eventos',manut:'nav-manut',membros:'nav-membros',devocional:'nav-devocional',avisos:'nav-avisos',oracao:'nav-oracao',financeiro:'nav-financeiro',doacoes:'nav-doacoes',config:'nav-config'};

const getAvatars = () => Array.from({length:9}, (_,i)=>document.querySelector(`[data-template-id="avatar-${i+1}"]`)?.src || '').filter(Boolean);
let pfAvatar='';

let profiles=LS.get('profiles',[]),activeProfile=LS.get('active_profile',null);
let members=LS.get('members',[]),escalas=LS.get('escalas',[]),eventos=LS.get('eventos',[]),manut=LS.get('manut',[]),financeiro=LS.get('financeiro',[]),doacoes=LS.get('doacoes',[]),devocionais=LS.get('devocionais',[]),avisos=LS.get('avisos',[]),oracoes=LS.get('oracoes',[]);
let settings=LS.get('settings',{churchName:'Igreja Betesda Fontes',theme:'dark'});
let sidebarCollapsed=LS.get('sidebar_collapsed',false);
let escalaFilter='todas';

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
  return {id:ADMIN_PROFILE_ID,name:ADMIN_USERNAME,ministry:'Sistema',role:'Administrador',birthDate:'',avatar:getAvatars()[0]||'',passwordHash:ADMIN_PASSWORD_HASH,isAdmin:true};
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


/* IMAGENS / AVATAR MOBILE */
function resizeImageFile(file, maxSize=420, quality=0.78){
  return new Promise((resolve,reject)=>{
    if(!file){resolve('');return;}
    if(!file.type || !file.type.startsWith('image/')){reject(new Error('Arquivo inválido'));return;}
    const reader=new FileReader();
    reader.onerror=()=>reject(new Error('Não foi possível ler a imagem'));
    reader.onload=()=>{
      const img=new Image();
      img.onerror=()=>reject(new Error('Não foi possível carregar a imagem'));
      img.onload=()=>{
        try{
          const scale=Math.min(1, maxSize/Math.max(img.width||1,img.height||1));
          const w=Math.max(1, Math.round((img.width||maxSize)*scale));
          const h=Math.max(1, Math.round((img.height||maxSize)*scale));
          const canvas=document.createElement('canvas');
          canvas.width=w; canvas.height=h;
          const ctx=canvas.getContext('2d');
          ctx.drawImage(img,0,0,w,h);
          let data=canvas.toDataURL('image/jpeg', quality);
          // Firestore/localStorage sofrem com fotos grandes. Se ainda ficou grande, reduz mais.
          if(data.length>180000){
            const canvas2=document.createElement('canvas');
            const scale2=Math.min(1, 280/Math.max(w,h));
            canvas2.width=Math.max(1,Math.round(w*scale2));
            canvas2.height=Math.max(1,Math.round(h*scale2));
            canvas2.getContext('2d').drawImage(canvas,0,0,canvas2.width,canvas2.height);
            data=canvas2.toDataURL('image/jpeg',0.68);
          }
          resolve(data);
        }catch(err){reject(err);}
      };
      img.src=reader.result;
    };
    reader.readAsDataURL(file);
  });
}
async function handleAvatarUpload(file, onDone){
  try{
    toast('Preparando imagem...');
    const data=await resizeImageFile(file);
    onDone(data);
    toast('Imagem carregada');
  }catch(err){
    console.error('Erro ao processar imagem:',err);
    toast('Não foi possível carregar a imagem');
  }
}

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
  const loginBtn=$('#modal-save');
  if(loginBtn) loginBtn.innerHTML='<span class="canva-text">Entrar</span>';
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
$('#pf-upload').onchange=e=>{const f=e.target.files[0];if(!f)return;handleAvatarUpload(f,(data)=>{pfAvatar=data;updatePfPreview();renderAvatarOptions();});};
$('#profile-form').onsubmit=async e=>{
  e.preventDefault();
  const form=e.currentTarget;
  const submitBtn=form.querySelector('button[type=\"submit\"]');
  try{
    if(submitBtn){submitBtn.disabled=true;submitBtn.style.opacity='0.65';}
    const pass=$('#pf-password').value;
    const pass2=$('#pf-password-confirm').value;
    if(pass.length<4){toast('A senha precisa ter pelo menos 4 caracteres');return;}
    if(pass!==pass2){toast('As senhas não conferem');return;}
    const name=$('#pf-name').value.trim();
    if(!name){toast('Informe o nome');return;}
    const p=stampRecord({id:uid(),name,ministry:$('#pf-min').value.trim(),role:$('#pf-role').value.trim(),birthDate:$('#pf-birth').value,avatar:pfAvatar || getAvatars()[0],passwordHash:hashPassword(pass)});
    profiles.push(p);
    LS.set('profiles',profiles);
    activeProfile=p.id;
    LS.set('active_profile',p.id);
    $('#profile-form').classList.add('hidden');
    $('#profile-list-wrap').classList.remove('hidden');
    openApp();
    saveCloudData();
    toast('Perfil criado');
  }catch(err){
    console.error('Erro ao criar perfil:',err);
    toast('Erro ao criar perfil. Tente uma imagem menor.');
  }finally{
    if(submitBtn){submitBtn.disabled=false;submitBtn.style.opacity='';}
  }
};
$('#switch-profile').onclick=()=>{activeProfile=null;localStorage.setItem('igreja_active_profile', JSON.stringify(null));$('#app').classList.add('hidden');$('#profile-screen').classList.remove('hidden');renderProfiles();icons();};
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
  ['home','escalas','eventos','manut','membros','devocional','avisos','oracao','financeiro','doacoes','config'].forEach(x=>$('#view-'+x)?.classList.toggle('hidden',x!==v));
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  updateTopTitle(v);
  if(v==='home')renderHome();if(v==='membros')renderMembers();if(v==='escalas')renderEscalas();if(v==='eventos')renderEventos();if(v==='manut')renderManut();if(v==='devocional')renderDevocionais();if(v==='avisos')renderAvisos();if(v==='oracao')renderOracoes();if(v==='financeiro')renderFinanceiro();if(v==='doacoes')renderDoacoes();
  icons();
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{switchView(b.dataset.view);if(isMobileView())closeMobileSidebar();});
document.querySelectorAll('[data-card-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.cardView));
$('#add-quick').onclick=()=>{switchView('escalas');openEscalaModal();};
$('#bell-btn').onclick=()=>openNotificationCenter();
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
    $('#cfg-profile-birth') && ($('#cfg-profile-birth').textContent=p.birthDate ? ('Nascimento: '+fmtBirthDate(p.birthDate)) : 'Nascimento não cadastrado');
    $('#topbar-pname') && ($('#topbar-pname').textContent=p.name||'');
    $('#topbar-prole') && ($('#topbar-prole').textContent=roleLine||'Perfil ativo');
    $('#topbar-avatar') && ($('#topbar-avatar').innerHTML=avatarImg(p.avatar,'av-img'));
    $('#admin-manage-profiles') && $('#admin-manage-profiles').classList.toggle('hidden', !isAdminProfile(p));
    $('#delete-current-profile') && $('#delete-current-profile').classList.toggle('hidden', isAdminProfile(p));
  }
  const risk=$('#risk-zone');
  if(risk) risk.classList.remove('hidden');
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
$('#delete-current-profile').onclick=()=>openDeleteCurrentProfileModal();
$('#admin-manage-profiles').onclick=()=>openAdminProfilesModal();
$('#reset-data').onclick=()=>openAdminResetModal();


function rememberDeletedProfileId(id){
  if(!id || String(id)===ADMIN_PROFILE_ID) return;
  const current = Array.isArray(settings.deletedProfileIds) ? settings.deletedProfileIds.map(String) : [];
  const next = Array.from(new Set([...current, String(id)]));
  settings = {...settings, deletedProfileIds: next};
  localStorage.setItem('igreja_settings', JSON.stringify(settings));
}

async function commitProfilesDirect(nextProfiles, deletedProfileId=null){
  // Exclusão precisa gravar direto no Firestore e registrar o ID apagado.
  // Assim a mesclagem segura não traz o perfil de volta vindo de outro navegador/cache antigo.
  if(deletedProfileId) rememberDeletedProfileId(deletedProfileId);
  ensureAdminProfile(false);
  profiles = Array.isArray(nextProfiles) ? nextProfiles : profiles;
  const deletedProfiles = new Set(Array.isArray(settings.deletedProfileIds) ? settings.deletedProfileIds.map(String) : []);
  profiles = profiles.filter(p => p && (String(p.id)===ADMIN_PROFILE_ID || !deletedProfiles.has(String(p.id))));
  const adm = profiles.find(p=>p.id===ADMIN_PROFILE_ID) || adminProfileTemplate();
  profiles = [adm, ...profiles.filter(p=>p.id!==ADMIN_PROFILE_ID)];
  markLocalDataChanged();
  localStorage.setItem('igreja_profiles', JSON.stringify(profiles));
  localStorage.setItem('igreja_settings', JSON.stringify(settings));
  const payload = collectCloudData();
  try{
    await setDoc(cloudDoc, payload, {merge:false});
    return true;
  }catch(err){
    console.error('Erro ao excluir perfil na nuvem:', err);
    toast('Erro ao atualizar perfis na nuvem');
    return false;
  }
}

function openDeleteCurrentProfileModal(){
  resetModalSaveButton();
  const p=currentProfile();
  if(!p){toast('Selecione um perfil primeiro');return;}
  if(isAdminProfile(p)){toast('O perfil ADM não pode ser excluído');return;}
  $('#modal-title').textContent='Excluir perfil';
  $('#modal-form').innerHTML=`
    <div class="sm:col-span-2 rounded-xl p-3" style="border:1px solid rgba(255,107,107,.35);background:rgba(255,107,107,.08)">
      <p class="font-semibold text-red-400 flex items-center gap-2"><i data-lucide="trash-2"></i> Excluir perfil</p>
      <p class="muted text-sm mt-1">Essa ação remove somente o perfil <strong>${esc(p.name||'')}</strong>. Não apaga membros, escalas, eventos, financeiro, doações ou demais dados do sistema.</p>
    </div>
    ${profileHasPassword(p) ? '<div class="sm:col-span-2"><label class="text-sm muted block mb-1" for="delete-profile-password">Senha do perfil</label><input id="delete-profile-password" type="password" class="w-full rounded-xl px-3 py-2" autocomplete="current-password"><p class="muted text-xs mt-1">Use a senha deste perfil ou as credenciais do ADM abaixo.</p></div>' : '<div class="sm:col-span-2 rounded-xl p-3 card2 text-sm">Este perfil não tem senha cadastrada. Use as credenciais do ADM abaixo para excluir.</div>'}
    <div class="sm:col-span-2 grid sm:grid-cols-2 gap-3 rounded-xl p-3 card2">
      <div><label class="text-sm muted block mb-1" for="delete-adm-user">Usuário ADM</label><input id="delete-adm-user" class="w-full rounded-xl px-3 py-2" placeholder="ADM" autocomplete="username"></div>
      <div><label class="text-sm muted block mb-1" for="delete-adm-password">Senha ADM</label><input id="delete-adm-password" type="password" class="w-full rounded-xl px-3 py-2" autocomplete="current-password"></div>
    </div>
    <label class="sm:col-span-2 flex items-start gap-2 text-sm muted"><input id="delete-profile-confirm" type="checkbox" class="mt-1"> <span>Confirmo que desejo excluir apenas este perfil.</span></label>`;
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  const saveBtn=$('#modal-save');
  saveBtn.innerHTML='<span>Excluir perfil</span>';
  saveBtn.onclick=async()=>{
    const profilePassOk = profileHasPassword(p) && hashPassword($('#delete-profile-password')?.value||'')===p.passwordHash;
    const admOk = validAdminCredentials($('#delete-adm-user')?.value||'', $('#delete-adm-password')?.value||'');
    if(!profilePassOk && !admOk){toast('Informe a senha do perfil ou as credenciais do ADM');return;}
    if(!$('#delete-profile-confirm').checked){toast('Marque a confirmação');return;}
    const ok=await commitProfilesDirect(profiles.filter(x=>x.id!==p.id), p.id);
    if(!ok)return;
    activeProfile=null;
    localStorage.setItem('igreja_active_profile', JSON.stringify(null));
    closeModal();
    $('#app')?.classList.add('hidden');
    $('#profile-screen')?.classList.remove('hidden');
    renderProfiles();
    toast('Perfil excluído');
  };
  icons();
}

function openAdminProfilesModal(){
  resetModalSaveButton();
  const adm=currentProfile();
  if(!isAdminProfile(adm)){toast('Apenas o ADM pode gerenciar perfis');return;}
  $('#modal-title').textContent='Gerenciar perfis';
  const list=profiles.filter(p=>p.id!==ADMIN_PROFILE_ID);
  $('#modal-form').innerHTML=`
    <div class="sm:col-span-2 rounded-xl p-3 card2">
      <p class="font-semibold flex items-center gap-2"><i data-lucide="shield"></i> Área do ADM</p>
      <p class="muted text-sm mt-1">O ADM pode excluir perfis comuns sem precisar da senha do usuário. O perfil ADM é fixo e não pode ser excluído.</p>
    </div>
    <div class="sm:col-span-2 space-y-2" id="admin-profile-list">
      ${list.length?list.map(p=>`
        <div class="card2 rounded-xl p-3 flex items-center justify-between gap-3" data-profile-id="${esc(p.id)}">
          <div class="flex items-center gap-3 min-w-0">
            <div class="w-10 h-10 rounded-full overflow-hidden shrink-0">${avatarImg(p.avatar,'av-img')}</div>
            <div class="min-w-0"><p class="font-medium truncate">${esc(p.name||'Sem nome')}</p><p class="muted text-xs truncate">${esc((p.role||'')+(p.ministry?' · '+p.ministry:''))}</p></div>
          </div>
          <button type="button" class="admin-delete-profile rounded-lg px-3 py-2 text-sm font-semibold shrink-0" style="color:#ff6b6b;border:1px solid rgba(255,107,107,.3)"><i data-lucide="trash-2" style="width:16px;height:16px;display:inline"></i> Excluir</button>
        </div>`).join(''):'<p class="muted text-sm">Nenhum perfil comum cadastrado.</p>'}
    </div>`;
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  $('#modal-save').innerHTML='<span>Fechar</span>';
  $('#modal-save').onclick=closeModal;
  document.querySelectorAll('.admin-delete-profile').forEach(btn=>{
    btn.onclick=async()=>{
      const row=btn.closest('[data-profile-id]');
      const id=row?.dataset.profileId;
      const prof=profiles.find(p=>p.id===id);
      if(!prof || prof.id===ADMIN_PROFILE_ID)return;
      if(!confirm(`Excluir o perfil "${prof.name||'Sem nome'}"?`))return;
      const ok=await commitProfilesDirect(profiles.filter(p=>p.id!==id), id);
      if(!ok)return;
      row.remove();
      renderProfiles();
      refreshSettingsUI();
      toast('Perfil excluído pelo ADM');
      if(!document.querySelector('#admin-profile-list [data-profile-id]')) $('#admin-profile-list').innerHTML='<p class="muted text-sm">Nenhum perfil comum cadastrado.</p>';
    };
  });
  icons();
}

function validAdminCredentials(user, password){
  return String(user||'').trim().toUpperCase()===ADMIN_USERNAME && hashPassword(password)===ADMIN_PASSWORD_HASH;
}

async function performProtectedReset(){
  ['active_profile','members','escalas','eventos','manut','financeiro','doacoes','devocionais','avisos','oracoes','settings','sidebar_collapsed'].forEach(k=>localStorage.removeItem('igreja_'+k));
  profiles=[adminProfileTemplate()];LS.set('profiles',profiles);
  try{await resetCloudData();}catch(err){console.error('Erro ao apagar dados na nuvem:',err);toast('Erro ao apagar na nuvem');return false;}
  activeProfile=ADMIN_PROFILE_ID;LS.set('active_profile',activeProfile);
  toast('Dados apagados. Perfil ADM preservado.');
  setTimeout(()=>location.reload(),700);
  return true;
}

function openAdminResetModal(){
  $('#modal-title').textContent='Ação protegida';
  $('#modal-form').innerHTML=`
    <div class="sm:col-span-2 rounded-xl p-3" style="border:1px solid rgba(255,107,107,.35);background:rgba(255,107,107,.08)">
      <p class="font-semibold text-red-400 flex items-center gap-2"><i data-lucide="lock"></i> Zona de risco bloqueada</p>
      <p class="muted text-sm mt-1">Digite o usuário e senha para essa ação. Essa ação apaga todos os cadastros, eventos, escalas, financeiro, doações, devocionais, avisos, pedidos de oração e manutenções. O usuário ADM será preservado.</p>
    </div>
    <div class="sm:col-span-2"><label class="text-sm muted block mb-1" for="admin-action-user">Usuário</label><input id="admin-action-user" class="w-full rounded-xl px-3 py-2" autocomplete="username" placeholder="ADM"></div>
    <div class="sm:col-span-2"><label class="text-sm muted block mb-1" for="admin-action-pass">Senha</label><input id="admin-action-pass" type="password" class="w-full rounded-xl px-3 py-2" autocomplete="current-password" placeholder="Senha do administrador"></div>
    <div class="sm:col-span-2"><label class="flex items-start gap-2 text-sm muted"><input id="admin-action-confirm" type="checkbox" class="mt-1"> <span>Confirmo que quero apagar todos os dados do sistema.</span></label></div>
    <p id="admin-action-error" class="hidden sm:col-span-2 text-sm text-red-400 font-semibold"></p>`;
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  const saveBtn=$('#modal-save');
  saveBtn.innerHTML='<span>Confirmar e apagar</span>';
  saveBtn.classList.remove('accent-grad');
  saveBtn.style.background='#dc2626';
  saveBtn.style.color='#fff';
  const err=$('#admin-action-error');
  saveBtn.onclick=async()=>{
    err.classList.add('hidden');err.textContent='';
    const user=$('#admin-action-user').value;
    const pass=$('#admin-action-pass').value;
    const confirmed=$('#admin-action-confirm').checked;
    if(!user || !pass){err.textContent='Digite o usuário e senha para essa ação.';err.classList.remove('hidden');return;}
    if(!validAdminCredentials(user,pass)){err.textContent='Usuário ou senha incorretos.';err.classList.remove('hidden');return;}
    if(!confirmed){err.textContent='Marque a confirmação para apagar os dados.';err.classList.remove('hidden');return;}
    saveBtn.disabled=true;
    saveBtn.textContent='Apagando...';
    const ok=await performProtectedReset();
    if(ok===false){saveBtn.disabled=false;saveBtn.textContent='Confirmar e apagar';}
  };
  $('#admin-action-user')?.focus();
  icons();
}

/* DATES */
function fmtDate(d){if(!d)return'—';const[y,m,day]=d.split('-');return`${day}/${m}/${y}`;}
function parse(d){return d?new Date(d+'T00:00:00'):null;}
function fmtBirthDate(d){
  if(!d)return '';
  const parts=String(d).split('-');
  if(parts.length<3)return '';
  return `${parts[2]}/${parts[1]}`;
}
function birthDayNumber(d){
  const parts=String(d||'').split('-');
  return parts.length>=3 ? Number(parts[2])||0 : 0;
}
function isBirthdayThisMonth(d){
  const parts=String(d||'').split('-');
  if(parts.length<3)return false;
  return Number(parts[1]) === (NOW.getMonth()+1);
}
function getMonthlyBirthdays(){
  const people=[];
  profiles.filter(p=>p.id!==ADMIN_PROFILE_ID && p.birthDate).forEach(p=>people.push({kind:'Perfil',name:p.name,role:p.role||p.ministry||'',avatar:p.avatar,birthDate:p.birthDate}));
  members.filter(m=>m.birthDate).forEach(m=>people.push({kind:'Membro',name:m.name,role:m.role||m.ministry||'',avatar:m.avatar,birthDate:m.birthDate}));
  return people.filter(p=>isBirthdayThisMonth(p.birthDate)).sort((a,b)=>birthDayNumber(a.birthDate)-birthDayNumber(b.birthDate)||String(a.name||'').localeCompare(String(b.name||'')));
}

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

  renderBirthdaysPanel();
  renderHomeSpiritualPanels();
  updateNotificationsBadge();
  icons();
}

function renderBirthdaysPanel(){
  const list=getMonthlyBirthdays();
  const box=$('#birthday-list');
  const empty=$('#birthday-empty');
  const count=$('#birthday-count');
  if(!box || !empty || !count)return;
  box.innerHTML='';
  count.textContent=list.length===1?'1 aniversariante':`${list.length} aniversariantes`;
  empty.classList.toggle('hidden', list.length>0);
  list.forEach(p=>{
    const item=document.createElement('div');
    item.className='birthday-item card2 rounded-xl p-3 flex items-center gap-3';
    item.innerHTML=`<div class="birthday-date accent-grad text-white rounded-xl shrink-0"><span>${fmtBirthDate(p.birthDate).slice(0,2)}</span><small>${fmtBirthDate(p.birthDate).slice(3)}</small></div><div class="w-10 h-10 rounded-full overflow-hidden card2 shrink-0">${avatarImg(p.avatar,'av-img')}</div><div class="min-w-0 flex-1"><p class="font-semibold truncate">${esc(p.name)}</p><p class="muted text-xs truncate">${esc(p.kind)}${p.role?' · '+esc(p.role):''}</p></div>`;
    box.appendChild(item);
  });
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
      <div class="mt-3 space-y-1 text-sm muted">${m.phone?`<p class="flex items-center gap-2"><i data-lucide="phone" style="width:14px;height:14px"></i>${esc(m.phone)}</p>`:''}${m.email?`<p class="flex items-center gap-2"><i data-lucide="mail" style="width:14px;height:14px"></i>${esc(m.email)}</p>`:''}${m.birthDate?`<p class="flex items-center gap-2"><i data-lucide="cake" style="width:14px;height:14px"></i>Aniversário: ${fmtBirthDate(m.birthDate)}</p>`:''}${m.notes?`<p class="text-xs mt-1">${esc(m.notes)}</p>`:''}</div>`;
    d.querySelector('.ed').onclick=()=>openMemberModal(m);
    d.querySelector('.dl').onclick=e=>confirmDelete(e.currentTarget,()=>{members=members.filter(x=>x.id!==m.id);LS.set('members',members);renderMembers();toast('Membro excluído');});
    c.appendChild(d);
  });
  icons();
}
$('#member-search').oninput=renderMembers;
$('#add-member').onclick=()=>openMemberModal();

/* ESCALAS */
function escalaTipoLabel(t){
  return ({louvor:'Louvor',pregacao:'Pregação',lideranca:'Liderança',geral:'Geral'}[t||'geral'] || 'Geral');
}
function ensureEscalaTools(){
  const list=$('#escala-list');
  if(!list || $('#escala-tools')) return;
  const wrap=document.createElement('div');
  wrap.id='escala-tools';
  wrap.className='card rounded-2xl p-4 mb-4';
  wrap.innerHTML=`<div class="flex flex-wrap items-center justify-between gap-3 mb-3"><div><h3 class="font-bold">Tipos de escala</h3><p class="muted text-sm">Crie escalas mensais separadas para Louvor, Pregação e Liderança.</p></div></div>
  <div class="grid sm:grid-cols-3 gap-3 mb-4">
    <button class="escala-month-btn card2 rounded-xl p-3 text-left hover:opacity-90" data-month="louvor"><div class="font-semibold flex items-center gap-2"><i data-lucide="music"></i>Escala: Louvor</div><p class="muted text-xs mt-1">Ministro, violão, guitarra, contrabaixo, teclado, vocais, bateria e cajon/percussão</p></button>
    <button class="escala-month-btn card2 rounded-xl p-3 text-left hover:opacity-90" data-month="pregacao"><div class="font-semibold flex items-center gap-2"><i data-lucide="book-open"></i>Escala: Pregação</div><p class="muted text-xs mt-1">Pregador por data do mês</p></button>
    <button class="escala-month-btn card2 rounded-xl p-3 text-left hover:opacity-90" data-month="lideranca"><div class="font-semibold flex items-center gap-2"><i data-lucide="hand"></i>Escala: Liderança</div><p class="muted text-xs mt-1">Oração inicial, dízimos e final</p></button>
  </div>
  <div class="flex flex-wrap gap-2 text-sm">
    ${['todas','louvor','pregacao','lideranca','geral'].map(t=>`<button class="escala-filter px-3 py-2 rounded-xl ${escalaFilter===t?'accent-grad text-white':'card2'}" data-filter="${t}">${t==='todas'?'Todas':escalaTipoLabel(t)}</button>`).join('')}
  </div>`;
  list.parentNode.insertBefore(wrap,list);
  wrap.querySelectorAll('[data-month]').forEach(b=>b.onclick=()=>openEscalaMensalModal(b.dataset.month));
  wrap.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{escalaFilter=b.dataset.filter;$('#escala-tools')?.remove();renderEscalas();});
  icons();
}
function escalaSearchText(e){
  return [e.date,e.time,e.type,e.worship,e.preacher,e.openingPrayer,e.tithePrayer,e.finalPrayer,e.reception,e.media,e.sound,e.minister,e.acousticGuitar,e.electricGuitar,e.bass,e.keyboard,e.vocals,e.drums,e.guitar2,e.cajonPercussion,e.notes].filter(Boolean).join(' ').toLowerCase();
}
function escalaRows(e){
  const row=(l,v)=>v?`<p class="muted"><span class="role-di">${l}:</span> ${esc(v)}</p>`:'';
  if(e.type==='louvor') return `${row('Ministro',e.minister||e.worship)}${row('Violão',e.acousticGuitar)}${row('Guitarra',e.electricGuitar||e.guitar)}${row('Contrabaixo',e.bass||e.contrabass)}${row('Teclado',e.keyboard)}${row('Vocais',e.vocals)}${row('Bateria',e.drums||e.guitar2)}${row('Cajon/Percussão',e.cajonPercussion)}${e.notes?`<p class="text-xs mt-1 muted">${esc(e.notes)}</p>`:''}`;
  if(e.type==='pregacao') return `${row('Pregador',e.preacher)}${e.notes?`<p class="text-xs mt-1 muted">${esc(e.notes)}</p>`:''}`;
  if(e.type==='lideranca') return `${row('Oração inicial',e.openingPrayer)}${row('Oração dízimos',e.tithePrayer)}${row('Oração final',e.finalPrayer)}${e.notes?`<p class="text-xs mt-1 muted">${esc(e.notes)}</p>`:''}`;
  return `${row('Louvor',e.worship)}${row('Pregador',e.preacher)}${row('Oração inicial',e.openingPrayer)}${row('Oração dízimos',e.tithePrayer)}${row('Recepção',e.reception)}${row('Mídia',e.media)}${row('Som',e.sound)}${e.notes?`<p class="text-xs mt-1 muted">${esc(e.notes)}</p>`:''}`;
}
function renderEscalas(){
  ensureEscalaTools();
  const q=$('#escala-search').value.toLowerCase();
  const list=escalas.filter(e=>{
    const type=e.type||'geral';
    const okFilter=escalaFilter==='todas'||type===escalaFilter;
    return okFilter && escalaSearchText(e).includes(q);
  }).sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const c=$('#escala-list');c.innerHTML='';$('#escala-empty').classList.toggle('hidden',list.length>0);
  list.forEach(e=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    const type=e.type||'geral';
    d.innerHTML=`<div class="flex items-start justify-between gap-2 mb-2">
      <div><p class="font-semibold flex items-center gap-2"><i data-lucide="calendar" style="width:16px;height:16px;color:var(--accent)"></i>${fmtDate(e.date)} · ${esc(e.time||'')}</p><p class="muted text-xs mt-1">Escala: ${esc(escalaTipoLabel(type))}</p></div>
      <div class="flex gap-1 shrink-0"><button class="dup muted hover:text-[var(--accent)]" title="Duplicar" aria-label="Duplicar"><i data-lucide="copy"></i></button><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div>
      <div class="text-sm space-y-1">${escalaRows(e)}</div>`;
    d.querySelector('.ed').onclick=()=>openEscalaModal(e);
    d.querySelector('.dup').onclick=()=>{escalas.push(stampRecord({...e,id:uid()}));LS.set('escalas',escalas);renderEscalas();toast('Escala duplicada');};
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{escalas=escalas.filter(x=>x.id!==e.id);markLocalDataChanged();LS.set('escalas',escalas);renderEscalas();toast('Escala excluída');});
    c.appendChild(d);
  });
  icons();
}
$('#escala-search').oninput=renderEscalas;
$('#add-escala').onclick=()=>openEscalaModal();

function sundayDatesOfMonth(monthValue){
  if(!monthValue) return [];
  const [year,month]=monthValue.split('-').map(Number);
  if(!year || !month) return [];
  const last=new Date(year,month,0).getDate();
  const dates=[];
  for(let day=1; day<=last; day++){
    const dt=new Date(year,month-1,day);
    if(dt.getDay()===0){
      const date=`${year}-${String(month).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
      dates.push(date);
    }
  }
  return dates;
}
function escalaMonthlyRoleFields(tipo){
  if(tipo==='louvor') return [
    ['minister','Ministro'],
    ['acousticGuitar','Violão'],
    ['electricGuitar','Guitarra'],
    ['bass','Contrabaixo'],
    ['keyboard','Teclado'],
    ['vocals','Vocais'],
    ['drums','Bateria'],
    ['cajonPercussion','Cajon/Percussão']
  ];
  if(tipo==='pregacao') return [
    ['preacher','Pregador']
  ];
  if(tipo==='lideranca') return [
    ['openingPrayer','Oração Inicial'],
    ['tithePrayer','Oração Dízimos'],
    ['finalPrayer','Oração Final']
  ];
  return [];
}
function openEscalaMensalModal(tipo){
  resetModalSaveButton();
  const label=escalaTipoLabel(tipo);
  const monthNow=new Date().toISOString().slice(0,7);
  const saveBtn=$('#modal-save');
  $('#modal-title').textContent='Criar escala mensal: '+label;
  saveBtn.innerHTML='<span class="canva-text">Salvar escalas do mês</span>';
  $('#modal-form').innerHTML=`
    <div class="sm:col-span-2 card2 rounded-2xl p-3 mb-1">
      <p class="font-semibold">Escala mensal por domingos</p>
      <p class="muted text-sm mt-1">Selecione o mês. O sistema monta automaticamente todos os domingos e você preenche pessoas diferentes para cada culto.</p>
    </div>
    <div>
      <label for="escala-month-field" class="text-sm muted block mb-1">Mês *</label>
      <input id="escala-month-field" type="month" value="${monthNow}" class="w-full rounded-xl px-3 py-2">
    </div>
    <div>
      <label for="escala-time-field" class="text-sm muted block mb-1">Horário padrão</label>
      <input id="escala-time-field" type="time" value="19:30" class="w-full rounded-xl px-3 py-2">
    </div>
    <div id="monthly-sundays-wrap" class="sm:col-span-2 space-y-3 mt-2"></div>`;
  const wrap=$('#monthly-sundays-wrap');
  const fields=escalaMonthlyRoleFields(tipo);
  const renderSundayBlocks=()=>{
    const month=$('#escala-month-field').value;
    const dates=sundayDatesOfMonth(month);
    if(!dates.length){wrap.innerHTML='<p class="muted text-sm">Nenhum domingo encontrado para este mês.</p>';return;}
    wrap.innerHTML=dates.map((date,idx)=>`
      <div class="card rounded-2xl p-4" data-sunday-index="${idx}" data-date="${date}">
        <div class="flex items-center justify-between gap-2 mb-3">
          <div>
            <p class="font-bold">Domingo ${fmtDate(date)}</p>
            <p class="muted text-xs">${label}</p>
          </div>
          <span class="text-xs px-2 py-1 rounded-full card2">${idx+1}º domingo</span>
        </div>
        <div class="grid sm:grid-cols-2 gap-3">
          ${fields.map(([key,roleLabel])=>`
            <div class="${fields.length===1?'sm:col-span-2':''}">
              <label class="text-sm muted block mb-1" for="monthly-${idx}-${key}">${roleLabel}</label>
              <input id="monthly-${idx}-${key}" data-role-key="${key}" class="w-full rounded-xl px-3 py-2" placeholder="Nome">
            </div>`).join('')}
          <div class="sm:col-span-2">
            <label class="text-sm muted block mb-1" for="monthly-${idx}-notes">Observações</label>
            <textarea id="monthly-${idx}-notes" data-role-key="notes" rows="2" class="w-full rounded-xl px-3 py-2" placeholder="Opcional"></textarea>
          </div>
        </div>
      </div>`).join('');
  };
  renderSundayBlocks();
  $('#escala-month-field').onchange=renderSundayBlocks;
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  saveBtn.onclick=()=>{
    const month=$('#escala-month-field').value;
    const time=$('#escala-time-field').value || '19:30';
    if(!month){toast('Selecione o mês');return;}
    const blocks=Array.from(document.querySelectorAll('#monthly-sundays-wrap [data-date]'));
    if(!blocks.length){toast('Nenhum domingo encontrado');return false;}
    const created=blocks.map(block=>{
      const item=stampRecord({id:uid(),type:tipo,date:block.dataset.date,time});
      fields.forEach(([key])=>{item[key]=(block.querySelector(`[data-role-key="${key}"]`)?.value||'').trim();});
      item.notes=(block.querySelector('[data-role-key="notes"]')?.value||'').trim();
      if(tipo==='louvor') item.worship=item.minister || '';
      return item;
    });
    escalas.push(...created);
    LS.set('escalas',escalas);
    escalaFilter=tipo;
    $('#escala-tools')?.remove();
    renderEscalas();
    toast(`${created.length} domingos criados para ${label}`);
    closeModal();
  };
  icons();
}

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


/* DEVOCIONAL / PLANO DE LEITURA */
function todayISO(){return new Date().toISOString().slice(0,10);}
function sortedByDateDesc(list){return [...list].sort((a,b)=>(b.date||'').localeCompare(a.date||''));}


/* DEVOCIONAL AUTOMÁTICO — PLANO DE LEITURA 2026
   Gera automaticamente um devocional por dia de 01/07/2026 a 31/12/2026.
   Não depende de cadastro manual nem de internet. Os devocionais manuais continuam funcionando como extras. */
const AUTO_DEVOTIONAL_START='2026-07-01';
const AUTO_DEVOTIONAL_END='2026-12-31';
const AUTO_DEVOTIONAL_THEMES=[
  {title:'Confiança em Deus',ref:'Salmos 37:5',reflection:'Confiar em Deus é entregar o caminho a Ele mesmo quando ainda não enxergamos todos os detalhes. A fé amadurece quando descansamos na direção do Senhor.',prayer:'Senhor, ajuda-nos a confiar em Ti e a caminhar com paz, mesmo quando não entendemos tudo.'},
  {title:'Graça para hoje',ref:'2 Coríntios 12:9',reflection:'A graça de Deus não é apenas uma ideia bonita; ela é força real para permanecer firme no dia de hoje.',prayer:'Pai, que a Tua graça sustente nossa casa, nossa igreja e nossas decisões hoje.'},
  {title:'Servir com alegria',ref:'Colossenses 3:23',reflection:'Servir na obra de Deus é mais do que cumprir uma escala. É oferecer o melhor ao Senhor com um coração sincero.',prayer:'Senhor, renova em nós a alegria de servir e a disposição para fazer tudo como para Ti.'},
  {title:'Unidade no corpo',ref:'Efésios 4:3',reflection:'A igreja se fortalece quando cada pessoa escolhe preservar a unidade, tratar o outro com amor e caminhar em paz.',prayer:'Deus, guarda a unidade da nossa igreja e ensina-nos a honrar uns aos outros.'},
  {title:'Palavra que guia',ref:'Salmos 119:105',reflection:'A Palavra de Deus ilumina decisões, corrige rotas e fortalece o coração para viver com sabedoria.',prayer:'Senhor, que a Tua Palavra ilumine nossos passos e governe nossas escolhas.'},
  {title:'Perseverança na fé',ref:'Hebreus 12:1',reflection:'A caminhada cristã exige constância. Nem todo dia será fácil, mas Deus nos chama a permanecer olhando para Cristo.',prayer:'Jesus, fortalece nossa perseverança e tira de nós tudo que atrapalha nossa caminhada.'},
  {title:'Amor em prática',ref:'1 João 3:18',reflection:'O amor cristão aparece em atitudes simples: ouvir, ajudar, perdoar, servir e cuidar de quem está perto.',prayer:'Pai, transforma nosso amor em atitudes que revelem o Teu coração.'},
  {title:'Coração ensinável',ref:'Provérbios 9:9',reflection:'Quem tem um coração ensinável cresce em sabedoria. Deus trabalha em nós quando aceitamos ser corrigidos e guiados.',prayer:'Senhor, dá-nos humildade para aprender, mudar e crescer na Tua presença.'},
  {title:'Paz em meio à pressão',ref:'Filipenses 4:6-7',reflection:'A paz de Deus não depende da ausência de problemas. Ela guarda o coração quando entregamos tudo em oração.',prayer:'Deus, guarda nossa mente e nosso coração com a Tua paz hoje.'},
  {title:'Fidelidade nas pequenas coisas',ref:'Lucas 16:10',reflection:'A fidelidade começa nas pequenas responsabilidades. Deus vê o cuidado, a constância e a obediência diária.',prayer:'Senhor, ajuda-nos a sermos fiéis nas pequenas e grandes responsabilidades.'},
  {title:'Renovo espiritual',ref:'Isaías 40:31',reflection:'Deus renova as forças daqueles que esperam Nele. Cansaço não é o fim quando o Senhor é a nossa fonte.',prayer:'Pai, renova nossa fé, nossa força e nossa esperança em Ti.'},
  {title:'Chamados para frutificar',ref:'João 15:5',reflection:'A vida frutífera nasce da permanência em Cristo. Antes de fazer mais, somos chamados a estar Nele.',prayer:'Jesus, mantém-nos ligados a Ti para que nossa vida produza frutos verdadeiros.'},
  {title:'Cuidado com as palavras',ref:'Provérbios 18:21',reflection:'Palavras podem curar ou ferir. O discípulo de Cristo aprende a falar com verdade, graça e responsabilidade.',prayer:'Senhor, governa nossas palavras e usa nossa boca para edificar.'},
  {title:'Generosidade',ref:'Atos 20:35',reflection:'A generosidade reflete o coração de Deus. Dar, ajudar e compartilhar são sinais de uma vida transformada.',prayer:'Pai, ensina-nos a viver com mãos abertas e coração generoso.'},
  {title:'Santidade diária',ref:'1 Pedro 1:15-16',reflection:'Santidade é viver separado para Deus nas escolhas comuns do dia: pensamentos, atitudes, conversas e prioridades.',prayer:'Senhor, purifica nosso coração e guia-nos em santidade.'},
  {title:'Família no altar',ref:'Josué 24:15',reflection:'Uma casa firmada em Deus é construída com oração, perdão, cuidado e decisões que honram o Senhor.',prayer:'Deus, abençoa as famílias da nossa igreja e firma cada lar na Tua presença.'},
  {title:'Esperança viva',ref:'1 Pedro 1:3',reflection:'A esperança cristã não é otimismo vazio; ela nasce da ressurreição de Jesus e sustenta a alma.',prayer:'Jesus, renova em nós a esperança viva que vem de Ti.'},
  {title:'Coragem para obedecer',ref:'Deuteronômio 31:6',reflection:'Obedecer a Deus exige coragem, mas nunca caminhamos sozinhos. O Senhor vai conosco.',prayer:'Senhor, dá-nos coragem para obedecer mesmo quando for difícil.'},
  {title:'Oração constante',ref:'1 Tessalonicenses 5:17',reflection:'Orar sem cessar é viver consciente da presença de Deus, levando a Ele cada preocupação e gratidão.',prayer:'Pai, aproxima-nos de Ti em uma vida de oração simples e constante.'},
  {title:'Alegria no Senhor',ref:'Neemias 8:10',reflection:'A alegria do Senhor fortalece a alma. Ela não ignora as lutas, mas encontra descanso em Deus.',prayer:'Senhor, que a Tua alegria seja nossa força hoje.'},
  {title:'Compaixão',ref:'Colossenses 3:12',reflection:'A compaixão nos move a perceber pessoas, dores e necessidades. Uma igreja saudável também é uma igreja sensível.',prayer:'Deus, dá-nos olhos atentos e coração compassivo.'},
  {title:'Discernimento',ref:'Tiago 1:5',reflection:'Deus dá sabedoria a quem pede com fé. Antes de decidir, podemos buscar direção no Senhor.',prayer:'Pai, concede-nos sabedoria e discernimento para cada decisão.'},
  {title:'Perdão',ref:'Efésios 4:32',reflection:'Perdoar não apaga a dor, mas quebra prisões e abre espaço para cura. Deus nos perdoou primeiro.',prayer:'Senhor, ajuda-nos a liberar perdão e caminhar em cura.'},
  {title:'Adoração verdadeira',ref:'João 4:23',reflection:'Adoração não é apenas canção; é uma vida rendida a Deus em espírito e em verdade.',prayer:'Jesus, recebe nossa adoração em palavras, atitudes e obediência.'},
  {title:'Dependência de Deus',ref:'Provérbios 3:5-6',reflection:'Depender de Deus é reconhecer que Ele enxerga o caminho inteiro. Nossa segurança está em confiar no Senhor.',prayer:'Pai, ensina-nos a depender de Ti em todas as áreas.'},
  {title:'Crescimento espiritual',ref:'2 Pedro 3:18',reflection:'Crescer na fé é um processo diário. Pequenas escolhas consistentes produzem maturidade no tempo certo.',prayer:'Senhor, amadurece nossa fé e aumenta nosso conhecimento de Cristo.'},
  {title:'Cuidado pastoral',ref:'1 Pedro 5:2',reflection:'Cuidar de pessoas é parte do coração de Deus. A igreja cresce quando há zelo, atenção e amor prático.',prayer:'Deus, fortalece todos que cuidam, lideram e servem pessoas.'},
  {title:'Fé que age',ref:'Tiago 2:17',reflection:'A fé viva produz movimento. Ela se manifesta em obediência, serviço e amor concreto.',prayer:'Senhor, que nossa fé seja vista em atitudes que glorifiquem o Teu nome.'},
  {title:'Gratidão',ref:'Salmos 103:2',reflection:'A gratidão ajuda o coração a lembrar o que Deus já fez. Quem se lembra da bondade de Deus caminha com mais fé.',prayer:'Pai, ensina-nos a reconhecer e agradecer Tuas bênçãos todos os dias.'},
  {title:'Missão',ref:'Mateus 28:19',reflection:'A igreja existe para anunciar Cristo. Cada pessoa alcançada é motivo para servir com propósito e amor.',prayer:'Jesus, desperta em nós paixão pela missão e amor pelas pessoas.'},
  {title:'Descanso em Deus',ref:'Mateus 11:28',reflection:'Cristo chama os cansados para perto. Descansar Nele é entregar pesos que não fomos chamados a carregar sozinhos.',prayer:'Senhor, recebe nossos pesos e dá descanso verdadeiro à nossa alma.'}
];
const NT_BOOKS_2026=[
  ['Mateus',28],['Marcos',16],['Lucas',24],['João',21],['Atos',28],['Romanos',16],['1 Coríntios',16],['2 Coríntios',13],['Gálatas',6],['Efésios',6],['Filipenses',4],['Colossenses',4],['1 Tessalonicenses',5],['2 Tessalonicenses',3],['1 Timóteo',6],['2 Timóteo',4],['Tito',3],['Filemom',1],['Hebreus',13],['Tiago',5],['1 Pedro',5],['2 Pedro',3],['1 João',5],['2 João',1],['3 João',1],['Judas',1],['Apocalipse',22]
];
function isoDateFromParts(y,m,d){return `${y}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;}
function dateRangeISO(start,end){
  const out=[]; const s=new Date(start+'T00:00:00'); const e=new Date(end+'T00:00:00');
  for(let d=new Date(s); d<=e; d.setDate(d.getDate()+1)) out.push(d.toISOString().slice(0,10));
  return out;
}
function readingRange(book,start,end){return start===end?`${book} ${start}`:`${book} ${start}-${end}`;}
function buildNtReadingPlan2026(totalDays){
  const readings=[]; let bookIdx=0, chapter=1;
  for(let i=0;i<totalDays;i++){
    const parts=[];
    let chaptersToday=(i%3===0)?2:1;
    while(chaptersToday>0 && bookIdx<NT_BOOKS_2026.length){
      const [book,total]=NT_BOOKS_2026[bookIdx];
      const start=chapter;
      const end=Math.min(total, chapter+chaptersToday-1);
      parts.push(readingRange(book,start,end));
      chaptersToday-=(end-start+1);
      chapter=end+1;
      if(chapter>total){bookIdx++;chapter=1;}
    }
    if(!parts.length){
      const ps=((i*2)%150)+1;
      parts.push(readingRange('Salmos',ps,Math.min(150,ps+1)));
    }
    readings.push(parts.join('; '));
  }
  return readings;
}
function buildAutoDevotionalPlan2026(){
  const dates=dateRangeISO(AUTO_DEVOTIONAL_START,AUTO_DEVOTIONAL_END);
  const nt=buildNtReadingPlan2026(dates.length);
  return dates.map((date,i)=>{
    const t=AUTO_DEVOTIONAL_THEMES[i%AUTO_DEVOTIONAL_THEMES.length];
    const day=new Date(date+'T00:00:00').getDate();
    const ps=((i)%150)+1;
    const pv=((i)%31)+1;
    const reading=`${nt[i]}\nSalmo ${ps}\nProvérbios ${pv}`;
    return {
      id:`auto-devocional-2026-${date}`,
      auto:true,
      date,
      title:t.title,
      type:'Devocional automático',
      reference:t.ref,
      reading,
      content:`Reflexão:\n${t.reflection}\n\nOração:\n${t.prayer}\n\nPlano de leitura:\n${reading}`
    };
  });
}
const AUTO_DEVOTIONALS_2026=buildAutoDevotionalPlan2026();


/* PLANOS ORIGINAIS BETESDA — biblioteca com capas e progresso
   Conteúdo próprio: títulos, reflexões e estrutura criados para uso interno da Betesda Fontes.
   Usamos referências bíblicas, não copiamos textos/capas de plataformas externas. */
const BETESDA_PLAN_DEFS=[
  {
    id:'plano-anual-2026',
    title:'Plano Anual Betesda 2026',
    duration:'Jul-Dez 2026',
    icon:'calendar-days',
    cover:'cover-annual',
    subtitle:'Leitura diária para os meses restantes de 2026',
    description:'Um caminho contínuo de leitura, oração e reflexão para manter a igreja alinhada com a Palavra todos os dias.',
    days:()=>AUTO_DEVOTIONALS_2026.map((d,i)=>({day:i+1,date:d.date,title:d.title,reference:d.reference,reading:d.reading,reflection:d.content}))
  },
  {
    id:'vida-de-oracao',
    title:'Vida de Oração',
    duration:'21 dias',
    icon:'hand',
    cover:'cover-prayer',
    subtitle:'Aprendendo a conversar com Deus todos os dias',
    description:'Um plano para fortalecer a intimidade com Deus, cultivar constância e transformar preocupações em oração.',
    days:[
      ['O convite à oração','Mateus 6:5-13','Jesus nos ensina que oração não é performance, é relacionamento com o Pai. Comece hoje separando um momento simples e sincero diante de Deus.'],
      ['Ore com confiança','Hebreus 4:16','A graça nos permite chegar diante de Deus sem medo. Ele ouve, acolhe e sustenta quem se aproxima com fé.'],
      ['Persistência','Lucas 18:1-8','A oração constante forma perseverança no coração. Nem sempre a resposta é imediata, mas Deus trabalha enquanto esperamos.'],
      ['Gratidão','Filipenses 4:6-7','A ansiedade perde força quando apresentamos tudo a Deus com gratidão. A paz do Senhor guarda mente e coração.'],
      ['Oração em secreto','Mateus 6:6','Há encontros com Deus que ninguém vê, mas que sustentam tudo o que vivemos em público.'],
      ['Intercessão','1 Timóteo 2:1','Interceder é carregar pessoas em oração. A igreja se fortalece quando ora uns pelos outros.'],
      ['Ouvir Deus','Salmos 46:10','Orar também é silenciar para reconhecer que Deus é Deus. Nem toda oração precisa ser cheia de palavras.'],
      ['Perdão na oração','Marcos 11:25','A oração abre espaço para cura. Ao perdoar, entregamos a Deus pesos que não precisamos carregar.'],
      ['Dependência','João 15:5','Sem Cristo, nossa força se esgota. Em oração reconhecemos que dependemos Dele para frutificar.'],
      ['Clamor','Jeremias 33:3','Deus convida Seu povo a clamar. Mesmo quando não vemos saída, Ele conhece caminhos que não enxergamos.'],
      ['Sabedoria','Tiago 1:5','Antes de decidir, ore. Deus dá sabedoria ao coração que reconhece seus limites.'],
      ['Fé em meio à espera','Salmos 27:14','Esperar no Senhor não é inércia; é confiança ativa. A oração sustenta a esperança.'],
      ['Oração e santidade','Salmos 139:23-24','Deus também responde mostrando o que precisa ser tratado em nós. A oração nos alinha ao caminho eterno.'],
      ['Família em oração','Josué 24:15','Uma casa que busca ao Senhor constrói fundamentos firmes. Ore por sua família e por futuras gerações.'],
      ['Igreja em oração','Atos 2:42','A igreja nasce e cresce em oração, comunhão, doutrina e partir do pão.'],
      ['Liderança em oração','Colossenses 4:2-4','Ore por quem lidera, ensina, serve e cuida. A obra de Deus precisa de cobertura espiritual.'],
      ['Oração e missão','Mateus 9:37-38','Jesus nos manda orar por trabalhadores. A missão começa no altar e se move para as ruas.'],
      ['Confissão','1 João 1:9','Confessar é abrir o coração para a restauração de Deus. Ele é fiel para perdoar e purificar.'],
      ['Adoração','Salmos 95:6','A oração também é rendição e adoração. Antes de pedir, reconheça quem Deus é.'],
      ['Paz','Isaías 26:3','Deus guarda em perfeita paz aquele cuja mente permanece Nele. A oração reposiciona nosso foco.'],
      ['Continue orando','1 Tessalonicenses 5:17','Uma vida de oração não termina em um plano. Continue cultivando diálogo diário com Deus.']
    ]
  },
  {
    id:'fe-que-permanece',
    title:'Fé que Permanece',
    duration:'14 dias',
    icon:'shield-check',
    cover:'cover-faith',
    subtitle:'Força espiritual para dias difíceis',
    description:'Um plano para lembrar que a fé cristã não depende das circunstâncias, mas da fidelidade de Deus.',
    days:[
      ['Firmes na Rocha','Mateus 7:24-27','A fé se fortalece quando escolhemos praticar a Palavra. O fundamento certo sustenta a casa nos ventos fortes.'],
      ['Quando não entendo','Isaías 55:8-9','Nem sempre entenderemos o caminho, mas podemos confiar no caráter de Deus.'],
      ['Esperança viva','1 Pedro 1:3','Nossa esperança não é frágil: ela nasce da ressurreição de Cristo.'],
      ['Coragem','Josué 1:9','Deus não apenas manda ser forte; Ele promete estar conosco.'],
      ['Paciência','Romanos 5:3-5','A perseverança produz maturidade. Deus usa processos para formar caráter.'],
      ['Descanso','Mateus 11:28-30','Jesus não chama os cansados para mais peso, mas para descanso verdadeiro.'],
      ['Olhos em Cristo','Hebreus 12:1-2','Fixar os olhos em Jesus nos ajuda a correr com perseverança.'],
      ['Provisão','Filipenses 4:19','Deus conhece nossas necessidades. Sua provisão chega conforme Sua vontade e sabedoria.'],
      ['Presença','Salmos 23','O Pastor caminha conosco nos vales e nas mesas preparadas.'],
      ['Vitória em Cristo','Romanos 8:37','Somos mais que vencedores porque Cristo nos sustenta, não porque somos fortes sozinhos.'],
      ['Fidelidade','Lamentações 3:22-23','As misericórdias do Senhor se renovam a cada manhã.'],
      ['Obediência','João 14:21','A fé verdadeira se revela em amor e obediência.'],
      ['Alegria','Neemias 8:10','A alegria do Senhor é força para continuar.'],
      ['Permaneça','João 15:4','Permanecer em Cristo é a fonte do fruto.']
    ]
  },
  {
    id:'servir-com-proposito',
    title:'Servir com Propósito',
    duration:'14 dias',
    icon:'heart-handshake',
    cover:'cover-service',
    subtitle:'Para equipes, ministérios e voluntários',
    description:'Uma jornada para servir com excelência, humildade e amor, lembrando que tudo é para Deus.',
    days:[
      ['Chamados para servir','Marcos 10:45','Jesus serviu primeiro. Nosso serviço nasce do exemplo Dele.'],
      ['Servir com alegria','Salmos 100:2','Alegria no serviço transforma tarefas em adoração.'],
      ['Excelência','Colossenses 3:23','Servimos a Deus em cada detalhe, mesmo quando ninguém percebe.'],
      ['Humildade','Filipenses 2:3-4','A humildade abre espaço para unidade e cuidado mútuo.'],
      ['Dons espirituais','1 Pedro 4:10','Cada dom recebido é uma oportunidade de servir ao próximo.'],
      ['Unidade','1 Coríntios 12:12-27','O corpo tem muitos membros, mas um só propósito.'],
      ['Fidelidade','Lucas 16:10','A fidelidade nas pequenas coisas prepara o coração para responsabilidades maiores.'],
      ['Coração ensinável','Provérbios 19:20','Quem serve bem também aprende, escuta e se deixa corrigir.'],
      ['Cuidado com pessoas','Gálatas 6:2','Servir é carregar fardos com amor e sensibilidade.'],
      ['Sem comparação','Romanos 12:4-8','Cada pessoa tem uma função. Comparação enfraquece; propósito fortalece.'],
      ['Perseverança','1 Coríntios 15:58','O trabalho no Senhor não é vão. Continue firme.'],
      ['Liderança servidora','João 13:14-15','Jesus lavou pés. Liderar no Reino é servir.'],
      ['Motivação correta','Mateus 6:1','Deus vê o coração por trás das obras.'],
      ['Para a glória de Deus','1 Coríntios 10:31','Tudo pode glorificar a Deus quando nasce de um coração rendido.']
    ]
  },
  {
    id:'familia-comunhao',
    title:'Família e Comunhão',
    duration:'14 dias',
    icon:'users',
    cover:'cover-family',
    subtitle:'Relacionamentos firmados em amor e perdão',
    description:'Um plano para fortalecer família, comunhão e cuidado entre irmãos.',
    days:[
      ['Casa edificada','Salmos 127:1','O Senhor é o fundamento de toda casa. Sem Ele, esforço vira peso.'],
      ['Amor paciente','1 Coríntios 13:4-7','O amor bíblico é prático, paciente e perseverante.'],
      ['Perdão no lar','Colossenses 3:13','Perdoar é abrir caminho para reconciliação e cura.'],
      ['Palavras que curam','Provérbios 15:1','Palavras brandas podem desarmar conflitos.'],
      ['Honra','Romanos 12:10','Honrar é reconhecer valor no outro.'],
      ['Comunhão da igreja','Atos 2:46-47','A comunhão cristã se expressa em presença, partilha e alegria.'],
      ['Cuidado mútuo','João 13:34-35','O amor entre irmãos é testemunho do evangelho.'],
      ['Paciência com diferenças','Efésios 4:2-3','Unidade exige humildade, mansidão e paciência.'],
      ['Oração em família','Deuteronômio 6:6-7','A fé também é ensinada no cotidiano da casa.'],
      ['Acolhimento','Romanos 15:7','Cristo nos acolheu; por isso acolhemos pessoas.'],
      ['Generosidade','Atos 4:32','Comunhão verdadeira não ignora necessidades.'],
      ['Conselho sábio','Provérbios 11:14','Bons conselhos protegem decisões e relacionamentos.'],
      ['Paz','Romanos 12:18','Onde depender de nós, devemos buscar a paz.'],
      ['Um só corpo','Efésios 4:16','Quando cada parte coopera, o corpo cresce em amor.']
    ]
  },
  {
    id:'louvor-adoracao',
    title:'Louvor e Adoração',
    duration:'10 dias',
    icon:'music',
    cover:'cover-worship',
    subtitle:'Vida no altar antes da canção',
    description:'Um plano para equipes de louvor e para todos que desejam adorar com vida inteira.',
    days:[
      ['Adoração em verdade','João 4:23-24','Deus procura adoradores, não apenas canções. A verdadeira adoração envolve espírito e verdade.'],
      ['Cântico novo','Salmos 96:1','Louvar é anunciar a grandeza do Senhor com coração renovado.'],
      ['Excelência e coração','Salmos 33:3','Tocar bem importa, mas o coração rendido vem primeiro.'],
      ['Presença de Deus','Salmos 22:3','O louvor nos lembra que Deus reina e está presente com Seu povo.'],
      ['Humildade no palco','João 3:30','Todo ministério deve apontar para Cristo, não para pessoas.'],
      ['Unidade da equipe','Romanos 15:5-6','Uma equipe unida adora com uma só voz e um só propósito.'],
      ['Santidade','Salmos 24:3-4','Quem ministra também é chamado a cuidar do coração.'],
      ['Gratidão cantada','Colossenses 3:16','Cânticos espirituais também ensinam, encorajam e fortalecem a igreja.'],
      ['Antes do microfone','Mateus 5:23-24','A adoração pública precisa caminhar com reconciliação e integridade.'],
      ['Tudo para Deus','Salmos 115:1','A glória pertence ao Senhor.']
    ]
  }
];
function normalizePlanDays(plan){
  const raw=typeof plan.days==='function'?plan.days():plan.days;
  return raw.map((d,i)=>{
    if(Array.isArray(d)) return {day:i+1,title:d[0],reference:d[1],reflection:d[2],reading:d[1]};
    return {day:i+1,...d};
  });
}
function getReadingPlans(){return BETESDA_PLAN_DEFS.map(p=>({...p,days:normalizePlanDays(p)}));}
function getPlanProgress(){return LS.get('reading_plan_progress',{} ) || {};}
function getProfileProgressKey(){return activeProfile||'geral';}
function isPlanDayDone(planId,day){const all=getPlanProgress();return !!(all[getProfileProgressKey()]?.[planId]?.[day]);}
function togglePlanDay(planId,day){
  const all=getPlanProgress(); const key=getProfileProgressKey();
  all[key]=all[key]||{}; all[key][planId]=all[key][planId]||{};
  all[key][planId][day]=!all[key][planId][day];
  LS.set('reading_plan_progress',all);
  if($('#view-devocional')?.classList.contains('plan-open')) renderReadingPlanDetail(planId);
  renderReadingPlanLibrary(false);
}
function getPlanCompletion(plan){
  const done=plan.days.filter(d=>isPlanDayDone(plan.id,d.day)).length;
  const total=plan.days.length||1;
  return {done,total,pct:Math.round((done/total)*100)};
}
function renderReadingPlanLibrary(renderDetail=false){
  const wrap=$('#reading-plan-library'); if(!wrap)return;
  const plans=getReadingPlans();
  const selected=LS.get('selected_reading_plan',plans[0]?.id)||plans[0]?.id;
  wrap.innerHTML=plans.map(p=>{
    const prog=getPlanCompletion(p);
    return `<button type="button" class="reading-plan-card card rounded-3xl overflow-hidden text-left hover:opacity-95 ${p.id===selected?'selected':''}" data-plan-id="${esc(p.id)}" aria-label="Abrir plano ${esc(p.title)}">
      <div class="plan-cover ${esc(p.cover||'cover-annual')}">
        <div class="plan-cover-glow"></div>
        <div class="plan-cover-icon"><i data-lucide="${esc(p.icon||'book-open')}"></i></div>
        <div class="plan-cover-text"><p class="plan-cover-kicker">Plano Betesda</p><h4>${esc(p.title)}</h4><span>${esc(p.duration)}</span></div>
      </div>
      <div class="p-4">
        <div class="flex items-start justify-between gap-2">
          <div class="min-w-0"><p class="font-semibold">${esc(p.title)}</p><p class="muted text-sm mt-1">${esc(p.subtitle)}</p></div>
          <span class="text-xs px-3 py-1 rounded-full card2 muted shrink-0">Abrir</span>
        </div>
        <div class="plan-progress mt-3"><span style="width:${prog.pct}%"></span></div>
        <p class="text-xs muted mt-2">${prog.done}/${prog.total} concluídos · ${prog.pct}%</p>
      </div>
    </button>`;
  }).join('');
  wrap.querySelectorAll('[data-plan-id]').forEach(b=>b.onclick=()=>openReadingPlanPage(b.dataset.planId));
  if($('#view-devocional')?.classList.contains('plan-open') || renderDetail) renderReadingPlanDetail(selected);
  else $('#reading-plan-detail') && ($('#reading-plan-detail').innerHTML='');
  icons();
}
function openReadingPlanPage(planId){
  const plans=getReadingPlans();
  const selected=plans.find(p=>p.id===planId)?.id || plans[0]?.id;
  if(!selected)return;
  LS.set('selected_reading_plan',selected);
  $('#view-devocional')?.classList.add('plan-open');
  renderReadingPlanDetail(selected);
  const main=document.querySelector('main');
  if(main) main.scrollTo({top:0,behavior:'smooth'});
  else window.scrollTo({top:0,behavior:'smooth'});
}
function closeReadingPlanPage(){
  $('#view-devocional')?.classList.remove('plan-open');
  $('#reading-plan-detail') && ($('#reading-plan-detail').innerHTML='');
  renderReadingPlanLibrary(false);
}
function renderReadingPlanDetail(planId){
  const box=$('#reading-plan-detail'); if(!box)return;
  const plan=getReadingPlans().find(p=>p.id===planId) || getReadingPlans()[0];
  if(!plan){box.innerHTML='';return;}
  const prog=getPlanCompletion(plan);
  const today=todayISO();
  const todayDay=plan.id==='plano-anual-2026' ? (plan.days.find(d=>d.date===today)?.day || 1) : Math.min(prog.done+1, plan.days.length);
  const previewDays=plan.days.map(d=>{
    const done=isPlanDayDone(plan.id,d.day);
    const isToday=plan.id==='plano-anual-2026' && d.date===today;
    return `<div class="plan-day card2 rounded-2xl p-3 ${done?'done':''} ${isToday?'today':''}">
      <div class="flex items-start gap-3">
        <button type="button" class="plan-day-check ${done?'done':''}" data-plan="${esc(plan.id)}" data-day="${d.day}" aria-label="Concluir dia ${d.day}">${done?'✓':' '}</button>
        <div class="min-w-0 flex-1">
          <div class="flex flex-wrap items-center gap-2"><p class="font-semibold">Dia ${d.day} · ${esc(d.title||'Leitura')}</p>${isToday?'<span class="text-[11px] px-2 py-0.5 rounded-full accent-grad text-white">Hoje</span>':''}</div>
          <p class="text-xs muted mt-0.5">${d.date?fmtDate(d.date)+' · ':''}${esc(d.reference||d.reading||'')}</p>
          ${d.reading&&d.reading!==d.reference?`<p class="text-xs muted mt-1 whitespace-pre-line">Leitura: ${esc(d.reading)}</p>`:''}
          <p class="text-sm muted mt-2">${esc(d.reflection||'Separe um momento para ler, meditar e orar.')}</p>
        </div>
      </div>
    </div>`;
  }).join('');
  box.innerHTML=`<div class="plan-detail-page-head mb-4 flex flex-wrap items-center justify-between gap-3">
    <button type="button" id="back-to-plan-library" class="canva-button rounded-xl px-4 py-2.5 card2 flex items-center gap-2 font-medium"><i data-lucide="arrow-left"></i> Voltar aos planos</button>
    <span class="text-xs px-3 py-1 rounded-full card2 muted">Plano de leitura aberto</span>
  </div><div class="card rounded-3xl overflow-hidden plan-detail-card">
    <div class="grid lg:grid-cols-[320px_1fr]">
      <div class="plan-cover plan-cover-large ${esc(plan.cover||'cover-annual')}">
        <div class="plan-cover-glow"></div>
        <div class="plan-cover-icon"><i data-lucide="${esc(plan.icon||'book-open')}"></i></div>
        <div class="plan-cover-text"><p class="plan-cover-kicker">Plano selecionado</p><h4>${esc(plan.title)}</h4><span>${esc(plan.duration)}</span></div>
      </div>
      <div class="p-5">
        <div class="flex flex-wrap items-start justify-between gap-3">
          <div><h3 class="font-bold text-xl">${esc(plan.title)}</h3><p class="muted text-sm mt-1">${esc(plan.description)}</p></div>
          <button type="button" class="canva-button rounded-xl px-4 py-2.5 card2 text-sm font-medium" id="complete-current-plan-day"><i data-lucide="check-circle" style="display:inline;width:16px;height:16px"></i> Concluir próximo dia</button>
        </div>
        <div class="plan-progress mt-4"><span style="width:${prog.pct}%"></span></div>
        <p class="text-xs muted mt-2">${prog.done}/${prog.total} dias concluídos · ${prog.pct}%</p>
        <div class="plan-days mt-5 grid gap-3 max-h-[560px] overflow-y-auto pr-1">${previewDays}</div>
      </div>
    </div>
  </div>`;
  $('#back-to-plan-library')?.addEventListener('click',closeReadingPlanPage);
  $('#complete-current-plan-day')?.addEventListener('click',()=>togglePlanDay(plan.id,todayDay));
  box.querySelectorAll('.plan-day-check').forEach(btn=>btn.addEventListener('click',()=>togglePlanDay(btn.dataset.plan,Number(btn.dataset.day))));
  icons();
}
function getAllDevocionais(){
  const manual=Array.isArray(devocionais)?devocionais.map(d=>({...d,auto:false})):[];
  return [...manual,...AUTO_DEVOTIONALS_2026];
}
function sortDevocionaisForDisplay(list){
  const today=todayISO();
  return [...list].sort((a,b)=>{
    const ap=(a.date||'')>=today?0:1;
    const bp=(b.date||'')>=today?0:1;
    if(ap!==bp) return ap-bp;
    return ap===0?(a.date||'').localeCompare(b.date||''):(b.date||'').localeCompare(a.date||'');
  });
}
function getDevocionalAtual(){
  const all=getAllDevocionais();
  const today=todayISO();
  return all.find(d=>(d.date||'')===today) || sortedByDateDesc(all.filter(d=>(d.date||'')<=today))[0] || all[0] || null;
}
function renderHomeSpiritualPanels(){
  const devBox=$('#home-devocional-box');
  if(devBox){
    const d=getDevocionalAtual();
    devBox.innerHTML=d?`<p class="font-semibold text-[var(--text)]">${esc(d.title||'Devocional')}</p><p class="text-xs muted mt-1">${esc(d.reference||d.type||'')}</p><p class="mt-2 line-clamp-3">${esc((d.content||'').slice(0,220))}${(d.content||'').length>220?'...':''}</p><p class="text-[11px] muted mt-3">Plano automático 2026 · ${fmtDate(d.date)}</p>`:'Nenhum devocional disponível.';
  }
  const avBox=$('#home-avisos-box');
  if(avBox){
    const latest=sortedByDateDesc(avisos).slice(0,3);
    avBox.innerHTML=latest.length?latest.map(a=>`<div class="card2 rounded-xl p-3"><p class="font-semibold text-[var(--text)] truncate">${esc(a.title||'Aviso')}</p><p class="text-xs muted">${fmtDate(a.date)} · ${esc(a.category||'Geral')}</p></div>`).join(''):'Nenhum aviso publicado.';
  }
  const orBox=$('#home-oracao-box');
  if(orBox){
    const active=oracoes.filter(o=>(o.status||'Em oração')!=='Respondido');
    orBox.innerHTML=active.length?`<p class="font-semibold text-[var(--text)]">${active.length} pedido(s) em oração</p><p class="text-xs muted mt-1">Último: ${esc(active[0]?.requester||'Não informado')}</p><p class="mt-2">${esc((active[0]?.request||'').slice(0,120))}${(active[0]?.request||'').length>120?'...':''}</p>`:'Nenhum pedido em oração.';
  }
}
function renderDevocionais(){
  renderReadingPlanLibrary();
  const list=sortDevocionaisForDisplay(getAllDevocionais());
  const current=getDevocionalAtual();
  const c=$('#devocional-list'); if(!c) return;
  c.innerHTML=''; $('#devocional-empty')?.classList.add('hidden');
  const destaque=$('#devocional-hoje');
  if(destaque && current){
    destaque.innerHTML=`<div class="card rounded-2xl p-5 mb-5 devotional-today-card"><div class="flex flex-wrap items-start justify-between gap-3"><div><p class="text-xs uppercase tracking-wide muted">Devocional de hoje · ${fmtDate(current.date)}</p><h3 class="font-bold text-xl mt-1 flex items-center gap-2"><i data-lucide="sunrise" style="color:var(--accent)"></i>${esc(current.title||'Devocional do dia')}</h3><p class="text-sm muted mt-1">${esc(current.reference||'')}</p></div><span class="text-xs px-3 py-1 rounded-full card2">Plano automático 2026</span></div><p class="muted text-sm mt-4 whitespace-pre-line">${esc(current.content||'')}</p></div>`;
  }
  list.forEach(dv=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    const isAuto=!!dv.auto;
    d.innerHTML=`<div class="flex items-start justify-between gap-2"><div class="min-w-0"><p class="font-semibold truncate flex items-center gap-2"><i data-lucide="book-open" style="color:var(--accent)"></i>${esc(dv.title||'Devocional')}</p><p class="muted text-sm">${fmtDate(dv.date)} · ${esc(dv.type||'Devocional')}</p></div><div class="flex gap-1 shrink-0">${isAuto?'<span class="text-[11px] px-2 py-1 rounded-full card2 muted">Auto</span>':'<button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button>'}</div></div>${dv.reference?`<p class="text-sm mt-3 font-medium">${esc(dv.reference)}</p>`:''}<p class="muted text-sm mt-2 whitespace-pre-line">${esc(dv.content||'')}</p>`;
    if(!isAuto){
      d.querySelector('.ed').onclick=()=>openDevocionalModal(dv);
      d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{devocionais=devocionais.filter(x=>x.id!==dv.id);LS.set('devocionais',devocionais);renderDevocionais();renderHomeSpiritualPanels();toast('Devocional excluído');});
    }
    c.appendChild(d);
  });
  icons();
}
$('#add-devocional') && ($('#add-devocional').onclick=()=>openDevocionalModal());
function openDevocionalModal(d){d=d||{};openModal(d.id?'Editar devocional':'Novo devocional',[
  {k:'title',l:'Título *',v:d.title,wide:true},{k:'type',l:'Tipo',v:d.type||'Devocional',type:'select',opts:['Devocional','Plano de leitura','Estudo bíblico']},
  {k:'date',l:'Data',v:d.date||todayISO(),type:'date'},{k:'reference',l:'Referência bíblica',v:d.reference},
  {k:'content',l:'Mensagem / leitura',v:d.content,type:'textarea',wide:true}
],v=>{if(d.id)Object.assign(d,v);else devocionais.push({id:uid(),...v});LS.set('devocionais',devocionais);renderDevocionais();renderHomeSpiritualPanels();toast('Devocional salvo');});}

/* MURAL DE AVISOS */
function renderAvisos(){
  const list=sortedByDateDesc(avisos);
  const c=$('#avisos-list'); if(!c) return;
  c.innerHTML=''; $('#avisos-empty')?.classList.toggle('hidden',list.length>0);
  list.forEach(av=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    const pr=av.priority||'Normal';
    d.innerHTML=`<div class="flex items-start justify-between gap-2"><div class="min-w-0"><p class="font-semibold truncate flex items-center gap-2"><i data-lucide="megaphone" style="color:var(--accent)"></i>${esc(av.title||'Aviso')}</p><p class="muted text-sm">${fmtDate(av.date)} · ${esc(av.category||'Geral')}</p></div><div class="flex gap-1 shrink-0"><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div><p class="mt-2">${statusChip(pr)}</p><p class="muted text-sm mt-3 whitespace-pre-line">${esc(av.message||'')}</p>${av.author?`<p class="muted text-xs mt-3">Publicado por: ${esc(av.author)}</p>`:''}`;
    d.querySelector('.ed').onclick=()=>openAvisoModal(av);
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{avisos=avisos.filter(x=>x.id!==av.id);LS.set('avisos',avisos);renderAvisos();renderHomeSpiritualPanels();toast('Aviso excluído');});
    c.appendChild(d);
  });
  icons();
}
$('#add-aviso') && ($('#add-aviso').onclick=()=>openAvisoModal());
function openAvisoModal(a){a=a||{};openModal(a.id?'Editar aviso':'Novo aviso',[
  {k:'title',l:'Título *',v:a.title,wide:true},{k:'category',l:'Categoria',v:a.category||'Geral',type:'select',opts:['Geral','Culto','Evento','Louvor','Reunião','Urgente']},
  {k:'date',l:'Data',v:a.date||todayISO(),type:'date'},{k:'priority',l:'Prioridade',v:a.priority||'Normal',type:'select',opts:['Normal','Importante','Urgente']},
  {k:'message',l:'Mensagem',v:a.message,type:'textarea',wide:true},{k:'author',l:'Responsável',v:a.author}
],v=>{if(a.id)Object.assign(a,v);else avisos.push({id:uid(),...v});LS.set('avisos',avisos);renderAvisos();renderHomeSpiritualPanels();toast('Aviso salvo');});}

/* PEDIDOS DE ORAÇÃO */
function renderOracoes(){
  const list=sortedByDateDesc(oracoes);
  const open=list.filter(o=>(o.status||'Em oração')!=='Respondido').length;
  const answered=list.filter(o=>(o.status||'Em oração')==='Respondido').length;
  $('#oracao-abertos') && ($('#oracao-abertos').textContent=open);
  $('#oracao-respondidos') && ($('#oracao-respondidos').textContent=answered);
  $('#oracao-total') && ($('#oracao-total').textContent=list.length);
  const c=$('#oracao-list'); if(!c) return;
  c.innerHTML=''; $('#oracao-empty')?.classList.toggle('hidden',list.length>0);
  list.forEach(or=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    const answered=(or.status||'Em oração')==='Respondido';
    d.innerHTML=`<div class="flex items-start justify-between gap-2"><div class="min-w-0"><p class="font-semibold truncate flex items-center gap-2"><i data-lucide="hand" style="color:var(--accent)"></i>${esc(or.requester||'Pedido de oração')}</p><p class="muted text-sm">${fmtDate(or.date)} · ${esc(or.category||'Geral')}</p></div><div class="flex gap-1 shrink-0"><button class="tg muted hover:text-[var(--accent)]" title="Alternar status" aria-label="Alternar status"><i data-lucide="check-circle"></i></button><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div><p class="mt-2">${statusChip(answered?'Respondido':'Em oração')}</p><p class="muted text-sm mt-3 whitespace-pre-line">${esc(or.request||'')}</p>`;
    d.querySelector('.tg').onclick=()=>{or.status=answered?'Em oração':'Respondido';LS.set('oracoes',oracoes);renderOracoes();renderHomeSpiritualPanels();toast('Status atualizado');};
    d.querySelector('.ed').onclick=()=>openOracaoModal(or);
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{oracoes=oracoes.filter(x=>x.id!==or.id);LS.set('oracoes',oracoes);renderOracoes();renderHomeSpiritualPanels();toast('Pedido excluído');});
    c.appendChild(d);
  });
  icons();
}
$('#add-oracao') && ($('#add-oracao').onclick=()=>openOracaoModal());
function openOracaoModal(o){o=o||{};openModal(o.id?'Editar pedido':'Novo pedido de oração',[
  {k:'requester',l:'Nome *',v:o.requester,wide:true},{k:'category',l:'Categoria',v:o.category||'Geral',type:'select',opts:['Geral','Saúde','Família','Trabalho','Espiritual','Gratidão','Outro']},
  {k:'date',l:'Data',v:o.date||todayISO(),type:'date'},{k:'status',l:'Status',v:o.status||'Em oração',type:'select',opts:['Em oração','Respondido']},
  {k:'request',l:'Pedido / gratidão',v:o.request,type:'textarea',wide:true}
],v=>{if(o.id)Object.assign(o,v);else oracoes.push({id:uid(),...v});LS.set('oracoes',oracoes);renderOracoes();renderHomeSpiritualPanels();toast('Pedido salvo');});}

/* NOTIFICAÇÕES */
function getNotifications(){
  const notes=[];
  const devotionalToday=getDevocionalAtual();
  if(devotionalToday) notes.push({icon:'book-open',title:'Devocional de hoje',text:`${devotionalToday.title||'Devocional'} · ${devotionalToday.reference||fmtDate(devotionalToday.date)}`});
  getMonthlyBirthdays().slice(0,5).forEach(p=>notes.push({icon:'cake',title:`Aniversário: ${p.name}`,text:`${fmtBirthDate(p.birthDate)} · ${p.kind}${p.role?' · '+p.role:''}`}));
  sortedByDateDesc(avisos).slice(0,3).forEach(a=>notes.push({icon:'megaphone',title:a.title||'Aviso',text:`${fmtDate(a.date)} · ${a.category||'Geral'}`}));
  const prayers=oracoes.filter(o=>(o.status||'Em oração')!=='Respondido');
  if(prayers.length) notes.push({icon:'hand',title:'Pedidos de oração',text:`${prayers.length} pedido(s) em oração`});
  const upEvt=eventos.filter(e=>parse(e.date)>=new Date(NOW.toDateString())).sort((a,b)=>a.date.localeCompare(b.date))[0];
  if(upEvt) notes.push({icon:'party-popper',title:'Próximo evento',text:`${upEvt.name} · ${fmtDate(upEvt.date)}`});
  const upEsc=escalas.filter(e=>parse(e.date)>=new Date(NOW.toDateString())).sort((a,b)=>a.date.localeCompare(b.date))[0];
  if(upEsc) notes.push({icon:'calendar-check',title:'Próxima escala',text:`${fmtDate(upEsc.date)} ${upEsc.time||''}`});
  return notes;
}
function updateNotificationsBadge(){
  const btn=$('#bell-btn'); if(!btn) return;
  let badge=btn.querySelector('.notif-badge');
  const count=getNotifications().length;
  if(!badge){badge=document.createElement('span');badge.className='notif-badge';btn.style.position='relative';btn.appendChild(badge);}
  badge.textContent=count>9?'9+':count;
  badge.classList.toggle('hidden',count===0);
}
function openNotificationCenter(){
  resetModalSaveButton();
  const notes=getNotifications();
  $('#modal-title').textContent='Notificações';
  $('#modal-form').innerHTML=notes.length?`<div class="sm:col-span-2 space-y-2">${notes.map(n=>`<div class="card2 rounded-xl p-3 flex items-start gap-3"><i data-lucide="${n.icon}" style="color:var(--accent)"></i><div><p class="font-semibold">${esc(n.title)}</p><p class="muted text-sm">${esc(n.text||'')}</p></div></div>`).join('')}</div>`:'<p class="sm:col-span-2 muted text-sm">Nenhuma notificação no momento.</p>';
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  const saveBtn=$('#modal-save');
  saveBtn.disabled=true;saveBtn.classList.remove('accent-grad','text-white');saveBtn.style.display='none';
  icons();
}

/* FINANCEIRO */
function renderFinanceiro(){
  const list=[...financeiro].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const entradas=list.filter(x=>x.type==='Entrada').reduce((s,x)=>s+(Number(String(x.value||0).replace(',','.'))||0),0);
  const saidas=list.filter(x=>x.type==='Saída').reduce((s,x)=>s+(Number(String(x.value||0).replace(',','.'))||0),0);
  $('#fin-entradas').textContent=money(entradas);$('#fin-saidas').textContent=money(saidas);$('#fin-saldo').textContent=money(entradas-saidas);
  const resumo=$('#financeiro-resumo');
  if(resumo){
    const porCat={};
    list.forEach(x=>{const k=x.category||'Sem categoria';porCat[k]=(porCat[k]||0)+(Number(String(x.value||0).replace(',','.'))||0)*(x.type==='Saída'?-1:1);});
    const rows=Object.entries(porCat).sort((a,b)=>Math.abs(b[1])-Math.abs(a[1]));
    resumo.classList.toggle('hidden',rows.length===0);
    resumo.innerHTML=rows.length?`<p class="font-semibold mb-2">Resumo por categoria</p><div class="grid sm:grid-cols-2 lg:grid-cols-3 gap-2">${rows.map(([k,v])=>`<div class="card2 rounded-xl p-3"><p class="muted text-xs truncate">${esc(k)}</p><p class="font-semibold ${v>=0?'role-di':'role-or'}">${money(v)}</p></div>`).join('')}</div>`:'';
  }
  const c=$('#financeiro-list');c.innerHTML='';$('#financeiro-empty').classList.toggle('hidden',list.length>0);
  list.forEach(f=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    const isEntrada=f.type==='Entrada';
    d.innerHTML=`<div class="flex items-start justify-between gap-2"><div><p class="font-semibold flex items-center gap-2"><i data-lucide="${isEntrada?'arrow-down-circle':'arrow-up-circle'}" class="${isEntrada?'role-di':'role-or'}"></i>${esc(f.title||f.category||f.type)}</p><p class="muted text-sm">${fmtDate(f.date)} · ${esc(f.category||'')} ${f.method?'· '+esc(f.method):''}</p></div><div class="flex gap-1 shrink-0"><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div><p class="font-bold text-xl mt-3 ${isEntrada?'role-di':'role-or'}">${money(f.value)}</p>${f.notes?`<p class="muted text-xs mt-2">${esc(f.notes)}</p>`:''}`;
    d.querySelector('.ed').onclick=()=>openFinanceiroModal(f);
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{financeiro=financeiro.filter(x=>x.id!==f.id);LS.set('financeiro',financeiro);renderFinanceiro();toast('Movimentação excluída');});
    c.appendChild(d);
  });
  icons();
}
$('#add-financeiro').onclick=()=>openFinanceiroModal();
function openFinanceiroModal(f){f=f||{};openModal(f.id?'Editar movimentação':'Nova movimentação',[
  {k:'title',l:'Descrição *',v:f.title,wide:true},{k:'type',l:'Tipo',v:f.type||'Entrada',type:'select',opts:['Entrada','Saída']},
  {k:'value',l:'Valor',v:f.value,type:'number'},{k:'date',l:'Data',v:f.date,type:'date'},{k:'category',l:'Categoria',v:f.category},{k:'method',l:'Forma',v:f.method||'Pix',type:'select',opts:['Pix','Dinheiro','Cartão','Transferência','Outro']},{k:'notes',l:'Observações',v:f.notes,type:'textarea',wide:true}
],v=>{if(f.id)Object.assign(f,v);else financeiro.push({id:uid(),...v});LS.set('financeiro',financeiro);renderFinanceiro();toast('Movimentação salva');});}

/* DOAÇÕES */
function renderDoacoes(){
  const list=[...doacoes].sort((a,b)=>(b.date||'').localeCompare(a.date||''));
  const total=list.reduce((s,x)=>s+(Number(String(x.value||0).replace(',','.'))||0),0);
  $('#doacoes-total').textContent=money(total);
  const resumo=$('#doacoes-resumo');
  if(resumo){
    const porTipo={}; list.forEach(x=>{const k=x.type||'Oferta';porTipo[k]=(porTipo[k]||0)+(Number(String(x.value||0).replace(',','.'))||0);});
    const rows=Object.entries(porTipo).sort((a,b)=>b[1]-a[1]);
    resumo.innerHTML=rows.length?`<p class="muted text-xs mb-1">Resumo por tipo</p>${rows.slice(0,3).map(([k,v])=>`<p class="text-sm flex justify-between gap-2"><span class="muted">${esc(k)}</span><strong>${money(v)}</strong></p>`).join('')}`:'<p class="muted text-xs mb-1">Resumo</p><p class="muted text-sm">Sem dados</p>';
  }
  const c=$('#doacoes-list');c.innerHTML='';$('#doacoes-empty').classList.toggle('hidden',list.length>0);
  list.forEach(dn=>{
    const d=document.createElement('div');d.className='card rounded-2xl p-4';
    d.innerHTML=`<div class="flex items-start justify-between gap-2"><p class="font-semibold truncate flex items-center gap-2"><i data-lucide="heart" class="role-di"></i>${esc(dn.donor||'Doador não informado')}</p><div class="flex gap-1 shrink-0"><button class="ed muted hover:text-[var(--accent)]" aria-label="Editar"><i data-lucide="pencil"></i></button><button class="dl muted hover:text-red-400" aria-label="Excluir"><i data-lucide="trash-2"></i></button></div></div><p class="font-bold text-xl mt-3 role-di">${money(dn.value)}</p><p class="muted text-sm">${fmtDate(dn.date)} · ${esc(dn.type||'Oferta')} · ${esc(dn.method||'')}</p>${dn.notes?`<p class="muted text-xs mt-2">${esc(dn.notes)}</p>`:''}`;
    d.querySelector('.ed').onclick=()=>openDoacaoModal(dn);
    d.querySelector('.dl').onclick=ev=>confirmDelete(ev.currentTarget,()=>{doacoes=doacoes.filter(x=>x.id!==dn.id);LS.set('doacoes',doacoes);renderDoacoes();toast('Doação excluída');});
    c.appendChild(d);
  });
  icons();
}
$('#add-doacao').onclick=()=>openDoacaoModal();
function openDoacaoModal(d){d=d||{};openModal(d.id?'Editar doação':'Nova doação',[
  {k:'donor',l:'Doador *',v:d.donor,wide:true},{k:'value',l:'Valor',v:d.value,type:'number'},
  {k:'type',l:'Tipo',v:d.type||'Oferta',type:'select',opts:['Dízimo','Oferta','Missões','Campanha','Evento','Outro']},{k:'date',l:'Data',v:d.date,type:'date'},{k:'method',l:'Forma',v:d.method||'Pix',type:'select',opts:['Pix','Dinheiro','Cartão','Transferência','Outro']},
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
  else if(f.type==='avatar'){
    const avatars=getAvatars();
    const selected=f.v || avatars[0] || '';
    inner=`<div data-avatar-field="${f.k}" class="space-y-3">
      <input id="fld-${f.k}" type="hidden" value="${esc(selected)}">
      <div class="flex items-center gap-3">
        <div class="w-16 h-16 rounded-full overflow-hidden card2 shrink-0" data-avatar-preview>${avatarImg(selected,'av-img')}</div>
        <p class="muted text-sm">Escolha o avatar que vai aparecer no cadastro do membro.</p>
      </div>
      <div class="flex flex-wrap gap-2">${avatars.map(a=>`<button type="button" class="avatar-opt w-11 h-11 ${a===selected?'sel':''}" data-avatar-option="${esc(a)}">${avatarImg(a,'av-img')}</button>`).join('')}</div>
    </div>`;
  }
  else inner=`<input id="fld-${f.k}" type="${f.type||'text'}" value="${esc(f.v||'')}" class="w-full rounded-xl px-3 py-2">`;
  return `<div class="${wide}"><label for="fld-${f.k}" class="text-sm muted block mb-1">${f.l}</label>${inner}</div>`;
}
function bindAvatarFields(){
  document.querySelectorAll('[data-avatar-field]').forEach(box=>{
    const key=box.dataset.avatarField;
    const input=$('#fld-'+key);
    const preview=box.querySelector('[data-avatar-preview]');
    box.querySelectorAll('[data-avatar-option]').forEach(btn=>{
      btn.onclick=()=>{
        const value=btn.dataset.avatarOption||'';
        if(input)input.value=value;
        if(preview)preview.innerHTML=avatarImg(value,'av-img');
        box.querySelectorAll('[data-avatar-option]').forEach(b=>b.classList.toggle('sel',b===btn));
      };
    });
  });
}
function resetModalSaveButton(){
  const saveBtn=$('#modal-save');
  if(!saveBtn) return;
  saveBtn.disabled=false;
  saveBtn.removeAttribute('style');
  saveBtn.classList.add('accent-grad','text-white');
  saveBtn.innerHTML='<span data-template-id="btn-save" class="canva-text">Salvar</span>';
}
function openModal(title,fields,onsave){
  resetModalSaveButton();
  $('#modal-title').textContent=title;
  $('#modal-form').innerHTML=fields.map(fieldHtml).join('');
  bindAvatarFields();
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  $('#modal-save').onclick=()=>{const vals={};fields.forEach(f=>vals[f.k]=($('#fld-'+f.k)?.value||'').trim());if(!vals[fields[0].k]){toast('Preencha o campo obrigatório');return;}const result=onsave(vals);if(result!==false)closeModal();};
  icons();
}
function closeModal(){resetModalSaveButton();$('#modal').classList.add('hidden');$('#modal').classList.remove('flex');}
$('#modal-close').onclick=closeModal;$('#modal-cancel').onclick=closeModal;
$('#modal').onclick=e=>{if(e.target.id==='modal')closeModal();};

function openMemberModal(m){m=m||{};openModal(m.id?'Editar Membro':'Novo Membro',[
  {k:'name',l:'Nome *',v:m.name,wide:true},{k:'avatar',l:'Avatar do membro',v:m.avatar||getAvatars()[0],type:'avatar',wide:true},
  {k:'phone',l:'Telefone',v:m.phone},{k:'email',l:'E-mail',v:m.email,type:'email'},
  {k:'ministry',l:'Ministério',v:m.ministry},{k:'role',l:'Cargo',v:m.role},{k:'birthDate',l:'Data de nascimento',v:m.birthDate,type:'date'},
  {k:'notes',l:'Observações',v:m.notes,type:'textarea',wide:true}
],v=>{
  if(!v.avatar)v.avatar=getAvatars()[0]||'';
  if(m.id)Object.assign(m,stampRecord(v));
  else members.push(stampRecord({id:uid(),...v}));
  LS.set('members',members);renderMembers();toast('Membro salvo');
});}

function openEscalaModal(e){e=e||{};openModal(e.id?'Editar Escala':'Nova Escala',[
  {k:'type',l:'Tipo de escala',v:e.type||'geral',type:'select',opts:['geral','louvor','pregacao','lideranca']},
  {k:'date',l:'Data *',v:e.date,type:'date'},{k:'time',l:'Horário',v:e.time,type:'time'},
  {k:'worship',l:'Louvor / Ministro',v:e.worship||e.minister},{k:'preacher',l:'Pregador',v:e.preacher},
  {k:'openingPrayer',l:'Oração inicial',v:e.openingPrayer},{k:'tithePrayer',l:'Oração dos dízimos',v:e.tithePrayer},{k:'finalPrayer',l:'Oração final',v:e.finalPrayer},
  {k:'acousticGuitar',l:'Violão',v:e.acousticGuitar},{k:'electricGuitar',l:'Guitarra',v:e.electricGuitar||e.guitar},{k:'bass',l:'Contrabaixo',v:e.bass||e.contrabass},{k:'keyboard',l:'Teclado',v:e.keyboard},
  {k:'vocals',l:'Vocais',v:e.vocals},{k:'drums',l:'Bateria',v:e.drums||e.guitar2},{k:'cajonPercussion',l:'Cajon/Percussão',v:e.cajonPercussion},
  {k:'reception',l:'Recepção',v:e.reception},{k:'media',l:'Mídia',v:e.media},
  {k:'sound',l:'Som',v:e.sound},{k:'notes',l:'Observações',v:e.notes,type:'textarea',wide:true}
],v=>{v.minister=v.worship;if(e.id)Object.assign(e,stampRecord(v));else escalas.push(stampRecord({id:uid(),...v}));LS.set('escalas',escalas);renderEscalas();toast('Escala salva');});}

function openEventoModal(e){e=e||{};openModal(e.id?'Editar Evento':'Novo Evento',[
  {k:'name',l:'Nome *',v:e.name,wide:true},{k:'date',l:'Data',v:e.date,type:'date'},{k:'time',l:'Horário',v:e.time,type:'time'},
  {k:'location',l:'Local',v:e.location},{k:'responsible',l:'Responsável',v:e.responsible},
  {k:'description',l:'Descrição',v:e.description,type:'textarea',wide:true}
],v=>{if(e.id)Object.assign(e,stampRecord(v));else eventos.push(stampRecord({id:uid(),...v}));LS.set('eventos',eventos);renderEventos();toast('Evento salvo');});}

function openManutModal(m){m=m||{};openModal(m.id?'Editar Manutenção':'Nova Manutenção',[
  {k:'title',l:'Título *',v:m.title,wide:true},{k:'location',l:'Local',v:m.location},{k:'responsible',l:'Responsável',v:m.responsible},
  {k:'priority',l:'Prioridade',v:m.priority||'Média',type:'select',opts:['Baixa','Média','Alta']},
  {k:'status',l:'Status',v:m.status||'Pendente',type:'select',opts:['Pendente','Concluído']},
  {k:'notes',l:'Observações',v:m.notes,type:'textarea',wide:true}
],v=>{if(m.id)Object.assign(m,stampRecord(v));else manut.push(stampRecord({id:uid(),...v}));LS.set('manut',manut);renderManut();toast('Manutenção salva');});}


function openEditProfileModal(){
  resetModalSaveButton();
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
    <div class="sm:col-span-2"><label class="text-sm muted block mb-1" for="edit-birth">Data de nascimento</label><input id="edit-birth" type="date" class="w-full rounded-xl px-3 py-2" value="${esc(p.birthDate||'')}" ${adm?'disabled':''}></div>
    ${adm?'':'<div class="sm:col-span-2"><p class="text-sm font-semibold mt-2">Alterar senha</p><p class="muted text-xs">Deixe em branco se não quiser trocar.</p></div>'}
    ${(!adm && profileHasPassword(p))?'<div class="sm:col-span-2"><label class="text-sm muted block mb-1" for="edit-current-password">Senha atual</label><input id="edit-current-password" type="password" class="w-full rounded-xl px-3 py-2"></div>':''}
    ${adm?'':'<div><label class="text-sm muted block mb-1" for="edit-new-password">Nova senha</label><input id="edit-new-password" type="password" minlength="4" class="w-full rounded-xl px-3 py-2"></div><div><label class="text-sm muted block mb-1" for="edit-new-password-confirm">Confirmar nova senha</label><input id="edit-new-password-confirm" type="password" minlength="4" class="w-full rounded-xl px-3 py-2"></div>'}`;
  $('#modal').classList.remove('hidden');$('#modal').classList.add('flex');
  const up=$('#edit-avatar-upload');
  up.onchange=e=>{const f=e.target.files[0];if(!f)return;handleAvatarUpload(f,(data)=>{editAvatar=data;$('#edit-avatar-preview').innerHTML=avatarImg(editAvatar,'av-img');});};
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
      p.ministry=$('#edit-ministry').value.trim();p.role=$('#edit-role').value.trim();p.birthDate=$('#edit-birth').value;p._updatedAt=Date.now();
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
  if (v && ['home','escalas','eventos','manut','membros','devocional','avisos','oracao','financeiro','doacoes','config'].includes(v) && !$('#app').classList.contains('hidden')) {
    switchView(v);
  }
})();


/* ============================================================
   PWA — Service Worker, instalação e status online/offline
   (Bloco adicionado sem alterar nenhuma tela, cor ou lógica
   do sistema de gestão acima.)
   ============================================================ */

/* ---------- Registro do Service Worker com atualização automática ---------- */
const APP_VERSION = '20260705-mobile-avatar-profile-v27';

(function forceOneTimeCacheRefresh(){
  try{
    const key='igreja_app_version_seen';
    const seen=localStorage.getItem(key);
    if(seen!==APP_VERSION){
      localStorage.setItem(key,APP_VERSION);
      if('caches' in window){
        caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('betesda-fontes-')).map(k=>caches.delete(k)))).catch(()=>{});
      }
      if('serviceWorker' in navigator){
        navigator.serviceWorker.getRegistrations?.().then(regs=>regs.forEach(reg=>reg.update())).catch(()=>{});
      }
    }
  }catch(e){console.warn('Não foi possível limpar cache da versão:', e);}
})();


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
  toast('No Android: menu ⋮ do navegador → Instalar app ou Adicionar à tela inicial');
}

function shouldShowInstallHelper(){
  return installBtn && !isStandalone();
}

// Mostra o botão de instalação também no Android/Chrome.
// O evento beforeinstallprompt pode demorar ou não aparecer em alguns aparelhos;
// quando não houver prompt automático, o botão mostra instruções manuais.
document.addEventListener('DOMContentLoaded', () => {
  if (shouldShowInstallHelper()) {
    setTimeout(() => {
      if (shouldShowInstallHelper()) installBtn.classList.remove('hidden');
    }, 900);
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
