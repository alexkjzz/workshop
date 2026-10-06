#pragma once

namespace actuators {

void begin();
// Applique une commande recue sur le topic de commande. Renvoie false si inconnue.
bool handleCommand(const char *command);
void setFailsafeAlarm(bool active);
// Pilote les clignotements et le buzzer ; a appeler a chaque tour de loop().
void loop(unsigned long now, bool online);
bool alarmActive();

}  // namespace actuators
