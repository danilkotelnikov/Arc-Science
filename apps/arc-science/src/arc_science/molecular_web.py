"""A fixed public example, separate from authenticated mission artifacts."""
import hashlib
from pathlib import Path

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

router = APIRouter()
ASSET_ROOT = Path(__file__).parent / 'example_assets' / '1dqj'
# Deliberately not a directory listing: new files are private until reviewed here.
ASSETS = {
    'collage.png': 'image/png', 'collage.svg': 'image/svg+xml',
    'overview.png': 'image/png', 'interface.png': 'image/png', 'rotated.png': 'image/png',
    'overview.svg': 'image/svg+xml', 'interface.svg': 'image/svg+xml', 'rotated.svg': 'image/svg+xml',
    'contacts.csv': 'text/csv', 'source.cif': 'chemical/x-cif',
    'scene.json': 'application/json', 'molecular_worker.py': 'text/plain',
    'manifest.json': 'application/json', 'worker-receipt.json': 'application/json',
    'checks.json': 'application/json', 'run.json': 'application/json',
    'caption.md': 'text/plain', 'visual-review.md': 'text/plain',
    'review-packet-metadata.json': 'application/json', 'integrity.json': 'application/json',
}


@router.get('/api/examples/1dqj')
def molecular_example():
    assets = {}
    for name, media_type in ASSETS.items():
        data = (ASSET_ROOT / name).read_bytes()
        assets[name] = {'url': '/api/examples/1dqj/assets/' + name,
                        'sha256': hashlib.sha256(data).hexdigest(),
                        'bytes': len(data), 'media_type': media_type}
    return {
        'id': '1dqj', 'title': 'HyHEL-63 Fab · Lysozyme',
        'source': {'database': 'RCSB PDB', 'id': '1DQJ',
                   'url': 'https://www.rcsb.org/structure/1DQJ', 'model': 1, 'assembly': '1',
                   'assembly_note': 'Identity operators verified',
                   'sha256': '176f9d155fdf18650f8221007511dbde90f0fc19de9462d59515ce590bb30250'},
        'partners': {'antibody': ['A', 'B'], 'antigen': ['C']},
        'cutoff_angstrom': 4.0, 'contact_pairs': 49,
        'review': {'status': 'Accepted illustrative figure, candidate 03',
                   'scope': 'Historical direct image review; not scientific or publication qualification',
                   'live_provider_qualified': False, 'browser_layout_verified': False},
        'limitations': ['Gaussian atomic envelope, not a solvent-excluded surface.',
                       'Contacts are geometric heavy-atom distances, not hydrogen bonds or affinity.',
                       'Rotated view shows only the three nearest residue pairs.',
                       'Native transparent PNG views are unlabeled. Focused SVGs retain annotations.',
                       'Editable .blend files remain in the separately delivered bundle.'],
        'assets': assets,
    }


@router.get('/api/examples/1dqj/assets/{filename:path}')
def molecular_asset(filename: str):
    if filename not in ASSETS:
        raise HTTPException(404, 'Unknown example asset')
    # Only these reviewed hybrid SVGs need embedded data images. They cannot run scripts.
    headers = {'Content-Security-Policy': "default-src 'none'; img-src data:; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'; sandbox"} if filename.endswith('.svg') else {}
    return FileResponse(ASSET_ROOT / filename, media_type=ASSETS[filename], headers=headers,
                        filename=filename, content_disposition_type='inline')
