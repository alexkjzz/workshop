import mqtt from 'mqtt';

const client = mqtt.connect('mqtt://127.0.0.1:1883');
let sample = 0;
let interval: ReturnType<typeof setInterval> | undefined;

function publishTelemetry() {
  if (!client.connected) return;
  const telemetry = {
    temperature: 22 + (sample % 10) / 10,
    humidity: 45 + (sample % 8),
    gas: 100 + (sample % 20) * 5,
    presence: sample % 6 < 3,
  };
  sample += 1;
  client.publish('esp8266/donnees', JSON.stringify(telemetry), { qos: 1 }, (error) => {
    if (error) {
      console.error('Publication simulee impossible :', error.message);
      return;
    }
    console.info('Mesure simulee :', JSON.stringify(telemetry));
  });
}

client.on('connect', () => {
  client.subscribe('esp8266/led', { qos: 1 }, (error, granted) => {
    if (error || granted?.some((subscription) => subscription.qos === 128)) {
      console.error('Abonnement LED impossible.');
      client.end(true);
      process.exitCode = 1;
      return;
    }
    console.info('Simulateur MQTT pret.');
    publishTelemetry();
    interval ??= setInterval(publishTelemetry, 2000);
  });
});

client.on('message', (_topic, message) => {
  console.info('Commande LED simulee :', message.toString());
});
client.on('error', (error) => console.error('Erreur MQTT du simulateur :', error.message));

function shutdown() {
  clearInterval(interval);
  client.end(true);
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);