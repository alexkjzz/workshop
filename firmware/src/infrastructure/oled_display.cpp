#include "infrastructure/oled_display.h"

#include <Adafruit_GFX.h>
#include <Adafruit_SSD1306.h>
#include <ESP8266WiFi.h>
#include <Wire.h>

#include "config.h"

namespace {

Adafruit_SSD1306 oled(128, 64, &Wire, -1);

const char *linkLabel(LinkState link) {
  switch (link) {
    case LinkState::WifiConnecting: return "WIFI...";
    case LinkState::BrokerConnecting: return "MQTTS...";
    case LinkState::Online: return "MQTTS OK";
  }
  return "";
}

}  // namespace

void OledDisplay::begin() {
  Wire.begin(PIN_I2C_SDA, PIN_I2C_SCL);
  available_ = oled.begin(SSD1306_SWITCHCAPVCC, OLED_ADDRESS);
  if (!available_) {
    Serial.println(F("[OLED] ecran introuvable, affichage desactive"));
    return;
  }
  oled.clearDisplay();
  oled.setTextColor(SSD1306_WHITE);
  oled.setTextSize(2);
  oled.setCursor(4, 16);
  oled.print(F("SENTINEL-X"));
  oled.setTextSize(1);
  oled.setCursor(4, 44);
  oled.print(F("AetherCorp - boot"));
  oled.display();
}

void OledDisplay::render(const Readings &readings, LinkState link, bool alarm) {
  if (!available_) {
    return;
  }
  const char *label = linkLabel(link);
  oled.clearDisplay();
  oled.setTextSize(1);

  oled.setCursor(0, 0);
  oled.print(F("SENTINEL-X"));
  oled.setCursor(128 - 6 * strlen(label), 0);
  oled.print(label);
  oled.drawFastHLine(0, 10, 128, SSD1306_WHITE);

  oled.setCursor(0, 14);
  if (WiFi.status() == WL_CONNECTED) {
    oled.printf("%s %ddBm", WiFi.localIP().toString().c_str(), WiFi.RSSI());
  } else {
    oled.print(F("WiFi: connexion..."));
  }

  oled.setCursor(0, 26);
  if (readings.climateValid) {
    oled.printf("T %.1fC  H %.0f%%", readings.temperature, readings.humidity);
  } else {
    oled.print(F("T --.-C  H --%"));
  }

  oled.setCursor(0, 38);
  oled.printf("GAZ %4d  PIR %s", readings.gas, readings.presence ? "OUI" : "non");

  if (alarm) {
    oled.fillRect(0, 50, 128, 14, SSD1306_WHITE);
    oled.setTextColor(SSD1306_BLACK);
    oled.setCursor(31, 53);
    oled.print(F("!! ALERTE !!"));
    oled.setTextColor(SSD1306_WHITE);
  } else {
    oled.setCursor(0, 53);
    oled.print(F("Statut: NORMAL"));
  }

  oled.display();
}

