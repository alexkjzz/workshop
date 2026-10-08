# Photos de référence

Dans **Caméra → Reconnaissance faciale → Ajouter une personne**, saisir le nom,
sélectionner 1 à 5 photos JPEG, PNG ou WebP, puis cliquer **Enregistrer la personne**.
Le navigateur passe uniquement par Express ; le service IA ajoute les fichiers
dans ce dossier et recharge automatiquement le catalogue. La webcam peut être
arrêtée ; le modèle facial doit être disponible.

Recommandation : 3 à 5 photos nettes avec un seul visage par photo et quelques
variations d'éclairage et d'angle. Limites d'envoi : 5 Mio par photo, 15 Mio au
total, 4096 pixels par côté et 16 mégapixels. Les refus sont expliqués par fichier ;
un envoi peut ajouter certaines photos et en refuser d'autres.

Les photos acceptées sont converties en JPEG, renommées par UUID, orientées
correctement et débarrassées des métadonnées EXIF. Réutiliser un nom existant
ajoute des références à la même identité sans écraser ses anciennes photos.
Le dossier utilisé reste celui de `FACE_KNOWN_DIR` ; aucune nouvelle variable
`.env` n'est nécessaire.

L'ajout manuel reste possible : créer un dossier par personne, par exemple
`Mohamed/photo1.jpg`. Utiliser **Recharger les visages connus** sur la page Caméra
après ajout manuel, suppression ou remplacement. Les références et embeddings
restent locaux et les photos sont ignorées par Git. Sans photo exploitable,
les visages détectés sont **Inconnu**.

Procédure complète, API et test isolé :
[Face Recognition](../../docs/FACE_RECOGNITION.md).
