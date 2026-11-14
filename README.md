# Bajo Mundo Creator Studio — No-API One-Click Mode

The studio is an authenticated, single-owner media utility that works without paid third-party AI API keys.

## Working one-click tools (self-hosted)

- **Auto Magic**: upload an MP4/MOV/WebM/MKV, JPG/PNG/WebP, or MP3/M4A/WAV/OGG/FLAC. The server detects whether the input is video, photo, or audio and automatically processes it.
- **Video Enhance**: FFmpeg color/sharpness adjustments and MP4 export (up to ten minutes / 200MB).
- **Photo Enhance**: FFmpeg contrast, color and sharpness correction; exports PNG.
- **Audio Cleanup**: EQ, compression and loudness balancing, exports MP3.
- **Beat Maker**: produces a short original procedural rhythm using a built-in synth.
- **Poster Maker**: original SVG promotional graphic, optionally with a custom heading.
- **Voice Creator**: eSpeak-NG Spanish text-to-speech, MP3 (robotic voice, not neural voice cloning).
- **Show Templates**: deterministic, reusable TXT show outline.

These are **automatic editing/synthesis tools, NOT generative machine-learning video or image reconstruction**. They do not magically transfer copyright in uploaded material. A truly generative, almost-photorealistic video recreation without external AI APIs would require installing and running substantial open-source video model weights on suitable GPU hardware, a separate next phase. Do not imply any copyright detection evasion or ownership transfer.

## Why this version is usable without API keys

The browser sends media only to this authenticated website, and the site processes it using FFmpeg, procedural graphics/music, and local speech synthesis. No Runway, Replicate or OpenAI keys are needed for the one-click mode. Railway hosting/resources still cost money. The old provider-based endpoints remain in source for possible future development but the primary interface does not call them.

## Deployment

The GitHub main branch is connected to Railway project **Bajo Mundo AI Studio**, service **ai-studio-web**.

- Dockerfile installs FFmpeg and eSpeak-NG.
- Railway volume at `/data` stores exported creations and metadata.
- `ADMIN_PASSWORD` (12+ chars), `SESSION_SECRET` (24+ chars), `NODE_ENV=production`, `TRUST_PROXY=1`, and `DATA_DIR=/data` are required/recommended. Keep them in Railway variables, not GitHub.
- Use the generated Railway domain on HTTPS; root page is password protected (media/results routes require login).
- The built-in job queue processes one media item at a time to avoid saturating CPU. Queued/in-flight work does not persist through deployments; interrupted jobs are marked failed after restart.
- Uploaded originals are deleted after processing. Generated outputs stay on the attached volume until deleted.
- Build checks include a live local end-to-end test that logs in, creates beat/poster, enhances image and video, and downloads each output **without any third-party API keys**.

## Current limitations

No video semantic scene changes, copyrighted-video reconstruction, celebrity voice cloning, full neural AI generation, automatic subtitles, or automatic background replacement. CPU-based filters are not generative AI. Large/long files may require more CPU, disk, time or a dedicated worker.

The app uses the basic express-session memory store for one owner. Before opening this to additional users, upgrade sessions to a persistent store, add account roles, quota policies and media retention rules.

## Later upgrade path

For real generative AI with no external provider APIs, introduce local GPU model workers (e.g., locally deployed image/video diffusion and speech models), model download/licensing review, GPU cost controls, a durable queue, and automated shot analysis, then connect them to the same upload-first interface.
