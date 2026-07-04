const LS={get:(k,d)=>{try{return JSON.parse(localStorage.getItem('igreja_'+k))??d}catch(e){return d}},set:(k,v)=>localStorage.setItem('igreja_'+k,JSON.stringify(v))};
const NOW=new Date();
const uid=()=>Date.now().toString(36)+Math.random().toString(36).slice(2,7);
const $=s=>document.querySelector(s);
const esc=s=>(s||'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));

// Titles for the top bar per view (labels sourced from the sidebar config-driven nav)
const VIEW_TITLES={home:'nav-home',escalas:'nav-escalas',eventos:'nav-eventos',manut:'nav-manut',membros:'nav-membros',config:'nav-config'};

const getAvatars = () => Array.from({length:9}, (_,i)=>document.querySelector(`[data-template-id="avatar-${i+1}"]`)?.src || '').filter(Boolean);
let pfAvatar='';

let profiles=LS.get('profiles',[]),activeProfile=LS.get('active_profile',null);
let members=LS.get('members',[]),escalas=LS.get('escalas',[]),eventos=LS.get('eventos',[]),manut=LS.get('manut',[]);
let settings=LS.get('settings',{churchName:'Igreja Betesda Fontes',theme:'dark'});
let sidebarCollapsed=LS.get('sidebar_collapsed',false);

function toast(m){const t=$('#toast');t.textContent=m;t.classList.remove('hidden');clearTimeout(t._t);t._t=setTimeout(()=>t.classList.add('hidden'),2200);}
function icons(){lucide.createIcons();}
function avatarImg(url,cls){
  const fallback = getAvatars()[0] || '';
  return `<img src="${url || fallback}" alt="Avatar" class="${cls}">`;
}

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
$('#mobile-menu').onclick=()=>{const a=document.querySelector('.app-sidebar');a.classList.toggle('hidden');a.classList.toggle('flex');a.classList.toggle('fixed');a.classList.toggle('z-40');a.classList.toggle('inset-y-0');a.classList.toggle('left-0');};

/* PROFILES */
function renderProfiles(){
  const w=$('#profile-list');w.innerHTML='';
  profiles.forEach(p=>{
    const b=document.createElement('button');
    b.className='card2 rounded-2xl p-4 flex items-center gap-3 text-left hover:opacity-90 text-current';
    b.innerHTML=`<div class="w-12 h-12 rounded-full overflow-hidden shrink-0 card2">${avatarImg(p.avatar,'av-img')}</div>
      <div class="min-w-0"><p class="font-medium truncate">${esc(p.name)}</p><p class="text-xs muted truncate">${esc(p.role||'')} · ${esc(p.ministry||'')}</p></div>`;
    b.onclick=()=>{activeProfile=p.id;LS.set('active_profile',p.id);openApp();};
    w.appendChild(b);
  });
  if(!profiles.length)w.innerHTML='<p class="muted text-sm col-span-2">Nenhum perfil ainda. Crie o primeiro.</p>';
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
$('#profile-form').onsubmit=e=>{e.preventDefault();const p={id:uid(),name:$('#pf-name').value.trim(),ministry:$('#pf-min').value.trim(),role:$('#pf-role').value.trim(),avatar:pfAvatar || getAvatars()[0]};profiles.push(p);LS.set('profiles',profiles);activeProfile=p.id;LS.set('active_profile',p.id);$('#profile-form').classList.add('hidden');$('#profile-list-wrap').classList.remove('hidden');openApp();};
$('#switch-profile').onclick=()=>{activeProfile=null;LS.set('active_profile',null);$('#app').classList.add('hidden');$('#profile-screen').classList.remove('hidden');renderProfiles();icons();};

/* APP */
function openApp(){
  $('#profile-screen').classList.add('hidden');$('#app').classList.remove('hidden');
  applySidebarState();
  const p=profiles.find(x=>x.id===activeProfile);
  if(p){
    $('#side-pname').textContent=p.name;$('#side-prole').textContent=(p.role||'')+(p.ministry?' · '+p.ministry:'');
    $('#side-avatar').innerHTML=avatarImg(p.avatar,'av-img');
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
  ['home','escalas','eventos','manut','membros','config'].forEach(x=>$('#view-'+x).classList.toggle('hidden',x!==v));
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===v));
  updateTopTitle(v);
  if(v==='home')renderHome();if(v==='membros')renderMembers();if(v==='escalas')renderEscalas();if(v==='eventos')renderEventos();if(v==='manut')renderManut();
  icons();
}
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>switchView(b.dataset.view));
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
let resetArmed=false;
$('#reset-data').onclick=e=>{if(!resetArmed){resetArmed=true;e.currentTarget.querySelector('span').textContent='Clique novamente para apagar tudo';setTimeout(()=>{resetArmed=false;e.currentTarget.querySelector('span').textContent='Apagar todos os dados';},3000);return;}['profiles','active_profile','members','escalas','eventos','manut','settings','sidebar_collapsed'].forEach(k=>localStorage.removeItem('igreja_'+k));location.reload();};

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
  $('#modal-save').onclick=()=>{const vals={};fields.forEach(f=>vals[f.k]=$('#fld-'+f.k).value.trim());if(!vals[fields[0].k]){toast('Preencha o campo obrigatório');return;}onsave(vals);closeModal();};
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

/* BOOT */
renderProfiles();
if(activeProfile&&profiles.find(p=>p.id===activeProfile)) {
  openApp();
} else {
  $('#profile-screen').classList.remove('hidden');
  updateThemeButtons();
}
icons();

// Atalhos do PWA (manifest "shortcuts"): ?view=escalas abre direto na tela certa, se já houver perfil ativo.
(function applyShortcutView(){
  const params = new URLSearchParams(location.search);
  const v = params.get('view');
  if (v && ['home','escalas','eventos','manut','membros','config'].includes(v) && !$('#app').classList.contains('hidden')) {
    switchView(v);
  }
})();


/* ============================================================
   PWA — Service Worker, instalação e status online/offline
   (Bloco adicionado sem alterar nenhuma tela, cor ou lógica
   do sistema de gestão acima.)
   ============================================================ */

/* ---------- Registro do Service Worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./service-worker.js')
      .then((reg) => {
        // Verifica atualização automaticamente de tempos em tempos
        setInterval(() => reg.update(), 60 * 60 * 1000); // a cada 1h

        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          if (!newWorker) return;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              // Já existia um SW controlando a página antes: há uma versão nova pronta.
              showUpdateToast(reg);
            }
          });
        });
      })
      .catch((err) => {
        console.warn('Falha ao registrar o Service Worker:', err);
      });

    // Quando o novo SW assume o controle, recarrega para usar a versão mais nova.
    let refreshing = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (refreshing) return;
      refreshing = true;
      window.location.reload();
    });
  });
}

function showUpdateToast(reg){
  const t = document.getElementById('toast');
  if (!t) return;
  t.innerHTML = 'Nova versão disponível. <button id="pwa-update-btn" style="text-decoration:underline;font-weight:600;margin-left:6px;background:none;border:none;color:inherit;cursor:pointer">Atualizar</button>';
  t.classList.remove('hidden');
  const btn = document.getElementById('pwa-update-btn');
  if (btn) {
    btn.onclick = () => {
      if (reg.waiting) reg.waiting.postMessage('SKIP_WAITING');
    };
  }
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
