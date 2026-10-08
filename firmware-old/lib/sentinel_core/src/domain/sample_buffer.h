#pragma once

#include <stddef.h>

#include "domain/readings.h"

// Tampon circulaire des mesures prises hors ligne : la plus ancienne est
// ecrasee quand il est plein.
template <size_t Capacity>
class SampleBuffer {
  static_assert(Capacity > 0, "Le tampon doit avoir une capacite positive");

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
    if (empty()) return;
    head_ = (head_ + 1) % Capacity;
    count_--;
  }

  bool empty() const { return count_ == 0; }
  bool full() const { return count_ == Capacity; }
  size_t size() const { return count_; }
  void clear() { head_ = count_ = 0; }

 private:
  Sample samples_[Capacity];
  size_t head_ = 0;
  size_t count_ = 0;
};
