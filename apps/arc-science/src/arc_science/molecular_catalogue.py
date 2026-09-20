"""The molecular software catalogue: structural biology and cheminformatics packages the
workbench knows about, with availability probes.

A catalogue entry names a package, its category, licence and home, and how its
presence can be observed: a Python module importable by this service's interpreter
(imported in a separate process, never into the service), an executable on PATH or
at a known install location, a conda environment or executable inside the WSL bench,
or the Claude Science daemon. A probe reports presence, never qualification: a
package that imports is not thereby correct, current or validated, and nothing here
installs anything.
"""
from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path

from .exploration.cli_seats import scrubbed_environment

PROBE_TIMEOUT = 20.0
PARALLEL = 4
CACHE_SECONDS = 300.0
MAX_OUTPUT = 64 * 1024
_SHARED = threading.Lock()
CATEGORIES = {
    'structure_prediction': 'Structure prediction',
    'protein_design': 'Protein and antibody design',
    'docking': 'Docking and virtual screening',
    'molecular_dynamics': 'Molecular dynamics and force fields',
    'structure_analysis': 'Structure analysis and quality',
    'sequence_analysis': 'Sequence analysis and alignment',
    'antibody_tools': 'Antibody-specific tools',
    'visualization': 'Visualisation and rendering',
    'cheminformatics': 'Cheminformatics',
    'qsar_ml': 'Chemical ML, QSAR and property prediction',
    'crystallography_cryoem': 'Crystallography and cryo-EM',
    'interactions': 'Pockets, interactions and interfaces',
    'formats': 'Formats and conversion',
    'bench': 'Local compute bench',
}


def _e(id, name, category, licence, home, *, python=None, exe=None, paths=(), wsl_env=None, wsl_exe=None, bench=False, note=''):
    probe = ({'kind': 'python', 'module': python} if python else {'kind': 'exe', 'name': exe, 'paths': list(paths)} if exe
             else {'kind': 'wsl_env', 'env': wsl_env} if wsl_env else {'kind': 'wsl_exe', 'name': wsl_exe} if wsl_exe
             else {'kind': 'bench'} if bench else {'kind': 'none'})
    return {'id': id, 'name': name, 'category': category, 'licence': licence, 'home': home, 'probe': probe, 'note': note}


PF = os.environ.get('ProgramFiles', r'C:\Program Files')
CATALOGUE = [
    # structure prediction
    _e('alphafold2', 'AlphaFold 2', 'structure_prediction', 'Apache-2.0', 'https://github.com/google-deepmind/alphafold', bench=True, note='via the Claude Science bench'),
    _e('boltz', 'Boltz', 'structure_prediction', 'MIT', 'https://github.com/jwohlwend/boltz', bench=True, note='via the Claude Science bench'),
    _e('chai1', 'Chai-1', 'structure_prediction', 'Apache-2.0', 'https://github.com/chaidiscovery/chai-lab', wsl_env='chai-1'),
    _e('openfold3', 'OpenFold 3', 'structure_prediction', 'Apache-2.0', 'https://github.com/aqlaboratory/openfold', bench=True, note='via the Claude Science bench'),
    _e('esmfold', 'ESMFold', 'structure_prediction', 'MIT', 'https://github.com/facebookresearch/esm', python='esm'),
    _e('colabfold', 'ColabFold', 'structure_prediction', 'MIT', 'https://github.com/sokrypton/ColabFold', wsl_exe='colabfold_batch'),
    _e('immunebuilder', 'ImmuneBuilder (ABodyBuilder2, NanoBodyBuilder2, TCRBuilder2)', 'structure_prediction', 'BSD-3-Clause', 'https://github.com/oxpig/ImmuneBuilder', wsl_env='immunebuilder'),
    _e('h3opt', 'H3-OPT', 'structure_prediction', 'see project home', 'https://github.com/chunhuisoft/H3-OPT', wsl_env='h3-opt'),
    _e('rosettafold', 'RoseTTAFold', 'structure_prediction', 'MIT', 'https://github.com/RosettaCommons/RoseTTAFold', wsl_env='SE3nv'),
    # protein design
    _e('rfdiffusion', 'RFdiffusion', 'protein_design', 'see project home', 'https://github.com/RosettaCommons/RFdiffusion', wsl_env='SE3nv'),
    _e('rfantibody', 'RFantibody', 'protein_design', 'see project home', 'https://github.com/RosettaCommons/RFantibody', wsl_env='SE3nv'),
    _e('proteinmpnn', 'ProteinMPNN', 'protein_design', 'MIT', 'https://github.com/dauparas/ProteinMPNN', bench=True, note='via the Claude Science bench'),
    _e('ligandmpnn', 'LigandMPNN', 'protein_design', 'MIT', 'https://github.com/dauparas/LigandMPNN', bench=True, note='via the Claude Science bench'),
    _e('rosetta', 'Rosetta / PyRosetta', 'protein_design', 'Rosetta Software (academic) / PyRosetta licence', 'https://www.rosettacommons.org', python='pyrosetta'),
    _e('tempro', 'TEMPRO', 'protein_design', 'see project home', 'https://github.com/jeffreyoung/TEMPRO', wsl_env='TEMPRO'),
    _e('nanomelt', 'NanoMelt', 'protein_design', 'see project home', 'https://github.com/nanomelt/nanomelt', wsl_env='nanomelt'),
    # docking
    _e('diffdock', 'DiffDock', 'docking', 'MIT', 'https://github.com/gcorso/DiffDock', bench=True, note='via the Claude Science bench'),
    _e('vina', 'AutoDock Vina', 'docking', 'Apache-2.0', 'https://vina.scripps.edu', python='vina'),
    _e('smina', 'smina', 'docking', 'see project home', 'https://sourceforge.net/projects/smina/', exe='smina'),
    _e('gnina', 'gnina', 'docking', 'Apache-2.0', 'https://github.com/gnina/gnina', wsl_exe='gnina'),
    _e('meeko', 'Meeko', 'docking', 'LGPL-2.1', 'https://github.com/forlilab/Meeko', python='meeko'),
    _e('haddock', 'HADDOCK3', 'docking', 'Apache-2.0', 'https://github.com/haddocking/haddock3', wsl_exe='haddock3'),
    _e('lightdock', 'LightDock', 'docking', 'GPL-3.0', 'https://github.com/lightdock/lightdock', python='lightdock'),
    # molecular dynamics
    _e('openmm', 'OpenMM', 'molecular_dynamics', 'MIT / LGPL', 'https://openmm.org', wsl_env='openmm'),
    _e('gromacs', 'GROMACS', 'molecular_dynamics', 'LGPL-2.1', 'https://www.gromacs.org', wsl_env='gromacs'),
    _e('pdbfixer', 'PDBFixer', 'molecular_dynamics', 'MIT', 'https://github.com/openmm/pdbfixer', wsl_env='pdbfixer'),
    _e('openff', 'Open Force Field toolkit', 'molecular_dynamics', 'MIT', 'https://openforcefield.org', python='openff.toolkit'),
    _e('ambertools', 'AmberTools', 'molecular_dynamics', 'GPL / LGPL (mixed)', 'https://ambermd.org/AmberTools.php', wsl_exe='tleap'),
    _e('mdanalysis', 'MDAnalysis', 'molecular_dynamics', 'GPL-2.0 / LGPL-3.0 (version-dependent)', 'https://www.mdanalysis.org', python='MDAnalysis'),
    _e('mdtraj', 'MDTraj', 'molecular_dynamics', 'LGPL-2.1', 'https://www.mdtraj.org', python='mdtraj'),
    _e('gbsa', 'MM/GBSA workflow environment', 'molecular_dynamics', 'mixed', 'https://github.com/Valdes-Tresanco-MS/gmx_MMPBSA', wsl_env='gbsa'),
    _e('chaperong', 'CHAPERONg', 'molecular_dynamics', 'see project home', 'https://github.com/abeebyekeen/CHAPERONg', wsl_env='chaperong'),
    # structure analysis
    _e('gemmi', 'GEMMI', 'structure_analysis', 'MPL-2.0', 'https://gemmi.readthedocs.io', python='gemmi'),
    _e('biopython', 'Biopython', 'structure_analysis', 'BSD-3-Clause', 'https://biopython.org', python='Bio'),
    _e('biotite', 'Biotite', 'structure_analysis', 'BSD-3-Clause', 'https://www.biotite-python.org', python='biotite'),
    _e('prody', 'ProDy', 'structure_analysis', 'MIT', 'http://prody.csb.pitt.edu', python='prody'),
    _e('dssp', 'DSSP (mkdssp)', 'structure_analysis', 'BSD-2-Clause', 'https://github.com/PDB-REDO/dssp', exe='mkdssp'),
    _e('freesasa', 'FreeSASA', 'structure_analysis', 'MIT', 'https://freesasa.github.io', python='freesasa'),
    _e('tmalign', 'TM-align / US-align', 'structure_analysis', 'see project home', 'https://zhanggroup.org/US-align/', exe='USalign'),
    _e('foldseek', 'Foldseek', 'structure_analysis', 'GPL-3.0', 'https://github.com/steineggerlab/foldseek', wsl_exe='foldseek'),
    _e('molprobity', 'MolProbity', 'structure_analysis', 'see project home', 'http://molprobity.biochem.duke.edu', wsl_exe='molprobity.molprobity'),
    _e('pdb2pqr', 'PDB2PQR', 'structure_analysis', 'BSD-3-Clause', 'https://github.com/Electrostatics/pdb2pqr', python='pdb2pqr'),
    _e('apbs', 'APBS', 'structure_analysis', 'BSD-3-Clause', 'https://apbs.readthedocs.io', exe='apbs'),
    _e('propka', 'PROPKA 3', 'structure_analysis', 'LGPL-2.1', 'https://github.com/jensengroup/propka', python='propka'),
    # sequence
    _e('hmmer', 'HMMER', 'sequence_analysis', 'BSD-3-Clause', 'http://hmmer.org', wsl_exe='hmmsearch'),
    _e('mafft', 'MAFFT', 'sequence_analysis', 'BSD', 'https://mafft.cbrc.jp/alignment/software/', wsl_exe='mafft'),
    _e('clustalo', 'Clustal Omega', 'sequence_analysis', 'GPL-2.0', 'http://www.clustal.org/omega/', wsl_exe='clustalo'),
    _e('muscle', 'MUSCLE', 'sequence_analysis', 'public domain', 'https://www.drive5.com/muscle/', wsl_exe='muscle'),
    _e('blast', 'BLAST+', 'sequence_analysis', 'public domain', 'https://blast.ncbi.nlm.nih.gov', wsl_exe='blastp'),
    _e('mmseqs2', 'MMseqs2', 'sequence_analysis', 'GPL-3.0', 'https://github.com/soedinglab/MMseqs2', wsl_exe='mmseqs'),
    _e('evo2', 'Evo 2', 'sequence_analysis', 'Apache-2.0', 'https://github.com/ArcInstitute/evo2', bench=True, note='via the Claude Science bench'),
    # antibody
    _e('anarci', 'ANARCI', 'antibody_tools', 'BSD-3-Clause', 'https://github.com/oxpig/ANARCI', python='anarci'),
    _e('abnumber', 'AbNumber', 'antibody_tools', 'MIT', 'https://github.com/prihoda/AbNumber', python='abnumber'),
    _e('scalop', 'SCALOP', 'antibody_tools', 'see project home', 'https://github.com/oxpig/SCALOP', wsl_env='scalop-env'),
    _e('igfold', 'IgFold', 'antibody_tools', 'JHU academic licence', 'https://github.com/Graylab/IgFold', python='igfold'),
    _e('abodybuilder3', 'ABodyBuilder3', 'antibody_tools', 'see project home', 'https://github.com/Exscientia/abodybuilder3', python='abodybuilder3'),
    _e('sabdab_tools', 'SAbDab / SAbPred access', 'antibody_tools', 'CC BY 4.0 (data)', 'https://opig.stats.ox.ac.uk/webapps/sabdab-sabpred/', note='data access through ToolUniverse; no local package'),
    # visualisation
    _e('molstar', 'Mol*', 'visualization', 'MIT', 'https://molstar.org', note='bundled viewer in this workbench'),
    _e('blender', 'Blender', 'visualization', 'GPL-3.0', 'https://www.blender.org', exe='blender', paths=[PF + r'\Blender Foundation\Blender 4.2\blender.exe', PF + r'\Blender Foundation\Blender 4.1\blender.exe', PF + r'\Blender Foundation\Blender 4.0\blender.exe', PF + r'\Blender Foundation\Blender 5.0\blender.exe']),
    _e('molecularnodes', 'Molecular Nodes (Blender add-on)', 'visualization', 'GPL-3.0', 'https://github.com/BradyAJohnston/MolecularNodes', note='inside Blender; not probed from here'),
    _e('pymol', 'PyMOL (open source)', 'visualization', 'BSD-like (Schrödinger open-source)', 'https://github.com/schrodinger/pymol-open-source', python='pymol'),
    _e('chimerax', 'UCSF ChimeraX', 'visualization', 'UCSF ChimeraX licence (free for non-commercial use)', 'https://www.cgl.ucsf.edu/chimerax/', exe='ChimeraX', paths=[PF + r'\ChimeraX 1.10\bin\ChimeraX.exe', PF + r'\ChimeraX 1.9\bin\ChimeraX.exe', PF + r'\ChimeraX\bin\ChimeraX.exe']),
    _e('vmd', 'VMD', 'visualization', 'UIUC Open Source (non-commercial)', 'https://www.ks.uiuc.edu/Research/vmd/', exe='vmd'),
    _e('nglview', 'NGLView', 'visualization', 'MIT', 'https://github.com/nglviewer/nglview', python='nglview'),
    _e('py3dmol', 'py3Dmol', 'visualization', 'BSD-3-Clause', 'https://3dmol.csb.pitt.edu', python='py3Dmol'),
    # cheminformatics
    _e('rdkit', 'RDKit', 'cheminformatics', 'BSD-3-Clause', 'https://www.rdkit.org', python='rdkit'),
    _e('openbabel', 'Open Babel', 'cheminformatics', 'GPL-2.0', 'https://openbabel.org', exe='obabel'),
    _e('openbabel_wsl', 'Open Babel (WSL)', 'cheminformatics', 'GPL-2.0', 'https://openbabel.org', wsl_exe='obabel'),
    _e('cdk', 'Chemistry Development Kit', 'cheminformatics', 'LGPL-2.1', 'https://cdk.github.io', note='JVM library; no probe from here'),
    _e('datamol', 'Datamol', 'cheminformatics', 'Apache-2.0', 'https://datamol.io', python='datamol'),
    _e('molfeat', 'molfeat', 'cheminformatics', 'Apache-2.0', 'https://molfeat.datamol.io', python='molfeat'),
    _e('mordred', 'Mordred descriptors', 'cheminformatics', 'BSD-3-Clause', 'https://github.com/mordred-descriptor/mordred', python='mordred'),
    _e('pubchempy', 'PubChemPy', 'cheminformatics', 'MIT', 'https://github.com/mcs07/PubChemPy', python='pubchempy'),
    _e('chembl_webresource', 'ChEMBL web resource client', 'cheminformatics', 'Apache-2.0', 'https://github.com/chembl/chembl_webresource_client', python='chembl_webresource_client'),
    _e('openff_fragmenter', 'OpenFF fragmenter', 'cheminformatics', 'MIT', 'https://github.com/openforcefield/openff-fragmenter', python='openff.fragmenter'),
    _e('xtb', 'xtb (semi-empirical QM)', 'cheminformatics', 'LGPL-3.0', 'https://github.com/grimme-lab/xtb', wsl_exe='xtb'),
    _e('psi4', 'Psi4', 'cheminformatics', 'LGPL-3.0', 'https://psicode.org', python='psi4'),
    # ML / QSAR
    _e('deepchem', 'DeepChem', 'qsar_ml', 'MIT', 'https://deepchem.io', python='deepchem'),
    _e('chemprop', 'Chemprop', 'qsar_ml', 'MIT', 'https://github.com/chemprop/chemprop', python='chemprop'),
    _e('torchdrug', 'TorchDrug', 'qsar_ml', 'Apache-2.0', 'https://torchdrug.ai', python='torchdrug'),
    _e('torch', 'PyTorch', 'qsar_ml', 'BSD-3-Clause', 'https://pytorch.org', python='torch'),
    _e('sklearn', 'scikit-learn', 'qsar_ml', 'BSD-3-Clause', 'https://scikit-learn.org', python='sklearn'),
    _e('admetlab', 'ADMET-AI', 'qsar_ml', 'MIT', 'https://github.com/swansonk14/admet_ai', python='admet_ai'),
    # crystallography / cryo-EM
    _e('ccp4', 'CCP4 suite', 'crystallography_cryoem', 'CCP4 licence', 'https://www.ccp4.ac.uk', wsl_exe='refmac5'),
    _e('phenix', 'Phenix', 'crystallography_cryoem', 'Phenix licence', 'https://phenix-online.org', wsl_exe='phenix.refine'),
    _e('coot', 'Coot', 'crystallography_cryoem', 'GPL-3.0', 'https://www2.mrc-lmb.cam.ac.uk/personal/pemsley/coot/', wsl_exe='coot'),
    _e('relion', 'RELION', 'crystallography_cryoem', 'GPL-2.0', 'https://relion.readthedocs.io', wsl_exe='relion_refine'),
    _e('cryosparc', 'CryoSPARC', 'crystallography_cryoem', 'CryoSPARC licence', 'https://cryosparc.com', wsl_exe='cryosparcm'),
    _e('mrcfile', 'mrcfile', 'crystallography_cryoem', 'BSD-3-Clause', 'https://github.com/ccpem/mrcfile', python='mrcfile'),
    # interactions
    _e('plip', 'PLIP', 'interactions', 'GPL-2.0', 'https://github.com/pharmai/plip', wsl_env='plip'),
    _e('prolif', 'ProLIF', 'interactions', 'Apache-2.0', 'https://github.com/chemosim-lab/ProLIF', python='prolif'),
    _e('fpocket', 'fpocket', 'interactions', 'MIT', 'https://github.com/Discngine/fpocket', wsl_exe='fpocket'),
    _e('arpeggio', 'Arpeggio', 'interactions', 'GPL-3.0', 'https://github.com/PDBeurope/arpeggio', python='arpeggio'),
    _e('pdbe_pisa', 'PDBePISA access', 'interactions', 'service', 'https://www.ebi.ac.uk/pdbe/pisa/', note='remote service; data access only'),
    # formats
    _e('pdbtools', 'pdb-tools', 'formats', 'Apache-2.0', 'https://github.com/haddocking/pdb-tools', python='pdbtools'),
    _e('pdbecif', 'PDBeCIF', 'formats', 'Apache-2.0', 'https://github.com/PDBeurope/pdbecif', python='pdbecif'),
    _e('maxit', 'MAXIT', 'formats', 'RCSB licence', 'https://sw-tools.rcsb.org/apps/MAXIT/', wsl_exe='maxit'),
    _e('biopandas', 'BioPandas', 'formats', 'BSD-3-Clause', 'https://biopandas.github.io/biopandas/', python='biopandas'),
    # bench
    _e('claude_science', 'Claude Science bench (WSL)', 'bench', 'proprietary daemon', 'http://127.0.0.1:8000', bench=True, note='the daemon that hosts the prediction, design and docking skills'),
    _e('ai_scientist_env', 'AI-Scientist environment', 'bench', 'Apache-2.0', 'https://github.com/SakanaAI/AI-Scientist', wsl_env='ai-scientist'),
    _e('bioinformatics_env', 'General bioinformatics environment (WSL)', 'bench', 'mixed', '', wsl_env='bioinformatics'),
]
BY_ID = {entry['id']: entry for entry in CATALOGUE}
assert len(BY_ID) == len(CATALOGUE), 'duplicate catalogue id'


def _run(argv, timeout):
    """A probe process under the same boundary as the CLI seats: allowlisted environment,
    a private empty working directory, bounded output, and a kill-on-close job (Windows)
    or its own session group (POSIX) so a timeout takes the whole tree."""
    from .figure_render import _assign_process_to_job, _close_job, _kill_on_close_job
    workdir = tempfile.mkdtemp(prefix='arc-probe-')
    job = _kill_on_close_job() if os.name == 'nt' else None
    options = {'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0)} if os.name == 'nt' else {'start_new_session': True}
    process = None
    try:
        process = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=workdir,
                                   env=scrubbed_environment(), **options)
        if job is not None:
            try:
                _assign_process_to_job(job, process)
            except OSError:
                process.kill()
                raise
        chunks = {'out': bytearray(), 'err': bytearray()}

        def drain(name, stream):
            # os.read returns what is available; a buffered read would wait to fill.
            fd = stream.fileno()
            while True:
                try:
                    piece = os.read(fd, 65536)
                except OSError:
                    return
                if not piece:
                    return
                if len(chunks[name]) < MAX_OUTPUT:
                    chunks[name].extend(piece[:MAX_OUTPUT - len(chunks[name])])
        readers = [threading.Thread(target=drain, args=(name, stream), daemon=True) for name, stream in (('out', process.stdout), ('err', process.stderr))]
        for reader in readers:
            reader.start()

        def close_tree():
            # The whole owned tree goes once the leader's status is known, whether it exited
            # or not: the session group on POSIX, the kill-on-close job on Windows. A
            # descendant that inherited the pipes then releases them.
            nonlocal job
            if os.name != 'nt':
                try:
                    import signal
                    os.killpg(process.pid, signal.SIGKILL)
                except (OSError, AttributeError, ProcessLookupError):
                    pass
            elif job is not None:
                _close_job(job)
                job = None
        try:
            returncode = process.wait(timeout)
        except subprocess.TimeoutExpired:
            process.kill()
            close_tree()
            returncode = process.wait(5)
            raise subprocess.TimeoutExpired(argv, timeout)
        close_tree()
        for reader in readers:
            reader.join(2)
        return subprocess.CompletedProcess(argv, returncode, chunks['out'].decode('utf-8', errors='replace'),
                                           chunks['err'].decode('utf-8', errors='replace'))
    finally:
        if process is not None and process.returncode is None:
            process.kill()
        if job is not None:
            _close_job(job)
        shutil.rmtree(workdir, ignore_errors=True)


def probe_python(module, interpreter=None):
    """Import the module in a separate, isolated interpreter and report its version."""
    code = ('import importlib, json; m = importlib.import_module(' + repr(module) + '); '
            'print(json.dumps({"version": str(getattr(m, "__version__", None) or getattr(m, "version", None) or "")[:40]}))')
    try:
        completed = _run([interpreter or sys.executable, '-I', '-c', code], PROBE_TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        return {'present': False, 'detail': 'probe did not complete'}
    if completed.returncode != 0:
        return {'present': False, 'detail': 'not importable'}
    try:
        import json
        return {'present': True, 'detail': json.loads(completed.stdout.strip().splitlines()[-1]).get('version') or 'importable',
                'where': 'host python'}
    except (ValueError, IndexError):
        return {'present': True, 'detail': 'importable', 'where': 'host python'}


def probe_exe(name, paths=()):
    found = shutil.which(name)
    if not found:
        found = next((p for p in paths if Path(p).is_file()), None)
    if not found:
        # Versioned install folders: `ChimeraX 1.10.dev…`, `Blender 4.2`.
        for parent, pattern, tail in ((Path(PF), 'ChimeraX*', ('bin', 'ChimeraX.exe')), (Path(PF) / 'Blender Foundation', 'Blender*', ('blender.exe',))):
            if name.lower() in pattern.lower() and parent.is_dir():
                for candidate in sorted(parent.glob(pattern), reverse=True):
                    if candidate.joinpath(*tail).is_file():
                        found = str(candidate.joinpath(*tail))
                        break
            if found:
                break
    return {'present': bool(found), 'detail': (Path(found).parent.parent.name if 'ChimeraX' in found else Path(found).name) if found else 'not on PATH',
            'where': 'host' if found else None}


UNSET = object()
_WSL_ENVS = {'at': 0.0, 'value': UNSET}


def wsl_available():
    return os.name == 'nt' and shutil.which('wsl.exe') is not None


def wsl_environments():
    """Conda environment names inside the WSL bench, listed once per cache window and
    once per report even when four probes ask at the same time."""
    if not wsl_available():
        return None
    with _SHARED:
        if _WSL_ENVS['value'] is not UNSET and time.monotonic() - _WSL_ENVS['at'] < CACHE_SECONDS:
            return _WSL_ENVS['value']
        try:
            completed = _run(['wsl.exe', '-d', 'Ubuntu', '--', 'bash', '-lc',
                              'ls -d ~/miniforge3/envs/* ~/miniconda3/envs/* ~/mambaforge/envs/* ~/anaconda3/envs/* 2>/dev/null'], PROBE_TIMEOUT)
            # ls exits non-zero when one of the globs has no match; the listed paths still count.
            names = sorted({Path(line.strip()).name for line in completed.stdout.splitlines() if line.strip().startswith('/')})
        except (OSError, subprocess.SubprocessError):
            names = None
        _WSL_ENVS.update(at=time.monotonic(), value=names)
        return names


def probe_wsl_env(env):
    """An environment seen is not the package observed: reported as indirect evidence."""
    names = wsl_environments()
    if names is None:
        return {'present': False, 'detail': 'WSL bench not reachable'}
    if env in names:
        return {'present': None, 'observed': 'environment_seen', 'detail': 'conda env ' + env + ' exists; the package itself was not observed', 'where': 'wsl'}
    return {'present': False, 'detail': 'no conda env ' + env}


def probe_wsl_exe(name):
    if not wsl_available():
        return {'present': False, 'detail': 'WSL bench not reachable'}
    try:
        completed = _run(['wsl.exe', '-d', 'Ubuntu', '--', 'bash', '-lc', 'command -v ' + name], PROBE_TIMEOUT)
    except (OSError, subprocess.SubprocessError):
        return {'present': False, 'detail': 'probe did not complete'}
    found = completed.stdout.strip().splitlines()[-1] if completed.returncode == 0 and completed.stdout.strip() else ''
    return {'present': bool(found), 'detail': Path(found).name if found else 'not on the WSL PATH', 'where': 'wsl' if found else None}


_BENCH = {'at': 0.0, 'value': None}


def probe_bench():
    """The Claude Science daemon's own status, once per cache window; a reachable daemon
    is indirect evidence for the skills it hosts, never the package observed."""
    if not wsl_available():
        return {'present': False, 'detail': 'WSL bench not reachable'}
    with _SHARED:
        if _BENCH['value'] is not None and time.monotonic() - _BENCH['at'] < CACHE_SECONDS:
            return dict(_BENCH['value'])
        try:
            import json
            completed = _run(['wsl.exe', '-d', 'Ubuntu', '--', 'bash', '-lc', 'cd /home/user && ./linux-x64 status'], PROBE_TIMEOUT)
            status = json.loads(completed.stdout.strip()) if completed.stdout.strip() else {}
            running = bool(status.get('running'))
            version = ' · v' + str(status['version']) if status.get('version') else ''
            if running:
                value = {'present': None, 'observed': 'daemon_reachable', 'detail': 'daemon running' + version + '; the package itself was not observed', 'where': 'wsl'}
            elif status:
                value = {'present': None, 'observed': 'daemon_installed', 'detail': 'daemon installed, not running' + version + '; the package itself was not observed', 'where': 'wsl'}
            else:
                value = {'present': None, 'observed': 'daemon_unavailable', 'detail': 'daemon status unavailable; nothing observed'}
        except (OSError, subprocess.SubprocessError, ValueError):
            value = {'present': None, 'observed': 'daemon_unavailable', 'detail': 'daemon status unavailable; nothing observed'}
        _BENCH.update(at=time.monotonic(), value=value)
        return dict(value)


# What a positive probe actually observed; an environment's existence is not the
# package's, and a daemon's status is not a skill's.
EVIDENCE = {'python': 'import', 'exe': 'executable', 'wsl_env': 'environment', 'wsl_exe': 'executable', 'bench': 'daemon'}


def probe(entry):
    kind = entry['probe']['kind']
    if kind == 'bench' and entry['id'] == 'claude_science':
        # For the daemon's own entry, the daemon is the package: its status is direct evidence.
        result = probe_bench()
        running = result.get('observed') == 'daemon_reachable'
        return {'present': running if result.get('observed') in ('daemon_reachable', 'daemon_installed') else False,
                'detail': result['detail'].split(';')[0], 'where': result.get('where'), 'evidence': 'daemon'}
    if kind == 'python':
        result = probe_python(entry['probe']['module'])
    elif kind == 'exe':
        result = probe_exe(entry['probe']['name'], entry['probe'].get('paths', ()))
    elif kind == 'wsl_env':
        result = probe_wsl_env(entry['probe']['env'])
    elif kind == 'wsl_exe':
        result = probe_wsl_exe(entry['probe']['name'])
    elif kind == 'bench':
        result = probe_bench()
    else:
        return {'present': None, 'detail': entry.get('note') or 'not probed from here', 'evidence': None}
    return {**result, 'evidence': EVIDENCE[kind]}


class Catalogue:
    """Probe results cached for a few minutes; a refresh re-probes everything."""

    def __init__(self):
        self.cached = None
        self.at = 0.0
        self.lock = asyncio.Lock()

    async def report(self, refresh=False):
        async with self.lock:
            if self.cached is not None and not refresh and time.monotonic() - self.at < CACHE_SECONDS:
                return self.cached
            if refresh:
                _WSL_ENVS.update(at=0.0, value=UNSET)
                _BENCH.update(at=0.0, value=None)
            semaphore = asyncio.Semaphore(PARALLEL)

            async def one(entry):
                async with semaphore:
                    try:
                        result = await asyncio.wait_for(asyncio.to_thread(probe, entry), PROBE_TIMEOUT + 5)
                    except Exception:
                        result = {'present': False, 'detail': 'probe did not complete'}
                    return {**entry, **{k: v for k, v in result.items()}}
            entries = await asyncio.gather(*(one(entry) for entry in CATALOGUE))
            counts = {'present': sum(1 for e in entries if e['present'] is True), 'absent': sum(1 for e in entries if e['present'] is False),
                      'indirect': sum(1 for e in entries if e['present'] is None and e.get('observed')),
                      'unprobed': sum(1 for e in entries if e['present'] is None and not e.get('observed')), 'total': len(entries)}
            self.cached = {'checked_at': int(time.time()), 'categories': CATEGORIES, 'counts': counts, 'entries': entries,
                           'scope': 'presence observed by probes (an import or an executable); an environment or a daemon seen is indirect evidence, '
                                    'not the package; never qualification, correctness or currency; nothing is installed',
                           'licence_note': 'licence names as recorded when the catalogue was written; confirm at the project home before relying on one'}
            self.at = time.monotonic()
            return self.cached
