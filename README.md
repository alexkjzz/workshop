# Workshop IoT

Dashboard React et API Express pour recevoir les mesures d'un ESP8266 via MQTT
et envoyer des commandes LED. Les tests locaux peuvent se faire sans carte,
avec Mosquitto pour simuler les messages.

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

- `iot-backend/` : API Express et connexion MQTT.
- `iot-frontend/` : application React/Vite.
- `firmware/` : firmware ESP8266 (PlatformIO, MQTTS), voir [firmware/README.md](firmware/README.md).
- `install.sh`, `run.sh`, `stop.sh` : installation, demarrage et arret.

## Demarrage Et Arret

Depuis la racine du depot :

```sh
bash run.sh
```

Le script lance le **mode test local sans carte IoT** : Mosquitto, le backend,
Vite et un simulateur MQTT en arriere-plan. Le backend et le frontend se
rechargent lors des modifications. Le simulateur publie des mesures fictives
toutes les deux secondes et recoit les commandes LED ON/OFF sans action physique.
La connexion MQTT est reelle, mais les capteurs et la carte sont simules.

- Dashboard : http://127.0.0.1:5173 (connexion requise, voir ci-dessous)
- API : http://127.0.0.1:3001/api/status
- Broker MQTT : `mqtt://127.0.0.1:1883`
- Journaux : `.runtime/mosquitto.log`, `.runtime/backend.log`, `.runtime/frontend.log`.
- Mesures et commandes simulees : `.runtime/simulator.log`.

Les ports `1883`, `3001` et `5173` sont fixes pour ces scripts. Un service deja
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

Le dashboard doit afficher ces valeurs sous environ deux secondes.

```sh
curl -b /tmp/sentinel-cookies http://127.0.0.1:5173/api/status
```

La reponse doit contenir `mqttConnected: true`, un `lastMessageAt` renseigne et
les valeurs dans `telemetry`. Les donnees sont conservees en memoire et perdues
au redemarrage du backend. Les champs sont optionnels ; les mesures doivent etre
des nombres finis et `presence` un booleen.

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
npm --prefix iot-frontend run lint
npm --prefix iot-frontend run build
```

Les tests existants couvrent le parsing de la telemetrie ; ils ne necessitent
pas de broker. Les commandes ci-dessus de publication et d'abonnement servent
aux tests manuels d'integration MQTT / API / dashboard.

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