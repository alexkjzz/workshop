#pragma once

#include <stdint.h>

struct Readings {
  float temperature = 0;
  float humidity = 0;
  bool climateValid = false;  // false si la derniere lecture DHT22 a echoue
  int gas = 0;                // valeur brute ADC 0-1023
  bool presence = false;
  bool gasValid = false;       // exploitable uniquement apres prechauffage
  bool presenceValid = false;  // exploitable uniquement apres stabilisation PIR

  bool anyValid() const { return climateValid || gasValid || presenceValid; }
};

// Mesure horodatee, prete a etre publiee ou mise en tampon.
struct Sample {
  uint32_t timestamp = 0;  // epoch en secondes, 0 si l'horloge n'est pas synchronisee
  Readings readings;
};
