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

```sh
npm install
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
| `GET /api/status` | MQTT connection state, latest reading and its time |
| `GET /api/readings?limit=N` | sensor history, newest first (`1 <= N <= 500`) |
| `GET /api/vision` | recent vision detections, newest first |
| `GET /api/stream` | Server-Sent Events: `reading` and `vision` events |
| `GET /api/camera/stream` | MJPEG stream relayed from `VISION_STREAM_URL` |
| `POST /api/action` | `{"ordre":"ON"}` or `{"ordre":"OFF"}`, published to the box |
| `GET /api/settings/notifications` | e-mail notification settings and whether mail is configured |
| `PUT /api/settings/notifications` | `{"email":"...","enabled":true,"alerts":{"intrusion":true,"unknown-face":true,"device-offline":true}}` |
| `POST /api/settings/notifications/test` | sends a test e-mail (at most every 30 s) |

Alerts (intrusion, unknown face, box offline for 30 s) are e-mailed to the
configured address, at most once every 5 minutes per type. Readings replayed
after an outage raise no alert.

Telemetry fields are optional. Temperature, humidity, and gas values must be
finite numbers; presence must be a boolean. An optional `ts` (epoch seconds)
dates the measurement: readings replayed by the box after an outage are stored
at their measurement time and do not overwrite the latest state. Timestamps in
the future or older than the retention period are replaced by the reception
time.

Public sign-up is disabled: create accounts with
`npm run user:create -- <email> "<name>"` (the password is prompted, or read
from `AUTH_USER_PASSWORD` for scripts). Sign-in is limited to 5 attempts per
minute per client IP. `X-Forwarded-For` is only trusted from `TRUST_PROXY`.

Use `npm test`, `npm run typecheck`, and `npm run build` to validate the backend.
