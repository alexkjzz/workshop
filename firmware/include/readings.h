#pragma once

struct Readings {
  float temperature = 0;
  float humidity = 0;
  bool climateValid = false;  // false si la derniere lecture DHT22 a echoue
  int gas = 0;                // valeur brute ADC 0-1023
  bool presence = false;
};
