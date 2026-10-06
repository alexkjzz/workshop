# IoT backend

The backend receives sensor telemetry over MQTT and exposes the latest valid
reading through HTTP. The MQTT broker is expected to run locally by default.

## Run

```sh
npm install
npm run dev
```

Configuration is read from environment variables:

- `MQTT_URL` (default: `mqtt://127.0.0.1:1883`)
- `MQTT_TELEMETRY_TOPIC` (default: `esp8266/donnees`)
- `MQTT_COMMAND_TOPIC` (default: `esp8266/led`)
- `PORT` (default: `3001`)
- `FRONTEND_ORIGINS` (comma-separated; defaults to the local Vite origins)

For example, publish a simulated reading with Mosquitto:

```sh
mosquitto_pub -h 127.0.0.1 -t esp8266/donnees \
  -m '{"temperature":22.5,"humidity":48,"gas":120,"presence":false}'
```

Telemetry fields are optional. Temperature, humidity, and gas values must be
finite numbers; presence must be a boolean. The server records the most recent
valid message in memory. `GET /api/status` returns the MQTT connection state,
the receive time, and the latest readings. `POST /api/action` accepts
`{"ordre":"ON"}` or `{"ordre":"OFF"}`.

Use `npm test`, `npm run typecheck`, and `npm run build` to validate the backend.