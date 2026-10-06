# Firmware SENTINEL-X (ESP8266)

Micrologiciel C++ (PlatformIO, framework Arduino) du boitier SENTINEL-X. Il lit
les capteurs de table, publie les mesures en JSON sur **MQTTS** (MQTT sur TLS,
certificat du broker verifie par une CA) et pilote les LEDs et le buzzer sur
commande du dashboard.

## Materiel Et Cablage (NodeMCU v2 / ESP-12E)

| Composant | Broche NodeMCU | GPIO | Remarque |
| --- | --- | --- | --- |
| OLED SSD1306 SDA | D2 | 4 | I2C, adresse `0x3C`, alim 3V3 |
| OLED SSD1306 SCL | D1 | 5 | |
| DHT22 DATA | D5 | 14 | pull-up 10 kOhm vers 3V3 (souvent deja sur le module) |
| PIR HC-SR501 OUT | D6 | 12 | alim 5V (VIN), sortie 3.3 V compatible |
| MQ-2 AO | A0 | ADC | alim 5V : **pont diviseur obligatoire** si la sortie depasse 3.3 V (ex. 10k / 20k) |
| Buzzer piezo | D7 | 13 | passif par defaut (`BUZZER_PASSIVE` dans `config.h`) |
| LED verte (liaison) | D0 | 16 | resistance 220 Ohm |
| LED rouge (alerte) | D8 | 15 | resistance 220 Ohm vers GND (ne pas tirer D8 a l'etat haut au boot) |

Toutes les masses sont communes. Le brochage, les intervalles et les seuils se
modifient dans [include/config.h](include/config.h).

## Architecture (clean architecture)

```
lib/sentinel_core/        coeur en C++ pur, sans dependance Arduino
  src/domain/             commandes, fail-safe gaz, etat des alarmes,
                          tampon hors ligne, mesures
  src/application/        ports (Sensors, Actuators, TelemetryLink,
                          StatusDisplay, Clock, Logger) et orchestrateur Sentinel
src/
  infrastructure/         adaptateurs Arduino : capteurs DHT22/MQ-2/PIR, GPIO,
                          liaison Wi-Fi + MQTTS, ecran OLED, horloge NTP, journal serie
  main.cpp                composition root
test/test_core/           tests Unity du coeur, executes sur l'ordinateur
```

Le coeur decide quand mesurer, publier, mettre en tampon et alerter ; les
adaptateurs ne font que parler au materiel. Il se teste sans carte :

```sh
pio test -e native
```

## Comportement

- Mesures toutes les 2 s (DHT22, MQ-2 moyenne sur 8 echantillons, PIR) publiees
  sur `esp8266/donnees`. Un changement d'etat du PIR est publie immediatement.
- Format JSON, compatible avec `iot-backend/src/infrastructure/messaging/messages.ts` :

  ```json
  {"device":"sentinel-x-01","ts":1791280000,"temperature":22.5,"humidity":48.0,"gas":123,"presence":false,"rssi":-61}
  ```

  `ts` (epoch en secondes) date la mesure ; il est omis tant que l'heure n'est
  pas synchronisee par NTP.

  `gas` est la valeur brute de l'ADC (0-1023). `temperature` et `humidity` sont
  omises si la lecture du DHT22 echoue (le backend rejetterait un `NaN`).
  `device` et `rssi` sont des champs supplementaires ignores par le backend actuel.
- Etat du boitier sur `esp8266/status` (retenu) : `online` a la connexion,
  `offline` publie par le broker via le Last Will en cas de perte.
- Commandes texte recues sur `esp8266/led` (insensibles a la casse) :

  | Commande | Effet |
  | --- | --- |
  | `ON` / `OFF` | LED rouge d'alerte (commande actuelle du dashboard) |
  | `BUZZER_ON` / `BUZZER_OFF` | buzzer intermittent |
  | `ALARM_ON` / `ALARM_OFF` | LED rouge + buzzer |

- LED verte fixe : MQTTS connecte ; clignotante : connexion Wi-Fi/MQTT en cours.
- Ecran OLED : IP, RSSI, etat de la liaison, mesures et bandeau d'alerte.
- Fail-safe local : si le gaz depasse `GAS_FAILSAFE_THRESHOLD` (apres 60 s de
  prechauffage du MQ-2), LED rouge clignotante et buzzer, meme sans reseau.
  Ce n'est pas la detection d'anomalies (qui reste l'IA cote serveur) mais une
  securite physique ; `GAS_FAILSAFE_THRESHOLD = 0` la desactive.
- Reconnexion Wi-Fi automatique et reconnexion MQTT avec backoff (2 s a 30 s).
- Tampon hors ligne : pendant une coupure, les mesures horodatees sont
  conservees (150 mesures, soit 5 min) puis rejouees a la reconnexion, de la
  plus ancienne a la plus recente. Le backend les range a leur date :
  l'historique du dashboard n'a pas de trou.

## Securite TLS

- Le firmware verifie le certificat du broker avec la CA de table
  (`MQTT_CA_CERT`) **et** le nom d'hote : l'IP de `MQTT_HOST` doit figurer dans
  le SAN du certificat serveur.
- La verification des dates du certificat necessite l'heure. Le reseau de table
  n'ayant pas Internet, faire servir NTP par le PC Serveur Local (`chrony` avec
  `allow 192.168.10.0/24` et `local stratum 10`). A defaut, l'heure de
  compilation est utilisee.
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
`mosquitto_passwd passwd backend`. Cette configuration a ete validee avec
`mosquitto_pub --cafile certs/ca.crt`.

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
explicite si `secrets.h` est absent.

## Compilation Et Televersement

Avec l'extension PlatformIO de VSCode (boutons Build / Upload / Monitor), ou en
ligne de commande depuis ce dossier :

```sh
pio run                    # compiler
pio run -t upload          # televerser par USB
pio device monitor         # journal serie a 115200 bauds
```

Le journal serie affiche la connexion Wi-Fi, la synchronisation NTP, les
erreurs TLS eventuelles (`[TLS] erreur ...`) et chaque message publie.

## Depannage

| Symptome | Cause probable |
| --- | --- |
| `[TLS] erreur ... certificate` | CA incorrecte, IP absente du SAN, ou certificat hors validite |
| `[MQTT] echec (etat 5)` | identifiants MQTT refuses |
| `[MQTT] echec (etat -2)` | broker injoignable : IP, port 8883, pare-feu (UFW) |
| `T --.-C` sur l'ecran | DHT22 mal cable ou pull-up absente |
| Valeur gaz bloquee a 1023 | tension trop elevee sur A0 : verifier le pont diviseur |
| Detections PIR au demarrage | le HC-SR501 a besoin d'environ 60 s de stabilisation |
