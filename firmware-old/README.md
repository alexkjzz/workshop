# Firmware SENTINEL-X (ESP8266)

Micrologiciel C++ (PlatformIO, framework Arduino) du boitier SENTINEL-X V2.
Le sketch Arduino fourni est integre dans l'architecture existante : capteurs,
alarme locale, trois LEDs, dashboard OLED et moniteur serie. Le mode MQTTS
conserve la publication JSON vers Express et les commandes du dashboard.

Le vrai point d'entree PlatformIO est **`src/main.cpp`**, pas un fichier
`main.cpp` a la racine de `firmware/`. Ce point d'entree assemble les modules ;
les lectures et les regles ne sont pas dupliquees dans un sketch monolithique.

Deux environnements sont disponibles :

| Environnement | Usage | Configuration requise |
| --- | --- | --- |
| `nodemcuv2-local` (par defaut) | Capteurs, alarmes, LEDs, OLED et serie | Aucun reseau, aucun `secrets.h` |
| `nodemcuv2` | Meme comportement + Wi-Fi/MQTTS vers le backend | `include/secrets.h`, broker TLS, CA et identifiants |

**Le mode local ne transmet aucune mesure au dashboard et n'entraine pas l'IA.**
Pour recevoir les vraies donnees ESP dans Sentinel-X, utiliser `nodemcuv2`.

## Materiel Et Cablage (NodeMCU v2 / ESP-12E)

| Composant | Broche NodeMCU | GPIO | Remarque |
| --- | --- | --- | --- |
| OLED SSD1306 SDA | D2 | 4 | I2C, adresse `0x3C`, alim 3V3 |
| OLED SSD1306 SCL | D1 | 5 | |
| DHT22 DATA | D5 | 14 | pull-up 10 kOhm vers 3V3 (souvent deja sur le module) |
| PIR HC-SR501 OUT | D6 | 12 | alim 5V (VIN), sortie 3.3 V compatible |
| MQ-2 AO | A0 | ADC | Adapter la tension a la carte : ADC ESP8266 nu 0-1 V ; certaines NodeMCU acceptent 0-3.3 V grace a leur diviseur. Ne pas envoyer 5 V sur A0. |
| Buzzer actif | D7 | 13 | HIGH/LOW par defaut ; `BUZZER_PASSIVE=true` pour un piezo passif |
| LED verte externe | D0 | 16 | resistance en serie, capteurs prets sans alarme |
| LED rouge externe | D4 | 2 | resistance en serie, alarme ; GPIO2 doit rester HIGH au reset |
| LED orange externe | D8 | 15 | D8 -> resistance -> LED -> GND ; GPIO15 doit rester LOW au reset |

Toutes les masses sont communes. Le brochage, les intervalles et les seuils se
modifient dans [include/config.h](include/config.h).

Les LEDs externes du sketch sont actives a HIGH. Pour utiliser la LED integree
sur D4, inverser uniquement `LED_ALERT_ACTIVE_LOW=true`. La LED integree peut
alors s'allumer a l'inverse d'une LED rouge externe active a HIGH sur cette
meme broche. Respecter les niveaux de boot de D4/D8 dans le cablage.
Details ADC et temporisation : [reference officielle ESP8266](https://arduino-esp8266.readthedocs.io/en/latest/reference.html).

## Architecture (clean architecture)

```
lib/sentinel_core/        coeur en C++ pur, sans dependance Arduino
  src/domain/             commandes, seuil gaz/hysteresis, alarmes gaz/PIR,
                          etat local, tampon hors ligne, mesures
  src/application/        ports (Sensors, Actuators, TelemetryLink,
                          StatusDisplay, Clock, Logger) et orchestrateur Sentinel
src/
  infrastructure/         board_sensors : DHT22/MQ-2/PIR
                          gpio_actuators : LEDs verte/rouge/orange + buzzer
                          oled_display : dashboard OLED et alarmes
                          serial_logger : etat toutes les secondes
                          mqtts_link : Wi-Fi/MQTTS ; local_link : reseau desactive
                          system_clock : heure NTP
  main.cpp                composition root
test/test_core/           tests Unity du coeur et du JSON, executes sur l'ordinateur
```

Le coeur decide quand mesurer, publier, mettre en tampon et alerter ; les
adaptateurs ne font que parler au materiel. Il se teste sans carte :

```sh
pio test -e native
```

Cet environnement de test necessite GCC/G++ avec C++17 sur le PC. Sur Windows
sans GCC, un compilateur portable Zig peut executer exactement les memes tests :

```powershell
# Depuis firmware/, apres compilation des dependances PlatformIO.
.\scripts\test-core-windows.ps1 -ZigPath 'C:\chemin\vers\zig.exe'
```

Le script ne telecharge rien et ecrit ses fichiers de test dans `.runtime/`.
Zig est disponible sur [son site officiel](https://ziglang.org/download/).

## Comportement

- DHT22 toutes les **2 s**, avec controle des valeurs finies, temperature entre
  -40 et 80 C et humidite entre 0 et 100 %. Une lecture invalide est marquee en
  erreur et n'est pas republiée comme une ancienne valeur valide.
- MQ-2 : une acquisition ADC par passage, au plus toutes les **5 ms**, dans
  une moyenne glissante de **8 lectures**. Le seuil d'alarme est evalue toutes
  les **250 ms**. Aucune attente `delay()` pour remplir la moyenne.
- PIR lu a chaque tour apres **45 s** de stabilisation. Avant cela, il ne
  declenche ni alarme ni fausse presence dans le JSON.
- MQ-2 en prechauffage pendant **60 s** apres l'initialisation. Alarme a
  **600 ou plus**, retour a la normale a **550 ou moins** (hysteresis).
- Alarme locale continue (buzzer + rouge) si gaz en alerte **ou** mouvement.
  Une commande distante OFF ne coupe pas cette alarme tant que sa cause existe.
- Priorite des voyants : rouge pour l'alarme, sinon orange pendant le
  prechauffage/une erreur DHT, sinon verte lorsque les capteurs sont prets.
  La verte indique la disponibilite locale des capteurs, pas la connexion MQTT.
- OLED actualise toutes les **300 ms** : climat, valeur/barre MQ-2, PIR,
  bandeau d'alerte clignotant et liaison LOCAL/WIFI/MQTTS.
- Etat serie toutes les **1 s**, a **115200 bauds**, saute si le tampon UART
  est occupe. `Q` indique les mesures en attente et `LOST` les pertes connues.
  Un OLED absent est recherche toutes les **5 s**, avec reprise automatique.
- En mode reseau, publication toutes les **2 s** sur `esp8266/donnees`,
  et immediatement sur un changement du PIR stabilise.
- Format JSON, compatible avec `iot-backend/src/infrastructure/messaging/messages.ts` :

  ```json
  {"device":"sentinel-x-01","ts":1791280000,"temperature":22.5,"humidity":48.0,"gas":123,"presence":false,"rssi":-61}
  ```

  `ts` (epoch en secondes) date la mesure ; il est omis tant que l'heure n'est
  pas synchronisee par NTP.

  `gas` est la valeur brute de l'ADC (0-1023). `temperature` et `humidity` sont
  omises si la lecture du DHT22 echoue (le backend rejetterait un `NaN`).
  `gas` est omis pendant les 60 s de prechauffage et `presence` pendant les
  45 s de stabilisation PIR. Aucune mesure n'est envoyee si tous les capteurs
  sont indisponibles. Le JSON conserve des nombres/booleens et n'est jamais
  publie tronque. Le MQ-2 n'est pas calibre en ppm ; une entree analogique
  debranchee ne peut pas etre diagnostiquee avec certitude par sa valeur seule.
  `device` et `rssi` sont des champs supplementaires ignores par le backend actuel.
- Etat du boitier sur `esp8266/status` (retenu) : `online` a la connexion,
  `offline` publie par le broker via le Last Will en cas de perte.
- Commandes texte recues sur `esp8266/led` (insensibles a la casse) :

  | Commande | Effet |
  | --- | --- |
  | `ON` / `OFF` | LED rouge d'alerte (commande actuelle du dashboard) |
  | `BUZZER_ON` / `BUZZER_OFF` | buzzer intermittent |
  | `ALARM_ON` / `ALARM_OFF` | LED rouge + buzzer |

- Fail-safe local : si le gaz atteint `GAS_FAILSAFE_THRESHOLD` (apres 60 s de
  prechauffage du MQ-2), LED rouge et buzzer continus, meme sans reseau.
  Ce n'est pas la detection d'anomalies (qui reste l'IA cote serveur) mais une
  securite physique ; `GAS_FAILSAFE_THRESHOLD = 0` la desactive.
- Reconnexion Wi-Fi automatique et reconnexion MQTT avec backoff (2 s a 30 s).
  Les attentes sont exactement 2, 4, 8, 16 puis 30 s apres la fin de l'essai.
  L'attente NTP ne bloque pas la boucle de lecture ; chaque tentative de
  connexion TLS/PubSubClient reste synchrone et peut temporairement la ralentir.
  Une nouvelle connexion est differee pendant une alarme locale gaz/PIR ;
  une connexion deja ouverte continue a transmettre les alertes.
- Tampon hors ligne : pendant une coupure, les mesures horodatees sont
  conservees (150 mesures, environ 5 min sans evenements PIR supplementaires)
  puis rejouees dans l'ordre d'acquisition, avant les mesures nouvelles.
  Une publication refusee conserve la mesure pour un prochain essai.
  Le tampon est en RAM : un redemarrage le perd, et une saturation ecrase la
  plus ancienne mesure. Sans horloge, une mesure hors ligne est abandonnee.
  Le compteur `LOST` rend ces pertes visibles. MQTT publie en QoS 0 :
  l'acceptation par la bibliotheque ne garantit pas la reception par le backend.

## Securite TLS

- Le firmware verifie le certificat du broker avec la CA de table
  (`MQTT_CA_CERT`) **et** le nom d'hote : l'IP de `MQTT_HOST` doit figurer dans
  le SAN du certificat serveur.
- La verification des dates du certificat necessite l'heure. Le reseau de table
  n'ayant pas Internet, faire servir NTP par le PC Serveur Local (`chrony` avec
  `allow 192.168.10.0/24` et `local stratum 10`). Sans heure synchronisee,
  l'etat reste `NTP_WAIT`/`NTP...` et MQTT ne se connecte pas. Les mesures et
  alarmes locales continuent. Aucun repli sur l'heure de compilation.
- BearSSL (ESP8266) supporte TLS 1.2 maximum : ne pas restreindre Mosquitto a
  TLS 1.3.
- Authentification par identifiant/mot de passe, et mTLS optionnel
  (`MQTT_USE_CLIENT_CERT` dans `secrets.h`).

### Generer Les Certificats

```sh
bash scripts/gen-certs.sh 192.168.10.1 sentinel-x-01
```

Les fichiers sont crees dans `certs/` (ignore par Git) : `ca.crt`,
`server.crt`/`server.key` pour Mosquitto, `client.crt`/`client.key` pour le
mTLS. Relancer le script regenere les certificats serveur et client en
conservant la CA. Garder `ca.key` hors du depot et de l'archive rendue.

### Exemple De Configuration Mosquitto

```conf
listener 8883
cafile /mosquitto/certs/ca.crt
certfile /mosquitto/certs/server.crt
keyfile /mosquitto/certs/server.key
tls_version tlsv1.2
# require_certificate true   # pour imposer le mTLS
allow_anonymous false
password_file /mosquitto/config/passwd
acl_file /mosquitto/config/acl
```

ACL minimale :

```conf
user sentinel-x-01
topic write esp8266/donnees
topic write esp8266/status
topic read esp8266/led

user backend
topic read esp8266/donnees
topic read esp8266/status
topic write esp8266/led
```

Comptes : `mosquitto_passwd -c passwd sentinel-x-01` puis
`mosquitto_passwd passwd backend`. Verifier cette configuration sur le broker
avec `mosquitto_pub --cafile certs/ca.crt` et les identifiants correspondants.

Le backend se connecte actuellement en `mqtt://` sans TLS : soit il passe en
`mqtts://` avec la CA, soit il reste sur un listener 1883 joignable uniquement
depuis le reseau Docker interne (jamais expose sur le Wi-Fi de table).

## Configuration

```sh
cp include/secrets.example.h include/secrets.h
```

Renseigner dans `include/secrets.h` (ignore par Git) : SSID et mot de passe
Wi-Fi, IP du broker, identifiants MQTT, serveur NTP et le contenu de
`certs/ca.crt` dans `MQTT_CA_CERT`. La compilation echoue avec un message
explicite si `secrets.h` est absent **en mode reseau**. Le mode local compile
sans ce fichier. Ne jamais remplacer la verification TLS par `setInsecure()`.

## Compilation Et Televersement

Avec l'extension PlatformIO de VSCode, selectionner le bon environnement.
Depuis `firmware/`, pour tester le sketch local :

```powershell
pio run -e nodemcuv2-local
pio run -e nodemcuv2-local -t upload
pio device monitor -e nodemcuv2-local
```

Pour transmettre les capteurs au backend (apres configuration MQTTS) :

```powershell
pio run -e nodemcuv2
pio run -e nodemcuv2 -t upload
pio device monitor -e nodemcuv2
```

Si `pio` n'est pas dans le PATH Windows, remplacer `pio` par
`& "$env:USERPROFILE\.platformio\penv\Scripts\platformio.exe"`.

Le journal serie affiche la connexion Wi-Fi, la synchronisation NTP, les
erreurs TLS eventuelles (`[TLS] erreur ...`) et chaque message publie.

## Verification Simple

1. Demarrer la carte : orange pendant le prechauffage, valeurs DHT sur
   OLED/serie, aucune alarme PIR pendant 45 s.
2. Apres 60 s, sans mouvement et avec DHT valide/gaz bas : verte allumee.
3. Passer devant le PIR : rouge et buzzer actifs, `MOUVEMENT` dans la serie.
   Ils s'arretent lorsque le PIR revient a LOW, si aucune autre alarme n'existe.
4. Deconnecter le DHT : apres la prochaine lecture (2 s), orange et message
   DHT en erreur, sauf si une alarme prioritaire maintient la rouge.
5. En mode reseau, verifier `[MQTT] connecte en TLS`, puis
   `[MQTT] esp8266/donnees -> {...}` et les mesures du dashboard.
6. Couper temporairement le Wi-Fi puis le retablir : `Q` augmente si l'heure
   etait disponible, puis diminue lorsque le broker redevient joignable.
7. Deconnecter/reconnecter l'OLED : les alarmes restent actives et l'affichage
   revient au prochain essai (5 s, plus la cadence d'affichage).

Les tests du coeur couvrent les seuils exacts 600/550, les prechauffages, les
priorites de sorties, l'independance des cadences, le debordement de millis(),
les commandes distantes et le tampon de reconnexion. Ils ne remplacent pas
la verification du cablage ou un test physique des capteurs.

Ils verifient aussi les 3 etats de disponibilite des mesures, l'ordre lors
d'une reconnexion en pleine publication, les echecs/depassements de tampon,
le backoff, la moyenne ADC, les commandes binaires invalides et le JSON reel.

## Depannage

| Symptome | Cause probable |
| --- | --- |
| `[TLS] erreur ... certificate` | CA incorrecte, IP absente du SAN, ou certificat hors validite |
| `[MQTT] echec (etat 5)` | identifiants MQTT refuses |
| `[MQTT] echec (etat -2)` | broker injoignable : IP, port 8883, pare-feu (UFW) |
| `NTP_WAIT` ou `NTP...` | serveur NTP injoignable (UDP 123) ; MQTT attend une heure valide |
| `CFG_ERR` ou `CFG ERR` | CA PEM invalide, configuration manquante ou allocation MQTT impossible |
| `T --.-C` sur l'ecran | DHT22 mal cable ou pull-up absente |
| Valeur gaz bloquee a 1023 | tension trop elevee sur A0 : verifier le pont diviseur |
| Detections PIR au demarrage | Attendre les 45 s configurees ; augmenter `PIR_WARMUP_MS` si le module demande plus de temps |
| OLED affiche LOCAL, aucune mesure sur le dashboard | Firmware `nodemcuv2-local` : utiliser `nodemcuv2` avec sa configuration Wi-Fi/MQTTS |
| LED D4 inversee | LED integree active a LOW : adapter `LED_ALERT_ACTIVE_LOW` |

## Fichiers De L'Integration V2

| Fichiers | Responsabilite |
| --- | --- |
| `src/main.cpp` | Assemblage du sketch, boucle et cadence serie |
| `include/config.h` | Broches, polarite, cadences, prechauffages, seuils et buzzer |
| `platformio.ini` | Environnements local/reseau, C++17 et analyse statique |
| `lib/sentinel_core/src/application/ports.h` | Interfaces entre coeur et materiel |
| `lib/sentinel_core/src/application/sentinel.h`, `sentinel.cpp` | Cadences independantes et orchestration des alarmes/publications |
| `lib/sentinel_core/src/domain/device_status.h` | Etat de prechauffage et des alarmes locales |
| `lib/sentinel_core/src/domain/alarm_state.h`, `alarm_state.cpp` | Priorite des voyants, gaz/PIR et commandes distantes |
| `lib/sentinel_core/src/domain/gas_failsafe.h`, `gas_failsafe.cpp` | Seuils inclusifs et prechauffage relatif a l'initialisation |
| `lib/sentinel_core/src/domain/readings.h`, `sample_buffer.h` | Disponibilite des mesures et tampon borne |
| `lib/sentinel_core/src/domain/rolling_average.h`, `retry_backoff.h` | Moyenne glissante et delais de reconnexion testables |
| `src/infrastructure/board_sensors.h`, `board_sensors.cpp` | DHT valide, moyenne ADC et PIR |
| `src/infrastructure/gpio_actuators.h`, `gpio_actuators.cpp` | Trois LEDs et buzzer |
| `src/infrastructure/oled_display.h`, `oled_display.cpp` | Dashboard OLED V2 |
| `src/infrastructure/serial_logger.h` | Etat lisible toutes les secondes |
| `src/infrastructure/local_link.h` | Mode local sans reseau |
| `src/infrastructure/mqtts_link.h`, `mqtts_link.cpp` | MQTTS conserve, attente NTP sans boucle bloquante |
| `src/infrastructure/telemetry_payload.h`, `telemetry_payload.cpp` | Contrat JSON Express, validation et limite de taille |
| `src/infrastructure/system_clock.h` | Heure epoch valide, sans date de repli artificielle |
| `test/test_core/test_main.cpp` | Tests de comportement du coeur |
| `scripts/test-core-windows.ps1` | Execution des tests sous Windows avec Zig portable |
| `README.md` | Structure, cablage, compilation et verification |

Analyse statique des sources du projet, depuis `firmware/` :

```powershell
pio check -e nodemcuv2-local --skip-packages --fail-on-defect medium --fail-on-defect high
```

Cppcheck analyse le code Sentinel. Les diagnostics internes aux headers
ArduinoJson sont exclus ; cette dependance reste compilee et le JSON produit
est teste avec la vraie bibliotheque. L'alias de namespace dans `check_flags`
contourne une limite du preprocesseur Cppcheck 2.11 et n'affecte pas le binaire.
