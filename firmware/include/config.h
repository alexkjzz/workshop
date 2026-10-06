#pragma once

#include <Arduino.h>

// Identite du boitier : sert d'identifiant client MQTT et de nom d'hote Wi-Fi.
#ifndef DEVICE_ID
#define DEVICE_ID "sentinel-x-01"
#endif

// --- Cablage (NodeMCU v2) ---------------------------------------------------
// OLED I2C SSD1306 0.96" (adresse 0x3C)
constexpr uint8_t PIN_I2C_SDA = D2;  // GPIO4
constexpr uint8_t PIN_I2C_SCL = D1;  // GPIO5
constexpr uint8_t OLED_ADDRESS = 0x3C;
// Capteurs
constexpr uint8_t PIN_DHT = D5;  // GPIO14, DHT22 (pull-up 10k vers 3V3)
constexpr uint8_t PIN_PIR = D6;  // GPIO12, sortie HC-SR501
constexpr uint8_t PIN_GAS = A0;  // MQ-2 sortie AO via pont diviseur (max 3.3 V sur A0)
// Actionneurs
constexpr uint8_t PIN_BUZZER = D7;      // GPIO13
constexpr uint8_t PIN_LED_STATUS = D0;  // GPIO16, LED verte : liaison MQTTS
constexpr uint8_t PIN_LED_ALERT = D8;   // GPIO15, LED rouge : alerte (pull-down au boot, OK pour une LED)

// true : buzzer piezo passif (pilote par tone), false : buzzer actif (niveau logique)
constexpr bool BUZZER_PASSIVE = true;
constexpr unsigned int BUZZER_FREQUENCY_HZ = 2700;

// --- Cadencement -----------------------------------------------------------
constexpr unsigned long SAMPLE_INTERVAL_MS = 2000;   // le DHT22 ne supporte pas mieux que 0.5 Hz
constexpr unsigned long PUBLISH_INTERVAL_MS = 2000;  // + publication immediate sur changement du PIR
constexpr unsigned long DISPLAY_INTERVAL_MS = 500;
constexpr unsigned long NTP_SYNC_TIMEOUT_MS = 5000;
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

// --- Securite locale (fail-safe independant du serveur) --------------------
// Alarme physique si le gaz depasse ce seuil brut (0-1023), meme sans reseau.
// La detection d'anomalies predictive reste du ressort de l'IA cote serveur.
// 0 desactive le fail-safe.
constexpr int GAS_FAILSAFE_THRESHOLD = 700;
constexpr int GAS_FAILSAFE_HYSTERESIS = 50;
constexpr unsigned long GAS_WARMUP_MS = 60000;  // prechauffage du MQ-2
constexpr uint8_t GAS_SAMPLES = 8;
