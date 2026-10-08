#pragma once

#include <stddef.h>

#include "application/ports.h"

size_t buildTelemetryPayload(
    const Sample &sample,
    const char *deviceId,
    int rssi,
    char *output,
    size_t capacity
);