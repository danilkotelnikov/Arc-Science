"""Bounded provider configuration and data contracts (observed website, not API)."""
from dataclasses import dataclass, field, fields
import os
from pathlib import Path
import re

ORIGIN = 'https://bioart.niaid.nih.gov'


def positive_id(value):
    if type(value) is not int or not 0 < value < 2**53:
        raise ValueError('Invalid BioArt identity')
    return value


@dataclass(frozen=True)
class BioArtRepresentation:
    group_id: int
    caption: str
    files: dict[str, int]


@dataclass(frozen=True)
class BioArtEntry:
    entry_id: int
    title: str
    license: str
    credit: str
    creator: str
    collection: str
    citation: str
    representations: tuple[BioArtRepresentation, ...]

    @property
    def preferred_representation_id(self):
        for term in ('grey', 'gray', 'blackwhite', 'black-and-white'):
            for representation in self.representations:
                if term in representation.caption.lower():
                    return representation.group_id
        return self.representations[0].group_id


@dataclass(frozen=True)
class BioArtSearchHit:
    entry_id: int
    title: str


@dataclass(frozen=True)
class BioArtReceipt:
    receipt_path: Path
    source_path: Path


@dataclass(frozen=True)
class BioArtLimits:
    max_metadata_bytes: int = 8 * 1024**2
    max_file_bytes: int = 32 * 1024**2
    max_cache_bytes: int = 256 * 1024**2
    metadata_ttl_seconds: int = 86400
    timeout_seconds: int = 30
    max_retries: int = 2

    def __post_init__(self):
        maxima = (64*1024**2, 128*1024**2, 4*1024**3, 604800, 120, 2)
        for item, maximum in zip(fields(self), maxima):
            value = getattr(self, item.name)
            minimum = 0 if item.name == 'max_retries' else 1
            if type(value) is not int or not minimum <= value <= maximum:
                raise ValueError('Invalid BioArt limit: ' + item.name)

    @classmethod
    def from_environment(cls):
        values = {}
        known = {'ARC_BIOART_CACHE_DIR'}
        for item in fields(cls):
            key = 'ARC_BIOART_' + item.name.upper()
            known.add(key)
            if key in os.environ:
                raw = os.environ[key]
                if not re.fullmatch(r'0|[1-9][0-9]{0,12}', raw):
                    raise ValueError('Invalid BioArt environment value: ' + key)
                values[item.name] = int(raw)
        if any(k.startswith('ARC_BIOART_') and k not in known for k in os.environ):
            raise ValueError('Unknown ARC_BIOART_ environment setting')
        return cls(**values)


@dataclass(frozen=True)
class BioArtSettings:
    cache_dir: Path
    limits: BioArtLimits = field(default_factory=BioArtLimits)

    @classmethod
    def from_environment(cls, project: Path):
        limits = BioArtLimits.from_environment()
        raw = os.environ.get('ARC_BIOART_CACHE_DIR', '.arc-science/bioart')
        if not raw or '\x00' in raw or '..' in Path(raw).parts:
            raise ValueError('Invalid BioArt cache path')
        root = Path(os.path.abspath(project))
        path = Path(raw)
        path = path if path.is_absolute() else root/path
        if not path.is_relative_to(root) or path == root:
            raise ValueError('BioArt cache must be inside the project')
        return cls(path, limits)
