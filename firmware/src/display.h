#pragma once

#include "readings.h"

namespace display {

void begin();
// linkLabel : etat de la liaison (ex. "WIFI...", "MQTTS OK").
void render(const Readings &readings, const char *linkLabel, bool alarm);

}  // namespace display
