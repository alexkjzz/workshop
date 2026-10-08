# Publier Sentinel-X sur GitHub

Le code source, les tests, les fichiers de dependances verrouilles et les
configurations d'exemple sont partageables. Les configurations locales, comptes,
mesures reelles, photos de reference, modeles telecharges ou entraines, caches et
certificats generes restent sur votre machine et sont ignores par Git.

## Contenu du depot

- `iot-frontend/` : dashboard React/Vite, tests et build.
- `iot-backend/` : API Express/TypeScript, MQTT, SQLite, authentification et relais IA.
- `ai/` : FastAPI, Isolation Forest, YOLO + ByteTrack, fusion et reconnaissance faciale.
- `firmware/` : firmware ESP8266 actuel (capteurs, alarmes locales, sortie serie USB).
- `scripts/` : installation Windows, passerelle USB et validations locales.
- `.github/workflows/ci.yml` : verification automatique des applications, de l'IA
  et compilation du firmware.

Le fichier public `ai/data/sensor_data.example.csv` contient uniquement les noms
de colonnes. Les mesures exportees vers `ai/data/sensor_data.csv` restent privees.
Les sous-dossiers de `ai/known_faces/` ne doivent jamais etre ajoutes avec `git add -f`.
Les notices de licence des modeles sont conservees ; aucune licence globale du
projet n'a ete choisie automatiquement.
Les exemples `.env.example` existent a la racine pour Docker, dans
`iot-backend/` et dans `ai/` pour les services natifs.

## Premier push

Creer un depot vide sur GitHub nomme, par exemple, `sentinel-x`. Laisser les
options d'initialisation README, licence et gitignore desactivees : le projet
possede deja un historique local. Depuis la racine, dans PowerShell :

```powershell
git status --short
git add .
py -3.12 scripts/check-repository.py
git diff --cached --stat
git diff --cached --check
git commit -m "Prepare Sentinel-X for GitHub"
git branch -M main
git remote add origin https://github.com/VOTRE_COMPTE/sentinel-x.git
git push -u origin main
```

Remplacer `VOTRE_COMPTE` par votre identifiant et adapter le nom du depot.
Si les changements sont deja committes et `git status` indique un repertoire
propre, ignorer les lignes `git add` et `git commit`.
L'authentification GitHub s'effectue avec votre gestionnaire d'identifiants ou
SSH ; ne mettre aucun token dans l'URL du remote ni dans un fichier du projet.
Si `origin` existe deja, verifier sa destination avec `git remote -v` et utiliser
`git remote set-url origin ...` seulement si vous souhaitez la changer.

Le controle Python ne demande aucune dependance supplementaire. Avec
l'environnement IA deja installe, vous pouvez aussi utiliser :

```powershell
.\ai\.venv\Scripts\python.exe scripts\check-repository.py
```

Il verifie les fichiers de l'index et leur contenu de travail : chemins prives,
fichiers generes, fichiers de plus de 10 Mio, formats de tokens courants et
correspondance avec les secrets de vos `.env` locaux. Il ne remplace pas une
revue de l'historique ou un scanner exhaustif de secrets. Aucun secret ne doit
etre publie sous pretexte que ce controle passe.

## Reinstaller depuis un clone

```powershell
git clone https://github.com/VOTRE_COMPTE/sentinel-x.git
Set-Location .\sentinel-x
powershell.exe -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows.ps1
```

Le script installe les dependances, cree les `.env` locaux absents a partir des
exemples et genere le secret d'authentification. Il preserve les configurations
existantes. Les modeles et photos prives ne sont pas fournis par Git :

- Modeles faciaux : depuis `ai/`, lancer `.\.venv\Scripts\python.exe -m app.vision.setup_faces`.
- YOLO : voir [installation vision](../ai/README.md).
- Isolation Forest : collecter des donnees normales et suivre
  [l'entrainement](../ai/README.md#entrainement-sur-mesures-reelles).
- Photos connues : suivre [Face Recognition](../README.md#face-recognition).
- Donnees ESP USB : suivre [le guide serie](esp-serial.md).

## Verifications locales

```powershell
npm.cmd --prefix iot-backend test
npm.cmd --prefix iot-backend run typecheck
npm.cmd --prefix iot-backend run build
npm.cmd --prefix iot-frontend test
npm.cmd --prefix iot-frontend run lint
npm.cmd --prefix iot-frontend run build
.\ai\.venv\Scripts\python.exe -m pytest ai\tests -q
.\ai\.venv\Scripts\python.exe -m unittest discover -s scripts\tests -v
.\ai\.venv\Scripts\python.exe firmware\tests\run_native.py
pio run -d firmware -e nodemcuv2
```

La CI reproduit ces verifications sans webcam ni ESP physique. La validation
du materiel et du flux temps reel reste locale. Les scripts d'integration
supplementaires sont documentes dans [le guide IA](../ai/README.md).
