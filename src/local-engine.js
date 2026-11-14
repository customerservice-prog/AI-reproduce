import express from 'express';
import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import { promises as fs } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const allowed = new Set(['auto','video','imageEdit','audio','music','image','voice','writing']);
const exts = {
  video:new Set(['.mp4','.mov','.webm','.mkv']),
  imageEdit:new Set(['.jpg','.jpeg','.png','.webp']),
  audio:new Set(['.mp3','.m4a','.wav','.ogg','.flac'])
};
const MAX_INPUT_BYTES = 200 * 1024 * 1024;

export function detectMedia(filename) {
  const ext = path.extname(String(filename)).toLowerCase();
  return Object.entries(exts).find(([,set])=>set.has(ext))?.[0] || null;
}
function safeText(raw,limit=250) {
  return String(raw||'').normalize('NFKC').replace(/[\x00-\x1F\x7F]/g,' ').trim().slice(0,limit);
}
function xmlEscape(s) {return s.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&apos;');}
function ffArgs(output,input,filters,flags=[]) {
  return ['-hide_banner','-loglevel','error','-nostdin','-y','-i',input,...filters,...flags,output];
}
async function execute(binary,args,limit=600000) {
  try { await exec(binary,args,{timeout:limit,maxBuffer:1024*1024}); }
  catch(e) { throw new Error((e.killed ? 'Processing exceeded the server time limit. ' : '') + (e.stderr || e.message || 'Media processing failed').slice(0,350)); }
}
async function inspect(input,expected) {
  const {stdout}=await exec('ffprobe',['-v','error','-show_entries','format=duration:stream=codec_type,width,height','-of','json',input],{timeout:25000,maxBuffer:1500000});
  const info=JSON.parse(stdout);
  const streams=info.streams || [];
  const which=expected==='audio'?'audio':'video';
  if(!streams.some(s=>s.codec_type===which))throw new Error('Uploaded file does not contain a supported '+which+' stream');
  const duration=Number(info.format?.duration);
  if(['video','audio'].includes(expected) && (!Number.isFinite(duration) || duration<=0 || duration>600))throw new Error('For this server, choose a file up to 10 minutes long');
  if(expected==='imageEdit' && (!streams.some(s=>s.width>0&&s.height>0)))throw new Error('Could not read the image');
  return {seconds:duration};
}
async function video(input,output) {
  await inspect(input,'video');
  await execute('ffmpeg',ffArgs(output,input,[
    '-map','0:v:0','-map','0:a?',
    '-vf','scale=1280:1280:force_original_aspect_ratio=decrease:force_divisible_by=2,eq=contrast=1.055:brightness=0.012:saturation=1.12,unsharp=5:5:0.55:5:5:0,format=yuv420p',
    '-c:v','libx264','-preset','ultrafast','-crf','23','-c:a','aac','-b:a','128k',
    '-movflags','+faststart','-threads','2'
  ]),600000);
  return 'mp4';
}
async function photo(input,output) {
  await inspect(input,'imageEdit');
  await execute('ffmpeg',ffArgs(output,input,[
    '-frames:v','1','-vf','scale=1600:1600:force_original_aspect_ratio=decrease,eq=contrast=1.07:brightness=0.012:saturation=1.13,unsharp=5:5:0.9:5:5:0'
  ]),120000);
  return 'png';
}
async function audio(input,output) {
  await inspect(input,'audio');
  await execute('ffmpeg',ffArgs(output,input,[
    '-vn','-af','highpass=f=55,lowpass=f=16000,acompressor=threshold=-18dB:ratio=2:attack=15:release=250,loudnorm=I=-16:TP=-1.5:LRA=11',
    '-c:a','libmp3lame','-q:a','4'
  ]),600000);
  return 'mp3';
}
function wave(duration=18) {
  const rate=22050,n=rate*duration,buf=Buffer.allocUnsafe(44+n*2);
  buf.write('RIFF',0);buf.writeUInt32LE(36+n*2,4);buf.write('WAVEfmt ',8);
  buf.writeUInt32LE(16,16);buf.writeUInt16LE(1,20);buf.writeUInt16LE(1,22);
  buf.writeUInt32LE(rate,24);buf.writeUInt32LE(rate*2,28);
  buf.writeUInt16LE(2,32);buf.writeUInt16LE(16,34);buf.write('data',36);buf.writeUInt32LE(n*2,40);
  const beat=60/112,tao=Math.PI*2,notes=[55,65.41,73.42,65.41];
  for(let i=0;i<n;i++){
    const t=i/rate,b=t/beat,step=Math.floor(b*2);
    const kickT=(b%2)*beat;
    const kick=Math.exp(-kickT*20)*Math.sin(tao*(70*kickT-32*kickT*kickT));
    const snT=(b+3)%4*beat;
    const sn=(Math.floor(b)%4===1 || Math.floor(b)%4===3) ? Math.exp(-((b%1)*beat)*32)*Math.sin(i*2.33)*0.45 : 0;
    const hatT=(b*2%1)*beat/2;
    const hat=(Math.sin(i*1.849)*Math.sin(i*.639))*Math.exp(-hatT*60)*0.08;
    const f=notes[Math.floor(b/4)%notes.length];
    const bass=(Math.sin(tao*f*t)+.2*Math.sin(tao*2*f*t))*0.2*(.5+.5*Math.exp(-((b%1)*beat)*7));
    const fade=Math.min(1,t/.3,(duration-t)/.6);
    const x=Math.max(-.95,Math.min(.95,(kick*.58+sn*.37+hat+bass)*Math.max(0,fade)));
    buf.writeInt16LE(Math.round(x*32767),44+i*2);
  }
  return buf;
}
async function beat(output,workdir,id) {
  const temp=path.join(workdir,id+'.wav');
  try {
    await fs.writeFile(temp,wave(),{mode:0o600});
    await execute('ffmpeg',ffArgs(output,temp,['-c:a','libmp3lame','-q:a','4']),120000);
    return 'mp3';
  }finally{await fs.unlink(temp).catch(()=>{});}
}
async function voice(output,workdir,id,text) {
  const temp=path.join(workdir,id+'.wav');
  const script=safeText(text,450)||'Bienvenidos a Bajo Mundo TV. Esta es una nueva forma de crear.';
  try {
    await execute('espeak-ng',['-v','es','-s','145','-w',temp,script],120000);
    await execute('ffmpeg',ffArgs(output,temp,['-c:a','libmp3lame','-q:a','4']),120000);
    return 'mp3';
  }finally{await fs.unlink(temp).catch(()=>{});}
}
async function poster(output,text) {
  const title=xmlEscape((safeText(text,55)||'BAJO MUNDO TV').toUpperCase());
  const svg='<svg xmlns="http://www.w3.org/2000/svg" width="1280" height="720" viewBox="0 0 1280 720"><defs><linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#101428"/><stop offset=".55" stop-color="#30155b"/><stop offset="1" stop-color="#080b18"/></linearGradient><radialGradient id="orb"><stop stop-color="#f6aaff"/><stop offset="1" stop-color="#8b36ff" stop-opacity="0"/></radialGradient></defs><rect width="1280" height="720" fill="url(#bg)"/><circle cx="970" cy="290" r="380" fill="url(#orb)" opacity=".85"/><circle cx="1050" cy="420" r="160" fill="none" stroke="#ed8cff" stroke-width="2" opacity=".65"/><circle cx="1030" cy="400" r="230" fill="none" stroke="#c179ff" stroke-width="2" opacity=".35"/><rect x="73" y="72" width="116" height="13" rx="5" fill="#da9aff"/><text x="75" y="165" font-family="Arial, Helvetica, sans-serif" font-size="32" letter-spacing="9" fill="#ca9aff">CREATOR STUDIO</text><text x="75" y="350" font-family="Arial, Helvetica, sans-serif" font-size="84" font-weight="900" fill="#fff">'+title+'</text><text x="78" y="420" font-family="Arial, Helvetica, sans-serif" font-size="35" fill="#dec7ff">UNA NUEVA ERA DE CONTENIDO</text><rect x="75" y="505" width="370" height="72" rx="20" fill="#d58aff"/><text x="114" y="550" font-family="Arial, Helvetica, sans-serif" font-size="25" font-weight="bold" fill="#1c0c37">HECHO EN BAJO MUNDO</text></svg>';
  await fs.writeFile(output,svg,{mode:0o600});
  return 'svg';
}
async function script(output,topic) {
  const what=safeText(topic,80)||'una nueva serie original de entretenimiento urbano';
  const body=[
    'BAJO MUNDO TV — ORIGINAL SHOW OUTLINE','',
    'Tema: '+what,'',
    'CONCEPTO',
    'Una historia original y cercana a la audiencia; enfocarse en una pregunta interesante y una experiencia real.','',
    'ESTRUCTURA SUGERIDA',
    '0:00 — Comienza con el momento más interesante y una pregunta.',
    '0:05 — Presenta el tema: '+what+'.',
    '0:15 — Muestra contexto, entrevistas autorizadas o material grabado por el equipo.',
    '0:35 — Cuenta el descubrimiento o la novedad con imágenes originales.',
    '0:50 — Resume lo aprendido y termina con una pregunta para la comunidad.','',
    'TÍTULOS PARA PROBAR',
    '1. Lo que no sabías sobre '+what,
    '2. Detrás de cámaras: '+what,
    '3. Bajo Mundo presenta: '+what,'',
    'Nota: Estas ideas son plantillas automáticas, no texto generado por un modelo de IA.'
  ].join('\n');
  await fs.writeFile(output,body,'utf8');return 'txt';
}
export function createLocalRouter({tmp,out,setJob,freshJob}) {
  const router=express.Router();
  const uploader=multer({
    dest:tmp,limits:{fileSize:MAX_INPUT_BYTES,files:1},
    fileFilter:(_req,file,cb)=>detectMedia(file.originalname) ? cb(null,true) : cb(new Error('Upload an MP4, MOV, WebM, MKV, image, MP3, WAV, M4A, OGG or FLAC'))
  });
  const queue=[];let active=0;
  function next(){
    if(active>=1||!queue.length)return;
    const item=queue.shift();active++;
    (async()=>{
      const {id,kind,input,optionalText}=item;
      try{
        const extensions={video:'mp4',imageEdit:'png',audio:'mp3',music:'mp3',image:'svg',voice:'mp3',writing:'txt'};
        const extension=extensions[kind];const dest=path.join(out,id+'.'+extension);
        await setJob(id,{providerStatus:'Working on your server'});
        if(kind==='video')await video(input,dest);
        else if(kind==='imageEdit')await photo(input,dest);
        else if(kind==='audio')await audio(input,dest);
        else if(kind==='music')await beat(dest,tmp,id);
        else if(kind==='image')await poster(dest,optionalText);
        else if(kind==='voice')await voice(dest,tmp,id,optionalText);
        else await script(dest,optionalText);
        await setJob(id,{status:'done',providerStatus:'Completed on server',ready:true,extension});
      }catch(err){
        await setJob(id,{status:'failed',providerStatus:'Failed',ready:false,error:String(err.message).slice(0,300)});
      }finally{
        if(input)await fs.unlink(input).catch(()=>{});
        active--;next();
      }
    })().catch(err=>{ console.error('Local engine error:',err.message); active--;next(); });
  }
  router.get('/local-config',(_req,res)=>res.json({mode:'self-hosted',configured:true,providersRequired:false,features:['video','imageEdit','audio','music','image','voice','writing'],generativeAI:false}));
  router.post('/auto',uploader.single('file'),async(req,res,nextMiddleware)=>{
    let input=req.file?.path;
    try{
      let kind=String(req.body.kind||'auto');
      if(!allowed.has(kind))throw new Error('Unsupported local tool');
      if(kind==='auto')kind=req.file ? detectMedia(req.file.originalname) : 'image';
      if(['video','imageEdit','audio'].includes(kind)){
        if(!req.file || detectMedia(req.file.originalname)!==kind)throw new Error('Please select a supported '+kind+' file');
        if(req.body.rightsConfirmed!=='true')throw new Error('Confirm that you have rights to the uploaded media');
      }else if(req.file){throw new Error('This tool does not need an uploaded file');}
      if(queue.length>=5)throw new Error('Server is busy; please try again when a processing job finishes');
      const titles={video:'Automatic video enhancement',imageEdit:'Automatic photo enhancement',audio:'Automatic audio cleanup',music:'Original rhythmic beat',image:'Original graphic poster',voice:'Spanish voice narration',writing:'Original show outline'};
      const title=req.file ? titles[kind]+': '+req.file.originalname : titles[kind];
      const job=freshJob(kind,title,'local','',{providerStatus:'Queued'});
      await setJob(job.id,job);
      queue.push({id:job.id,kind,input,optionalText:req.body.prompt});
      input=null;next();
      res.status(201).json({id:job.id,status:'processing',kind:job.kind,title:job.title});
    }catch(err){nextMiddleware(err);}
    finally{if(input)await fs.unlink(input).catch(()=>{});}
  });
  return router;
}
