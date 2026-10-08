#pragma once

#include <Arduino.h>

// L'environnement nodemcuv2-local desactive explicitement le reseau.
#ifndef SENTINEL_NETWORK_ENABLED
#define SENTINEL_NETWORK_ENABLED 1
#endif

// Identite du boitier : sert d'identifiant client MQTT et de nom d'hote Wi-Fi.
#ifndef DEVICE_ID
#define DEVICE_ID "sentinel-x-01"
#endif

// --- Cablage (NodeMCU v2) ---------------------------------------------------
// OLED I2C SSD1306 0.96" (adresse 0x3C)
constexpr uint8_t PIN_I2C_SDA = D2;  // GPIO4
constexpr uint8_t PIN_I2C_SCL = D1;  // GPIO5
constexpr uint8_t OLED_ADDRESS = 0x3C;
constexpr uint16_t OLED_WIDTH = 128;
constexpr uint16_t OLED_HEIGHT = 64;
// Capteurs
constexpr uint8_t PIN_DHT = D5;  // GPIO14, DHT22 (pull-up 10k vers 3V3)
constexpr uint8_t PIN_PIR = D6;  // GPIO12, sortie HC-SR501
constexpr uint8_t PIN_GAS = A0;  // MQ-2 AO : adapter la tension a l'ADC de la carte
// Actionneurs
constexpr uint8_t PIN_BUZZER = D7;      // GPIO13
constexpr uint8_t PIN_LED_STATUS = D0;   // GPIO16, LED verte externe : capteurs prets
constexpr uint8_t PIN_LED_ALERT = D4;    // GPIO2, LED rouge externe : alarme
constexpr uint8_t PIN_LED_WARNING = D8;  // GPIO15, LED orange externe : attente/erreur
// true uniquement pour utiliser la LED integree D4 (active a LOW).
constexpr bool LED_ALERT_ACTIVE_LOW = false;

// true : buzzer piezo passif (pilote par tone), false : buzzer actif (niveau logique)
constexpr bool BUZZER_PASSIVE = false;  // sketch fourni : buzzer actif commande HIGH/LOW
constexpr unsigned int BUZZER_FREQUENCY_HZ = 2700;

// --- Cadencement -----------------------------------------------------------
constexpr unsigned long SAMPLE_INTERVAL_MS = 2000;   // le DHT22 ne supporte pas mieux que 0.5 Hz
constexpr unsigned long GAS_INTERVAL_MS = 250;
constexpr unsigned long GAS_ADC_INTERVAL_MS = 5;
constexpr unsigned long PUBLISH_INTERVAL_MS = 2000;  // + publication immediate sur changement du PIR
constexpr unsigned long DISPLAY_INTERVAL_MS = 300;
constexpr unsigned long SERIAL_INTERVAL_MS = 1000;
constexpr unsigned long PIR_WARMUP_MS = 45000;
constexpr unsigned long NTP_SYNC_TIMEOUT_MS = 5000;
constexpr unsigned long OLED_RETRY_INTERVAL_MS = 5000;
constexpr unsigned long MQTT_RETRY_MIN_MS = 2000;
constexpr unsigned long MQTT_RETRY_MAX_MS = 30000;

// --- MQTT ------------------------------------------------------------------
// Topics alignes sur iot-backend (config.ts).
constexpr const char *MQTT_TELEMETRY_TOPIC = "esp8266/donnees";
constexpr const char *MQTT_COMMAND_TOPIC = "esp8266/led";
// Etat du boitier, retenu : "online" a la connexion, "offline" via le Last Will.
constexpr const char *MQTT_STATUS_TOPIC = "esp8266/status";
constexpr uint16_t MQTT_BUFFER_SIZE = 512;
constexpr uint16_t MQTT_KEEPALIVE_S = 15;
constexpr uint16_t MQTT_SOCKET_TIMEOUT_S = 1;
// Mesures rejouees par tour de loop() apres une coupure (taille du tampon :
// kOfflineBufferSize dans lib/sentinel_core/src/application/sentinel.h).
constexpr uint8_t REPLAY_BATCH = 5;

// --- Securite locale (fail-safe independant du serveur) --------------------
// Alarme physique si le gaz depasse ce seuil brut (0-1023), meme sans reseau
// (voir GasFailsafe). 0 desactive le fail-safe.
constexpr int GAS_FAILSAFE_THRESHOLD = 600;
constexpr int GAS_FAILSAFE_HYSTERESIS = 50;
constexpr unsigned long GAS_WARMUP_MS = 60000;  // prechauffage du MQ-2
constexpr uint8_t GAS_SAMPLES = 8;

static_assert(SAMPLE_INTERVAL_MS >= 2000, "Le DHT22 exige au moins 2 s entre lectures");
static_assert(GAS_ADC_INTERVAL_MS >= 5 && GAS_INTERVAL_MS >= GAS_ADC_INTERVAL_MS,
              "Respecter la cadence ADC ESP8266");
static_assert(PUBLISH_INTERVAL_MS > 0 && DISPLAY_INTERVAL_MS > 0 && SERIAL_INTERVAL_MS > 0,
              "Les intervalles doivent etre positifs");
static_assert(MQTT_RETRY_MIN_MS > 0 && MQTT_RETRY_MIN_MS <= MQTT_RETRY_MAX_MS,
              "Backoff MQTT invalide");
static_assert(REPLAY_BATCH > 0 && GAS_SAMPLES > 0, "Les lots ne peuvent pas etre vides");
static_assert(GAS_FAILSAFE_THRESHOLD >= 0 && GAS_FAILSAFE_THRESHOLD <= 1023
                  && GAS_FAILSAFE_HYSTERESIS >= 0
                  && (GAS_FAILSAFE_THRESHOLD == 0 || GAS_FAILSAFE_HYSTERESIS <= GAS_FAILSAFE_THRESHOLD),
              "Seuils gaz hors plage ADC");
