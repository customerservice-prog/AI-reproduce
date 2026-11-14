import express from 'express';
import helmet from 'helmet';
import session from 'express-session';
import rateLimit from 'express-rate-limit';
import multer from 'multer';
import axios from 'axios';
import FormData from 'form-data';
import crypto from 'node:crypto';
import path from 'node:path';
import { promises as fs, createReadStream, createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { buildVideoPrompt, validateMusic, safeProviderUrl, publicJob, VIDEO_PRESETS } from './logic.js';

const exec = promisify(execFile);
const app = express();
const PORT = Number(process.env.PORT || 3000);
const DATA = path.resolve(process.env.DATA_DIR || './data');
const TMP = path.join(DATA, 'uploads');
const OUT = path.join(DATA, 'outputs');
const DB = path.join(DATA, 'jobs.json');
const runwayKey = process.env.RUNWAYML_API_SECRET || '';
const replicateKey = process.env.REPLICATE_API_TOKEN || '';
const openaiKey = process.env.OPENAI_API_KEY || '';
const password = process.env.ADMIN_PASSWORD || '';
const secret = process.env.SESSION_SECRET || '';
const MAX_VIDEO = Math.min(200, Number(process.env.MAX_VIDEO_MB || 200)) * 1024 * 1024;
const MAX_IMAGE = 9 * 1024 * 1024;
const MAX_OUTPUT = 350 * 1024 * 1024;
const RUNWAY_API = 'https://api.dev.runwayml.com/v1';
const REPLICATE_API = 'https://api.replicate.com/v1';

if (password.length < 12 || secret.length < 24) {
  throw new Error('Configure ADMIN_PASSWORD (12+ characters) and SESSION_SECRET (24+ characters)');
}
await fs.mkdir(TMP, { recursive: true });
await fs.mkdir(OUT, { recursive: true });

let jobs = {};
try { jobs = JSON.parse(await fs.readFile(DB, 'utf8')); }
catch (err) { if (err.code !== 'ENOENT') throw err; }
let writeChain = Promise.resolve();
function save() {
  const snapshot = JSON.stringify(jobs, null, 2);
  writeChain = writeChain.then(async () => {
    await fs.writeFile(DB + '.tmp', snapshot, { mode: 0o600 });
    await fs.rename(DB + '.tmp', DB);
  });
  return writeChain;
}
async function setJob(id, updates) {
  jobs[id] = Object.assign({}, jobs[id], updates);
  await save();
  return jobs[id];
}
function freshJob(kind, title, provider, providerId, extras = {}) {
  return {
    id: crypto.randomUUID(), kind, title: String(title).slice(0, 80),
    provider, providerId, status: 'processing', providerStatus: 'starting',
    createdAt: new Date().toISOString(), ready: false, ...extras
  };
}
function checkPrompt(input, min = 10, max = 1800) {
  const value = String(input || '').trim();
  if (value.length < min || value.length > max) throw new Error('Prompt must be between ' + min + ' and ' + max + ' characters');
  return value;
}
function checkRights(v) {
  if (v !== true && v !== 'true') throw new Error('Confirm you own or have permission to use this input and any voices/likenesses');
}
function failureMessage(err) {
  const data = err.response?.data;
  const msg = typeof data?.detail === 'string' ? data.detail :
    typeof data?.error === 'string' ? data.error :
    typeof data?.message === 'string' ? data.message : err.message;
  return String(msg || 'Unknown provider error').slice(0, 300);
}
function runwayHeaders() {
  return { Authorization: 'Bearer ' + runwayKey, 'X-Runway-Version': '2024-11-06' };
}
function replicateHeaders() { return { Authorization: 'Bearer ' + replicateKey }; }
function openaiHeaders() { return { Authorization: 'Bearer ' + openaiKey }; }
function loginRequired(req, res, next) {
  if (!req.session?.authenticated) return res.status(401).json({ error: 'Please sign in' });
  next();
}
function requireKey(key, service) { if (!key) throw new Error(service + ' API key has not been configured in Railway'); }

if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({ contentSecurityPolicy: {
  directives: {
    defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
    imgSrc: ["'self'", 'blob:', 'data:'], mediaSrc: ["'self'", 'blob:'],
    connectSrc: ["'self'"], frameAncestors: ["'none'"], objectSrc: ["'none'"]
  }
}}));
app.use(express.json({ limit: '32kb' }));
app.use(session({
  name: 'bmai_session', secret, resave: false, saveUninitialized: false,
  cookie: { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', maxAge: 12 * 60 * 60 * 1000 }
}));
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.get('origin');
    const host = req.get('host');
    if (origin && new URL(origin).host !== host) return res.status(403).json({ error: 'Invalid request origin' });
  }
  next();
});
app.get('/healthz', (_, res) => res.json({ status: 'ok' }));
app.use(express.static(path.resolve('public'), { dotfiles: 'deny' }));
app.post('/api/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 10 }), (req, res) => {
  const attempt = Buffer.from(String(req.body?.password || ''));
  const known = Buffer.from(password);
  const ok = attempt.length === known.length && crypto.timingSafeEqual(attempt, known);
  if (!ok) return res.status(401).json({ error: 'Incorrect password' });
  req.session.regenerate(err => {
    if (err) return res.status(500).json({ error: 'Could not create a session' });
    req.session.authenticated = true;
    req.session.save(err2 => err2 ? res.status(500).json({ error: 'Could not save a session' }) : res.json({ ok: true }));
  });
});
app.get('/api/me', (req, res) => res.json({ authenticated: Boolean(req.session?.authenticated) }));
app.post('/api/logout', loginRequired, (req, res) => req.session.destroy(() => res.clearCookie('bmai_session').json({ ok: true })));
app.use('/api', loginRequired);
app.get('/api/config', (_, res) => res.json({
  providers: { runway: Boolean(runwayKey), replicate: Boolean(replicateKey), openai: Boolean(openaiKey) },
  maxVideoSeconds: 30, maxVideoMB: Math.floor(MAX_VIDEO / (1024 * 1024)),
  styles: VIDEO_PRESETS
}));

const upload = multer({
  dest: TMP, limits: { fileSize: MAX_VIDEO, files: 1 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (!['.mp4','.mov','.webm','.mkv','.png','.jpg','.jpeg','.webp'].includes(ext)) return cb(new Error('Unsupported file type'));
    cb(null, true);
  }
});
async function durationOf(file) {
  const { stdout } = await exec('ffprobe', ['-v','error','-show_entries','format=duration:stream=codec_type','-of','json',file],
    { timeout: 20000, maxBuffer: 1000000 });
  const data = JSON.parse(stdout);
  const seconds = Number(data.format?.duration);
  if (!data.streams?.some(s => s.codec_type === 'video') || !Number.isFinite(seconds) || seconds < 2 || seconds > 30) {
    throw new Error('Video edit clips must be 2–30 seconds with a real video stream');
  }
  return seconds;
}
async function uploadRunway(file, filename, mimetype) {
  const ext = path.extname(filename).toLowerCase();
  const init = await axios.post(RUNWAY_API + '/uploads', { filename: 'input' + ext, type: 'ephemeral' },
    { headers: runwayHeaders(), timeout: 30000 });
  const form = new FormData();
  for (const [k, v] of Object.entries(init.data.fields || {})) form.append(k, String(v));
  form.append('file', createReadStream(file), { filename: 'input' + ext, contentType: mimetype });
  await axios.post(safeProviderUrl(init.data.uploadUrl), form, {
    headers: form.getHeaders(), maxBodyLength: Infinity, timeout: 180000, maxRedirects: 0
  });
  return init.data.runwayUri;
}
async function createReplicate(model, input) {
  const result = await axios.post(REPLICATE_API + '/models/' + model + '/predictions',
    { input }, { headers: replicateHeaders(), timeout: 45000 });
  return result.data;
}
async function createOpenAIText(input, instruction) {
  const response = await axios.post('https://api.openai.com/v1/responses', {
    model: process.env.OPENAI_TEXT_MODEL || 'gpt-4.1-mini',
    instructions: instruction, input, max_output_tokens: 1700
  }, { headers: openaiHeaders(), timeout: 90000 });
  return (response.data.output || []).flatMap(item => item.content || [])
    .filter(c => c.type === 'output_text').map(c => c.text || '').join('\n').trim();
}
async function createSpeech(input, voice) {
  const response = await axios.post('https://api.openai.com/v1/audio/speech', {
    model: 'gpt-4o-mini-tts', input, voice, response_format: 'mp3'
  }, { headers: openaiHeaders(), responseType: 'arraybuffer', timeout: 90000 });
  return Buffer.from(response.data);
}

app.post('/api/generate', upload.single('file'), async (req, res, next) => {
  const file = req.file;
  try {
    const kind = String(req.body.kind || '');
    if (!['video','image','imageEdit','music','voice','writing'].includes(kind)) throw new Error('Select a studio tool');
    checkRights(req.body.rightsConfirmed);
    const prompt = checkPrompt(req.body.prompt, kind === 'voice' ? 3 : 10, kind === 'voice' ? 2000 : 1800);
    let job;
    if (kind === 'video') {
      requireKey(runwayKey, 'Runway');
      if (!file || !['.mp4','.mov','.webm','.mkv'].includes(path.extname(file.originalname).toLowerCase())) throw new Error('Upload an MP4, MOV, WebM or MKV video');
      await durationOf(file.path);
      const style = String(req.body.style || 'cinematic');
      const promptText = buildVideoPrompt(style, prompt);
      const runwayUri = await uploadRunway(file.path, file.originalname, file.mimetype);
      const reply = await axios.post(RUNWAY_API + '/video_to_video',
        { model: 'aleph2', videoUri: runwayUri, promptText },
        { headers: runwayHeaders(), timeout: 45000 });
      job = freshJob(kind, file.originalname, 'runway', reply.data.id, { preset: style });
    } else if (kind === 'image' || kind === 'imageEdit') {
      requireKey(replicateKey, 'Replicate');
      let prediction;
      if (kind === 'imageEdit') {
        if (!file || !['.png','.jpg','.jpeg','.webp'].includes(path.extname(file.originalname).toLowerCase())) throw new Error('Upload a JPG, PNG or WebP image');
        if (file.size > MAX_IMAGE) throw new Error('Image must be smaller than 9MB');
        const data = await fs.readFile(file.path);
        const mime = file.mimetype === 'image/png' ? 'image/png' : file.mimetype === 'image/webp' ? 'image/webp' : 'image/jpeg';
        prediction = await createReplicate('black-forest-labs/flux-kontext-pro',
          { prompt, input_image: 'data:' + mime + ';base64,' + data.toString('base64'), output_format: 'png' });
      } else {
        const ratio = ['1:1','16:9','9:16','4:3','3:4'].includes(req.body.aspectRatio) ? req.body.aspectRatio : '16:9';
        prediction = await createReplicate('black-forest-labs/flux-schnell',
          { prompt, aspect_ratio: ratio, num_outputs: 1, output_format: 'webp' });
      }
      job = freshJob(kind, prompt, 'replicate', prediction.id, { providerStatus: prediction.status });
    } else if (kind === 'music') {
      requireKey(replicateKey, 'Replicate');
      const item = validateMusic(prompt, req.body.seconds || 30);
      const prediction = await createReplicate('elevenlabs/music',
        { prompt: item.prompt, music_length_ms: item.seconds * 1000,
          force_instrumental: req.body.instrumental !== 'false', output_format: 'mp3_high_quality' });
      job = freshJob(kind, prompt, 'replicate', prediction.id, { providerStatus: prediction.status });
    } else if (kind === 'voice') {
      requireKey(openaiKey, 'OpenAI');
      const selected = ['alloy','ash','coral','echo','nova','onyx','sage','shimmer','marin','cedar'].includes(req.body.voice) ? req.body.voice : 'marin';
      const audio = await createSpeech(prompt, selected);
      job = freshJob(kind, 'AI narration: ' + prompt.slice(0, 50), 'local', '', { status: 'done', ready: true, extension: 'mp3' });
      await fs.writeFile(path.join(OUT, job.id + '.mp3'), audio);
    } else {
      requireKey(openaiKey, 'OpenAI');
      const mode = ['script','ideas','caption','rewrite','translate'].includes(req.body.writingMode) ? req.body.writingMode : 'ideas';
      const instruction = 'You are an expert creative producer. Task: ' + mode + '. Write useful, original results. Do not imitate protected lyrics or claim ownership of third party creations.';
      const result = await createOpenAIText(prompt, instruction);
      if (!result) throw new Error('The text model returned no result');
      job = freshJob(kind, mode + ': ' + prompt.slice(0, 45), 'local', '', { status: 'done', ready: true, extension: 'txt' });
      await fs.writeFile(path.join(OUT, job.id + '.txt'), result, 'utf8');
    }
    await setJob(job.id, job);
    res.status(201).json(publicJob(job));
  } catch (err) { next(err); }
  finally { if (file) await fs.unlink(file.path).catch(() => {}); }
});

const refreshing = new Map();
const allowedOutputHosts = ['replicate.delivery','replicateusercontent.com','runwayml.com','amazonaws.com','googleapis.com','cloudfront.net'];
function allowOutputUrl(raw) {
  const url = safeProviderUrl(raw);
  const host = new URL(url).hostname.toLowerCase();
  if (!allowedOutputHosts.some(d => host === d || host.endsWith('.' + d))) throw new Error('Provider output URL host is not approved: ' + host);
  return url;
}
function outputExt(job, url) {
  if (job.kind === 'video') return 'mp4';
  if (job.kind === 'music' || job.kind === 'voice') return 'mp3';
  if (job.kind === 'writing') return 'txt';
  const match = new URL(url).pathname.match(/\.(png|jpe?g|webp)(?:$)/i);
  return match ? match[1].toLowerCase().replace('jpeg','jpg') : job.kind === 'image' ? 'webp' : 'png';
}
async function downloadOutput(job, rawUrl) {
  const url = allowOutputUrl(rawUrl);
  const extension = outputExt(job, url);
  const dest = path.join(OUT, job.id + '.' + extension);
  const temp = dest + '.part';
  let count = 0;
  try {
    const r = await axios.get(url, { responseType: 'stream', timeout: 90000, maxRedirects: 0 });
    r.data.on('data', chunk => {
      count += chunk.length;
      if (count > MAX_OUTPUT) r.data.destroy(new Error('Output is too large'));
    });
    await pipeline(r.data, createWriteStream(temp, { mode: 0o600 }));
    if (count < 100) throw new Error('Provider returned an empty output');
    await fs.rename(temp, dest);
    return extension;
  } finally { await fs.unlink(temp).catch(() => {}); }
}
async function refreshJob(job) {
  if (job.status !== 'processing' || job.provider === 'local') return job;
  if (refreshing.has(job.id)) return refreshing.get(job.id);
  const task = (async () => {
    try {
      let data;
      if (job.provider === 'runway') {
        requireKey(runwayKey, 'Runway');
        const r = await axios.get(RUNWAY_API + '/tasks/' + encodeURIComponent(job.providerId),
          { headers: runwayHeaders(), timeout: 30000 });
        data = r.data;
      } else {
        requireKey(replicateKey, 'Replicate');
        const r = await axios.get(REPLICATE_API + '/predictions/' + encodeURIComponent(job.providerId),
          { headers: replicateHeaders(), timeout: 30000 });
        data = r.data;
      }
      const state = String(data.status || '').toUpperCase();
      if (['FAILED','CANCELED','CANCELLED'].includes(state)) {
        return await setJob(job.id, { status: 'failed', providerStatus: state, error: String(data.error || data.failure || 'Provider generation failed').slice(0, 240) });
      }
      if (['SUCCEEDED','SUCCESS','COMPLETED'].includes(state)) {
        const output = Array.isArray(data.output) ? data.output[0] : data.output;
        if (typeof output !== 'string') throw new Error('Provider produced an unsupported output');
        const ext = await downloadOutput(job, output);
        return await setJob(job.id, { status: 'done', providerStatus: state, extension: ext, ready: true });
      }
      return await setJob(job.id, { providerStatus: state });
    } catch (err) {
      // A temporary status or CDN issue should not mark a billable generation as failed.
      return await setJob(job.id, { warning: failureMessage(err) });
    }
  })();
  refreshing.set(job.id, task);
  try { return await task; } finally { refreshing.delete(job.id); }
}
app.get('/api/jobs', async (_req,res,next) => {
  try {
    const list = Object.values(jobs).sort((a,b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 50);
    res.json(list.map(publicJob));
  } catch(err) {next(err);}
});
app.get('/api/jobs/:id', async (req,res,next) => {
  try {
    const job = jobs[req.params.id];
    if (!job) return res.status(404).json({ error: 'Job not found' });
    if (job.status === 'processing' && (!job.lastCheck || Date.now() - job.lastCheck > 6000)) {
      job.lastCheck = Date.now();
      await refreshJob(job);
    }
    res.json(publicJob(jobs[req.params.id]));
  } catch(err) {next(err);}
});
app.get('/api/download/:id', async (req,res,next) => {
  const job = jobs[req.params.id];
  if (!job?.ready) return res.status(404).json({ error: 'Output not available' });
  const file = path.join(OUT, job.id + '.' + job.extension);
  try {
    await fs.access(file);
    res.download(file, 'bajo-mundo-' + job.kind + '-' + job.id.slice(0,8) + '.' + job.extension);
  } catch(err) { next(err); }
});
app.get('/api/preview/:id', async (req,res,next) => {
  const job = jobs[req.params.id];
  if (!job?.ready) return res.status(404).end();
  const file = path.join(OUT, job.id + '.' + job.extension);
  try {
    await fs.access(file);
    res.type(job.extension === 'txt' ? 'text/plain' : job.extension);
    res.set('Cache-Control','private, no-store');
    res.sendFile(file);
  } catch(err) { next(err); }
});
app.delete('/api/jobs/:id', async(req,res,next) => {
  const job = jobs[req.params.id];
  if (!job) return res.status(404).json({ error: 'Job not found' });
  if (job.status === 'processing') return res.status(409).json({ error: 'Wait for the provider job to finish before clearing its record' });
  try {
    if (job.extension) await fs.unlink(path.join(OUT, job.id + '.' + job.extension)).catch(() => {});
    delete jobs[job.id]; await save();
    res.json({ ok:true });
  } catch(err) {next(err);}
});

app.use((err,_req,res,_next) => {
  console.error('Studio error:', err.message);
  const status = err instanceof multer.MulterError ? 413 :
    /must|invalid|upload|prompt|select|confirm|unsupported|shorter|length|larger|seconds/i.test(err.message) ? 400 :
    /not been configured/.test(err.message) ? 503 : 500;
  res.status(status).json({ error: status === 500 ? 'Generation failed: ' + failureMessage(err) : failureMessage(err) });
});
app.listen(PORT, '0.0.0.0', () => console.log('Bajo Mundo AI Studio listening on ' + PORT));