"""Verify real packaged HTTP bytes without a browser, server or provider call."""
import hashlib
import json
from pathlib import Path
import re
import sys
from tempfile import TemporaryDirectory
from zipfile import ZipFile


def main():
    wheel = Path(sys.argv[1]).resolve()
    with TemporaryDirectory(prefix='arc-wheel-check-') as scratch:
        root = Path(scratch)
        with ZipFile(wheel) as archive:
            assert archive.testzip() is None
            assert not any(name.endswith('.blend') for name in archive.namelist())
            archive.extractall(root / 'installed')
        sys.path.insert(0, str(root / 'installed'))
        from arc_science.service import create_app
        import arc_science
        from fastapi.testclient import TestClient
        assert str(root / 'installed') in arc_science.__file__
        assert arc_science.__version__ == '0.5.0'
        with TestClient(create_app(data_dir=root / 'data', token='t' * 40)) as client:
            page = client.get('/')
            scripts = re.findall(r'<script[^>]+src="([^"]+)"', page.text)
            assert len(scripts) == 1
            assert sorted(path.name for path in (root / 'installed/arc_science/static/web/assets').glob('*.js')) == [Path(scripts[0]).name], 'Wheel contains stale compiled JavaScript'
            js = client.get(scripts[0])
            assert js.status_code == 200 and 'vision_review' in js.text and 'Molecules' in js.text
            assert client.get('/THIRD_PARTY_NOTICES.md').status_code == 200
            example = client.get('/api/examples/1dqj').json()
            for asset in example['assets'].values():
                response = client.get(asset['url'])
                assert response.status_code == 200
                assert len(response.content) == asset['bytes']
                assert hashlib.sha256(response.content).hexdigest() == asset['sha256']
            png = client.get(example['assets']['collage.png']['url']).content
            assert hashlib.sha256(png).hexdigest() == '7394f162dca9bba20ca985a2cd43473da2c9df7d88be5e39acaec81f30f598d9'
            assert client.get('/api/examples/1dqj/assets/overview.blend').status_code == 404
            assert client.get('/api/missions').status_code == 401
            assert client.get('/api/missions',headers={'Authorization':'Bearer '+'t'*40}).json() == []
            print(json.dumps({'wheel':wheel.name,'wheel_sha256':hashlib.sha256(wheel.read_bytes()).hexdigest(),'public_assets':len(example['assets']),'compiled_js_bytes':len(js.content),'installed_package_http_checks':'passed'}))


if __name__ == '__main__':
    main()
