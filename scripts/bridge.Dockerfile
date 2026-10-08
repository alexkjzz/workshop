# syntax=docker/dockerfile:1
# Sentinel-X USB bridge: reads the ESP8266 serial blocks, publishes over MQTTS.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PIP_NO_CACHE_DIR=1 PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app
COPY requirements-esp.txt ./
RUN pip install -r requirements-esp.txt
COPY esp_serial_bridge.py ./
# Non-root account allowed to open serial devices (dialout).
RUN useradd --uid 10002 --user-group --no-create-home --shell /usr/sbin/nologin bridge \
 && usermod -aG dialout bridge
USER bridge
ENTRYPOINT ["python", "/app/esp_serial_bridge.py"]
