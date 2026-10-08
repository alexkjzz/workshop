# Validation des capteurs et de l'IA

Le firmware USB, la passerelle, Express et FastAPI ont des responsabilités
distinctes. Les LED et le buzzer dépendent du gaz et du PIR dans l'ESP ; le
Risk Engine calcule une analyse de monitoring sur le PC. La reconnaissance
faciale complète YOLO et ByteTrack sans les remplacer.

## Corrections de fiabilité

- Configuration matérielle unique dans `firmware/include/sentinel_config.h`.
  Le démarrage indique le type DHT configuré et sa broche.
- Première lecture DHT après deux secondes ; erreurs explicites sans valeurs
  normales inventées. Préchauffage gaz/PIR conservé après le débordement de
  `millis()` ; états réinitialisés lors d'un nouveau démarrage.
- Vérification de l'acquittement I2C de l'OLED et fonctionnement des alarmes
  même lorsque l'écran est absent.
- Réassemblage des lignes USB fragmentées avec limites de taille et de temps.
  Reconnexion sur l'unique port USB détecté si `--port` n'est pas imposé.
- Les anciens relevés PIR ne réinitialisent plus un état plus récent. Les
  simulations ne remplacent plus l'état physique et n'envoient pas d'alertes.
- Contrôle des canaux capteurs et de l'ordre des mesures avant l'analyse IA.
  Une mesure ignorée ou invalide produit une explication et ne devient pas une
  preuve de fonctionnement normal.
- Les simulations conservent leur provenance et leur analyse ; elles ne sont
  pas fusionnées avec la webcam réelle. Le panneau IA privilégie une analyse
  physique récente, tout en gardant les simulations dans l'historique.

Ces corrections ne calibrent pas les capteurs. `climateValid=true` signifie
que la lecture DHT est exploitable au niveau logiciel, pas que sa valeur a été
confirmée par un instrument indépendant. Le gaz MQ-2 reste un ADC brut de
0 à 1023, sans conversion automatique en ppm.

## Vérifier les 76,8 °C à température ambiante

La lecture `76.8 C / 6.9 %` est transmise telle quelle. Elle se trouve dans les
plages admises par un DHT22 et ne permet pas de déterminer le modèle réellement
branché. Le code utilise déjà des degrés Celsius.

1. Identifier l'inscription du capteur ou la référence de son module.
2. Vérifier que `DHT_TYPE` correspond dans la configuration canonique : DHT22
   reste la valeur par défaut ; choisir DHT11 seulement si le matériel est un
   DHT11. Voir [le guide firmware](../firmware/README.md).
3. Vérifier le câblage avec le schéma du module réellement utilisé, puis comparer
   les mesures stabilisées avec un thermomètre et un hygromètre de référence.
4. Si les lectures restent incohérentes, vérifier le capteur et son alimentation
   avant de collecter des données d'entraînement.

Les alarmes matérielles actuelles concernent **gaz + mouvement**. Une valeur
élevée de température n'est pas, à elle seule, un déclencheur du buzzer dans
ce firmware. L'anomalie environnementale IA nécessite un modèle entraîné.

## Démarrer sous Windows

Après modification du code, arrêter les anciennes instances dans leurs
terminaux avec Ctrl+C avant de les relancer. Le lancement d'une seconde
instance sur 3001, 8001 ou 1883 ne met pas à jour l'instance existante.
Ne pas démarrer de simulateur pendant une validation matérielle.

Dans des terminaux distincts ouverts à la racine du dépôt :

```powershell
# Broker : conserver l'instance existante si elle utilise déjà 1883.
& 'C:\Program Files\mosquitto\mosquitto.exe' -c .\scripts\mosquitto-local.conf -v
```

```powershell
# Backend
Set-Location .\iot-backend
node --env-file=.env --import tsx src/main.ts
```

```powershell
# IA
Set-Location .\ai
.\.venv\Scripts\python.exe -m app.main
```

```powershell
# Frontend
Set-Location .\iot-frontend
npm.cmd run dev -- --host 127.0.0.1
```

```powershell
# Passerelle USB : fermer le moniteur série et toute autre passerelle avant.
.\ai\.venv\Scripts\python.exe scripts\esp_serial_bridge.py --list-ports
.\ai\.venv\Scripts\python.exe scripts\esp_serial_bridge.py
```

En présence de plusieurs cartes USB, ajouter `--port COMx` avec le bon numéro.
Le message « MQTT connecté » confirme uniquement le broker ; attendre aussi
« Port COMx ouvert » puis les lignes `MQTT #...` contenant les mesures.
Un avertissement signale un port ouvert sans bloc valide pendant dix secondes.

Les modifications du firmware doivent être téléversées sur la carte après
vérification du type DHT et des broches. Les vérifications automatiques du
projet compilent le binaire ; elles ne téléversent rien.

## Vérifier le résultat

1. Ouvrir http://127.0.0.1:5173 et se connecter. Attendre la calibration PIR
   (45 s) et le préchauffage logiciel MQ-2 (60 s) après le démarrage de la carte.
   Ce délai logiciel ne remplace pas la stabilisation/calibration matérielle.
2. Comparer les valeurs série, les logs de la passerelle et le dashboard.
   Les trois doivent conserver les valeurs mesurées et les indicateurs du boîtier.
3. Passer devant le PIR : après calibration, présence, alarme et LED rouge
   doivent refléter le firmware. Le frontend n'actionne pas les sorties USB.
4. Démarrer la webcam depuis le dashboard : YOLO détecte les personnes,
   ByteTrack suit les pistes, YuNet/SFace reconnaît les visages si ses modèles
   et les photos de référence sont configurés.
5. Débrancher l'USB : les mesures doivent s'arrêter et devenir périmées, sans
   valeurs normales fictives. Rebrancher : la passerelle retrouve l'unique
   carte USB, même si Windows lui attribue un autre numéro COM.

Le navigateur utilise toujours Express ; aucun appel direct à FastAPI n'est
nécessaire. Les tests d'intégration locaux utilisent leurs propres processus,
bases temporaires et identifiants, sans modifier les services réels.

## Entraîner Isolation Forest

Le modèle de production reste absent tant qu'un entraînement valide n'a pas
été effectué. L'indication « non entraîné » est alors correcte. Ne pas utiliser
les relevés DHT incohérents comme référence de normalité.

Après vérification du matériel, collecter plusieurs conditions normales,
exporter les relevés réels et sélectionner les périodes normales :

```powershell
Set-Location .\ai
.\.venv\Scripts\python.exe -m app.integrations.backend_client --database ..\iot-backend\data\telemetry.db --output data\sensor_data.csv
```

Créer `data/normal_validated.csv` à partir des lignes réellement vérifiées,
avec l'en-tête `timestamp,temperature,humidity,gas,presence`. Il faut au moins
128 valeurs observées par capteur ; plusieurs milliers de mesures
représentatives sont préférables. Puis :

```powershell
.\.venv\Scripts\python.exe -m app.anomaly.trainer --csv data\normal_validated.csv --output models\isolation_forest.joblib
```

Recharger le modèle par la route de service `/model/reload` documentée dans
[ai/README.md](../ai/README.md), ou relancer l'IA dans son terminal. La détection
d'anomalies décrit un écart aux conditions apprises ; elle ne corrige pas une
mesure physique fausse et ne remplace pas les alarmes matérielles.

## Vérifications automatiques

Commandes depuis la racine ; les compilateurs et dépendances doivent être
installés comme indiqué dans les guides du projet :

```powershell
.\ai\.venv\Scripts\python.exe firmware\tests\run_native.py
pio run -d firmware -e nodemcuv2
.\ai\.venv\Scripts\python.exe -m pytest ai\tests -q
.\ai\.venv\Scripts\python.exe -m unittest discover -s scripts\tests -v
npm.cmd --prefix iot-backend test
npm.cmd --prefix iot-backend run typecheck
npm.cmd --prefix iot-backend run build
npm.cmd --prefix iot-frontend test
npm.cmd --prefix iot-frontend run lint
npm.cmd --prefix iot-frontend run build
node scripts\check-ai-integration.mjs
```

Le firmware utilise g++, clang++ ou Zig pour les tests natifs. Les interfaces
matérielles sont simulées ; une compilation réussie ne valide pas le câblage
ni les valeurs physiques du DHT. Aucun nouveau réglage `.env` n'est obligatoire.

## Validation effectuee et fichiers modifies

86 tests IA, 71 backend, 26 frontend et 27 passerelle USB reussis.
Les 10 cas firmware passent dans deux configurations (20 executions).
Compilation ESP8266, typecheck/build backend, lint/build frontend et
integration Express/FastAPI isolee reussis. Cppcheck : aucun defaut
moyen ou eleve. Un avertissement de deprecation Starlette reste dans les tests IA.
Aucun flash, redemarrage des services reels ni entrainement de production effectue.

```text
.github/workflows/ci.yml
README.md
ai/README.md
ai/app/anomaly/detector.py
ai/app/anomaly/preprocessing.py
ai/app/anomaly/trainer.py
ai/app/fusion/sensor_fusion.py
ai/app/integrations/backend_client.py
ai/app/schemas/sensor.py
ai/app/service.py
ai/tests/test_anomaly.py
ai/tests/test_export.py
ai/tests/test_fusion.py
ai/tests/test_ingestion.py
docs/GITHUB.md
docs/VALIDATION_CAPTEURS_IA.md
docs/esp-serial.md
firmware/README.md
firmware/include/config.h
firmware/include/sentinel_config.h
firmware/lib/sentinel_core/src/application/sentinel.cpp
firmware/lib/sentinel_core/src/infrastructure/board_sensors.cpp
firmware/lib/sentinel_core/src/infrastructure/board_sensors.h
firmware/lib/sentinel_core/src/infrastructure/gpio_actuators.cpp
firmware/lib/sentinel_core/src/infrastructure/oled_display.cpp
firmware/lib/sentinel_core/src/infrastructure/oled_display.h
firmware/tests/run_native.py
firmware/tests/stubs/Adafruit_GFX.h
firmware/tests/stubs/Adafruit_SSD1306.h
firmware/tests/stubs/Arduino.h
firmware/tests/stubs/DHT.h
firmware/tests/stubs/Wire.h
firmware/tests/test_firmware.cpp
iot-backend/README.md
iot-backend/src/application/ai-coordinator.test.ts
iot-backend/src/application/ai-coordinator.ts
iot-backend/src/application/alert-detector.test.ts
iot-backend/src/application/alert-detector.ts
iot-backend/src/application/device-state.test.ts
iot-backend/src/application/device-state.ts
iot-backend/src/application/use-cases/record-telemetry.test.ts
iot-backend/src/domain/notification.test.ts
iot-backend/src/domain/notification.ts
iot-backend/src/domain/vision.ts
iot-backend/src/infrastructure/messaging/messages.test.ts
iot-backend/src/infrastructure/messaging/messages.ts
iot-backend/src/tools/simulator.ts
iot-frontend/src/domain/ai.ts
iot-frontend/src/presentation/components/AiPanel.tsx
iot-frontend/tests/ai.test.ts
scripts/check-ai-integration.mjs
scripts/esp_serial_bridge.py
scripts/tests/test_esp_serial_bridge.py
```
