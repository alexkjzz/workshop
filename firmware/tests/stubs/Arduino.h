#pragma once

#include <array>
#include <cstdarg>
#include <cstdint>
#include <cstdio>
#include <iomanip>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#define F(value) value
constexpr uint8_t HIGH = 1, LOW = 0, INPUT = 0, OUTPUT = 1;
constexpr uint8_t D0 = 16, D1 = 5, D2 = 4, D3 = 0, D4 = 2;
constexpr uint8_t D5 = 14, D6 = 12, D7 = 13, D8 = 15, A0 = 17;

namespace fake {
inline uint32_t now = 0;
inline int adc = 0;
inline std::array<int, 18> levels{};
inline std::vector<std::pair<char, int>> gpioCalls;
}

inline uint32_t millis() { return fake::now; }
inline void pinMode(uint8_t pin, uint8_t) { fake::gpioCalls.emplace_back('m', pin); }
inline void digitalWrite(uint8_t pin, uint8_t level) {
  fake::levels.at(pin) = level;
  fake::gpioCalls.emplace_back('w', pin);
}
inline int digitalRead(uint8_t pin) { return fake::levels.at(pin); }
inline int analogRead(uint8_t) { return fake::adc; }
inline void delayMicroseconds(unsigned int) {}
inline int constrain(int value, int minimum, int maximum) {
  return value < minimum ? minimum : value > maximum ? maximum : value;
}
inline long map(long value, long fromMin, long fromMax, long toMin, long toMax) {
  return (value - fromMin) * (toMax - toMin) / (fromMax - fromMin) + toMin;
}

class FakePrint {
 public:
  std::string text;
  void print(const char *value) { text += value; }
  void print(char value) { text += value; }
  template <typename T> void print(T value) { text += std::to_string(value); }
  void print(float value, int decimals) {
    std::ostringstream stream;
    stream << std::fixed << std::setprecision(decimals) << value;
    text += stream.str();
  }
  void println() { text += '\n'; }
  template <typename T> void println(T value) { print(value); println(); }
  void printf(const char *format, ...) {
    char buffer[512];
    va_list args;
    va_start(args, format);
    std::vsnprintf(buffer, sizeof(buffer), format, args);
    va_end(args);
    text += buffer;
  }
};
inline FakePrint Serial;
