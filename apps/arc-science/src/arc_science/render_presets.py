"""Blender render presets: named, fully specified styles the molecular pipeline applies.

A preset changes presentation only — background, lighting strength, material finish,
partner colours, envelope tightness, stick radius, figure width and sample count. It
never changes the coordinates, the chain selection, the contact cutoff or the
geometry the worker derives from them, and a render under any preset establishes no
scientific validity. The worker reads the style it is given from a file recorded in
the manifest, so a render replays under the preset it was made with.
"""
from __future__ import annotations

import re

HEX = re.compile(r'^#[0-9A-Fa-f]{6}$')
BACKGROUNDS = ('transparent', 'white', 'light', 'dark', 'black')
# Every style key with its bounds; the worker applies exactly these.
STYLE_SCHEMA = {
    'background': {'type': 'choice', 'choices': BACKGROUNDS},
    'world_strength': {'type': 'number', 'min': 0.0, 'max': 3.0},
    'roughness': {'type': 'number', 'min': 0.0, 'max': 1.0},
    'specular': {'type': 'number', 'min': 0.0, 'max': 1.0},
    'antibody_color': {'type': 'hex'},
    'antigen_color': {'type': 'hex'},
    'isovalue': {'type': 'number', 'min': 0.2, 'max': 0.8},
    'stick_radius': {'type': 'number', 'min': 0.1, 'max': 0.5},
}
RENDER_SCHEMA = {'width': {'min': 640, 'max': 2400}, 'samples': {'min': 1, 'max': 128}}
BASE = {'background': 'transparent', 'world_strength': 0.7, 'roughness': 0.72, 'specular': 0.22,
        'antibody_color': '#91AEC5', 'antigen_color': '#C4C9CC', 'isovalue': 0.45, 'stick_radius': 0.13}


def _preset(description, *, render=None, **style):
    unknown = set(style) - set(STYLE_SCHEMA)
    if unknown:
        raise ValueError('Unknown style keys: ' + ', '.join(sorted(unknown)))
    return {'description': description, 'style': {**BASE, **style}, 'render': dict(render or {})}


PRESETS = {
    'publication_white': _preset('The reviewed default: transparent film over a soft white world, matte partners in blue-grey and warm grey.'),
    'publication_transparent': _preset('The default look with the film left transparent and the world dimmed for compositing.', world_strength=0.5),
    'publication_dark': _preset('A dark world with brighter, slightly glossier partners for slides.', background='dark', world_strength=1.0,
                                roughness=0.55, specular=0.35, antibody_color='#9ECAE1', antigen_color='#E0E0E0'),
    'publication_black': _preset('Black world, luminous partners; for posters on dark backgrounds.', background='black', world_strength=1.2,
                                 roughness=0.5, specular=0.4, antibody_color='#A6CEE3', antigen_color='#F0F0F0'),
    'flat_diagram': _preset('Matte, specular-free surfaces that read as a diagram rather than a photograph.', roughness=1.0, specular=0.0,
                            world_strength=0.9),
    'glossy': _preset('Glossy surfaces with visible highlights.', roughness=0.3, specular=0.5),
    'colourblind_safe': _preset('Okabe–Ito partner colours (blue and orange) with the default finish.', antibody_color='#0072B2',
                                antigen_color='#E69F00'),
    'high_contrast': _preset('Saturated complementary partners for small figure panels.', antibody_color='#1F77B4', antigen_color='#FF7F0E',
                             roughness=0.6),
    'grayscale': _preset('Two greys, for print without colour.', antibody_color='#7A7A7A', antigen_color='#C8C8C8', roughness=0.8, specular=0.1),
    'monochrome_blue': _preset('One hue in two tones; the antigen lighter.', antibody_color='#3B6EA5', antigen_color='#BFD3E6'),
    'warm': _preset('Warm partner palette: terracotta and sand.', antibody_color='#C46A4A', antigen_color='#E8D5B5'),
    'cool': _preset('Cool partner palette: teal and ice.', antibody_color='#2A9D8F', antigen_color='#CFE8EF'),
    'tight_envelope': _preset('A tighter Gaussian envelope that follows the atoms more closely.', isovalue=0.6),
    'soft_envelope': _preset('A looser, smoother envelope.', isovalue=0.32),
    'thick_sticks': _preset('Heavier contact-residue sticks for small panels.', stick_radius=0.2),
    'thin_sticks': _preset('Lighter contact-residue sticks.', stick_radius=0.1),
    'draft': _preset('A quick low-sample preview at a small width.', render={'width': 800, 'samples': 12}),
    'print_wide': _preset('The widest figure with the most samples the pipeline accepts.', render={'width': 2400, 'samples': 128}),
    'slide_dark_flat': _preset('Dark world with flat, matte partners for projected slides.', background='dark', world_strength=1.0,
                               roughness=1.0, specular=0.0, antibody_color='#8ECAE6', antigen_color='#FFD166'),
    'poster_black_glossy': _preset('Black world, glossy saturated partners, tight envelope.', background='black', world_strength=1.3,
                                   roughness=0.35, specular=0.5, antibody_color='#4CC9F0', antigen_color='#F72585', isovalue=0.55),
}
DEFAULT_PRESET = 'publication_white'


def preset_names():
    return list(PRESETS)


def preset(name):
    if name not in PRESETS:
        raise ValueError('Unknown render preset: ' + str(name)[:64])
    return PRESETS[name]


def validate_style(style):
    """The style dict exactly as the worker will apply it, or ValueError."""
    if not isinstance(style, dict) or set(style) != set(STYLE_SCHEMA):
        raise ValueError('A style needs exactly the schema keys')
    for key, rule in STYLE_SCHEMA.items():
        value = style[key]
        if rule['type'] == 'choice' and value not in rule['choices']:
            raise ValueError('Invalid ' + key)
        if rule['type'] == 'hex' and not (isinstance(value, str) and HEX.match(value)):
            raise ValueError('Invalid ' + key)
        if rule['type'] == 'number' and not (isinstance(value, (int, float)) and not isinstance(value, bool)
                                             and rule['min'] <= float(value) <= rule['max']):
            raise ValueError('Invalid ' + key)
    return dict(style)


def catalogue():
    """What the API reports: every preset with its style and render overrides."""
    return {'default': DEFAULT_PRESET, 'style_schema': STYLE_SCHEMA, 'render_schema': RENDER_SCHEMA,
            'presets': {name: {'description': p['description'], 'style': dict(p['style']), 'render': dict(p['render'])}
                        for name, p in PRESETS.items()}}


for _name, _p in PRESETS.items():
    validate_style(_p['style'])
    for _key, _value in _p['render'].items():
        if _key not in RENDER_SCHEMA or not RENDER_SCHEMA[_key]['min'] <= _value <= RENDER_SCHEMA[_key]['max']:
            raise ValueError('Preset ' + _name + ' has an invalid render override')
