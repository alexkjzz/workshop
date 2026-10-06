#pragma once

#include <stdint.h>

// Securite locale : alarme si le gaz depasse un seuil, meme sans reseau.
// Hysteresis pour eviter le battement, ignoree pendant le prechauffage du MQ-2.
// La detection d'anomalies predictive reste du ressort de l'IA cote serveur.
class GasFailsafe {
 public:
  // threshold <= 0 desactive le fail-safe.
  GasFailsafe(int threshold, int hysteresis, uint32_t warmupMs);

  // Renvoie l'etat de l'alarme apres prise en compte de la mesure.
  bool update(int gas, uint32_t nowMs);
  bool active() const { return active_; }

 private:
  const int threshold_;
  const int hysteresis_;
  const uint32_t warmupMs_;
  bool warmedUp_ = false;
  bool active_ = false;
};
