#include "domain/alarm_state.h"

namespace {
constexpr uint32_t kBlinkPeriodMs = 250;
constexpr uint32_t kBeepPeriodMs = 400;
}  // namespace

bool AlarmState::apply(Command command) {
  switch (command) {
    case Command::AlertLedOn: remoteLed_ = true; return true;
    case Command::AlertLedOff: remoteLed_ = false; return true;
    case Command::BuzzerOn: remoteBuzzer_ = true; return true;
    case Command::BuzzerOff: remoteBuzzer_ = false; return true;
    case Command::AlarmOn: remoteLed_ = remoteBuzzer_ = true; return true;
    case Command::AlarmOff: remoteLed_ = remoteBuzzer_ = false; return true;
    case Command::Unknown: break;
  }
  return false;
}

ActuatorOutputs AlarmState::outputs(uint32_t nowMs, bool online) const {
  const bool blinkPhase = (nowMs / kBlinkPeriodMs) % 2 == 0;
  const bool beepPhase = (nowMs / kBeepPeriodMs) % 2 == 0;
  return {
      online || blinkPhase,
      remoteLed_ || (failsafe_ && blinkPhase),
      (remoteBuzzer_ || failsafe_) && beepPhase,
  };
}
