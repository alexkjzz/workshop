# Workshop IoT

## Sentinel-X : intelligence artificielle et Windows

Le service Python local se trouve dans [`ai/`](ai/README.md) : Isolation Forest,
features temporelles, YOLO/OpenCV, fusion capteurs et moteur de risque. Il utilise
le backend MQTT/SQLite, le flux SSE existant et le relais MJPEG authentifie.

Pour Windows, executer depuis la racine :

```powershell
.\scripts\setup-windows.ps1
```

Les commandes de lancement dans trois terminaux, l'entrainement reel ou de
demonstration et les tests sont dans [ai/README.md](ai/README.md).
Le script ne demarre aucune simulation. Les scripts Bash ci-dessous restent le
mode de test historique avec donnees fictives.

Architecture et limites : [docs/AI_IMPLEMENTATION.md](docs/AI_IMPLEMENTATION.md).
Inventaire des fichiers : [docs/AI_FILES.md](docs/AI_FILES.md).

## Donnees ESP reelles par USB

Le firmware actuel envoie temperature, humidite, gaz, presence et etats du
boitier sur le port serie USB. La passerelle les transmet au MQTT existant :
**ESP USB -> passerelle Python -> MQTT -> Express -> SQLite/SSE -> React**.
Le navigateur continue a communiquer uniquement avec Express.

Depuis la racine, avec le broker, le backend et le frontend demarres :

```powershell
.\ai\.venv\Scripts\python.exe -m pip install -r .\scripts\requirements-esp.txt
.\ai\.venv\Scripts\python.exe .\scripts\esp_serial_bridge.py --port COM7
```

Fermer `platformio device monitor` avant de lancer la passerelle : un seul
programme peut ouvrir COM7. Le port peut changer apres rebranchement ; utiliser
`--list-ports` pour le retrouver. Le dashboard affiche les quatre capteurs et
un panneau **Etat du boitier ESP** (gaz/PIR, DHT, alarme et LEDs). La chauffe et
la calibration ne sont pas interpretees comme des mesures valides.

Installation complete, configuration et test : [docs/esp-serial.md](docs/esp-serial.md).

Dashboard React et API Express pour recevoir les mesures d'un ESP8266 via MQTT
et envoyer des commandes LED. Les tests locaux peuvent se faire sans carte,
avec Mosquitto pour simuler les messages.

## Face Recognition

La webcam utilise **YOLO + ByteTrack** pour les personnes et le suivi, puis un
module séparé **OpenCV YuNet + SFace** pour détecter et identifier les visages.
Le navigateur utilise les routes Express authentifiées ; Express appelle FastAPI.
Aucune nouvelle dépendance Python lourde : les modèles ONNX utilisent OpenCV déjà installé.

Installation des modèles officiels (une fois, environ 39 Mo, SHA-256 vérifié) :

```powershell
Set-Location 'C:\Users\the-b\OneDrive\Bureau\workshop-main\ai'
.\.venv\Scripts\python.exe -m app.vision.setup_faces
```

Placer **3 à 5 photos par personne**, avec un seul visage suffisamment grand et
net par photo, dans des sous-dossiers portant le nom de la personne :

```text
ai/known_faces/Mohamed/photo1.jpg
ai/known_faces/Mohamed/photo2.jpg
ai/known_faces/Mohamed/photo3.jpg
ai/known_faces/Personne2/photo1.jpg
```

Le catalogue est chargé au démarrage de Python. Après ajout/suppression de photos,
cliquer **Recharger les visages connus** dans la page Caméra. Aucun redémarrage
n'est nécessaire pour recharger les références. Les images sans visage, trop
petites, illisibles ou contenant plusieurs visages sont ignorées et journalisées.
Sans référence, le compteur indique 0 identité connue et les visages restent Inconnu.

Variables dans `ai/.env` :

```dotenv
FACE_RECOGNITION_ENABLED=true
FACE_RECOGNITION_THRESHOLD=0.55
FACE_RECOGNITION_EVERY_N_FRAMES=3
FACE_RECOGNITION_MAX_FPS=2
FACE_KNOWN_DIR=known_faces
FACE_EVENT_COOLDOWN_SECONDS=5
FACE_MIN_SIZE_PIXELS=40
FACE_DETECTOR_MODEL=models/face_detection_yunet_2023mar.onnx
FACE_EMBEDDING_MODEL=models/face_recognition_sface_2021dec.onnx
```

La confiance affichée est une similarité cosinus, pas une probabilité d'identité.
Le seuil doit être évalué sur vos propres photos et conditions de caméra ; un
score de 90–95 % n'est pas garanti. Fonction de démonstration/monitoring, à ne
pas utiliser comme unique mécanisme de sécurité critique.

Commandes de démarrage, API, procédure de test, résultats de validation et liste
des fichiers modifiés : [docs/FACE_RECOGNITION.md](docs/FACE_RECOGNITION.md).

## Installation

1. Installer Git et [Homebrew](https://brew.sh/) sur macOS, si necessaire.
2. Installer Node.js (npm est inclus) :

```sh
brew install node
```

Node.js 22.13 ou plus recent est requis (module `node:sqlite` utilise pour les comptes). Si Node.js est deja installe avec une
version compatible, conserver cette installation. `lsof` est fourni avec macOS.

3. Cloner le depot, puis ouvrir un terminal a sa racine (le dossier contenant ce README).
4. Lancer le script d'installation :

```sh
bash install.sh
```

Le script verifie les prerequis, installe Mosquitto et ses clients via Homebrew
s'ils sont absents, puis execute `npm ci` dans le backend et le frontend a partir
de leurs fichiers de verrouillage. Il ne demarre aucun service. Une connexion
Internet est necessaire pour telecharger les paquets. Le script peut etre relance
apres une mise a jour du depot ; `npm ci` recree les dependances locales.

Sur Linux, installer Node.js, npm, `lsof`, Mosquitto et ses clients avec le
gestionnaire de paquets du systeme avant de lancer `bash install.sh`.

## Structure Du Projet

- `iot-backend/` : API Express, MQTT, historique SQLite, voir [iot-backend/README.md](iot-backend/README.md).
- `iot-frontend/` : application React/Vite (pages Metriques et Camera), voir [iot-frontend/README.md](iot-frontend/README.md).
- `firmware/` : firmware ESP8266 actuel (PlatformIO, capteurs/OLED et sortie serie USB).
- `firmware-old/` : ancienne version reseau ; le flux USB actuel ne l'utilise pas.
- `scripts/esp_serial_bridge.py` : passerelle des mesures serie vers le backend MQTT.
- `install.sh`, `run.sh`, `stop.sh` : installation, demarrage et arret.
- `docker-compose.yml` : stack web conteneurisee (voir [Docker](#docker)).

## Architecture

Les trois projets suivent la clean architecture : les regles metier ne
dependent d'aucun framework, et les dependances pointent toujours vers le
centre.

| Couche | Role | Backend | Frontend | Firmware |
| --- | --- | --- | --- | --- |
| Domaine | entites et regles pures | `src/domain` | `src/domain` | structures dans `application/ports.h` |
| Application | cas d'usage et ports (interfaces) | `src/application` | `src/application` | `lib/sentinel_core/src/application` |
| Infrastructure | adaptateurs techniques | `src/infrastructure` (SQLite, MQTT, Better Auth, camera) | `src/infrastructure` (fetch, SSE, Better Auth, localStorage) | `lib/sentinel_core/src/infrastructure` (capteurs, GPIO, OLED) |
| Presentation | interface utilisateur / HTTP | `src/presentation/http` (Express) | `src/presentation` (React) | ecran OLED (adaptateur) |
| Composition | assemble les implementations | `src/main.ts` | `src/main.tsx` | `src/main.cpp` |

Le domaine et l'application web se testent sans broker, sans base persistante,
sans navigateur ni carte, avec de faux adaptateurs en memoire cote serveur.
Le parseur serie se teste egalement sans ESP.

```
ESP8266 --USB--> passerelle serie --MQTT--> Mosquitto --> backend --SQLite--> historique
                                          |  \--REST + SSE--> dashboard (Metriques)
script vision IA --MJPEG + MQTT--------->/   \--relais camera--> dashboard (Camera)
```

## Demarrage Et Arret

Depuis la racine du depot :

```sh
bash run.sh
```

Le script lance le **mode test local sans carte IoT** : Mosquitto, le backend,
Vite et un simulateur en arriere-plan. Le backend et le frontend se rechargent
lors des modifications. Le simulateur (`iot-backend/src/tools/`) joue une scene
coherente :

- mesures toutes les deux secondes (temperature et humidite qui derivent, pic
  de gaz toutes les 4 minutes, passage d'une personne 20 s par minute) ;
- au demarrage, publication horodatee des 5 dernieres minutes manquantes, pour
  que les graphiques soient remplis tout de suite (meme mecanisme que le rejeu
  du firmware) ;
- flux camera simule sur http://127.0.0.1:8090/stream.mjpg (silhouette dans un
  cadre vert si le visage est reconnu, rouge sinon) et detections publiees sur
  `sentinel/vision` ;
- reception des commandes LED ON/OFF, sans action physique.

La connexion MQTT est reelle, mais les capteurs, la carte et la camera sont
simules.

- Dashboard : http://127.0.0.1:5173 (connexion requise, voir ci-dessous)
- API : http://127.0.0.1:3001/api/status
- Broker MQTT : `mqtt://127.0.0.1:1883`
- Journaux : `.runtime/mosquitto.log`, `.runtime/backend.log`, `.runtime/frontend.log`.
- Mesures et commandes simulees : `.runtime/simulator.log`.

Les ports `1883`, `3001`, `5173` et `8090` sont fixes pour ces scripts. Un service deja
present sur l'un de ces ports est reutilise : verifier qu'il s'agit bien du
service attendu. Les scripts peuvent aussi etre appeles depuis un autre dossier.

```sh
bash stop.sh
```

## Authentification

L'interface web et les routes `/api/status` et `/api/action` sont protegees par
[Better Auth](https://www.better-auth.com/) (e-mail + mot de passe, session par
cookie `HttpOnly`). Seule `/api/health` reste publique.

L'inscription publique est desactivee : les comptes se creent en ligne de
commande. Le mot de passe (12 caracteres minimum) est demande deux fois, sans
affichage :

```sh
npm --prefix iot-backend run user:create -- operateur@aethercorp.test "Operateur"
```

- Les comptes sont stockes dans `iot-backend/data/auth.db` (SQLite, ignore par
  Git, mots de passe hashes en scrypt). Les tables sont creees au demarrage.
- `run.sh` genere au premier lancement le secret de session dans
  `.runtime/auth-secret`. Le supprimer invalide toutes les sessions.
- Sessions de 8 heures. Connexion limitee a 5 tentatives par minute et par IP
  (HTTP `429` au-dela).
- Les requetes d'authentification venant d'une origine absente de
  `FRONTEND_ORIGINS` sont refusees (HTTP `403`).

Pour appeler l'API protegee en ligne de commande, ouvrir d'abord une session :

```sh
curl -c /tmp/sentinel-cookies -H 'Origin: http://127.0.0.1:5173' \
	-H 'Content-Type: application/json' \
	-d '{"email":"operateur@aethercorp.test","password":"<mot de passe>"}' \
	http://127.0.0.1:5173/api/auth/sign-in/email
```

Les exemples `curl` suivants utilisent ensuite `-b /tmp/sentinel-cookies`.

L'arret concerne uniquement les processus lances par `run.sh`, y compris leurs
sous-processus. Les services demarres manuellement ou via Homebrew sont laisses
intacts ; les arreter dans leurs terminaux avec Ctrl+C si necessaire. Les PID et
journaux locaux sont ignores par Git. Ne pas lancer les scripts simultanement.

## Tester Les Mesures

Une fois les services demarres, les mesures simulees apparaissent automatiquement.
Pour publier ponctuellement une valeur manuelle (remplacee par la prochaine
mesure du simulateur) :

```sh
mosquitto_pub -h 127.0.0.1 -t esp8266/donnees \
	-m '{"temperature":22.5,"humidity":48,"gas":120,"presence":true}'
```

Le dashboard doit afficher ces valeurs en temps reel (graphiques et tableaux
mis a jour par Server-Sent Events).

```sh
curl -b /tmp/sentinel-cookies http://127.0.0.1:5173/api/status
curl -b /tmp/sentinel-cookies 'http://127.0.0.1:5173/api/readings?limit=20'
```

La reponse de `/api/status` doit contenir `mqttConnected: true`, un
`lastMessageAt` renseigne et les valeurs dans `telemetry`. Chaque mesure est
enregistree dans `iot-backend/data/telemetry.db` (SQLite) et conservee 7 jours
(`READINGS_RETENTION_DAYS`). Les champs sont optionnels ; les mesures doivent
etre des nombres finis et `presence` un booleen. Un champ `ts` (epoch en
secondes) date la mesure : le firmware l'envoie pour les mesures rejouees apres
une coupure.

## Camera Et Reconnaissance Faciale

La page Camera affiche le flux du script vision de l'equipe IA, relaye par le
backend derriere l'authentification, et l'historique des detections. Contrat a
respecter par ce script :

- Flux video MJPEG (`multipart/x-mixed-replace`) annote, sur l'URL definie par
  `VISION_STREAM_URL` (ex. `http://192.168.10.1:8000/stream.mjpg`).
- Detections publiees en JSON sur le topic `sentinel/vision`
  (`MQTT_VISION_TOPIC`) :

  ```json
  {"ts":1791280000,"persons":1,"faces":[{"name":"Alice","confidence":0.92}]}
  ```

  `name` vaut `null` pour un visage inconnu (signale en alerte sur la page),
  `confidence` est compris entre 0 et 1, `ts` et `persons` sont optionnels.

En mode test local, le simulateur publie des detections fictives ; sans
`VISION_STREAM_URL`, la page indique que le flux est indisponible.

## Tester Les Commandes LED

Dans un terminal, ecouter les commandes :

```sh
mosquitto_sub -h 127.0.0.1 -t esp8266/led -v
```

Cliquer sur ON/OFF dans le dashboard, ou appeler l'API :

```sh
curl -i -b /tmp/sentinel-cookies http://127.0.0.1:5173/api/action \
	-H 'Content-Type: application/json' \
	-d '{"ordre":"ON"}'
```

L'API doit repondre HTTP `202` et l'abonne afficher `esp8266/led ON`.
Le simulateur journalise aussi `Commande LED simulee : ON` dans
`.runtime/simulator.log`.
La commande MQTT est une chaine `ON` ou `OFF`, pas un objet JSON.
Cela confirme la publication, pas l'execution physique par une carte.

## Verifications Automatiques

```sh
npm --prefix iot-backend test
npm --prefix iot-backend run typecheck
npm --prefix iot-backend run build
npm --prefix iot-frontend test
npm --prefix iot-frontend run lint
npm --prefix iot-frontend run build
(cd firmware && pio test -e native)
```

Les tests couvrent les regles du domaine, les cas d'usage (avec de faux
adaptateurs), le parsing des messages MQTT, le depot SQLite et le coeur du
firmware ; ils ne necessitent ni broker ni carte. Les commandes de publication
et d'abonnement ci-dessus servent aux tests manuels d'integration.

## Notifications Par E-mail

L'onglet **Parametres** du dashboard regle l'adresse qui recoit les alertes,
les active et choisit les types envoyes ; un bouton envoie un e-mail de test.
Les notifications sont uniquement envoyees par e-mail.

| Alerte | Declenchement |
| --- | --- |
| Intrusion | le capteur PIR passe a "presence" |
| Visage inconnu | la reconnaissance faciale signale un visage sans nom |
| Boitier hors ligne | aucune mesure recue depuis 30 s |

- Un meme type d'alerte part au plus une fois toutes les 5 minutes ; les
  mesures rejouees apres une coupure ne declenchent pas d'alerte.
- L'envoi passe par SMTP (`SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`,
  `SMTP_USER`, `SMTP_PASSWORD`, `MAIL_FROM`), STARTTLS exige hors TLS
  implicite. Sans serveur SMTP, la page le signale et aucun e-mail ne part.
- En mode test local (`run.sh`), les e-mails ne sont pas envoyes mais ecrits
  dans `.runtime/mail/` (fichiers `.eml`, lisibles avec un client mail).
- Les parametres sont stockes dans `iot-backend/data/settings.db`.

## Docker

Le backend et le frontend sont conteneurises (`iot-backend/Dockerfile`,
`iot-frontend/Dockerfile`) et orchestres par `docker-compose.yml`. Le frontend
est servi par nginx, qui relaie `/api` vers le backend : seul le port web est
publie, l'API n'est pas joignable directement.

```sh
cp .env.example .env        # puis renseigner BETTER_AUTH_SECRET (openssl rand -base64 32)
docker compose up -d --build
docker compose exec backend node dist/cli/create-user.js operateur@aethercorp.test "Operateur"
```

- Dashboard : http://localhost:8080 (port `WEB_PORT`). Pour un acces depuis le
  reseau de table, ajouter l'URL (ex. `http://192.168.10.1:8080`) a
  `FRONTEND_ORIGINS` et la definir comme `PUBLIC_URL`.
- Le broker MQTT n'est pas inclus : `MQTT_URL` pointe par defaut sur le
  Mosquitto de l'hote (`host.docker.internal:1883`).
- Les comptes et l'historique des capteurs sont conserves dans le volume
  `backend-data`.
- `VISION_STREAM_URL` et `MQTT_VISION_TOPIC` raccordent le script vision de
  l'equipe IA (voir [Camera](#camera-et-reconnaissance-faciale)).
- Durcissement : processus non-root, systeme de fichiers en lecture seule,
  capacites Linux retirees, `no-new-privileges`, en-tetes de securite nginx
  (CSP, `X-Frame-Options`, `nosniff`). Le backend ne fait confiance a
  `X-Forwarded-For` que depuis le sous-reseau interne `172.30.10.0/24` (nginx).

## Avec Un Vrai ESP8266

Le broker lance par le script est reserve aux connexions locales. Pour une carte,
arreter le mode test avec `bash stop.sh` pour ne plus publier de mesures fictives,
puis lancer le backend et le frontend manuellement avec `npm run dev` dans leurs
dossiers respectifs. Ensuite,
configurer un listener Mosquitto accessible sur le reseau local, autoriser le
port `1883` dans le pare-feu et utiliser l'adresse IP du Mac dans le firmware
(pas `127.0.0.1`). La carte et le Mac doivent etre sur le meme reseau.
Prevoir une authentification et des ACL avant d'exposer le broker ; ne pas
ouvrir un broker anonyme sur Internet.

La configuration du backend par variables d'environnement est detaillee dans
[iot-backend/README.md](iot-backend/README.md). Pour personnaliser les ports ou
topics, demarrer les services manuellement plutot qu'avec les scripts locaux.
