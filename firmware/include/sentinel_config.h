#pragma once

#include <Arduino.h>

// ======================================================
// SENTINEL-X V2 - ESP8266 NodeMCU
// Configuration extraite de l'ancien main.cpp
// ======================================================

// Broches
#define PIN_DHT         D5
#define PIN_I2C_SDA     D2
#define PIN_I2C_SCL     D1
#define PIN_PIR         D6
#define PIN_BUZZER      D7
#define PIN_GAS         A0
#define PIN_LED_STATUS  D0   // verte
#define PIN_LED_ALERT   D4   // rouge
#define PIN_LED_WARNING D8   // orange

// DHT22
#define DHT_TYPE DHT22

// OLED
#define OLED_WIDTH   128
#define OLED_HEIGHT  64
#define OLED_ADDRESS 0x3C

// Sorties actives HIGH comme dans le code original
#define BUZZER_ON  HIGH
#define BUZZER_OFF LOW
#define GREEN_LED_ON  HIGH
#define GREEN_LED_OFF LOW
#define RED_LED_ON    HIGH
#define RED_LED_OFF   LOW
#define ORANGE_LED_ON  HIGH
#define ORANGE_LED_OFF LOW

// MQ-2 + hysteresis
constexpr int GAS_THRESHOLD_ON  = 600;
constexpr int GAS_THRESHOLD_OFF = 550;

// Intervalles
constexpr uint32_t DHT_INTERVAL_MS     = 2000UL;
constexpr uint32_t GAS_INTERVAL_MS     = 250UL;
constexpr uint32_t DISPLAY_INTERVAL_MS = 300UL;
constexpr uint32_t SERIAL_INTERVAL_MS  = 1000UL;

// Stabilisation
constexpr uint32_t PIR_WARMUP_MS = 45000UL;
constexpr uint32_t GAS_WARMUP_MS = 60000UL;
