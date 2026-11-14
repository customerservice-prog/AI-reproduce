const $ = id => document.getElementById(id);
const modes = {
  video: {
    title:'Video Reimagine', description:'Transform video you own into a new visual style while preserving the action and camera movement.',
    file:true, fileLabel:'Upload your source video', accept:'video/mp4,video/quicktime,video/webm,video/x-matroska',
    fileHelp:'MP4, MOV, WebM or MKV · 2–30 seconds · max 200MB', placeholder:'Example: Turn the daytime street into a neon-lit nighttime scene. Preserve camera motion, timing and the original people.',
    hint:'Describe what should change, and what must stay the same.', style:true, provider:'runway',
    cost:'Runway Aleph uses paid credits per second. Start with a short 2–5 second test.',
    ideas:['Turn a daytime scene into a cinematic rainy night without changing camera movement.',
      'Make the environment look like a futuristic city while preserving the subject and action.',
      'Give the footage beautiful film lighting and a warm professional color grade.']
  },
  imageEdit: {
    title:'Photo Transform', description:'Upload your own picture and change the background, lighting, outfits, objects, or atmosphere.',
    file:true,fileLabel:'Upload a photo',accept:'image/png,image/jpeg,image/webp',fileHelp:'JPG, PNG or WebP · max 9MB',
    placeholder:'Example: Keep the person and pose, replace the background with a luxury recording studio, cinematic lighting and authentic detail.',
    hint:'Specify what to preserve. An edited image may not look exactly the same.',provider:'replicate',cost:'Image editing uses paid Replicate credits.',
    ideas:['Keep the same face and pose. Replace the background with a luxury recording studio.',
      'Turn this picture into an illustrated comic-book cover with cinematic lighting.',
      'Make this product photo look like a high-end professional advertisement.']
  },
  image: {
    title:'Image Generator',description:'Create brand-new visuals from words: covers, posters, thumbnails, logos, scenes, products and fantasy art.',
    file:false,ratio:true,placeholder:'Example: Ultra-realistic editorial cover of a glowing futuristic city at night, rain reflections, dramatic violet and cyan lighting, no text.',
    hint:'For best results describe the subject, composition, style, lighting, and aspect ratio.',provider:'replicate',cost:'Image generation uses paid Replicate credits.',
    ideas:['Make a professional 16:9 entertainment news thumbnail with a dramatic studio scene.',
      'Design a photorealistic black-and-purple futuristic music studio with holographic screens.',
      'Create a cinematic tropical city rooftop scene at sunset, realistic and vibrant.']
  },
  music: {
    title:'Original Music',description:'Generate a completely new instrumental or song from a musical description, with no copied recordings or melodies.',
    file:false,music:true,placeholder:'Example: Original Dominican dembow instrumental, 115 BPM, heavy kick and punchy percussion, modern synth bass, exciting club energy, memorable rhythmic breaks.',
    hint:'Describe genre, BPM, instruments, energy, structure, and whether you want vocals.',provider:'replicate',cost:'Music uses paid Replicate credits based on generated song length. Test at 15 seconds.',
    ideas:['Original Dominican dembow instrumental at 115 BPM with sharp percussion and powerful bass.',
      'Cinematic trailer music with pounding drums, brass stabs and a dramatic climax.',
      'A catchy original reggaeton instrumental with tropical rhythms and bright synths.']
  },
  voice: {
    title:'AI Voice Narration',description:'Turn your original words into spoken audio using built-in synthetic voices. No celebrity voice cloning.',
    file:false,voice:true,placeholder:'Example: Bienvenidos a Bajo Mundo TV. Lo último del entretenimiento urbano está aquí.',
    hint:'Type the actual words to narrate. The result is a downloadable AI voice MP3.',provider:'openai',
    cost:'Voice generation is billed by OpenAI. The current speech model is deprecated and will need migration by January 2027.',
    ideas:['Bienvenidos a Bajo Mundo TV, tu destino para las noticias del movimiento urbano.',
      'Tonight, we take you behind the scenes and show how a hit video comes to life.',
      'Welcome to the future of creativity. Built from an idea, powered by imagination.']
  },
  writing: {
    title:'Ideas & Scripts',description:'Turn one thought into video scripts, ideas, social captions, translations, and creative copy.',
    file:false,writing:true,placeholder:'Example: Give me 10 fresh, original viral show ideas for a Dominican urban entertainment channel, with hooks and a 30-second opening script.',
    hint:'Describe your audience, tone, language, and output. Your result downloads as TXT.',provider:'openai',
    cost:'Text generation is billed according to OpenAI API usage.',
    ideas:['Write a high-energy 60-second Spanish script introducing a new urban entertainment show.',
      'Brainstorm 15 unique entertainment content ideas that can be filmed on a budget.',
      'Create five Spanish social media captions to announce a brand-new entertainment series.']
  }
};
let mode = 'video';
let settings = { providers:{} };
let timer = null;
let pending = false;
async function api(path, opts={}) {
  const response = await fetch(path,{ credentials:'same-origin',...opts });
  const type = response.headers.get('content-type') || '';
  const result = type.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) throw new Error(result?.error || 'Request failed ('+response.status+')');
  return result;
}
function showStudio(auth) {
  $('studio').classList.toggle('hidden',!auth);
  $('loginView').classList.toggle('hidden',auth);
  if (auth) { fetchConfig(); loadJobs(); }
}
async function fetchConfig() {
  try {
    settings = await api('/api/config');
    for(const p of ['runway','replicate','openai']){
      const label = $(p+'Status');
      label.textContent = settings.providers[p] ? '● Connected' : '○ Not configured';
      label.classList.toggle('connected',Boolean(settings.providers[p]));
    }
  } catch(err) { $('formError').textContent=err.message; }
}
function selectMode(next) {
  mode = next;
  const config=modes[mode];
  $('currentMode').textContent=config.title;
  $('toolTitle').textContent=config.title;
  $('toolDescription').textContent=config.description;
  $('fileWrap').classList.toggle('hidden',!config.file);
  $('styleWrap').classList.toggle('hidden',!config.style);
  $('ratioWrap').classList.toggle('hidden',!config.ratio);
  $('musicWrap').classList.toggle('hidden',!config.music);
  $('voiceWrap').classList.toggle('hidden',!config.voice);
  $('writingWrap').classList.toggle('hidden',!config.writing);
  $('fileLabel').textContent=config.fileLabel || 'Source file';
  $('fileHelp').textContent=config.fileHelp || '';
  $('sourceFile').accept=config.accept || '';
  $('sourceFile').value='';
  $('fileChosen').textContent='';
  $('prompt').value='';
  $('prompt').placeholder=config.placeholder;
  $('promptHint').textContent=config.hint;
  $('costNote').textContent=config.cost;
  $('formError').textContent='';
  $('rights').checked=false;
  $('generate').disabled=false;
  $('generate').textContent='✦ Generate with AI →';
  document.querySelectorAll('.nav-link').forEach(btn=>btn.classList.toggle('active',btn.dataset.mode===mode));
  $('ideas').replaceChildren();
  config.ideas.forEach(s=>{
    const b=document.createElement('button');b.type='button';b.className='idea';
    const symbol=document.createElement('span');symbol.textContent='✧';
    const text=document.createElement('span');text.textContent=s;b.append(symbol,text);
    b.addEventListener('click',()=>{$('prompt').value=s;$('prompt').focus();});
    $('ideas').append(b);
  });
}
function handleChosen() {
  const file=$('sourceFile').files[0];
  $('fileChosen').textContent = file ? '✓ ' + file.name + ' (' + (file.size/1024/1024).toFixed(1) + ' MB)' : '';
}
async function generate(event) {
  event.preventDefault();
  if(pending)return;
  const config=modes[mode];
  const file=$('sourceFile').files[0];
  if(config.file && !file){$('formError').textContent='Upload a source file first.';return;}
  if(!$('rights').checked){$('formError').textContent='Confirm you have permission to use the content.';return;}
  if(!settings.providers[config.provider]){
    $('formError').textContent='This tool needs a '+config.provider+' API key configured in Railway.';
    return;
  }
  const form=new FormData();
  form.append('kind',mode);
  form.append('prompt',$('prompt').value.trim());
  form.append('rightsConfirmed','true');
  if(config.file)form.append('file',file);
  form.append('style',$('style').value);
  form.append('aspectRatio',$('aspectRatio').value);
  form.append('seconds',$('seconds').value);
  form.append('instrumental',$('instrumental').checked ? 'true':'false');
  form.append('voice',$('voice').value);
  form.append('writingMode',$('writingMode').value);
  $('formError').textContent='';
  pending=true;
  $('generate').disabled=true;
  $('generate').textContent='✦ Creating...';
  try {
    await api('/api/generate',{method:'POST',body:form});
    $('prompt').value='';
    $('sourceFile').value='';
    $('fileChosen').textContent='';
    await loadJobs();
    document.querySelector('.gallery').scrollIntoView({behavior:'smooth',block:'start'});
  }catch(err){$('formError').textContent=err.message;}
  finally{pending=false;$('generate').disabled=false;$('generate').textContent='✦ Generate with AI →';}
}
function mediaPreview(job) {
  const div=document.createElement('div');div.className='job-media';
  if(job.status!=='done' || !job.ready){div.textContent=job.status==='failed'?'!':'✦';return div;}
  const src='/api/preview/'+encodeURIComponent(job.id);
  if(['image','imageEdit'].includes(job.kind)){
    const img=document.createElement('img');img.src=src;img.alt='Generated creation';img.loading='lazy';div.append(img);
  }else if(job.kind==='video'){
    const video=document.createElement('video');video.src=src;video.controls=true;video.preload='metadata';div.append(video);
  }else if(['music','voice'].includes(job.kind)){
    const audio=document.createElement('audio');audio.src=src;audio.controls=true;audio.preload='none';div.append(audio);
  }else{
    div.textContent='TXT';
    div.style.fontSize='24px';
  }
  return div;
}
function renderJob(job) {
  const card=document.createElement('article');card.className='job';
  card.append(mediaPreview(job));
  const name=document.createElement('div');name.className='job-name';name.textContent=job.title;card.append(name);
  const meta=document.createElement('div');meta.className='job-meta';meta.textContent=job.kind+' · '+new Date(job.createdAt).toLocaleString();card.append(meta);
  const state=document.createElement('div');state.className='status '+job.status;
  state.textContent=job.status==='processing'?'◌ Processing'+(job.providerStatus ? ' · '+job.providerStatus:''):
    job.status==='done'?'● Ready to download':'✕ Failed';
  card.append(state);
  if(job.error){const error=document.createElement('p');error.className='error';error.textContent=job.error;card.append(error);}
  const actions=document.createElement('div');actions.className='job-actions';
  if(job.ready){
    const download=document.createElement('a');download.href='/api/download/'+encodeURIComponent(job.id);download.textContent='↓ Download';actions.append(download);
    if(job.kind==='writing'){const preview=document.createElement('a');preview.href='/api/preview/'+encodeURIComponent(job.id);preview.target='_blank';preview.rel='noopener';preview.textContent='Read';actions.append(preview);}
  }
  if(job.status!=='processing'){
    const clear=document.createElement('button');clear.type='button';clear.textContent='Remove';
    clear.addEventListener('click',async()=>{
      if(!confirm('Remove this result and delete its saved output from the studio?'))return;
      try{await api('/api/jobs/'+encodeURIComponent(job.id),{method:'DELETE'});await loadJobs();}
      catch(err){alert(err.message);}
    });actions.append(clear);
  }
  card.append(actions);
  return card;
}
async function loadJobs(){
  try{
    const list=await api('/api/jobs');
    const box=$('jobs');box.replaceChildren();
    if(!list.length){const empty=document.createElement('div');empty.className='empty-state';empty.textContent='Nothing created yet. Your first AI experiment begins above.';box.append(empty);}
    else{list.forEach(j=>box.append(renderJob(j)));}
    for(const job of list.filter(j=>j.status==='processing').slice(0,8)){
      api('/api/jobs/'+encodeURIComponent(job.id)).then(updated=>{
        if(updated.status!=='processing')loadJobs();
        else{
          const state=Array.from(document.querySelectorAll('.job')).find(el=>el.querySelector('.job-name')?.textContent===job.title);
          if(state){const badge=state.querySelector('.status');if(badge)badge.textContent='◌ Processing · '+updated.providerStatus;}
        }
      }).catch(()=>{});
    }
  }catch(err){
    if(err.message==='Please sign in'){clearInterval(timer);showStudio(false);}
  }
}
$('loginForm').addEventListener('submit',async e=>{
  e.preventDefault();
  $('loginError').textContent='';
  try{await api('/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:$('password').value})});$('password').value='';showStudio(true);}
  catch(err){$('loginError').textContent=err.message;}
});
$('logout').addEventListener('click',async()=>{try{await api('/api/logout',{method:'POST'});}catch{}clearInterval(timer);showStudio(false);});
$('nav').addEventListener('click',e=>{const button=e.target.closest('[data-mode]');if(button)selectMode(button.dataset.mode);});
$('createForm').addEventListener('submit',generate);
$('sourceFile').addEventListener('change',handleChosen);
$('refresh').addEventListener('click',loadJobs);
const drop=$('dropzone');
drop.addEventListener('dragover',e=>{e.preventDefault();drop.classList.add('dragover');});
drop.addEventListener('dragleave',()=>drop.classList.remove('dragover'));
drop.addEventListener('drop',e=>{
  e.preventDefault();drop.classList.remove('dragover');
  if(e.dataTransfer.files.length){$('sourceFile').files=e.dataTransfer.files;handleChosen();}
});
selectMode('video');
api('/api/me').then(result=>{showStudio(result.authenticated);if(result.authenticated)timer=setInterval(loadJobs,6500);})
  .catch(()=>showStudio(false));
$('loginForm').addEventListener('submit',()=>{if(!timer)timer=setInterval(loadJobs,6500);});