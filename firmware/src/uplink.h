#pragma once

#include "readings.h"

namespace uplink {

using CommandHandler = void (*)(const char *command);

void begin(CommandHandler onCommand);
// Maintient Wi-Fi et MQTTS (reconnexion non bloquante avec backoff).
void loop();
bool online();
// Libelle court pour l'ecran OLED.
const char *stateLabel();
bool publishTelemetry(const Readings &readings);

}  // namespace uplink
