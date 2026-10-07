# Inventaire de l’intégration IA Sentinel-X

Chemins relatifs à la racine du projet. Les dossiers existants du frontend,
du backend et du firmware sont conservés. Cet inventaire porte sur les fichiers
sources et de configuration livrés avec l’intégration.

## Fichiers créés

### Service Python `ai/`

```text
ai/.env.example
ai/.gitignore
ai/README.md
ai/pytest.ini
ai/requirements.txt
ai/requirements-core.txt
ai/requirements-vision.txt
ai/requirements-test.txt
ai/requirements-lock.txt
ai/data/sensor_data.csv
ai/models/.gitkeep
ai/app/__init__.py
ai/app/main.py
ai/app/config.py
ai/app/service.py
ai/app/simulator.py
ai/app/schemas/__init__.py
ai/app/schemas/sensor.py
ai/app/schemas/prediction.py
ai/app/schemas/vision.py
ai/app/anomaly/__init__.py
ai/app/anomaly/preprocessing.py
ai/app/anomaly/trainer.py
ai/app/anomaly/model_manager.py
ai/app/anomaly/detector.py
ai/app/vision/__init__.py
ai/app/vision/camera.py
ai/app/vision/person_detector.py
ai/app/vision/tracker.py
ai/app/fusion/__init__.py
ai/app/fusion/sensor_fusion.py
ai/app/fusion/risk_engine.py
ai/app/integrations/__init__.py
ai/app/integrations/backend_client.py
ai/app/utils/__init__.py
ai/app/utils/logger.py
ai/app/utils/health.py
ai/tests/test_anomaly.py
ai/tests/test_fusion.py
ai/tests/test_api.py
ai/tests/test_vision.py
ai/tests/test_export.py
```

`sensor_data.csv` ne contient que l’en-tête, sans aucune mesure fictive.
Les CSV et modèles de démonstration sont générés uniquement par une commande explicite.

### Backend `iot-backend/`

```text
iot-backend/.env.example
iot-backend/src/domain/ai.ts
iot-backend/src/application/ai-coordinator.ts
iot-backend/src/application/ai-coordinator.test.ts
iot-backend/src/infrastructure/ai/ai-contract.ts
iot-backend/src/infrastructure/ai/http-ai-gateway.ts
iot-backend/src/infrastructure/ai/http-ai-gateway.test.ts
iot-backend/src/infrastructure/persistence/sqlite-ai-repository.ts
iot-backend/src/infrastructure/persistence/sqlite-ai-repository.test.ts
iot-backend/src/presentation/http/routes/ai-routes.ts
iot-backend/src/presentation/http/routes/ai-routes.test.ts
iot-backend/src/testing/ai-fixture.ts
```

### Frontend `iot-frontend/`

```text
iot-frontend/src/domain/ai.ts
iot-frontend/src/infrastructure/http-ai-api.ts
iot-frontend/src/presentation/components/AiPanel.tsx
iot-frontend/src/presentation/components/AiPanel.css
iot-frontend/src/presentation/components/CameraFeed.tsx
iot-frontend/src/presentation/components/CameraFeed.css
iot-frontend/src/presentation/components/VisionControls.tsx
iot-frontend/src/presentation/components/VisionControls.css
iot-frontend/tests/ai.test.ts
iot-frontend/tests/live-feed.test.ts
```

### Installation, intégration et documentation

```text
scripts/setup-windows.ps1
scripts/mosquitto-local.conf
scripts/check-ai-integration.mjs
docs/AI_IMPLEMENTATION.md
docs/AI_FILES.md
```

## Fichiers modifiés

### Backend `iot-backend/`

```text
iot-backend/package.json
iot-backend/README.md
iot-backend/src/main.ts
iot-backend/src/application/ports.ts
iot-backend/src/application/device-state.ts
iot-backend/src/application/alert-detector.ts
iot-backend/src/application/alert-detector.test.ts
iot-backend/src/application/use-cases/record-telemetry.ts
iot-backend/src/domain/telemetry.ts
iot-backend/src/infrastructure/config.ts
iot-backend/src/infrastructure/camera/http-camera-feed.ts
iot-backend/src/infrastructure/messaging/messages.ts
iot-backend/src/infrastructure/messaging/messages.test.ts
iot-backend/src/infrastructure/persistence/sqlite-reading-repository.ts
iot-backend/src/infrastructure/persistence/sqlite-reading-repository.test.ts
iot-backend/src/tools/simulator.ts
iot-backend/src/presentation/http/app.ts
iot-backend/src/presentation/http/routes/live-routes.ts
```

### Frontend `iot-frontend/`

```text
iot-frontend/package.json
iot-frontend/README.md
iot-frontend/src/main.tsx
iot-frontend/src/application/ports.ts
iot-frontend/src/infrastructure/sse-live-feed.ts
iot-frontend/src/presentation/hooks/useLiveData.ts
iot-frontend/src/presentation/App.tsx
iot-frontend/src/presentation/pages/MetricsPage.tsx
iot-frontend/src/presentation/pages/CameraPage.tsx
iot-frontend/src/presentation/pages/CameraPage.css
```

### Racine

```text
.gitignore
README.md
docker-compose.yml
```

Les environnements virtuels, dépendances installées, builds, journaux, bases
SQLite et modèles entraînés sont des artefacts locaux ignorés par Git. Ils
ne figurent pas dans cette liste de fichiers sources.

La liste des ajouts et modifications specifiques a la correction de la webcam
se trouve dans [CAMERA_FIX.md](CAMERA_FIX.md).
