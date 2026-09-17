"""Literal coordinates catch wrong cutoffs, partner grouping and identity loss."""
import importlib.util
import json
from pathlib import Path

import gemmi
import pytest


def api():
    assert importlib.util.find_spec('arc_science.molecular'), 'Coordinate preparation is not implemented'
    from arc_science.molecular import prepare_complex
    return prepare_complex


def structure(tmp_path, *, insertion='', alt=False, assembly=False, transformed=False):
    s = gemmi.Structure()
    s.name = 'hand-placed'
    m = gemmi.Model('1')
    for name, number, x in [('L', 1, 50), ('H', 1, 0), ('A', 7, 3.5), ('A', 8, 4.5)]:
        c = m.find_chain(name)
        if c is None:
            m.add_chain(gemmi.Chain(name))
            c = m.find_chain(name)
        r = gemmi.Residue()
        r.name = 'ALA'
        r.seqid = gemmi.SeqId(number, insertion or ' ')
        r.subchain = name
        r.entity_type = gemmi.EntityType.Polymer
        for label, dx, occupancy in ([('A', 0, .7), ('B', 10, .3)] if alt else [('\x00', 0, 1)]):
            a = gemmi.Atom()
            a.name = 'CA'
            a.element = gemmi.Element('C')
            a.pos = gemmi.Position(x+dx, 0, 0)
            a.altloc, a.occ = label, occupancy
            r.add_atom(a)
        c.add_residue(r)
    s.add_model(m)
    for name in ('L', 'H', 'A'):
        e = gemmi.Entity(name)
        e.entity_type = gemmi.EntityType.Polymer
        e.polymer_type = gemmi.PolymerType.PeptideL
        e.subchains = [name]
        s.entities.append(e)
    if assembly:
        a = gemmi.Assembly('1')
        g = gemmi.Assembly.Gen()
        g.subchains = ['L', 'H', 'A']
        op = gemmi.Assembly.Operator()
        op.name = '1'
        if transformed:
            op.transform.vec.x = 20
        g.operators.append(op)
        a.generators.append(g)
        s.assemblies.append(a)
    path = tmp_path / 'hand.cif'
    s.make_mmcif_document().write_file(str(path))
    return path


def test_contact_uses_second_antibody_chain_and_literal_distance(tmp_path):
    scene = api()(structure(tmp_path), antibody_chains=('L','H'), antigen_chains=('A',))
    assert [(c['antibody_residue'], c['antigen_residue']) for c in scene['contacts']] == [('H:1','A:7')]
    assert scene['contacts'][0]['distance'] == pytest.approx(3.5)
    assert scene['selection']['antibody_chains'] == ['L','H']
    assert scene['source']['sha256']
    json.dumps(scene, allow_nan=False)


def test_insertion_codes_and_consistent_altloc_survive(tmp_path):
    scene = api()(structure(tmp_path, insertion='B', alt=True), antibody_chains=('L','H'), antigen_chains=('A',))
    assert [(c['antibody_residue'], c['antigen_residue']) for c in scene['contacts']] == [('H:1B','A:7B')]
    assert len(scene['atoms']) == 4
    assert {a['altloc'] for a in scene['atoms']} == {'A'}
    assert {r['insertion_code'] for r in scene['residues']} == {'B'}


@pytest.mark.parametrize('changes,match', [
    ({'antibody_chains':('',)},'blank'),
    ({'antibody_chains':('H','A')},'overlap'),
    ({'antibody_chains':('Z',)},'missing'),
    ({'cutoff':float('nan')},'cutoff'),
    ({'cutoff':float('inf')},'cutoff'),
    ({'cutoff':0},'cutoff'),
    ({'assembly':'missing'},'assembly'),
    ({'model_index':1},'model'),
])
def test_invalid_selection_fails_explicitly(tmp_path, changes, match):
    options = dict(antibody_chains=('L','H'), antigen_chains=('A',))
    options.update(changes)
    with pytest.raises(ValueError, match=match):
        api()(structure(tmp_path), **options)


def test_identity_assembly_is_recorded_and_nonidentity_is_rejected(tmp_path):
    prepare = api()
    scene = prepare(structure(tmp_path, assembly=True), antibody_chains=('L','H'), antigen_chains=('A',), assembly='1')
    assert scene['selection']['assembly'] == '1'
    assert scene['selection']['assembly_application'] == 'identity operators verified'
    with pytest.raises(ValueError, match='transform'):
        prepare(structure(tmp_path, assembly=True, transformed=True), antibody_chains=('L','H'), antigen_chains=('A',), assembly='1')


def test_zero_occupancy_hydrogen_and_water_are_excluded(tmp_path):
    path = structure(tmp_path)
    s = gemmi.read_structure(str(path))
    for atom_name, element, occ in [('H','H',1), ('CB','C',0)]:
        a = gemmi.Atom(); a.name = atom_name; a.element = gemmi.Element(element)
        a.pos = gemmi.Position(3.4,0,0); a.occ = occ
        s[0]['L'][0].add_atom(a)
    water = gemmi.Residue(); water.name = 'HOH'; water.seqid = gemmi.SeqId(99,' ')
    water.subchain = 'W'; water.entity_type = gemmi.EntityType.Water
    a = gemmi.Atom(); a.name = 'O'; a.element = gemmi.Element('O'); a.pos = gemmi.Position(0,0,0)
    water.add_atom(a); s[0]['H'].add_residue(water)
    e = gemmi.Entity('water'); e.entity_type = gemmi.EntityType.Water; e.subchains = ['W']; s.entities.append(e)
    s.make_mmcif_document().write_file(str(path))
    scene = api()(path, antibody_chains=('L','H'), antigen_chains=('A',))
    assert len(scene['atoms']) == 4
    assert scene['excluded']['water_residues'] == 1
    assert scene['excluded']['hydrogen_atoms'] == 1
    assert scene['excluded']['zero_occupancy_atoms'] == 1
    assert any('solvent' in w for w in scene['warnings'])


def test_nonfinite_atom_is_rejected(tmp_path):
    path = structure(tmp_path)
    s = gemmi.read_structure(str(path)); s[0]['H'][0][0].pos.x = float('nan')
    s.make_mmcif_document().write_file(str(path))
    with pytest.raises(ValueError, match='finite'):
        api()(path, antibody_chains=('L','H'), antigen_chains=('A',))


def test_oversized_coordinate_source_is_rejected_before_reading(tmp_path, monkeypatch):
    prepare = api()
    path = tmp_path/'oversized.cif'
    with path.open('wb') as stream:
        stream.truncate(100*1024*1024+1)
    def unexpected_read(*args, **kwargs):
        pytest.fail('Oversized source was read before its size was validated')
    monkeypatch.setattr(Path,'read_bytes',unexpected_read)
    with pytest.raises(ValueError, match='100 MiB'):
        prepare(path,antibody_chains=('L','H'),antigen_chains=('A',))


@pytest.mark.skipif(not hasattr(__import__('os'),'mkfifo'),reason='FIFOs are POSIX-only; S_ISREG covers non-regular rejection on Windows')
def test_fifo_coordinate_source_is_rejected_without_waiting_for_writer(tmp_path):
    import os
    import subprocess
    import sys
    path=tmp_path/'pipe.cif'; os.mkfifo(path)
    code='''import sys
from pathlib import Path
from arc_science.molecular import prepare_complex
try:
    prepare_complex(Path(sys.argv[1]),antibody_chains=('L','H'),antigen_chains=('A',))
except ValueError as exc:
    print(exc)
    raise SystemExit(0)
raise SystemExit(1)
'''
    result=subprocess.run([sys.executable,'-c',code,str(path)],capture_output=True,text=True,
        env={**os.environ,'PYTHONPATH':str(Path(__file__).resolve().parents[1]/'src')},timeout=3)
    assert result.returncode == 0
    assert 'regular file' in result.stdout


def test_read_coordinate_source_returns_exact_bytes_including_crlf(tmp_path):
    import hashlib
    from arc_science.molecular import read_coordinate_source
    # CRLF and an embedded ^Z must survive verbatim, or the recorded sha256 would not
    # match the file. On Windows a text-mode read would strip \r and stop at \x1a.
    path=tmp_path/'crlf.cif'
    payload=b'data_x\r\n_a.b 1\r\n#\r\n\x1a still here\r\n'
    path.write_bytes(payload)
    data=read_coordinate_source(path)
    assert data==payload
    assert hashlib.sha256(data).hexdigest()==hashlib.sha256(path.read_bytes()).hexdigest()


def test_source_growth_after_stat_cannot_bypass_read_cap(tmp_path, monkeypatch):
    from arc_science import molecular
    path=tmp_path/'growing.cif'; path.write_bytes(b'A'*16)
    monkeypatch.setattr(molecular,'SOURCE_LIMIT',32)
    original_read=molecular.os.read
    grown=False
    def grow_then_read(fd,count):
        nonlocal grown
        if not grown:
            grown=True
            with path.open('ab') as stream: stream.write(b'B'*32)
        return original_read(fd,count)
    monkeypatch.setattr(molecular.os,'read',grow_then_read)
    with pytest.raises(ValueError,match='limit'):
        molecular.read_coordinate_source(path)
