#pragma once

// Etat local du boitier, distinct des mesures envoyees au backend.
struct DeviceStatus {
  bool pirReady = false;
  bool gasReady = false;
  bool gasAlert = false;
  bool alarmActive = false;

  bool systemReady() const { return pirReady && gasReady; }
};
