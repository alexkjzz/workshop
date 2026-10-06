#pragma once

#include <stddef.h>

#include "domain/readings.h"

// Tampon circulaire des mesures prises hors ligne : la plus ancienne est
// ecrasee quand il est plein.
template <size_t Capacity>
class SampleBuffer {
 public:
  void push(const Sample &sample) {
    samples_[(head_ + count_) % Capacity] = sample;
    if (count_ < Capacity) {
      count_++;
    } else {
      head_ = (head_ + 1) % Capacity;
    }
  }

  // A n'appeler que si !empty().
  const Sample &front() const { return samples_[head_]; }

  void pop() {
    head_ = (head_ + 1) % Capacity;
    count_--;
  }

  bool empty() const { return count_ == 0; }
  size_t size() const { return count_; }

 private:
  Sample samples_[Capacity];
  size_t head_ = 0;
  size_t count_ = 0;
};
