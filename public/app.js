const $=id=>document.getElementById(id);
const types={
  auto:{title:'Auto Magic',description:'Upload any supported video, photo, or audio file. The studio detects its type and improves it automatically.',file:true,accept:'video/*,image/*,audio/*',fileLabel:'Upload a video, photo, or audio file',help:'MP4, MOV, WebM, MKV, JPG, PNG, WebP, MP3, M4A, WAV, OGG or FLAC · up to 200MB',button:'⚡ Improve automatically →',action:'Automatic media detection and enhancement'},
  video:{title:'Video Enhance',description:'Automatic color, sharpness, resolution and export improvements for your footage.',file:true,accept:'video/mp4,video/quicktime,video/webm,video/x-matroska',fileLabel:'Upload a video',help:'2–600 seconds · max 200MB · automatic MP4 output',button:'◈ Enhance video →',action:'Balanced color correction and clear video MP4'},
  imageEdit:{title:'Photo Enhance',description:'Improve your photo’s contrast, colors, and sharpness without changing who or what is in it.',file:true,accept:'image/png,image/jpeg,image/webp',fileLabel:'Upload a picture',help:'JPG, PNG or WebP · up to 200MB',button:'✧ Improve photo →',action:'Clean colors and sharp image PNG'},
  audio:{title:'Audio Cleanup',description:'Improve intelligibility and loudness automatically. Great for voice recordings and clips.',file:true,accept:'audio/*',fileLabel:'Upload audio',help:'MP3, WAV, M4A, OGG or FLAC · up to 10 minutes',button:'◉ Clean audio →',action:'Balanced audio with equalization and compression'},
  music:{title:'Original Beat Maker',description:'One click generates an original rhythmic instrumental with a simple built-in synthesizer.',file:false,button:'♫ Make a beat →',action:'An original short procedural instrumental, MP3'},
  image:{title:'Original Poster Maker',description:'Create a new Bajo Mundo-style graphic poster on your own server.',file:false,text:true,button:'▧ Make a poster →',hint:'Optional: enter a short headline, or leave blank for BAJO MUNDO TV.',action:'New original 1280×720 SVG graphic'},
  voice:{title:'Spanish Voice Creator',description:'Create a synthetic Spanish voice announcement with a local speech engine.',file:false,text:true,button:'● Create voice →',hint:'Optional: type the words to narrate. Leave blank for a default Bajo Mundo introduction.',action:'An automatically narrated Spanish MP3'},
  writing:{title:'Show & Script Templates',description:'Get a ready-made outline for an original entertainment video.',file:false,text:true,button:'✎ Make an outline →',hint:'Optional: enter a topic. Leave blank for a general show outline.',action:'A reusable structured show template in TXT'}
};
let mode='auto',busy=false,timer=null;
async function api(url,opts={}){
  const r=await fetch(url,{credentials:'same-origin',...opts});
  const c=r.headers.get('content-type')||'';
  const value=c.includes('application/json')?await r.json():await r.text();
  if(!r.ok)throw new Error(value?.error||'Request failed: '+r.status);
  return value;
}
function loggedIn(value){
  $('studio').classList.toggle('hidden',!value);
  $('loginView').classList.toggle('hidden',value);
  if(value){
    loadJobs();
    if(!timer)timer=setInterval(loadJobs,8000);
  } else {
    if(timer)clearInterval(timer);
    timer=null;
  }
}
function chooseMode(next){
  mode=next;const c=types[next];
  $('currentMode').textContent=c.title;
  $('toolTitle').textContent=c.title;
  $('toolDescription').textContent=c.description;
  $('fileWrap').classList.toggle('hidden',!c.file);
  $('promptWrap').classList.toggle('hidden',!c.text);
  $('rightsWrap').classList.toggle('hidden',!c.file);
  $('fileLabel').textContent=c.fileLabel||'Your file';
  $('fileHelp').textContent=c.help||'';
  $('sourceFile').accept=c.accept||'';
  $('sourceFile').required=Boolean(c.file);
  $('sourceFile').value='';
  $('fileChosen').textContent='';
  $('prompt').value='';
  $('prompt').required=false;
  $('promptHint').textContent=c.hint||'';
  $('rights').checked=false;
  $('generate').textContent=c.button;
  $('formError').textContent='';
  $('inspirationTitle').textContent=c.title;
  $('inspirationSubtitle').textContent='One-click result: '+c.action+'. No instructions required.';
  $('ideas').replaceChildren();
  const actions=['Video Enhance','Photo Enhance','Audio Cleanup','Original Beat Maker','Original Poster Maker','Spanish Voice Creator'];
  const keys=['video','imageEdit','audio','music','image','voice'];
  actions.forEach((label,i)=>{
    if(keys[i]===next)return;
    const b=document.createElement('button');
    b.type='button';b.className='idea';b.textContent='✦ '+label;
    b.addEventListener('click',()=>chooseMode(keys[i]));
    $('ideas').append(b);
  });
  document.querySelectorAll('#nav [data-mode]').forEach(b=>b.classList.toggle('active',b.dataset.mode===next));
}
function filePicked(){
  const file=$('sourceFile').files?.[0];
  if(!file){$('fileChosen').textContent='';return;}
  const s=(file.size/1024/1024).toFixed(1)+' MB';
  let kind=file.type.startsWith('video/')?'video':file.type.startsWith('image/')?'photo':file.type.startsWith('audio/')?'audio':'file';
  $('fileChosen').textContent='✓ '+file.name+' ('+s+') · Detected: '+kind;
}
async function create(e){
  e.preventDefault();if(busy)return;
  const config=types[mode],file=$('sourceFile').files?.[0];
  $('formError').textContent='';
  if(config.file&&!file){$('formError').textContent='Choose a file to process.';return;}
  if(config.file&&!$('rights').checked){$('formError').textContent='Confirm you have the right to edit this uploaded file.';return;}
  busy=true;$('generate').disabled=true;$('generate').textContent='⚙ Starting...';
  try{
    const body=new FormData();
    body.append('kind',mode);
    body.append('rightsConfirmed',$('rights').checked?'true':'false');
    if(file)body.append('file',file);
    if(config.text)body.append('prompt',$('prompt').value);
    await api('/api/auto',{method:'POST',body});
    $('sourceFile').value='';$('fileChosen').textContent='';$('prompt').value='';
    await loadJobs();
    document.querySelector('.gallery').scrollIntoView({behavior:'smooth'});
  }catch(err){$('formError').textContent=err.message;}
  finally{busy=false;$('generate').disabled=false;$('generate').textContent=config.button;}
}
function media(job){
  const box=document.createElement('div');box.className='job-media';
  if(!job.ready){box.textContent=job.status==='failed'?'!':'✦';return box;}
  const url='/api/preview/'+encodeURIComponent(job.id);
  if(['image','imageEdit'].includes(job.kind)){
    const el=document.createElement('img');el.src=url;el.alt='Processed image';el.loading='lazy';box.append(el);
  }else if(job.kind==='video'){
    const el=document.createElement('video');el.src=url;el.controls=true;el.preload='metadata';box.append(el);
  }else if(['audio','music','voice'].includes(job.kind)){
    const el=document.createElement('audio');el.src=url;el.controls=true;el.preload='none';box.append(el);
  }else{box.textContent='TXT';box.style.fontSize='26px';}
  return box;
}
function card(job){
  const box=document.createElement('article');box.className='job';box.append(media(job));
  const title=document.createElement('div');title.className='job-name';title.textContent=job.title;box.append(title);
  const small=document.createElement('div');small.className='job-meta';
  small.textContent=job.kind+' · '+new Date(job.createdAt).toLocaleString();box.append(small);
  const status=document.createElement('div');status.className='status '+job.status;
  status.textContent=job.status==='done'?'● Ready':job.status==='processing'?'◌ '+(job.providerStatus||'Processing'):'✕ Failed';
  box.append(status);
  if(job.error){const warning=document.createElement('p');warning.className='error';warning.textContent=job.error;box.append(warning);}
  const buttons=document.createElement('div');buttons.className='job-actions';
  if(job.ready){
    const a=document.createElement('a');a.href='/api/download/'+encodeURIComponent(job.id);a.textContent='↓ Download';buttons.append(a);
    if(job.kind==='writing'){const p=document.createElement('a');p.href='/api/preview/'+encodeURIComponent(job.id);p.target='_blank';p.rel='noopener';p.textContent='Read';buttons.append(p);}
  }
  if(job.status!=='processing'){
    const remove=document.createElement('button');remove.type='button';remove.textContent='Delete';
    remove.addEventListener('click',async()=>{
      if(!confirm('Delete this creation?'))return;
      try{await api('/api/jobs/'+encodeURIComponent(job.id),{method:'DELETE'});await loadJobs();}
      catch(err){alert(err.message);}
    });buttons.append(remove);
  }
  box.append(buttons);return box;
}
async function loadJobs(){
  try{
    const jobs=await api('/api/jobs');
    const container=$('jobs');container.replaceChildren();
    if(!jobs.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='No creations yet. Select a file above or choose a built-in creator.';container.append(empty);}
    else jobs.forEach(job=>container.append(card(job)));
    const pending=jobs.filter(job=>job.status==='processing');
    if(pending.length){
      const updates=await Promise.allSettled(pending.slice(0,6).map(job=>api('/api/jobs/'+encodeURIComponent(job.id))));
      if(updates.some((result,i)=>result.status==='fulfilled'&&result.value.status!==pending[i].status)){
        const latest=await api('/api/jobs');container.replaceChildren();latest.forEach(job=>container.append(card(job)));
      }
    }
  }catch(err){if(err.message==='Please sign in')loggedIn(false);}
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();$('loginError').textContent='';
  try{
    await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});
    $('password').value='';loggedIn(true);
  }catch(err){$('loginError').textContent=err.message;}
});
$('logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});}catch{}loggedIn(false);});
$('nav').addEventListener('click',e=>{const b=e.target.closest('button[data-mode]');if(b)chooseMode(b.dataset.mode);});
$('sourceFile').addEventListener('change',filePicked);
$('refresh').addEventListener('click',loadJobs);
$('createForm').addEventListener('submit',create);
const drop=$('dropzone');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('dragover');
  if(e.dataTransfer.files.length){$('sourceFile').files=e.dataTransfer.files;filePicked();}
});
chooseMode('auto');
api('/api/me').then(v=>loggedIn(Boolean(v.authenticated))).catch(()=>loggedIn(false));
