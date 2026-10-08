# syntax=docker/dockerfile:1
# Sentinel-X AI service: FastAPI, Isolation Forest, YOLOv8 + ByteTrack, YuNet + SFace.
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_DEFAULT_TIMEOUT=120 \
    PIP_RETRIES=10

# OpenCV runtime libraries.
RUN apt-get update \
 && apt-get install -y --no-install-recommends libgl1 libglib2.0-0 \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-core.txt requirements-vision.txt ./
# CPU-only PyTorch: avoids the multi-gigabyte CUDA build on x86 servers.
# The BuildKit cache keeps downloaded wheels between builds (slow or unstable networks).
RUN --mount=type=cache,target=/root/.cache/pip \
    pip install --index-url https://download.pytorch.org/whl/cpu torch torchvision \
 && pip install -r requirements.txt

COPY app ./app
COPY models ./models
# Model weights are fetched at build time and verified; the container never downloads at runtime.
ADD --checksum=sha256:f59b3d833e2ff32e194b5bb8e08d211dc7c5bdf144b90d2c8412c47ccfc83b36 \
    https://github.com/ultralytics/assets/releases/download/v8.3.0/yolov8n.pt models/yolov8n.pt
RUN python -m app.vision.setup_faces

# Non-root service account; trained model and face catalogue live in volumes.
RUN useradd --uid 10001 --user-group --no-create-home --shell /usr/sbin/nologin sentinel \
 && usermod -aG video sentinel \
 && mkdir -p /app/state /app/known_faces \
 && chown sentinel:sentinel /app/state /app/known_faces \
 && chmod 0644 models/*

ENV HOME=/tmp \
    YOLO_CONFIG_DIR=/tmp/ultralytics \
    MPLCONFIGDIR=/tmp/matplotlib \
    YOLO_AUTOINSTALL=False \
    AI_HOST=0.0.0.0 \
    ANOMALY_MODEL=/app/state/isolation_forest.joblib \
    SENSOR_CSV=/app/state/sensor_data.csv \
    FACE_KNOWN_DIR=/app/known_faces

USER sentinel
EXPOSE 8001
CMD ["python", "-m", "app.main"]
