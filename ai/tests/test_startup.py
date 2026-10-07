import errno
import io
import json
import socket
import threading
import time
from urllib.request import urlopen
from unittest.mock import Mock

import pytest

from app.config import Settings
from app import main as module
from app.utils import startup


def occupied(*args, **kwargs):
    raise OSError(errno.EADDRINUSE, 'Address already in use')


def test_existing_sentinel_returns_without_initializing_models_or_webcam(monkeypatch, caplog):
    monkeypatch.setattr(startup.socket, 'create_server', occupied)
    response = io.BytesIO(json.dumps({'status': 'ok', 'service': 'sentinel-x-ai', 'model_loaded': False}).encode())
    monkeypatch.setattr(startup, 'urlopen', lambda *args, **kwargs: response)
    create = Mock(side_effect=AssertionError('A duplicate launch must not load models'))
    monkeypatch.setattr(module, 'create_app', create)
    with caplog.at_level('INFO', logger='STARTUP'):
        module.main()
    create.assert_not_called()
    assert 'déjà démarré' in caplog.text


@pytest.mark.parametrize('health', [{'status': 'ok', 'service': 'another-service'}, {'status': 'error', 'service': 'sentinel-x-ai'}, []])
def test_unknown_port_owner_is_not_stopped_or_replaced(monkeypatch, health, caplog):
    monkeypatch.setattr(startup.socket, 'create_server', occupied)
    monkeypatch.setattr(startup, 'urlopen', lambda *args, **kwargs: io.BytesIO(json.dumps(health).encode()))
    with pytest.raises(SystemExit) as failure:
        startup.reserve_listener(Settings())
    assert failure.value.code == 1 and 'port' in caplog.text


def test_busy_but_unresponsive_port_reports_conflict(monkeypatch):
    monkeypatch.setattr(startup.socket, 'create_server', occupied)
    def timeout(*args, **kwargs):
        raise TimeoutError('health timeout')
    monkeypatch.setattr(startup, 'urlopen', timeout)
    with pytest.raises(SystemExit):
        startup.reserve_listener(Settings())


def test_other_binding_errors_are_not_misclassified_as_an_existing_service(monkeypatch):
    def denied(*args, **kwargs):
        raise OSError(errno.EACCES, 'Access denied')
    monkeypatch.setattr(startup.socket, 'create_server', denied)
    with pytest.raises(OSError) as error:
        startup.reserve_listener(Settings())
    assert error.value.errno == errno.EACCES


def test_first_launch_passes_reserved_socket_to_uvicorn_before_app_creation(monkeypatch):
    import uvicorn
    order = []
    class Listener:
        def __enter__(self): return self
        def __exit__(self, *args): order.append('closed')
    listener = Listener()
    def reserve(settings):
        order.append('reserved')
        return listener
    def create(settings):
        order.append('app')
        return object()
    def run(server, sockets):
        assert sockets == [listener] and server.config.factory
        assert order == ['reserved']
        server.config.app()
    monkeypatch.setattr(module, 'reserve_listener', reserve)
    monkeypatch.setattr(module, 'create_app', create)
    monkeypatch.setattr(uvicorn.Server, 'run', run)
    module.main()
    assert order == ['reserved', 'app', 'closed']


def test_wildcard_and_ipv6_health_addresses_are_local():
    assert startup.local_service_url(Settings(host='0.0.0.0', port=8001)) == 'http://127.0.0.1:8001'
    assert startup.local_service_url(Settings(host='::', port=8001)) == 'http://[::1]:8001'


def test_keyboard_interrupt_closes_the_owned_socket_without_a_traceback(monkeypatch):
    import uvicorn
    closed = []
    class Listener:
        def __enter__(self): return self
        def __exit__(self, *args): closed.append(True)
    def interrupt(*args, **kwargs):
        raise KeyboardInterrupt
    monkeypatch.setattr(module, 'reserve_listener', lambda settings: Listener())
    monkeypatch.setattr(uvicorn.Server, 'run', interrupt)
    module.main()
    assert closed == [True]


def test_real_main_serves_health_and_a_second_launch_keeps_the_same_instance(monkeypatch, tmp_path):
    import uvicorn
    with socket.socket() as probe:
        probe.bind(('127.0.0.1', 0))
        port = probe.getsockname()[1]
    settings = Settings(host='127.0.0.1', port=port, face_enabled=False,
                        vision_auto_start=False, service_token='', model_path=tmp_path / 'missing.joblib')
    monkeypatch.setattr(module, 'Settings', lambda: settings)
    servers = []
    original_server = uvicorn.Server
    class OwnedServer(original_server):
        def __init__(self, config):
            super().__init__(config)
            servers.append(self)
    monkeypatch.setattr(uvicorn, 'Server', OwnedServer)
    worker = threading.Thread(target=module.main, daemon=True)
    worker.start()
    try:
        deadline = time.monotonic() + 10
        while True:
            try:
                with urlopen(f'http://127.0.0.1:{port}/health', timeout=.5) as response:
                    health = json.load(response)
                break
            except OSError:
                assert time.monotonic() < deadline
                time.sleep(.02)
        assert health['service'] == 'sentinel-x-ai' and health['status'] == 'ok'
        module.main()
        assert len(servers) == 1 and worker.is_alive()
    finally:
        if servers:
            servers[0].should_exit = True
        worker.join(5)
        assert not worker.is_alive()
