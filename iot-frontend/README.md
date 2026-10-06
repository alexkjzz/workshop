# Interface web SENTINEL-X

Application React/Vite : page de connexion, page Metriques (etat du broker,
valeurs courantes, graphiques temps reel et tableaux des valeurs precedentes),
page Camera (flux de la webcam et reconnaissance faciale) et page Parametres
(notifications par e-mail). Theme clair/sombre (suit le
systeme jusqu'au premier choix).

## Architecture (clean architecture)

```
src/
  domain/          types et regles pures (fusion de l'historique, fraicheur
                   d'une detection, series de valeurs)
  application/     ports : DeviceApi, SettingsApi, LiveFeed, AuthService, ThemeStore
  infrastructure/  adaptateurs : fetch (/api), EventSource (/api/stream),
                   client Better Auth, localStorage
  presentation/    composants, pages et hooks React ; les services sont
                   injectes par ServicesContext
  main.tsx         composition root : instancie les adaptateurs concrets
```

Les composants ne connaissent que les ports : remplacer le transport (REST,
SSE) ou l'authentification ne touche pas a la presentation.

## Commandes

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
