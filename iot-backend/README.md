# IoT backend

The backend receives sensor telemetry over MQTT and exposes the latest valid
reading through HTTP. The MQTT broker is expected to run locally by default.

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
- `PORT` (default: `3001`)
- `FRONTEND_ORIGINS` (comma-separated; defaults to the local Vite origins)
- `BETTER_AUTH_SECRET` (required, at least 32 characters: `openssl rand -base64 32`)
- `BETTER_AUTH_URL` (public URL of the web interface; defaults to the first
  frontend origin)
- `AUTH_DATABASE_PATH` (default: `data/auth.db`)

For example, publish a simulated reading with Mosquitto:

```sh
mosquitto_pub -h 127.0.0.1 -t esp8266/donnees \
  -m '{"temperature":22.5,"humidity":48,"gas":120,"presence":false}'
```

Telemetry fields are optional. Temperature, humidity, and gas values must be
finite numbers; presence must be a boolean. The server records the most recent
valid message in memory. Better Auth is mounted on `/api/auth/*`. `GET /api/status` and
`POST /api/action` require a session cookie and return `401` otherwise;
`GET /api/health` is public. Public sign-up is disabled: create accounts with
`npm run user:create -- <email> "<name>"` (the password is prompted, or read
from `AUTH_USER_PASSWORD` for scripts). Sign-in is limited to 5 attempts per
minute per client IP. `X-Forwarded-For` is only trusted from a loopback proxy
(the Vite dev server).

`GET /api/status` returns the MQTT connection state,
the receive time, and the latest readings. `POST /api/action` accepts
`{"ordre":"ON"}` or `{"ordre":"OFF"}`.

Use `npm test`, `npm run typecheck`, and `npm run build` to validate the backend.