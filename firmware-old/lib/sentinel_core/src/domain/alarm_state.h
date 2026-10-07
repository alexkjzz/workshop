#pragma once

#include <stdint.h>

#include "domain/command.h"

struct ActuatorOutputs {
  bool statusLed;   // verte : capteurs prets et valides, aucune alarme
  bool alertLed;    // rouge : alarme locale ou commande distante
  bool buzzer;      // continu en alarme locale, intermittent sur commande distante
  bool warningLed;  // orange : prechauffage ou erreur capteur, sans alarme
};

// Etat des alarmes : gaz/PIR locaux + commandes distantes.
class AlarmState {
 public:
  // Renvoie false si la commande est inconnue.
  bool apply(Command command);
  void setFailsafe(bool active) { failsafe_ = active; }
  void setMotion(bool active) { motion_ = active; }
  bool active() const { return remoteLed_ || remoteBuzzer_ || failsafe_ || motion_; }
  // Sorties a appliquer a l'instant donne (clignotements cadences par le temps).
  ActuatorOutputs outputs(uint32_t nowMs, bool systemReady, bool sensorsValid) const;

 private:
  bool remoteLed_ = false;
  bool remoteBuzzer_ = false;
  bool failsafe_ = false;
  bool motion_ = false;
};
