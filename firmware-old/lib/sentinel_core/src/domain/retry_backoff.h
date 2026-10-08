#pragma once

#include <stdint.h>

class RetryBackoff {
 public:
  RetryBackoff(
      uint32_t minimum,
      uint32_t maximum
  )
      : minimum_(minimum),
        maximum_(maximum),
        current_(minimum) {}

  bool due(uint32_t now) const {
    return !waiting_ || now - failedAt_ >= delay_;
  }

  uint32_t failed(uint32_t now) {
    failedAt_ = now;
    delay_ = current_;
    current_ = current_ > maximum_ / 2 ? maximum_ : current_ * 2;
    waiting_ = true;
    return delay_;
  }

  void reset() {
    current_ = minimum_;
    waiting_ = false;
  }

 private:
  uint32_t minimum_;
  uint32_t maximum_;

  uint32_t current_;
  uint32_t failedAt_ = 0;
  uint32_t delay_ = 0;
  bool waiting_ = false;
};
