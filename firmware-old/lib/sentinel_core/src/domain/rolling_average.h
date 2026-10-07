#pragma once

#include <stddef.h>
#include <stdint.h>

template <size_t N>
class RollingAverage {
  static_assert(N > 0, "La fenetre ADC ne peut pas etre vide");

 public:
  void clear() {
    index_ = 0;
    count_ = 0;
    total_ = 0;

    for (size_t i = 0; i < N; i++) {
      values_[i] = 0;
    }
  }

  void add(uint16_t value) {
    if (count_ < N) {
      values_[index_] = value;
      total_ += value;

      count_++;

    } else {
      total_ -= values_[index_];

      values_[index_] = value;

      total_ += value;
    }

    index_++;

    if (index_ >= N) {
      index_ = 0;
    }
  }

  uint16_t value() const {
    if (count_ == 0) {
      return 0;
    }

    return static_cast<uint16_t>(
        total_ / count_
    );
  }

 private:
  uint16_t values_[N]{};

  size_t index_ = 0;
  size_t count_ = 0;

  uint32_t total_ = 0;
};
