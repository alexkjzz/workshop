#pragma once

#include <Arduino.h>

// ======================================================
// SENTINEL-X V2 - ESP8266 NodeMCU
// Configuration extraite de l'ancien main.cpp
// ======================================================

// Broches
#ifndef PIN_DHT
#define PIN_DHT         D5
#endif
#define PIN_I2C_SDA     D2
#define PIN_I2C_SCL     D1
#define PIN_PIR         D6
#define PIN_BUZZER      D7
#define PIN_GAS         A0
#define PIN_LED_STATUS  D0   // verte
#define PIN_LED_ALERT   D4   // rouge
#define PIN_LED_WARNING D8   // orange

// Override only after checking the physical sensor and its wiring.
// PlatformIO build_flags: -DDHT_TYPE=22 -DPIN_DHT=14 (GPIO number, D5 = GPIO14).
#ifndef DHT_TYPE
#define DHT_TYPE DHT22
#endif

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

static_assert(DHT_INTERVAL_MS >= 2000UL, "DHT requires at least 2 s between reads");
static_assert(GAS_THRESHOLD_OFF >= 0 && GAS_THRESHOLD_OFF < GAS_THRESHOLD_ON &&
              GAS_THRESHOLD_ON <= 1023, "Invalid MQ-2 ADC hysteresis thresholds");
