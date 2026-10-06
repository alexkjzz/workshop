#pragma once

#include <stdint.h>

#include "domain/command.h"

struct ActuatorOutputs {
  bool statusLed;  // verte : fixe si en ligne, clignotante sinon
  bool alertLed;   // rouge : fixe sur commande, clignotante sur fail-safe
  bool buzzer;     // intermittent
};

// Etat des alarmes : commandes distantes + fail-safe local.
class AlarmState {
 public:
  // Renvoie false si la commande est inconnue.
  bool apply(Command command);
  void setFailsafe(bool active) { failsafe_ = active; }
  bool active() const { return remoteLed_ || remoteBuzzer_ || failsafe_; }
  // Sorties a appliquer a l'instant donne (clignotements cadences par le temps).
  ActuatorOutputs outputs(uint32_t nowMs, bool online) const;

 private:
  bool remoteLed_ = false;
  bool remoteBuzzer_ = false;
  bool failsafe_ = false;
};
