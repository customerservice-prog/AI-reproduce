import path from 'node:path';

export const VIDEO_PRESETS = Object.freeze({
  cinematic: 'Cinematic film grade, realistic lighting, elegant camera treatment.',
  urban: 'Stylish urban nighttime atmosphere, rich shadows, neon reflections, photorealistic.',
  vintage: 'Authentic vintage film aesthetic, natural grain and period color.',
  fantasy: 'Cinematic fantasy atmosphere with believable environmental details.',
  clean: 'Clean polished edit: improve lighting and visual presentation with subtle changes.',
  custom: ''
});

export function buildVideoPrompt(preset, prompt) {
  if (!Object.hasOwn(VIDEO_PRESETS, preset)) throw new Error('Unknown style preset');
  const clean = String(prompt || '').trim().replace(/\s+/g, ' ');
  if (clean.length < 12 || clean.length > 650) throw new Error('Describe the visual changes (12–650 characters)');
  return [VIDEO_PRESETS[preset], clean, 'Keep motion coherent, shots consistent and natural; preserve the visual context unless instructed otherwise.'].filter(Boolean).join(' ').slice(0, 1000);
}

export function validateMusic(prompt, seconds) {
  const clean = String(prompt || '').trim();
  const duration = Number(seconds);
  if (clean.length < 15 || clean.length > 1600) throw new Error('Describe the original track (15–1600 characters)');
  if (!Number.isInteger(duration) || duration < 10 || duration > 180) throw new Error('Length must be between 10 and 180 seconds');
  return {prompt: clean, seconds: duration};
}

export function safeExtension(kind) {
  return kind === 'video' ? '.mp4' : '.mp3';
}

export function safeOutputPath(baseDir, jobId, kind) {
  if (!/^[a-f0-9-]{36}$/.test(jobId)) throw new Error('Invalid job ID');
  return path.join(baseDir, 'outputs', jobId + safeExtension(kind));
}

export function safeProviderUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Provider URL must be HTTPS');
  const host = url.hostname.toLowerCase().replace(/\.$/, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || /^[0-9.]+$/.test(host) || host.includes(':')) throw new Error('Unsafe provider output host');
  return url.toString();
}

export function publicJob(job) {
  return {
    id: job.id, kind: job.kind, preset: job.preset || null,
    title: job.title, status: job.status, createdAt: job.createdAt,
    providerStatus: job.providerStatus || null, error: job.error || null,
    ready: Boolean(job.ready), creditsEstimate: job.creditsEstimate || null
  };
}
