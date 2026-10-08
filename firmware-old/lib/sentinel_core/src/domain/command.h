#pragma once

#include <stddef.h>

// Commandes recues du superviseur (texte, insensible a la casse).
enum class Command {
  AlertLedOn,   // "ON" : contrat actuel du dashboard
  AlertLedOff,  // "OFF"
  BuzzerOn,     // "BUZZER_ON"
  BuzzerOff,    // "BUZZER_OFF"
  AlarmOn,      // "ALARM_ON" : LED + buzzer
  AlarmOff,     // "ALARM_OFF"
  Unknown,
};

Command parseCommand(const char *payload, size_t length);
