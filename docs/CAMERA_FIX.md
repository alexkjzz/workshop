# Sentinel-X : correction de la webcam

Fonctionnement, configuration et procédure de vérification de la webcam locale.

## Cause du 503 et changements

FastAPI refusait correctement `/stream.mjpg` tant que la caméra n'était pas
`running`. React ouvrait pourtant l'image MJPEG dès l'affichage de la page,
avant le démarrage. Cette première erreur restait affichée dans `CameraFeed`.
Le bouton ignorait aussi l'état renvoyé par `/vision/start` : un HTTP 200 avec
`starting` ne signifie pas encore qu'une image est disponible.

Le chargement YOLO et l'inférence étaient couplés à la capture. Leur lenteur
ou leur échec pouvaient donc empêcher la vidéo de démarrer. Les essais réels
ont également révélé deux problèmes de reprise : un détecteur en cours d'arrêt
empêchait le redémarrage immédiat, et une nouvelle image utilisant la même URL
pouvait conserver la dernière frame MJPEG en mémoire dans le navigateur.

La capture ouvre maintenant l'index configurable, par défaut 0, avec DirectShow
sous Windows, puis le backend OpenCV par défaut si nécessaire. Elle publie
la première image JPEG avant de lancer YOLO. `running` et `stream_ready=true`
signifient qu'une image est réellement disponible. Un verrou protège la capture
unique, les événements annulent les workers et les données JPEG sont protégées.
`start()` et `stop()` sont idempotents. L'arrêt vide le flux et libère la webcam.

Un thread séparé exécute YOLO. Un verrou sérialise les détecteurs pendant les
reprises ; un ancien chargement annulé ne bloque plus la vidéo et ne peut pas
publier de présence après l'arrêt. Sans modèle ou en cas d'erreur d'inférence,
la vidéo brute reste disponible. `detection_status` et `detection_error`
signalent cette situation ; la fusion ignore les détections absentes ou périmées.

React suit `start → status → stream`, attend `running`, masque le flux dès
l'arrêt et reprend ce parcours pour « Réessayer ». Chaque connexion reçoit
une URL distincte. Les erreurs du service sont affichées dans l'interface.
Le statut général reste interrogé toutes les 5 secondes dans React et toutes
les 2 secondes dans Express. Le contrôle de démarrage interroge seulement
`/vision/status`, toutes les secondes jusqu'au démarrage ou à l'expiration.

Le navigateur utilise exclusivement `/api/*`. Express transmet le token à
FastAPI et relaie le MJPEG sans charger tout le flux en mémoire. Il préserve
le Content-Type et annule la requête amont quand le client se déconnecte.
La reconnaissance faciale MQTT et le flux externe existants restent disponibles.

## Configuration et lancement

Exemple de configuration locale :

```dotenv
# ai/.env
AI_HOST=127.0.0.1
AI_PORT=8001
VISION_CAMERA_INDEX=0
VISION_AUTO_START=false

# iot-backend/.env
PORT=3001
AI_SERVICE_URL=http://127.0.0.1:8001
AI_POLL_MS=2000
```

`VISION_CAMERA_INDEX` est prioritaire sur l'ancien `CAMERA_INDEX`, qui reste
compatible. Sans `VISION_STREAM_URL` explicite, Express utilise le flux de l'IA.
Si un token est configuré, `AI_SERVICE_TOKEN` doit être identique dans les deux
services. Aucun token n'est envoyé au navigateur.

Arrêter avec **Ctrl+C** les anciennes instances dans leurs terminaux avant de
relancer. La commande backend et Python ci-dessous ne rechargent pas le code
automatiquement. Le port IA par défaut est 8001 ; si vous le changez,
mettre à jour `AI_PORT` et `AI_SERVICE_URL` ensemble. Ouvrir chacun des terminaux
ci-dessous à la racine du dépôt.

**Terminal IA :**

```powershell
Set-Location .\ai
.\.venv\Scripts\python.exe -m app.main
```

**Terminal backend :**

```powershell
Set-Location .\iot-backend
node --env-file=.env --import tsx src/main.ts
```

**Terminal frontend :**

```powershell
Set-Location .\iot-frontend
npm.cmd run dev -- --host 127.0.0.1
```

Ouvrir http://127.0.0.1:5173, se connecter, puis aller sur **Caméra** et cliquer
**Démarrer la webcam**. Le flux apparaît après la première image. Cliquer
**Arrêter la webcam** le masque et libère le périphérique.

## Routes

| Express, session requise | FastAPI, token si configuré |
| --- | --- |
| `POST /api/ai/vision/start` | `POST /vision/start` |
| `POST /api/ai/vision/stop` | `POST /vision/stop` |
| `GET /api/ai/vision/status` | `GET /vision/status` |
| `GET /api/ai/vision/stream` | `GET /stream.mjpg` |
| `GET /api/camera/stream` (route conservée) | `GET /stream.mjpg` |

Un démarrage renvoie rapidement `starting`, puis le statut passe à `running`
après lecture et encodage de la première frame. Le MJPEG retourne alors HTTP
200 avec `multipart/x-mixed-replace; boundary=frame`. Après l'arrêt, il retourne
503 avec une explication ; ce refus est attendu et n'est plus déclenché par
React avant le démarrage.

## Tests PowerShell

Depuis la racine :

```powershell
npm.cmd --prefix iot-backend test
npm.cmd --prefix iot-backend run typecheck
npm.cmd --prefix iot-backend run build
npm.cmd --prefix iot-frontend test
npm.cmd --prefix iot-frontend run lint
npm.cmd --prefix iot-frontend run build
Push-Location ai
.\.venv\Scripts\python.exe -m pytest -q
Pop-Location
node .\scripts\check-ai-integration.mjs
node .\scripts\check-camera-integration.mjs
```

Le dernier script ouvre réellement la webcam et Edge sans fenêtre, avec des
ports temporaires, des bases isolées et un profil navigateur temporaire.
Il utilise le frontend compilé, le proxy Vite, les routes Express et le service
FastAPI réels. Une session de test est fournie seulement par son serveur
éphémère ; l'authentification du projet n'est pas modifiée. Les routes sans
session et FastAPI sans token sont aussi vérifiés. Aucune image n'est sauvegardée.
Le script arrête ses processus et nettoie ses données ; il conserve les services
déjà lancés. Fermer les autres applications utilisant la webcam pour cet essai.

Vérification physique supplémentaire avec YOLO volontairement absent,
uniquement dans le service temporaire :

```powershell
$env:CAMERA_TEST_NO_YOLO = '1'
try { node .\scripts\check-camera-integration.mjs }
finally { Remove-Item Env:CAMERA_TEST_NO_YOLO }
```

Pour vérifier directement les routes Python, avec l'IA lancée :

```powershell
$cameraHeaders = @{}
$cameraTokenLine = Get-Content .\ai\.env | Where-Object { $_ -match '^AI_SERVICE_TOKEN=' } | Select-Object -First 1
$cameraToken = if ($cameraTokenLine) { ($cameraTokenLine -replace '^AI_SERVICE_TOKEN=', '').Trim().Trim('"').Trim("'") } else { '' }
if ($cameraToken) { $cameraHeaders['Authorization'] = "Bearer $cameraToken" }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8001/vision/start -Headers $cameraHeaders
for ($attempt = 0; $attempt -lt 40; $attempt++) {
    $vision = Invoke-RestMethod -Uri http://127.0.0.1:8001/vision/status -Headers $cameraHeaders
    if ($vision.status -ne 'starting') { break }
    Start-Sleep -Milliseconds 500
}
$vision | Select-Object status, stream_ready, camera_index, detection_status, error
Add-Type -AssemblyName System.Net.Http
$cameraClient = New-Object System.Net.Http.HttpClient
foreach ($key in $cameraHeaders.Keys) { [void]$cameraClient.DefaultRequestHeaders.TryAddWithoutValidation($key, $cameraHeaders[$key]) }
try {
    $cameraResponse = $cameraClient.GetAsync('http://127.0.0.1:8001/stream.mjpg', [System.Net.Http.HttpCompletionOption]::ResponseHeadersRead).GetAwaiter().GetResult()
    $cameraResponse.StatusCode
    $cameraResponse.Content.Headers.ContentType.ToString()
    $cameraResponse.Dispose()
} finally { $cameraClient.Dispose() }
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8001/vision/stop -Headers $cameraHeaders
```

## Points à vérifier

- Suites Python, backend et frontend ; typecheck, lint et builds.
- Mesures vers IA, SQLite et SSE, puis panne et reprise du service IA.
- Webcam vers React via Express : première image, arrêt, reprise et « Réessayer ».
- Deux viewers utilisant le flux partagé et annulation des requêtes amont.
- Vidéo brute disponible lorsque YOLO manque ; détection explicitement indisponible.
- Aucun appel du navigateur directement vers Python.

Les commandes ci-dessus fournissent les contrôles automatisés. La disponibilité
du périphérique, les autorisations Windows et les performances doivent être
vérifiées sur le matériel utilisé. Ces essais ne mesurent pas la précision
de détection ni la stabilité sur une longue durée.

## Détection de personnes et reconnaissance faciale

La page affichait auparavant un tableau « Reconnaissance faciale » alimenté
uniquement par l'ancien canal de détection faciale. Le détecteur YOLO produisait
des personnes via les événements et les résultats IA, sans alimenter ce tableau.
L'absence de messages faciaux faisait afficher « Aucune personne dans le champ
de la caméra », même quand YOLO avait détecté une présence confirmée.

La page Caméra possède maintenant une section **Détection de personnes** reliée
au statut IA courant et à l'historique IA chargé par REST/SSE. Elle affiche le
nombre réel, la confiance et la confirmation. Les lignes sont dédupliquées sur
l'horodatage propre à l'inférence caméra, puisque plusieurs analyses capteurs
peuvent contenir le même résultat YOLO. Les données absentes, périmées, en
chargement ou en erreur ne sont jamais présentées comme une absence de personne.

La section faciale est désormais alimentée par le module local YuNet/SFace,
séparé de YOLO/ByteTrack. Elle affiche les noms connus, les visages inconnus,
les scores de similarité et un historique en mémoire. Si YOLO voit une personne
sans visage visible, elle indique « Personne détectée, visage non identifiable ».
L'ancien flux facial MQTT reste affiché lorsqu'il fournit des données.
Voir [Face Recognition](FACE_RECOGNITION.md) pour les photos, modèles et tests.

Le test navigateur vérifie aussi les deux sections et l'historique réel. Pour
contrôler uniquement l'affichage avec l'IA déjà lancée, en conservant l'état de
la webcam, utiliser :

```powershell
$env:CAMERA_TEST_READ_ONLY = '1'
try { node .\scripts\check-camera-integration.mjs }
finally { Remove-Item Env:CAMERA_TEST_READ_ONLY }
```

Ce mode n'envoie que des GET à son backend de test et au service Python existant.
Il conserve la webcam arrêtée si elle est arrêtée, et vérifie le flux et
l'historique lorsque la détection est active.

## Fichiers ajoutés ou modifiés pour cette correction

```text
ai/.env (configuration locale)
ai/.env.example
ai/README.md
ai/app/config.py
ai/app/main.py
ai/app/service.py
ai/app/schemas/vision.py
ai/app/vision/camera.py
ai/app/fusion/sensor_fusion.py
ai/tests/test_api.py
ai/tests/test_fusion.py
ai/tests/test_vision.py

iot-backend/.env (URL locale du service IA)
iot-backend/.env.example
iot-backend/README.md
iot-backend/src/main.ts
iot-backend/src/application/ai-coordinator.ts
iot-backend/src/application/ai-coordinator.test.ts
iot-backend/src/application/errors.ts
iot-backend/src/application/ports.ts
iot-backend/src/domain/ai.ts
iot-backend/src/infrastructure/config.ts
iot-backend/src/infrastructure/ai/ai-contract.ts
iot-backend/src/infrastructure/ai/http-ai-gateway.ts
iot-backend/src/infrastructure/ai/http-ai-gateway.test.ts
iot-backend/src/infrastructure/camera/http-camera-feed.ts
iot-backend/src/infrastructure/camera/http-camera-feed.test.ts (ajouté)
iot-backend/src/presentation/http/routes/ai-routes.ts
iot-backend/src/presentation/http/routes/ai-routes.test.ts
iot-backend/src/presentation/http/routes/vision-routes.ts

iot-frontend/src/application/ports.ts
iot-frontend/src/application/start-vision.ts (ajouté)
iot-frontend/src/domain/ai.ts
iot-frontend/src/infrastructure/http-ai-api.ts
iot-frontend/src/infrastructure/camera-stream.ts (ajouté)
iot-frontend/src/presentation/hooks/useLiveData.ts
iot-frontend/src/presentation/App.tsx
iot-frontend/src/presentation/pages/CameraPage.tsx
iot-frontend/src/presentation/components/AiPanel.tsx
iot-frontend/src/presentation/components/CameraFeed.tsx
iot-frontend/src/presentation/components/VisionControls.tsx
iot-frontend/src/presentation/components/VisionCamera.tsx (ajouté)
iot-frontend/tests/start-vision.test.ts (ajouté)
iot-frontend/tests/ai.test.ts

scripts/check-camera-integration.mjs (ajouté)
docs/CAMERA_FIX.md (ajouté)
docs/AI_IMPLEMENTATION.md
docs/AI_FILES.md
```
