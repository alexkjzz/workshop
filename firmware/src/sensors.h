#pragma once

#include "readings.h"

namespace sensors {

void begin();
// Lit le DHT22 et le MQ-2. A appeler au plus toutes les 2 s.
void sample(Readings &readings);
// Lit le PIR ; renvoie true si l'etat de presence a change.
bool pollPresence(Readings &readings);

}  // namespace sensors
