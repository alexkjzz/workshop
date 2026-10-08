# IoT backend

The backend receives sensor telemetry and vision detections over MQTT, stores
the sensor history in SQLite, and exposes it over HTTP (REST and Server-Sent
Events) behind Better Auth sessions.

## Architecture (clean architecture)

```
src/
  domain/          entities and pure rules (telemetry, vision, recorded time)
  application/     use cases, ports (interfaces), in-memory device state
  infrastructure/  adapters: SQLite repositories, MQTT gateway and message
                   parsing, Better Auth, camera feed, mailers (SMTP, outbox),
                   live event bus, config
  presentation/    Express app, routes and middlewares (HTTP only)
  main.ts          composition root, the only place wiring concrete classes
  cli/             create-user command
  tools/           MQTT simulator for local tests
```

Dependencies point inwards: `domain` imports nothing, `application` only
imports `domain`, and `presentation` never imports `infrastructure`. Use cases
are tested with in-memory fakes, without a broker or a database.

## Run

From `iot-backend/` (Node.js >= 22.13), after configuring the local environment:

```sh
npm ci
export BETTER_AUTH_SECRET="$(openssl rand -base64 32)"
npm run user:create -- operateur@aethercorp.test "Operateur"
npm run dev
```

Configuration is read from environment variables:

- `MQTT_URL` (default: `mqtt://127.0.0.1:1883`)
- `MQTT_TELEMETRY_TOPIC` (default: `esp8266/donnees`)
- `MQTT_COMMAND_TOPIC` (default: `esp8266/led`)
- `MQTT_VISION_TOPIC` (default: `sentinel/vision`)
- `VISION_STREAM_URL` (MJPEG stream of the vision script; empty disables the camera)
  If omitted, the local AI MJPEG stream is used. An explicit value always wins.
- `AI_SERVICE_URL` (default `http://127.0.0.1:8001`; empty disables the AI bridge)
- `AI_TIMEOUT_MS` (default `5000`), `AI_POLL_MS` (default `2000`)
- `AI_SERVICE_TOKEN` (optional bearer token, shared with the Python service)
- `TELEMETRY_DATABASE_PATH` (default: `data/telemetry.db`)
- `READINGS_RETENTION_DAYS` (default: `7`; older readings are pruned hourly)
- `SETTINGS_DATABASE_PATH` (default: `data/settings.db`; notification settings)
- `SMTP_HOST`, `SMTP_PORT` (default `587`), `SMTP_SECURE` (`true` for implicit
  TLS, otherwise STARTTLS is required), `SMTP_USER`, `SMTP_PASSWORD`,
  `MAIL_FROM`: mail transport for notifications
- `MAIL_OUTBOX_DIR` (local test mode: e-mails are written there as `.eml`
  files when no `SMTP_HOST` is set)
- `PORT` (default: `3001`)
- `FRONTEND_ORIGINS` (comma-separated; defaults to the local Vite origins)
- `BETTER_AUTH_SECRET` (required, at least 32 characters: `openssl rand -base64 32`)
- `BETTER_AUTH_URL` (public URL of the web interface; defaults to the first
  frontend origin)
- `AUTH_DATABASE_PATH` (default: `data/auth.db`)
- `TRUST_PROXY` (Express `trust proxy` value; default: `loopback`, set to the
  proxy subnet when running behind nginx)
- `TLS_CERT_FILE`, `TLS_KEY_FILE` (serve HTTPS instead of HTTP; used in Docker)
- `MQTT_USERNAME`, `MQTT_PASSWORD` (broker account; use an `mqtts://` URL and
  `NODE_EXTRA_CA_CERTS` for a local CA)
- `PUBLIC_HOSTS`, `PUBLIC_HTTPS_PORT` (production: derive the allowed HTTPS
  origins and `BETTER_AUTH_URL` when `FRONTEND_ORIGINS` is not set)
- `INITIAL_ADMIN_EMAIL`, `INITIAL_ADMIN_PASSWORD_FILE` (first deployment: an
  administrator is created when the account database is empty)

Secrets can be read from files: `BETTER_AUTH_SECRET_FILE`, `AI_SERVICE_TOKEN_FILE`,
`MQTT_PASSWORD_FILE` and `SMTP_PASSWORD_FILE` take precedence over the plain variables.

For example, publish a simulated reading with Mosquitto:

```sh
mosquitto_pub -h 127.0.0.1 -t esp8266/donnees \
  -m '{"temperature":22.5,"humidity":48,"gas":120,"presence":false}'
```

## HTTP API

Better Auth is mounted on `/api/auth/*`. Every other route except
`GET /api/health` requires a session cookie and returns `401` otherwise.

| Route | Description |
| --- | --- |
| `GET /api/status` | MQTT connection state, latest physical-device reading and its time |
| `GET /api/readings?limit=N` | sensor history, newest first (`1 <= N <= 500`) |
| `GET /api/vision` | recent vision detections, newest first |
| `GET /api/stream` | Server-Sent Events: `reading` and `vision` events |
| `GET /api/camera/stream` | MJPEG stream relayed from `VISION_STREAM_URL` |
| `GET /api/ai/status` | AI connectivity, model/camera availability, queue and dropped sample count |
| `GET /api/ai/latest` | fresh live prediction first, otherwise the newest result; `null` before the first result |
| `GET /api/ai/history?limit=N` | persisted AI history, newest first (`1 <= N <= 500`) |
| `POST /api/ai/vision/start` | starts the server PC webcam through the Python service |
| `POST /api/ai/vision/stop` | stops the Python webcam worker |
| `GET /api/ai/vision/faces/status` | facial model availability, local identity catalog and recent face metadata |
| `GET /api/ai/vision/faces/latest` | current recognized/unknown faces and their inference time |
| `GET /api/ai/vision/faces/history` | up to 20 recent face events kept in Python memory |
| `POST /api/ai/vision/faces/reload` | atomically reloads local reference photos without restarting Python |
| `POST /api/ai/vision/faces/enroll` | adds reference photos for a named identity and reloads the facial catalog |
| `POST /api/action` | `{"ordre":"ON"}` or `{"ordre":"OFF"}`, published to the box |
| `GET /api/settings/notifications` | e-mail notification settings and whether mail is configured |
| `PUT /api/settings/notifications` | `{"email":"...","enabled":true,"alerts":{"intrusion":true,"unknown-face":true,"device-offline":true}}` |
| `POST /api/settings/notifications/test` | sends a test e-mail (at most every 30 s) |

Face enrollment accepts JSON `{ "name": "Mohamed", "images": [{ "filename": "photo.jpg", "content_base64": "..." }] }`.
Use canonical padded base64 without a data URL. The limits are 5 photos, 5 MiB
decoded per photo, and 15 MiB decoded overall. Only this endpoint accepts a
21 MiB JSON body, after session authentication; other JSON routes retain their
16 KiB limit. Names are trimmed and normalized to Unicode NFC, up to 64
characters, with letters, numbers, spaces, `_`, `-` and `'`. Path separators,
dots, Windows device names, `Unknown` and `Inconnu` are rejected. Filenames are
display metadata; Python validates JPEG/PNG/WEBP content and saves normalized
photos under generated names. The response is `{ name, added, rejected:
[{ filename, message }], catalog }`, including when all photos are rejected.
Validation/size/model errors return HTTP 400/413/422/503 with `{ message }`.
The browser uses Express; the FastAPI URL and service token stay on the server.

Alerts (intrusion, unknown face, box offline for 30 s) are e-mailed to the
configured address, at most once every 5 minutes per type. Sensor observations
older than the last accepted PIR state, older than 60 seconds, or more than
5 seconds in the future raise no intrusion alert. Simulator telemetry and vision
messages carry `source: "simulation"` and never trigger real notifications.

Telemetry fields are optional. Temperature, humidity, and gas values must be
finite numbers; presence is normalized from a boolean or `0`/`1`. An optional `ts` (epoch seconds)
or `timestamp` (ISO date)
dates the measurement: readings replayed by the box after an outage are stored
at their measurement time and do not overwrite the latest state. Timestamps in
the future or older than the retention period are replaced by the reception
time.

The current ESP8266 firmware sends its measurements over USB. The Python
[serial bridge](../docs/esp-serial.md) publishes them on the same MQTT topic.
Optional boolean fields `climateValid`, `gasReady`, `pirReady`, `gasAlert`,
`alarmActive`, `ledRed`, `ledOrange` and `ledGreen` are preserved in status,
history and SSE. Sensor fields may be absent during warmup; absent flags mean
unknown. USB ingestion is read-only: physical LED commands require a compatible
MQTT firmware.

Public sign-up is disabled: create accounts with
`npm run user:create -- <email> "<name>"` (the password is prompted, or read
from `AUTH_USER_PASSWORD` for scripts). Sign-in is limited to 5 attempts per
minute per client IP. `X-Forwarded-For` is only trusted from `TRUST_PROXY`.

Use `npm test`, `npm run typecheck`, and `npm run build` to validate the backend.

## Local AI integration

Every fresh MQTT sensor reading is stored as before and placed in an ordered,
asynchronous AI queue. The backend posts `{temperature?,humidity?,gas?,presence?,
timestamp,sample_id,source}` to Python `POST /analyze`. The returned anomaly,
vision and risk result is saved in a new `ai_predictions` table in the existing
telemetry database. Sensor history, MQTT commands, face detections, notification
settings and Better Auth continue to use their existing paths.

Sensor history now also persists `source: "live" | "simulation"`. Normal device
ingestion defaults to `live`; demo publishers explicitly send `simulation`.
Simulated readings remain available in history, SSE charts and AI demonstration
results. They do not replace `/api/status` or reset the physical-device heartbeat;
without a physical sample, the ESP status stays unavailable.
AI sample order is checked separately for live data and simulations, with a
5-second future clock tolerance. `/api/ai/latest` gives live sensor results
priority for 30 seconds, using `sensor_timestamp` rather than camera refresh
time. Simulations remain in AI history and SSE, and their isolated vision result
cannot overwrite the canonical webcam/facial status returned by Python polling.
The schema migration leaves older rows without a source (`NULL`), because their
provenance cannot be inferred. Training exports can therefore select only
`source = 'live'` and keep simulations and unknown legacy data out of the model.

The existing authenticated SSE stream now also emits `ai` (the full persisted
prediction) and `ai-status` (the status response). There is no second WebSocket
transport. Polling Python `/status` collects camera changes even when no sensor
sample arrives. Duplicate predictions are ignored. AI errors mark the service
offline; they do not stop MQTT ingestion or produce invented NORMAL/SAFE results.
An untrained model keeps anomaly fields null. Historical/replayed sensor samples
older than 30 seconds are excluded from live inference. The queue holds 32 waiting
samples; overload drops the oldest waiting sample and increments `dropped_samples`.
AI history uses the same retention period as sensor readings.

The dashboard calls only this backend. `/api/camera/stream` relays the annotated
Python MJPEG output behind the existing session cookie; video is never embedded
in SSE messages. The camera connection has an opening timeout, while established
streams stay open.

Use `npm run simulate` for the existing MQTT/fake camera simulator. Its sensor
messages explicitly carry `source: "simulation"`; do not run it against real
production sensor topics. For the progressive ML demonstration and Windows
setup see [the AI README](../ai/README.md).

To use `.env.example` with Node 24 in PowerShell, copy it to `.env`, set a private
`BETTER_AUTH_SECRET`, and run `node --env-file=.env --import tsx src/main.ts`.
The normal npm scripts continue to consume PowerShell environment variables.
