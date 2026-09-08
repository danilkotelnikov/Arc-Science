"""Explicit partner selection and geometric heavy-atom contacts from coordinates.

Author chain identifiers are the public selection contract. Biological assemblies
with nonidentity operators are rejected; their coordinates are never mislabeled.
"""
from __future__ import annotations

import hashlib
import math
import os
from pathlib import Path
import stat


MAX_ATOMS = 100_000
MAX_CONTACT_PAIRS = 2_000_000
SOURCE_LIMIT = 100 * 1024 * 1024


def read_coordinate_source(source: Path) -> bytes:
    """Read a bounded regular file through one descriptor, rejecting stream input."""
    fd=os.open(source,os.O_RDONLY|os.O_NONBLOCK|os.O_NOFOLLOW)
    try:
        before=os.fstat(fd)
        if not stat.S_ISREG(before.st_mode):
            raise ValueError('Coordinate source must be a regular file')
        if before.st_size>SOURCE_LIMIT:
            raise ValueError('Coordinate source exceeds 100 MiB limit')
        chunks=[]; retained=0
        while True:
            chunk=os.read(fd,min(1024*1024,SOURCE_LIMIT+1-retained))
            if not chunk: break
            retained+=len(chunk)
            if retained>SOURCE_LIMIT: raise ValueError('Coordinate source exceeds 100 MiB limit')
            chunks.append(chunk)
        after=os.fstat(fd)
        if (before.st_size,before.st_mtime_ns,before.st_ctime_ns)!=(after.st_size,after.st_mtime_ns,after.st_ctime_ns):
            raise ValueError('Coordinate source changed during bounded read')
        return b''.join(chunks)
    finally:
        os.close(fd)


def prepare_complex(source: Path, *, antibody_chains: tuple[str, ...],
                    antigen_chains: tuple[str, ...], model_index: int = 0,
                    assembly: str = 'asymmetric_unit', cutoff: float = 4.0) -> dict:
    import gemmi
    import numpy as np
    from scipy.spatial import cKDTree

    groups = {'antibody': tuple(antibody_chains), 'antigen': tuple(antigen_chains)}
    for group in groups.values():
        if not group or any(not isinstance(c, str) or not c.strip() for c in group):
            raise ValueError('Partner chain selections cannot be empty or blank')
        if len(set(group)) != len(group):
            raise ValueError('Duplicate chain selection')
    if set(antibody_chains) & set(antigen_chains):
        raise ValueError('Partner chain selections overlap')
    if not isinstance(cutoff, (int, float)) or not math.isfinite(cutoff) or not 0 < cutoff <= 20:
        raise ValueError('Contact cutoff must be finite and in (0, 20] angstrom')
    source = Path(source).absolute()
    raw = read_coordinate_source(source)
    # Parse the exact bytes whose digest is recorded, avoiding a read/reopen race.
    if source.suffix.lower() in ('.cif', '.mmcif'):
        structure = gemmi.make_structure_from_block(gemmi.cif.read_string(raw.decode()).sole_block())
    elif source.suffix.lower() in ('.pdb', '.ent'):
        structure = gemmi.read_pdb_string(raw.decode())
        structure.setup_entities()
    else:
        raise ValueError('Expected an mmCIF or PDB coordinate source')
    if not isinstance(model_index, int) or not 0 <= model_index < len(structure):
        raise ValueError('Requested model index is absent')
    model = structure[model_index]
    selected = set(antibody_chains) | set(antigen_chains)
    present = {c.name for c in model}
    if selected - present:
        raise ValueError('Requested author chain is missing: ' + ', '.join(sorted(selected-present)))
    assembly_subchains = None
    application = 'asymmetric unit; no assembly operators applied'
    if assembly != 'asymmetric_unit':
        matches = [a for a in structure.assemblies if a.name == assembly]
        if not matches:
            raise ValueError('Requested assembly is absent: ' + str(assembly))
        assembly_subchains = set()
        for generator in matches[0].generators:
            if not generator.operators or any(not op.transform.is_identity() for op in generator.operators):
                raise ValueError('Unsupported biological assembly transform; only identity operators are supported')
            for chain in model:
                for residue in chain:
                    if chain.name in generator.chains or residue.subchain in generator.subchains:
                        assembly_subchains.add(residue.subchain)
        application = 'identity operators verified'
    entities = {subchain: entity for entity in structure.entities for subchain in entity.subchains}
    atoms, residues, chains = [], [], []
    excluded = dict(water_residues=0, nonpolymer_residues=0, hydrogen_atoms=0,
                    zero_occupancy_atoms=0, alternate_atoms=0)
    warnings = []
    for partner, names in groups.items():
        for name in names:
            chain_atom_indices = []
            for chain in model:
                if chain.name != name:
                    continue
                for residue in chain:
                    if assembly_subchains is not None and residue.subchain not in assembly_subchains:
                        continue
                    entity = entities.get(residue.subchain)
                    if residue.is_water():
                        excluded['water_residues'] += 1
                        continue
                    if entity is None or entity.entity_type != gemmi.EntityType.Polymer:
                        excluded['nonpolymer_residues'] += 1
                        continue
                    if entity.polymer_type not in (gemmi.PolymerType.PeptideL, gemmi.PolymerType.PeptideD):
                        raise ValueError('Selected polymer is not a protein: ' + name)
                    icode = residue.seqid.icode.strip()
                    rid = f'{name}:{residue.seqid.num}{icode}'
                    if any(r['id'] == rid for r in residues):
                        raise ValueError('Ambiguous duplicate author residue identity: ' + rid)
                    alternatives = {}
                    for atom in residue:
                        label = atom.altloc.strip('\x00 ')
                        if label:
                            alternatives[label] = alternatives.get(label, 0.0) + max(0, atom.occ)
                    chosen = min(alternatives, key=lambda label: (-alternatives[label], label)) if alternatives else ''
                    indices = []
                    names_seen = set()
                    # Named alternate atom overrides a shared atom of the same name.
                    ordered = sorted(residue, key=lambda a: a.altloc.strip('\x00 ') != chosen)
                    for atom in ordered:
                        label = atom.altloc.strip('\x00 ')
                        if label and label != chosen:
                            excluded['alternate_atoms'] += 1
                            continue
                        if not math.isfinite(atom.occ):
                            raise ValueError('Atom occupancy must be finite')
                        if atom.occ <= 0:
                            excluded['zero_occupancy_atoms'] += 1
                            continue
                        if atom.element.is_hydrogen:
                            excluded['hydrogen_atoms'] += 1
                            continue
                        xyz = [atom.pos.x, atom.pos.y, atom.pos.z]
                        if not all(math.isfinite(v) for v in xyz):
                            raise ValueError('Atom coordinates must be finite')
                        if atom.name in names_seen:
                            excluded['alternate_atoms'] += 1
                            continue
                        names_seen.add(atom.name)
                        index = len(atoms)
                        atoms.append(dict(index=index, id=rid+':'+atom.name, residue=rid,
                                          chain=name, subchain=residue.subchain, entity=entity.name,
                                          partner=partner, name=atom.name, element=atom.element.name,
                                          position=xyz, occupancy=float(atom.occ), altloc=label,
                                          model_number=model.num, assembly=assembly))
                        indices.append(index)
                        if len(atoms) > MAX_ATOMS:
                            raise ValueError('Selected complex exceeds 100000 heavy atoms')
                    if indices:
                        residues.append(dict(id=rid, chain=name, subchain=residue.subchain,
                                             number=residue.seqid.num, insertion_code=icode,
                                             name=residue.name, partner=partner, entity=entity.name,
                                             polymer_type=str(entity.polymer_type), altloc=chosen,
                                             model_number=model.num, assembly=assembly, atom_indices=indices))
                        chain_atom_indices.extend(indices)
            if not chain_atom_indices:
                raise ValueError('Selected chain has no protein atoms in requested assembly: ' + name)
            positions = np.array([atoms[i]['position'] for i in chain_atom_indices])
            chains.append(dict(id=name, partner=partner, atom_indices=chain_atom_indices,
                               center=positions.mean(axis=0).tolist(),
                               bounds=[positions.min(axis=0).tolist(), positions.max(axis=0).tolist()]))
    left = [a for a in atoms if a['partner'] == 'antibody']
    right = [a for a in atoms if a['partner'] == 'antigen']
    tree = cKDTree([a['position'] for a in right])
    residue_contacts = {}
    pair_count = 0
    # One atom query at a time bounds intermediate neighbor storage.
    for atom in left:
        for j in tree.query_ball_point(atom['position'], cutoff):
            other = right[j]
            distance = math.dist(atom['position'], other['position'])
            if distance > cutoff:
                continue
            pair_count += 1
            if pair_count > MAX_CONTACT_PAIRS:
                raise ValueError('Contact computation exceeds two million atom pairs')
            key = (atom['residue'], other['residue'])
            previous = residue_contacts.get(key)
            if previous is None:
                residue_contacts[key] = dict(antibody_residue=key[0], antigen_residue=key[1],
                                             antibody_atom=atom['id'], antigen_atom=other['id'],
                                             distance=distance, atom_pair_count=1)
            else:
                previous['atom_pair_count'] += 1
                if (distance, atom['id'], other['id']) < (previous['distance'], previous['antibody_atom'], previous['antigen_atom']):
                    previous.update(distance=distance, antibody_atom=atom['id'], antigen_atom=other['id'])
    contacts = [residue_contacts[key] for key in sorted(residue_contacts)]
    interface_residues = sorted({c[side+'_residue'] for c in contacts for side in ('antibody','antigen')})
    interface_atoms = [a for a in atoms if a['residue'] in interface_residues]
    positions = np.array([a['position'] for a in (interface_atoms or atoms)])
    if not contacts:
        warnings.append('No inter-partner heavy-atom contacts at the declared cutoff; interface views show the full selected complex.')
    if excluded['water_residues']:
        warnings.append('Omitted solvent: water residues are recorded but water-mediated contacts are not inferred.')
    if excluded['nonpolymer_residues']:
        warnings.append('Nonpolymer or entity-unassigned residues were omitted.')
    warnings.append('No secondary-structure representation is supplied; surfaces are illustrative atomic envelopes, not solvent-excluded surfaces.')
    return dict(format='molecular-scene/v1', source=dict(path=str(source), name=source.name,
                sha256=hashlib.sha256(raw).hexdigest(), bytes=len(raw)),
                selection=dict(antibody_chains=list(antibody_chains), antigen_chains=list(antigen_chains),
                               model_index=model_index, model_number=model.num, assembly=assembly,
                               assembly_application=application, chain_id_namespace='author'),
                atoms=atoms, residues=residues, chains=chains, contacts=contacts,
                contact_definition=dict(cutoff=float(cutoff), units='angstrom',
                    method='minimum selected heavy-atom distance per residue pair', atom_pair_count=pair_count,
                    interpretation='geometric proximity; not hydrogen bonds, affinity, or energetic hotspots'),
                interface=dict(center=positions.mean(axis=0).tolist(), residue_ids=interface_residues),
                representation=dict(overview='illustrative atomic envelope',
                    interface='contact-residue sticks with coordinate-derived covalent geometry',
                    surface_method='Gaussian atomic density isosurface; not a solvent-excluded surface',
                    colors=dict(antibody='#91AEC5', antigen='#C4C9CC')),
                excluded=excluded, warnings=warnings)
