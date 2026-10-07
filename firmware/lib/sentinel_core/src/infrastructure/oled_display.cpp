#include "infrastructure/oled_display.h"

#include <Adafruit_GFX.h>
#include <Arduino.h>
#include <Wire.h>

void OledDisplay::begin() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  Wire.setClock(100000);

  connected_ = display_.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (!connected_) {
    Serial.println(F("OLED : NON DETECTE"));
    return;
  }
  // Tourner l'écran de 180 degrés
  display_.setRotation(2);

  Serial.println(F("OLED : OK"));
  display_.clearDisplay();
  display_.setTextColor(SSD1306_WHITE);
  display_.drawRect(0, 0, 128, 64, SSD1306_WHITE);
  display_.setTextSize(2);
  display_.setCursor(10, 8);
  display_.println(F("SENTINEL"));
  display_.setCursor(48, 25);
  display_.println(F("X"));
  display_.setTextSize(1);
  display_.setCursor(20, 44);
  display_.print(F("SECURITY SYSTEM"));
  display_.setCursor(35, 54);
  display_.print(F("BOOTING..."));
  display_.display();
}

void OledDisplay::render(const Readings &r, const DeviceStatus &s) {
  if (!connected_) return;

  display_.clearDisplay();
  display_.setTextColor(SSD1306_WHITE);
  display_.setTextSize(1);

  display_.setCursor(0, 0);
  display_.print(F("SENTINEL-X"));
  display_.setCursor(104, 0);
  if (s.alarmActive) display_.print(F("AL!"));
  else if (!s.systemReady) display_.print(F("..."));
  else display_.print(F("OK"));
  display_.drawLine(0, 9, 127, 9, SSD1306_WHITE);

  display_.setCursor(0, 13);
  display_.print(F("T"));
  if (r.climateValid) {
    display_.setTextSize(2);
    display_.setCursor(10, 11);
    display_.print(r.temperature, 1);
    display_.setTextSize(1);
    display_.print(F("C"));
  } else {
    display_.setCursor(10, 15);
    display_.print(F("--.-C"));
  }

  display_.setTextSize(1);
  display_.setCursor(72, 13);
  display_.print(F("H"));
  if (r.climateValid) {
    display_.setTextSize(2);
    display_.setCursor(82, 11);
    display_.print(static_cast<int>(r.humidity));
    display_.setTextSize(1);
    display_.print(F("%"));
  } else {
    display_.setCursor(82, 15);
    display_.print(F("--%"));
  }

  display_.drawLine(0, 29, 127, 29, SSD1306_WHITE);
  display_.setTextSize(1);
  display_.setCursor(0, 33);
  display_.print(F("GAS "));
  if (!s.gasReady) display_.print(F("WARM"));
  else if (s.gasAlert) display_.print(F("DANGER"));
  else display_.print(F("SAFE"));

  display_.setCursor(100, 33);
  display_.print(r.gas);

  constexpr int barX = 0;
  constexpr int barY = 43;
  constexpr int barWidth = 80;
  constexpr int barHeight = 7;
  display_.drawRect(barX, barY, barWidth, barHeight, SSD1306_WHITE);

  const int gasLimited = constrain(r.gas, 0, 1023);
  const int gasBarValue = map(gasLimited, 0, 1023, 0, barWidth - 2);
  if (gasBarValue > 0) {
    display_.fillRect(barX + 1, barY + 1, gasBarValue, barHeight - 2, SSD1306_WHITE);
  }

  const int thresholdX = map(GAS_THRESHOLD_ON, 0, 1023, barX + 1, barX + barWidth - 1);
  display_.drawLine(thresholdX, barY - 1, thresholdX, barY + barHeight, SSD1306_WHITE);

  display_.setCursor(85, 43);
  if (!s.pirReady) display_.print(F("PIR..."));
  else if (s.motionDetected) display_.print(F("MOVE!"));
  else display_.print(F("PIR OK"));

  display_.drawLine(0, 52, 127, 52, SSD1306_WHITE);
  display_.setCursor(0, 55);

  if (s.gasAlert && s.motionDetected) {
    if ((millis() / 300) % 2) display_.print(F("!! GAS + MOTION !!"));
  } else if (s.gasAlert) {
    if ((millis() / 300) % 2) display_.print(F("!!! GAS ALERT !!!"));
  } else if (s.motionDetected) {
    if ((millis() / 300) % 2) display_.print(F("!! MOTION ALERT !!"));
  } else if (!s.systemReady) {
    display_.print(F("STARTING"));
    const int animation = (millis() / 400) % 4;
    for (int i = 0; i < animation; ++i) display_.print('.');
  } else if (!r.climateValid) {
    display_.print(F("DHT SENSOR ERROR"));
  } else {
    display_.print(F("SYSTEM SAFE"));
  }

  display_.display();
}
