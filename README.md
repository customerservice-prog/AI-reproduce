# Bajo Mundo AI Studio

A private, multimodal creative lab built to experiment with AI media tools. This project is separate from bajomundotv.com.

## Six creation tools

| Tool | Provider | Result |
|---|---|---|
| Video Reimagine | Runway Aleph 2 | MP4 |
| Photo Transform | Replicate FLUX Kontext Pro | PNG |
| Image Generator | Replicate FLUX Schnell | WebP |
| Original Music | Replicate ElevenLabs Music | MP3 |
| AI Narration | OpenAI Speech API | MP3 |
| Ideas & Scripts | OpenAI Responses API | TXT |

Includes drag-and-drop media, presets, prompt suggestions, private generation history, preview players, and downloadable outputs. Source material and any likenesses or voices must be owned or used with permission. AI does not change rights in copyrighted materials.

## Local setup

Requires Node 20+, FFmpeg/ffprobe, and API keys.

1. Copy .env.example to .env and set ADMIN_PASSWORD (12+ characters), SESSION_SECRET (24+ characters), and the relevant AI keys.
2. Run npm install.
3. With Node 22, run node --env-file=.env src/server.js (or export variables before npm start).
4. Open http://localhost:3000 and sign in.
5. Run npm test to check core validators.

## Railway deployment

1. Deploy this GitHub repository using its Dockerfile in a separate Railway project.
2. In Railway Variables set ADMIN_PASSWORD, SESSION_SECRET, TRUST_PROXY=1 and desired provider keys.
3. Attach a persistent Railway volume at /data.
4. Generate a Railway HTTPS domain and verify /healthz.
5. Sign in and start with a small image or 2–5 second video.

Variables:
- RUNWAYML_API_SECRET for video-to-video
- REPLICATE_API_TOKEN for images and original music
- OPENAI_API_KEY for original narration and creative writing
- DATA_DIR=/data for stored job records and outputs
- OPENAI_TEXT_MODEL optional, default gpt-4.1-mini

Never put secrets into code or GitHub.

## Limits and costs

- Runway video editing currently accepts 2–30-second clips up to 200MB. Long videos require segmentation, queuing and stitching in a later iteration.
- Image edits: JPG/PNG/WebP up to 9MB.
- Music choices: 15–180 seconds.
- Inputs are deleted from the studio server after submission to the provider. Output files remain until removed in the UI.
- Providers charge separately from Railway or ChatGPT. Usage can grow rapidly, especially with video.
- Provider CDN outputs and generation success are not guaranteed. Keep local backups.
- OpenAI Speech model is deprecated and scheduled to shut down January 6, 2027. Migrate before then.

## Security and ownership

Single-owner password-gated app. Do not expose it publicly before configuring passwords and reviewing provider data policies. The generated media is your project output; third-party rights may still apply. This software is not designed to bypass copyright matching or replicate someone else's voice without consent. For future public SaaS launch, add robust job queues, Redis-backed sessions, 2FA, per-user accounts, payment controls, an audit log, media scanning, and retention enforcement.

## Next phase

Long-form video, image-to-video, sound effects, dubbing, captions, documents, 3D assets, batch creation, model comparisons and before/after views.
