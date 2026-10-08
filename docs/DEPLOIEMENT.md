# Deploiement en production

Guide complet (architecture, securite, exploitation, depannage) :
[docs/pdf/Sentinel-X_Guide-deploiement.pdf](pdf/Sentinel-X_Guide-deploiement.pdf).

## Demarrage rapide (Linux 64 bits, Docker Engine + compose)

```sh
git clone <url-du-depot> /opt/sentinel-x && cd /opt/sentinel-x
echo "PUBLIC_HOSTS=192.168.10.1" > .env      # adresse du serveur (recommande)
docker compose up -d --build
docker compose exec backend cat /run/sentinel/secrets/initial-admin-password
```

- Installer `deploy/runtime/sentinel-x-ca.crt` comme autorite de confiance sur
  les postes clients, puis ouvrir `https://192.168.10.1`.
- Se connecter avec `admin@sentinel-x.local` et le mot de passe affiche, puis
  creer les comptes : `docker compose exec backend node dist/cli/create-user.js <email> "<nom>"`.
- Brancher le boitier ESP8266 (USB) et la webcam : ils sont detectes a chaud.

Aucun secret n'est a saisir : le service `init` cree a chaque demarrage (sans
rien ecraser) l'autorite de certification locale, les certificats TLS de chaque
service et tous les secrets. Toutes les liaisons sont chiffrees (HTTPS, MQTTS),
seuls les ports 80 (redirection) et 443 sont publies.
