"""Reserve the listening socket before loading models or starting the webcam."""
import errno
import json
import logging
import socket
import ssl
from urllib.request import urlopen

from app.config import Settings

logger = logging.getLogger("STARTUP")


def local_service_url(settings: Settings) -> str:
    host = {"0.0.0.0": "127.0.0.1", "::": "::1", "": "127.0.0.1"}.get(settings.host, settings.host)
    scheme = "https" if settings.tls_cert_file else "http"
    return f"{scheme}://{'[' + host + ']' if ':' in host else host}:{settings.port}"


def existing_service_is_sentinel(settings: Settings) -> bool:
    try:
        context = None
        if settings.tls_cert_file:
            context = ssl.create_default_context(cafile=str(settings.tls_ca_file) if settings.tls_ca_file else None)
            # The certificate names the service (ai); the check targets the loopback address.
            context.check_hostname = False
        with urlopen(local_service_url(settings) + "/health", timeout=2, context=context) as response:
            health = json.load(response)
        return isinstance(health, dict) and health.get("service") == "sentinel-x-ai" and health.get("status") == "ok"
    except (OSError, ValueError):
        return False


def reserve_listener(settings: Settings) -> socket.socket | None:
    family = socket.AF_INET6 if ":" in settings.host else socket.AF_INET
    try:
        # create_server does not enable SO_REUSEADDR on Windows. Reserving and
        # passing this same socket to Uvicorn also avoids a check/bind race.
        return socket.create_server((settings.host, settings.port), family=family)
    except OSError as error:
        if error.errno not in {errno.EADDRINUSE, 10048}:
            raise
        if existing_service_is_sentinel(settings):
            logger.info("Sentinel-X IA est déjà démarré sur %s. Utilisez cette instance depuis le dashboard.", local_service_url(settings))
            return None
        logger.error("Le port %s est occupé et aucun service Sentinel-X actif n'a été identifié. "
                     "Vérifiez le processus utilisant ce port avant de relancer l'IA.", settings.port)
        raise SystemExit(1) from None
