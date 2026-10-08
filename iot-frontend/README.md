# Interface web SENTINEL-X

Application React/Vite : page de connexion, page Metriques (etat du broker,
valeurs courantes, graphiques temps reel et tableaux des valeurs precedentes),
page Camera (flux de la webcam et reconnaissance faciale) et page Parametres
(notifications par e-mail). Theme clair/sombre (suit le
systeme jusqu'au premier choix).

Les pages partagent les couleurs, surfaces, boutons et focus clavier definis dans
`src/presentation/index.css`. Les panneaux s'adaptent aux grands ecrans et au
mobile ; les historiques larges defilent dans leur propre tableau.

La page Metriques affiche aussi **AI ENGINE** : disponibilite du service,
Isolation Forest, score d'anomalie, risque fusionne, confiance et evenements
recents. Un modele non entraine, des donnees manquantes ou une analyse partielle
sont affiches explicitement. Les derniers resultats restent consultables pendant
une interruption du service IA, avec leur horodatage et leur origine
(`live` ou `SIMULATION`).

Le panneau **Etat du boitier ESP** affiche le prechauffage MQ-2, la calibration
PIR, la validite DHT22, l'alarme locale et les LEDs transmis par le firmware USB.
Les etats absents ou sans mesure recente restent inconnus ; les valeurs
invalides ne deviennent pas des zeros dans les graphiques. La passerelle USB
transmet uniquement les mesures : les commandes LED exigent un firmware MQTT.

## Architecture (clean architecture)

```
src/
  domain/          types et regles pures (fusion de l'historique, fraicheur
                   d'une detection, series de valeurs)
  application/     ports : DeviceApi, AiApi, SettingsApi, LiveFeed, AuthService, ThemeStore
  infrastructure/  adaptateurs : fetch (/api), EventSource (/api/stream),
                   client Better Auth, localStorage
  presentation/    composants, pages et hooks React ; les services sont
                   injectes par ServicesContext
  main.tsx         composition root : instancie les adaptateurs concrets
```

Les composants ne connaissent que les ports : remplacer le transport (REST,
SSE) ou l'authentification ne touche pas a la presentation.

Le meme EventSource `/api/stream` transporte `reading`, `vision`, `ai` et
`ai-status`. Les premieres analyses viennent de `/api/ai/history` et
`/api/ai/latest`; la disponibilite est verifiee toutes les cinq secondes sur
`/api/ai/status`. L'interface ne contacte jamais directement Python.

Les commandes webcam passent par `/api/ai/vision/start` et
`/api/ai/vision/stop`. Le flux MJPEG annote par YOLO utilise le relais existant
`/api/camera/stream`, derriere la session du backend. Il est visible dans le
dashboard lorsque la vision est active et sur la page Camera. Les anciennes
detections de visages et leur historique restent disponibles. La webcam est
celle du PC serveur; le navigateur ne demande pas d'acces a sa propre camera.

La section **Reconnaissance faciale** reçoit `vision.faces` via le statut IA et
le SSE existant. Elle affiche les noms, Connu/Inconnu, similarité, heure et
tracker ID lorsqu'il existe, ainsi que les 20 événements récents. Le bouton
de rechargement appelle `/api/ai/vision/faces/reload` via Express. Le formulaire
**Ajouter une personne** envoie un nom et une a cinq photos via
`/api/ai/vision/faces/enroll`, puis actualise le catalogue automatiquement. Les photos de
référence restent dans le service Python ; voir
[Face Recognition](../docs/FACE_RECOGNITION.md).

## Commandes

Depuis `iot-frontend/`, apres `npm ci` (ou le script d'installation racine) :

```sh
npm run dev      # Vite, /api relaye vers http://127.0.0.1:3001
npm test         # regles du domaine (test runner integre a Node)
npm run lint
npm run build
```

En production, l'image Docker sert le build avec nginx (`nginx.conf`), qui
relaie `/api` vers le backend et applique les en-tetes de securite (CSP).
`public/theme-init.js` applique le theme avant le premier affichage ; c'est un
fichier externe pour rester compatible avec la CSP.

Apres le build, depuis la racine du depot :

```sh
node scripts/check-frontend-style.mjs
```

Ce controle pilote Edge, Chrome ou Chromium sur une instance Vite isolee avec
des reponses API factices. Il verifie les quatre pages en clair/sombre, a
1440, 375 et 320 pixels, le focus clavier, les commandes accessibles et les
contrastes de texte principaux. Les captures et le rapport sont conserves dans
`.runtime/`. Aucun service reel, webcam, envoi d'e-mail ou commande ESP n'est
utilise. `STYLE_TEST_BROWSER` permet de choisir l'executable du navigateur.
