#include "domain/command.h"

#include <ctype.h>
#include <string.h>

namespace {

struct Entry {
  const char *text;
  Command command;
};

constexpr Entry kCommands[] = {
    {"ON", Command::AlertLedOn},          {"OFF", Command::AlertLedOff},
    {"BUZZER_ON", Command::BuzzerOn},     {"BUZZER_OFF", Command::BuzzerOff},
    {"ALARM_ON", Command::AlarmOn},       {"ALARM_OFF", Command::AlarmOff},
};
constexpr size_t kMaxLength = 31;

}  // namespace

Command parseCommand(const char *payload, size_t length) {
  if (!payload || length == 0 || length > 128) return Command::Unknown;
  // Un message MQTT n'est pas une chaine C : refuser les NUL internes.
  if (memchr(payload, '\0', length)) return Command::Unknown;
  // Espaces de bordure retires, puis majuscules.
  size_t start = 0;
  while (start < length && isspace(static_cast<unsigned char>(payload[start]))) start++;
  while (length > start && isspace(static_cast<unsigned char>(payload[length - 1]))) length--;
  if (length - start > kMaxLength) return Command::Unknown;

  char normalized[kMaxLength + 1];
  size_t size = 0;
  for (size_t i = start; i < length; i++) {
    normalized[size++] = static_cast<char>(toupper(static_cast<unsigned char>(payload[i])));
  }
  normalized[size] = '\0';

  for (const Entry &entry : kCommands) {
    if (strcmp(normalized, entry.text) == 0) return entry.command;
  }
  return Command::Unknown;
}
