# ESP8266 USB -> MQTT

Le firmware actuel mesure les capteurs et commande lui-même les LED et le
buzzer. Il imprime son état sur USB toutes les secondes. La passerelle lit
ces blocs sans envoyer de commandes au matériel, puis publie vers le broker
MQTT utilisé par Express. Le navigateur continue de communiquer avec Express.

Depuis la racine du projet, installer les deux dépendances légères :

```powershell
.\ai\.venv\Scripts\python.exe -m pip install -r scripts\requirements-esp.txt
.\ai\.venv\Scripts\python.exe scripts\esp_serial_bridge.py --list-ports
```

Fermer **PlatformIO Device Monitor**, Arduino Serial Monitor et toute autre
application utilisant le port : un port COM Windows est exclusif. Dans deux
terminaux distincts, démarrer le broker puis la passerelle :

```powershell
mosquitto -c scripts\mosquitto-local.conf -v
```

Si Mosquitto est deja actif sur le port 1883, conserver cette instance. Sous
Windows, si la commande n'est pas dans le PATH :

```powershell
& 'C:\Program Files\mosquitto\mosquitto.exe' -c scripts\mosquitto-local.conf -v
```

```powershell
.\ai\.venv\Scripts\python.exe scripts\esp_serial_bridge.py
```

Pour imposer un port, ajouter `--port COMx` avec le résultat de `--list-ports`.
Sans `--port`, la sélection est
automatique seulement lorsqu'un seul port USB plausible existe ; les ports
Bluetooth sont exclus. Elle est refaite après une déconnexion, même si Windows
change le numéro COM. Un port imposé n'est jamais remplacé silencieusement par
une autre carte. Le débit par défaut est **115200 bauds**.

La configuration par défaut est `127.0.0.1:1883`, topic `esp8266/donnees`,
identifiant `sentinel-x-01`. Si le backend utilise d'autres valeurs :

```powershell
.\ai\.venv\Scripts\python.exe scripts\esp_serial_bridge.py --port COM7 --baud 115200 --mqtt-host 127.0.0.1 --mqtt-port 1883 --mqtt-topic esp8266/donnees --device sentinel-x-01
```

Cette passerelle vise le broker local TCP du projet, sans authentification ni
TLS : le broker doit rester limité à la machine locale.

En production Docker, le service `bridge` lance cette passerelle
automatiquement, en MQTTS vers le broker authentifié. Hors Docker, les options
`--mqtt-ca`, `--mqtt-username` et `--mqtt-password-file` activent TLS et
l'authentification (voir [le déploiement](DEPLOIEMENT.md)).

Pour un diagnostic limité à cinq envois, utiliser `--max-messages 5`.
**Ctrl+C** ferme le port et la connexion MQTT. L'ouverture d'un port USB peut
réinitialiser certaines cartes selon leur pilote ; la passerelle laisse les
lignes DTR/RTS inactives et ne transmet aucun ordre série.

## Données transmises

Seuls les blocs complets `========= SENTINEL-X =========` ...
`==============================` sont acceptés. Les valeurs malformées,
doublons, blocs tronqués ou dépassant trois secondes sont ignorés. Les logs
de démarrage et de mouvement hors blocs sont ignorés.
Les lignes USB fragmentées par les délais de lecture sont réassemblées ; une
ligne reste limitée à 256 octets et trois secondes. Un port ouvert sans bloc
valide pendant dix secondes produit un avertissement, puis au plus un toutes
les trente secondes. Une connexion MQTT seule ne prouve pas la réception USB.

Exemple après préchauffage :

```json
{
  "source": "live",
  "device": "sentinel-x-01",
  "ts": 1791370000.5,
  "temperature": 24.4,
  "humidity": 61.1,
  "gas": 40,
  "presence": true,
  "climateValid": true,
  "gasReady": true,
  "pirReady": true,
  "gasAlert": false,
  "alarmActive": true,
  "ledRed": true,
  "ledOrange": false,
  "ledGreen": false
}
```

`ts` correspond à la réception du bloc par le PC, en secondes Unix. Les LED
et alarmes reflètent les états imprimés par le firmware. Le gaz est une
valeur ADC brute **0 à 1023**, pas une concentration en ppm.

- DHT en `ERREUR` : `climateValid=false`, température et humidité omises.
- Gaz en `CHAUFFE` : `gasReady=false`, valeur de gaz omise.
- PIR en `CALIBRATION` : `pirReady=false`, présence omise.
- Tous les capteurs indisponibles : seuls les huit indicateurs booléens sont
  envoyés ; aucune valeur normale fictive n'est ajoutée.

La passerelle reconnecte automatiquement USB et MQTT. Elle conserve au plus
le dernier bloc, pendant **deux secondes**, et un paquet MQTT en cours. Les
messages expirés sont abandonnés ; aucun historique hors ligne n'est rejoué
et l'horodatage n'est jamais rafraîchi lors d'une reconnexion. À l'ouverture du
port, les octets précédemment en attente sont écartés.

MQTT utilise **QoS 0**, sans message retenu : un message perdu n'est pas
réémis. Le compteur des logs indique les paquets écrits par le client MQTT ;
il ne constitue pas un accusé de réception du backend.

## Vérification

Express doit etre relance une fois apres ces changements pour charger les
nouveaux champs et appliquer la migration SQLite qui preserve l'historique.
Si vous le demarrez manuellement, Ctrl+C dans son terminal puis, depuis la racine :

```powershell
Set-Location .\iot-backend
node --env-file=.env --import tsx src/main.ts
```

Frontend, dans un autre terminal ouvert a la racine :

```powershell
Set-Location .\iot-frontend
npm.cmd run dev -- --host 127.0.0.1
```

Conserver les instances deja actives. Une instance Vite en mode developpement
charge automatiquement les changements. Ouvrir http://127.0.0.1:5173 et se
connecter avec le compte habituel. Les routes `/api/status`, `/api/readings` et
`/api/stream` restent authentifiees ; le navigateur ne contacte ni MQTT ni Python.

Lancer les services habituels Express, IA et frontend, puis connecter la carte
avec le firmware USB actuel. Après préchauffage, vérifier dans le dashboard
les valeurs et les LED. Un mouvement doit être accompagné de `presence=true`,
`alarmActive=true` et `ledRed=true` dans les logs et l'interface. Débrancher
USB doit arrêter les nouvelles mesures ; rebrancher permet la reconnexion.

Apres 30 secondes sans mesure recente, le panneau indique des etats inconnus
et les anciennes mesures restent dans l'historique. Les commandes LED du
dashboard utilisent MQTT et necessitent un firmware reseau ; le firmware
serie actuel commande ses LEDs localement.

Démarrer la passerelle dans un terminal dédié et l'arrêter avec **Ctrl+C**
avant de rouvrir le moniteur série. Ne pas lancer deux passerelles sur le même port.

Les tests de parsing, de préchauffage, de sélection des ports et de tampon
ne nécessitent aucun matériel ni broker :

```powershell
.\ai\.venv\Scripts\python.exe -m unittest discover -s scripts\tests -v
```

## Fichiers de cette integration

- Passerelle : `scripts/esp_serial_bridge.py`, `scripts/requirements-esp.txt`,
  `scripts/tests/test_esp_serial_bridge.py`.
- Installation et validation : `scripts/setup-windows.ps1`,
  `scripts/check-ai-integration.mjs` (etats ESP dans REST/SSE et SQLite isole).
- Backend : `src/domain/telemetry.ts`, `src/infrastructure/messaging/messages.ts`,
  `src/infrastructure/persistence/sqlite-reading-repository.ts`,
  `src/application/ai-coordinator.ts`, `src/application/alert-detector.ts`,
  leurs quatre fichiers de tests et
  `src/application/use-cases/record-telemetry.test.ts` dans `iot-backend/`.
- Frontend : `src/domain/telemetry.ts`, `src/domain/esp-status.ts`,
  `src/presentation/components/EspStatusPanel.tsx` et son CSS,
  `src/presentation/pages/MetricsPage.tsx` et son CSS,
  `src/presentation/hooks/useDeviceStatus.ts`,
  `src/infrastructure/http-device-api.ts`, `tests/esp-status.test.ts`
  dans `iot-frontend/`.
- Documentation : `README.md`, `ai/README.md`, `docs/esp-serial.md`.

Aucune nouvelle variable `.env` obligatoire : la passerelle utilise les options
CLI listees ci-dessus. La configuration materielle canonique se trouve dans
`firmware/include/sentinel_config.h` ; voir [le guide firmware](../firmware/README.md)
et [la validation capteurs/IA](VALIDATION_CAPTEURS_IA.md) avant de changer le type DHT.
