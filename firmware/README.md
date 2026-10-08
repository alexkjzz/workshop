# Sentinel-X : firmware ESP8266 USB

Le firmware mesure DHT, MQ-2 et PIR, pilote localement les LEDs et le buzzer,
affiche les mesures sur SSD1306 et imprime des blocs serie a 115200 bauds.
Il ne contient ni Wi-Fi ni client MQTT ; la passerelle USB du projet lit les
blocs existants sans commander la carte.

La configuration canonique est `include/sentinel_config.h` ; `config.h` est
un alias de compatibilite. Les broches par defaut restent DHT D5, PIR D6,
MQ-2 A0, buzzer D7, LEDs verte D0/rouge D4/orange D8, I2C SDA D2/SCL D1.
Les sorties sont actives HIGH, pour des LEDs externes. La LED integree D4
peut avoir une polarite differente. D8/GPIO15 doit rester LOW au demarrage.

Le type configure par defaut est **DHT22**. Ce choix logiciel ne prouve pas
le type physique : lire la reference du capteur et verifier le cablage.
Pour adapter un capteur confirme, ajouter dans `platformio.ini` :

```ini
build_flags =
    -I include
    -DDHT_TYPE=22
    -DPIN_DHT=14
```

`PIN_DHT` utilise le numero GPIO (D5 = GPIO14). Les types de la bibliotheque
acceptes sont 11, 12, 21 et 22. Le demarrage imprime le type, la broche et
l'intervalle configures. Aucune detection automatique du type n'est effectuee.

La premiere lecture DHT attend 2 secondes et les suivantes sont espacees
d'au moins 2 secondes. NaN, infinis et valeurs hors -40..80 C / 0..100 % sont
invalides et effaces ; une mesure valide n'est pas corrigee artificiellement.
76.8 C / 6.9 % respecte ces limites techniques : comparer avec un thermometre
et verifier le capteur avant d'interpreter cette observation comme l'ambiance.

PIR : calibration 45 secondes ; MQ-2 : chauffe 60 secondes, alerte ADC a 600,
retour normal a 550. Le gaz est une valeur ADC brute, pas des ppm. L'alarme
locale reste gaz **ou** mouvement ; une erreur DHT affiche un avertissement
sans desactiver ces alarmes. Ces seuils et delais de demonstration doivent
etre evalues avec le materiel utilise. La fin de chauffe est memorisee meme
apres debordement de `millis()`. Un nouvel appel `begin()` reinitialise les etats.

L'OLED verifie l'acquittement I2C a l'initialisation et lors des rafraichissements.
Il signale un climat invalide et retente une connexion absente toutes les
5 secondes ; les alarmes locales continuent sans ecran.

Depuis la racine du depot, avec PlatformIO installe :

```sh
pio run -d firmware
python firmware/tests/run_native.py
```

Le runner natif utilise g++, clang++ ou Zig disponible dans le PATH. On peut
specifier `--compiler /chemin/vers/zig` (ou son chemin Windows). Il compile
les vraies classes Sentinel, BoardSensors, GPIO et OLED avec des doubles
Arduino/DHT/I2C ; il ne recopie pas leurs regles dans un modele de test.
Il execute les cas par defaut puis avec des overrides de configuration.
Les tests ne valident ni le capteur physique ni sa precision. `pio run`
compile uniquement : aucun flash ni changement d'un service reel.
