# CAMERA_PROXY_DEPLOYMENT_REPORT.md

**التاريخ:** 2026-06-18  
**الحالة:** ✅ Camera Proxy يعمل على Hetzner

---

## 1. نتائج الفحص الأولي

| السؤال | الجواب |
|--------|--------|
| هل يوجد proxy في الكود؟ | ✅ نعم — `camera-proxy/provisioning-agent/` + MediaMTX |
| نوعه | **MediaMTX** (RTSP→MJPEG→HLS) + **Node.js Provisioning Agent** (port 8787) |
| هل كان منشوراً على Hetzner؟ | ❌ لا |
| ما المشكلة؟ | `mediamtx.exe` و `ffmpeg.exe` ملفات **Windows** لا تعمل على Ubuntu |
| CORS | مقيّد بـ `localhost:5173` فقط (dev) |
| ffmpeg على السيرفر | ❌ لم يكن مثبتاً |
| PM2 | ❌ لم يكن مثبتاً |

---

## 2. المعمارية الحقيقية

```
Browser → Nginx :80
              │
              ├─ /camera-proxy/* → Node.js Agent :8787
              │     ├── GET /health          → { ok: true }
              │     ├── POST /provision      → ffprobe + MediaMTX API + HLS verify
              │     ├── POST /validate/nvr-parent → TCP check
              │     └── POST /shutdown       → stop agent
              │
              └─ /camera-hls/*  → MediaMTX HLS :8888
                    └── /cam-{id12}/index.m3u8  → HLS stream

MediaMTX :8554 ← RTSP cameras (via internet/VPN only for remote cameras)
MediaMTX :9997 → Provisioning Agent (localhost only, API control)
```

### تدفق provisioning كاملاً:
```
1. Frontend → POST /camera-proxy/provision { cameraId, rtspUrl, mode }
2. Agent → ffprobe: detect codecs from RTSP stream
3. Agent → POST http://127.0.0.1:9997/v3/config/paths/add/cam-{id12}
4. MediaMTX → ffmpeg: transcode RTSP → H.264/AAC → re-publishes as RTSP
5. MediaMTX → serve HLS at :8888/cam-{id12}/index.m3u8
6. Agent → poll http://127.0.0.1:8888/cam-{id12}/index.m3u8 until #EXTM3U
7. Agent → return { ok:true, liveStreamUrl: "http://91.98.80.25/camera-hls/cam-{id12}/index.m3u8" }
8. Frontend → save liveStreamUrl to Supabase cameras.live_stream_url
9. Browser → hls.js plays http://91.98.80.25/camera-hls/cam-{id12}/index.m3u8
```

---

## 3. الإصلاحات المُنفَّذة

### كود (ملفين):

| الملف | التغيير |
|-------|---------|
| `camera-proxy/provisioning-agent/config.js` | Linux binary paths + env-var overrides + production CORS |
| `camera-proxy/provisioning-agent/hlsCheck.js` | Public URL للـ browser، Internal URL للتحقق |
| `.env` | إضافة `VITE_PROVISIONING_AGENT_URL=/camera-proxy` |

### config.js - التغييرات الرئيسية:
```js
// قبل (Windows فقط):
export const FFMPEG_PATH  = path.join(MEDIAMTX_DIR, 'ffmpeg.exe')
export const FFPROBE_PATH = path.join(MEDIAMTX_DIR, 'ffprobe.exe')
export const ALLOWED_ORIGINS = new Set(['http://localhost:5173'])

// بعد (cross-platform):
export const FFMPEG_PATH  = process.env.FFMPEG_PATH  ?? (process.platform === 'win32' ? WIN_FFMPEG  : 'ffmpeg')
export const FFPROBE_PATH = process.env.FFPROBE_PATH ?? (process.platform === 'win32' ? WIN_FFPROBE : 'ffprobe')
export const MEDIAMTX_HLS_PUBLIC_URL = process.env.MEDIAMTX_HLS_PUBLIC_URL ?? MEDIAMTX_HLS_BASE
export const ALLOWED_ORIGINS = new Set([
  'http://localhost:5173', 'http://127.0.0.1:5173',
  ...(process.env.CAMERA_PROXY_ALLOWED_ORIGINS ?? '').split(',').filter(Boolean)
])
```

### Server setup:
```bash
apt-get install -y ffmpeg                          # ffmpeg v6.1.1
npm install -g pm2                                 # Process manager
# MediaMTX v1.9.3 Linux binary downloaded
/var/www/ai-attendance/camera-proxy/mediamtx-linux
```

---

## 4. الخدمات على الإنتاج

```
PM2 Processes:
┌────┬───────────────────────────────┬──────────┬────────┐
│ id │ name                          │ pid      │ status │
├────┼───────────────────────────────┼──────────┼────────┤
│ 0  │ ai-attendance-mediamtx        │ 60624    │ online │
│ 1  │ ai-attendance-camera-proxy    │ 60628    │ online │
└────┴───────────────────────────────┴──────────┴────────┘
```

### PM2 Environment (provisioning agent):
```
CAMERA_PROXY_ALLOWED_ORIGINS = http://91.98.80.25
MEDIAMTX_HLS_PUBLIC_URL      = http://91.98.80.25/camera-hls
AGENT_HOST                   = 127.0.0.1
AGENT_PORT                   = 8787
```

### Nginx reverse proxy (جديد):
```nginx
location /camera-proxy/ { proxy_pass http://127.0.0.1:8787/; }
location /camera-hls/   { proxy_pass http://127.0.0.1:8888/; }
```

---

## 5. الاختبار الحقيقي

### Health check (مؤكد):
```
curl http://91.98.80.25/camera-proxy/health
→ {"ok":true}   ← HTTP 200 ✅
```

### اختبار provision (يحتاج كاميرا RTSP متاحة عبر الإنترنت):
```bash
curl -X POST http://91.98.80.25/camera-proxy/provision \
  -H "Content-Type: application/json" \
  -d '{"cameraId":"test-cam-1","rtspUrl":"rtsp://IP:554/stream","mode":"direct_rtsp"}'
```

---

## 6. قيد معماري مهم

**الكاميرات المحلية (192.168.x.x) لا تعمل من Hetzner.**

الخادم على Hetzner في ألمانيا. الكاميرا على الشبكة المحلية `192.168.1.15`. لا يوجد مسار.

**ما يعمل من Hetzner:**
- كاميرات بـ IP عام (DDNS/port forwarding)
- كاميرات cloud (EZVIZ, IMOU — عبر cloud adapter)
- كاميرا RTSP متاحة عبر الإنترنت

**ما لا يعمل من Hetzner:**
- `rtsp://192.168.x.x/...` (شبكة محلية خاصة)

**الحل للكاميرات المحلية:**
- إما تشغيل MediaMTX محلياً (dev setup أو edge server)
- أو port forwarding للـ RTSP على الراوتر

---

## 7. خلاصة الـ Endpoints المتاحة

| Endpoint | Method | الغرض |
|----------|--------|--------|
| `http://91.98.80.25/camera-proxy/health` | GET | liveness check |
| `http://91.98.80.25/camera-proxy/provision` | POST | تشغيل RTSP stream |
| `http://91.98.80.25/camera-proxy/validate/nvr-parent` | POST | التحقق من وصول NVR |
| `http://91.98.80.25/camera-hls/{pathName}/index.m3u8` | GET | تشغيل HLS في المتصفح |

---

## 8. نتائج البناء والنشر

```
TSC app:    0 errors ✅
Build:      ✓ built in 1.22s (VITE_PROVISIONING_AGENT_URL=/camera-proxy) ✅
MediaMTX:   v1.9.3 Linux — ACTIVE via PM2 ✅
Agent:      Node.js — ACTIVE via PM2 :8787 ✅
Nginx:      /camera-proxy/ + /camera-hls/ proxies ✅
Health:     HTTP 200 {"ok":true} ✅
PM2 save:   Auto-restart on server reboot ✅
```
