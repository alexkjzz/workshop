"""Real OpenCV inference on public sample images, with no production enrollment."""
import sys
import tempfile
from pathlib import Path
from urllib.request import urlopen

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'ai'))

import cv2
from app.config import Settings
from app.vision.face_recognition import FaceRecognitionService

with tempfile.TemporaryDirectory(prefix='sentinel-face-check-') as directory:
    root = Path(directory)
    for filename in ('lena.jpg', 'messi5.jpg'):
        with urlopen(f'https://raw.githubusercontent.com/opencv/opencv/master/samples/data/{filename}', timeout=30) as response:
            (root / filename).write_bytes(response.read())
    known = root / 'known' / 'OpenCV sample'
    known.mkdir(parents=True)
    lena = cv2.imread(str(root / 'lena.jpg'))
    for index, factor in enumerate((1., .95, 1.05)):
        cv2.imwrite(str(known / f'{index}.jpg'), cv2.convertScaleAbs(lena, alpha=factor))
    service = FaceRecognitionService(Settings(face_enabled=True, face_known_dir=root / 'known', face_min_size=10))
    loaded = service.reload()
    assert loaded.model_loaded, loaded.error
    assert loaded.known_identities == 1 and loaded.reference_images == 3, loaded
    session = service.camera_started()
    transformed = cv2.convertScaleAbs(lena, alpha=.9, beta=5)
    result = service.process(transformed, [], session)
    assert result.faces and result.faces[0].known, result
    print(f'PASS real YuNet/SFace recognition: {result.faces[0].name}, similarity={result.faces[0].confidence:.3f}')
    unknown = service.process(cv2.imread(str(root / 'messi5.jpg')), [], session)
    assert unknown.faces and all(not face.known for face in unknown.faces), unknown
    print(f'PASS different real face: Unknown, similarity={unknown.faces[0].similarity}')
    for image in known.iterdir():
        image.unlink()
    assert service.reload().known_identities == 0
    empty = service.process(lena, [], session)
    assert empty.faces and empty.faces[0].name == 'Unknown' and empty.faces[0].similarity is None
    service.shutdown()
    print('PASS reload to zero identities; production reference directory untouched.')
