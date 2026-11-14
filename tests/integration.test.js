import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn, execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {mkdtemp,rm,readFile} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const exec=promisify(execFile);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('self-hosted studio logs in and processes image, short video and beat with no API keys', {timeout:110000},async()=>{
  const temp=await mkdtemp(path.join(os.tmpdir(),'studio-smoke-'));
  const port=33929+Math.floor(Math.random()*5000);
  const password='Local-Test-Password-1234';
  const site='http://127.0.0.1:'+port;
  const proc=spawn(process.execPath,['src/server.js'],{
    cwd:process.cwd(),env:{...process.env,PORT:String(port),NODE_ENV:'test',DATA_DIR:temp,ADMIN_PASSWORD:password,SESSION_SECRET:'test_secret_long_enough_for_the_studio_session_12345',
      RUNWAYML_API_SECRET:'',REPLICATE_API_TOKEN:'',OPENAI_API_KEY:''},stdio:['ignore','pipe','pipe']
  });
  let logs='';
  proc.stdout.on('data',x=>logs+=x.toString());
  proc.stderr.on('data',x=>logs+=x.toString());
  try{
    let started=false;
    for(let attempt=0;attempt<50;attempt++){
      if(proc.exitCode!==null)throw new Error('Server exited early: '+logs);
      try{const r=await fetch(site+'/healthz');if(r.ok){started=true;break;}}catch{}
      await sleep(100);
    }
    assert.ok(started,'Server did not start: '+logs);
    const login=await fetch(site+'/api/login',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({password})});
    assert.equal(login.status,200,'Login should work');
    const cookie=login.headers.get('set-cookie')?.split(';')[0];
    assert.ok(cookie?.includes('bmai_session='));
    const headers={cookie};

    const r=await fetch(site+'/api/local-config',{headers});
    assert.equal(r.status,200);
    assert.equal((await r.json()).providersRequired,false);
    async function submit(kind,file){
      const body=new FormData();
      body.set('kind',kind);body.set('rightsConfirmed','true');
      if(file)body.set('file',new Blob([await readFile(file)]),path.basename(file));
      const response=await fetch(site+'/api/auto',{method:'POST',headers,body});
      const job=await response.json();
      assert.equal(response.status,201,JSON.stringify(job));
      for(let i=0;i<100;i++){
        const result=await fetch(site+'/api/jobs/'+job.id,{headers});
        const state=await result.json();
        if(state.status==='done'){
          const output=await fetch(site+'/api/download/'+job.id,{headers});
          assert.equal(output.status,200);
          assert.ok(Number(output.headers.get('content-length'))>100);
          return state;
        }
        if(state.status==='failed')throw new Error('Failed '+kind+': '+state.error);
        await sleep(200);
      }
      throw new Error('Timed out processing '+kind);
    }

    await submit('music');
    await submit('image');
    const photo=path.join(temp,'test.png');
    await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','color=c=blue:s=320x240','-frames:v','1',photo],{timeout:20000});
    await submit('imageEdit',photo);
    const video=path.join(temp,'test.mp4');
    await exec('ffmpeg',['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','testsrc2=s=320x240:r=20:d=2','-c:v','libx264','-pix_fmt','yuv420p',video],{timeout:30000});
    await submit('video',video);
  }finally{
    proc.kill('SIGTERM');
    await sleep(250);
    await rm(temp,{recursive:true,force:true});
  }
});
