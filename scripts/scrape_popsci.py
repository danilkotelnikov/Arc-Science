#!/usr/bin/env python3
"""Scrape encyclopedic / popular-science chemistry text from Wikipedia.

Negative samples for the Layer B register classifier. The Wikipedia REST
+ MediaWiki extracts endpoints return plain text under the CC-BY-SA 4.0
license, which is the appropriate channel for ML training corpora that
need a non-academic register signal.

Output schema matches positives.jsonl / negatives.jsonl so the trainer
ingests both uniformly::

    {paper_id, para_idx, text, n_words, section, label, label_source}

Where ``label=0``, ``label_source="popsci_wikipedia"``, ``section`` is
the Wikipedia article subsection (or ``"Body"`` for the lead), and
``paper_id`` is ``wiki_<article-slug>``.

Volume target: ~3000-5000 paragraphs (~150 chemistry articles × ~20-30
substantive paragraphs each, post-filter).
"""
from __future__ import annotations

import argparse
import asyncio
import json
import os
import re
import sys
from pathlib import Path

import httpx


WIKIPEDIA_API = "https://en.wikipedia.org/w/api.php"
USER_AGENT = (
    "vedix-corpus-build/3.0 (https://github.com/danilkotelnikov/vedix; "
    "mailto:OPENALEX_EMAIL) python-httpx"
)


# Per-discipline canonical topic registries. Each list is ~120-200
# Wikipedia article titles chosen to give broad encyclopedic-register
# coverage of the discipline: foundational concepts, sub-fields,
# canonical examples, techniques, applications. Mainspace titles only
# (no namespace prefixes). The MediaWiki extracts API resolves
# redirects automatically so common synonyms still hit.
CANONICAL_CHEMISTRY_TOPICS = [
    # Elements & periodic table
    "Periodic table", "Chemical element", "Atom", "Atomic nucleus",
    "Electron", "Hydrogen", "Helium", "Lithium", "Beryllium", "Boron",
    "Carbon", "Nitrogen", "Oxygen", "Fluorine", "Neon", "Sodium",
    "Magnesium", "Aluminium", "Silicon", "Phosphorus", "Sulfur",
    "Chlorine", "Argon", "Potassium", "Calcium", "Titanium", "Iron",
    "Cobalt", "Nickel", "Copper", "Zinc", "Bromine", "Iodine", "Mercury (element)",
    "Lead", "Uranium", "Plutonium",
    # Bonding & structure
    "Chemical bond", "Covalent bond", "Ionic bond", "Hydrogen bond",
    "Van der Waals force", "Metallic bonding", "Molecular orbital theory",
    "Lewis structure", "Hybridization (chemistry)", "VSEPR theory",
    "Stereochemistry", "Chirality (chemistry)", "Aromaticity",
    # Reactions & mechanisms
    "Chemical reaction", "Acid", "Base (chemistry)", "Acid-base reaction",
    "Oxidation", "Reduction (chemistry)", "Redox", "Catalysis",
    "Combustion", "Polymerization", "Esterification", "Hydrolysis",
    "Electrolysis", "Substitution reaction", "Addition reaction",
    "Elimination reaction",
    # Thermodynamics & kinetics
    "Chemical thermodynamics", "Chemical kinetics", "Enthalpy",
    "Entropy", "Gibbs free energy", "Activation energy", "Reaction rate",
    "Chemical equilibrium", "Le Chatelier's principle",
    # Sub-fields
    "Organic chemistry", "Inorganic chemistry", "Physical chemistry",
    "Analytical chemistry", "Biochemistry", "Polymer chemistry",
    "Medicinal chemistry", "Computational chemistry", "Green chemistry",
    "Photochemistry", "Electrochemistry", "Surface science",
    "Materials science",
    # Common compounds
    "Water", "Ammonia", "Methane", "Ethanol", "Acetone", "Benzene",
    "Glucose", "Sucrose", "Caffeine", "Aspirin", "Penicillin",
    "Hemoglobin", "Chlorophyll", "Sodium chloride", "Sulfuric acid",
    "Nitric acid", "Hydrochloric acid", "Sodium hydroxide",
    "Calcium carbonate", "Carbon dioxide", "Ozone",
    # Biomolecules
    "Protein", "Enzyme", "DNA", "RNA", "Lipid", "Carbohydrate",
    "Amino acid", "Nucleic acid",
    # Materials
    "Diamond", "Graphite", "Graphene", "Carbon nanotube",
    "Polymer", "Plastic", "Rubber", "Glass", "Ceramic", "Steel",
    "Concrete", "Silicone",
    # Techniques
    "Chromatography", "Gas chromatography", "Mass spectrometry",
    "Nuclear magnetic resonance spectroscopy",
    "Infrared spectroscopy", "X-ray crystallography",
    "Distillation", "Crystallization", "Filtration",
    "Titration", "Spectrophotometry", "Electrophoresis",
    # Industrial / applied
    "Haber process", "Contact process", "Bessemer process",
    "Cracking (chemistry)", "Petroleum refining",
    "Drug design", "Drug discovery", "Pharmaceutical industry",
    "Fertilizer", "Pesticide", "Plastic recycling",
    # Concepts
    "Mole (unit)", "Molar mass", "Avogadro constant",
    "Ideal gas law", "Stoichiometry", "Concentration",
    "Solution (chemistry)", "Phase (matter)", "Crystal structure",
    "Allotropy",
]


CANONICAL_BIOLOGY_TOPICS = [
    # Cell biology
    "Cell (biology)", "Cell membrane", "Cell nucleus", "Mitochondrion",
    "Chloroplast", "Ribosome", "Endoplasmic reticulum", "Golgi apparatus",
    "Lysosome", "Cytoskeleton", "Cell biology", "Cell division",
    "Cell cycle", "Cytoplasm",
    # Molecular biology
    "DNA", "RNA", "Gene", "Genome", "Chromosome", "Mitosis", "Meiosis",
    "Heredity", "Mutation", "Allele", "Genetic code", "Transcription (biology)",
    "Translation (biology)", "CRISPR", "Epigenetics", "Molecular biology",
    "Genetic engineering", "Polymerase chain reaction",
    # Evolution
    "Evolution", "Natural selection", "Charles Darwin", "Speciation",
    "Phylogenetics", "Common descent", "Adaptation", "Fitness (biology)",
    "Genetic drift", "On the Origin of Species", "Phylogenetic tree",
    "Tree of life (biology)",
    # Plants & photosynthesis
    "Plant", "Photosynthesis", "Flowering plant", "Tree", "Botany",
    "Pollination", "Seed", "Leaf", "Root", "Stem", "Chlorophyll",
    "Cellulose", "Vascular tissue", "Xylem", "Phloem",
    # Animals
    "Animal", "Mammal", "Bird", "Fish", "Insect", "Reptile",
    "Amphibian", "Invertebrate", "Vertebrate", "Zoology",
    "Arthropod", "Mollusca", "Marsupial", "Primate",
    # Microbiology
    "Bacteria", "Virus", "Fungus", "Archaea", "Microorganism",
    "Bacteriophage", "Microbiology", "Microbiome", "Pathogen",
    "Antimicrobial resistance",
    # Anatomy/Physiology
    "Anatomy", "Physiology", "Tissue (biology)", "Organ (biology)",
    "Skeleton", "Muscle", "Bone", "Skin", "Heart", "Lung",
    "Liver", "Kidney", "Stomach", "Intestine", "Pancreas",
    # Nervous system
    "Brain", "Neuron", "Nervous system", "Synapse", "Action potential",
    "Reflex", "Neurotransmitter", "Central nervous system",
    # Immune system
    "Immune system", "Antibody", "Vaccine", "Antigen", "T cell",
    "B cell", "Innate immune system", "Adaptive immune system",
    "Allergy", "Autoimmune disease",
    # Reproduction & development
    "Reproduction", "Embryology", "Stem cell", "Embryonic development",
    "Sexual reproduction", "Asexual reproduction", "Fertilization",
    "Pregnancy", "Embryo",
    # Ecology
    "Ecosystem", "Biosphere", "Biodiversity", "Food chain", "Symbiosis",
    "Habitat", "Predation", "Ecological niche", "Population (ecology)",
    "Trophic level", "Ecology", "Biogeochemical cycle", "Nitrogen cycle",
    "Carbon cycle", "Water cycle",
    # Biochemistry
    "Protein", "Enzyme", "Lipid", "Carbohydrate", "Amino acid",
    "Nucleic acid", "Hormone", "Glycolysis", "Krebs cycle",
    "Cellular respiration", "ATP", "Metabolism", "Biochemistry",
    # Sub-fields
    "Bioinformatics", "Genomics", "Proteomics", "Biotechnology",
    "Marine biology", "Conservation biology", "Evolutionary biology",
    "Developmental biology", "Systems biology", "Synthetic biology",
    "Neuroscience", "Endocrinology", "Immunology", "Virology",
    "Mycology", "Entomology", "Ornithology", "Ichthyology",
    "Herpetology",
]


CANONICAL_PHYSICS_TOPICS = [
    # Classical mechanics
    "Classical mechanics", "Newton's laws of motion", "Force", "Mass",
    "Energy", "Momentum", "Work (physics)", "Power (physics)",
    "Acceleration", "Velocity", "Position (geometry)", "Inertia",
    "Kinetic energy", "Potential energy", "Conservation of energy",
    "Angular momentum", "Torque", "Friction", "Free body diagram",
    # Thermodynamics
    "Thermodynamics", "Heat", "Temperature", "Entropy", "Enthalpy",
    "Internal energy", "Laws of thermodynamics", "Statistical mechanics",
    "Boltzmann distribution", "Ideal gas", "Heat engine",
    "Carnot cycle", "Phase transition",
    # Electromagnetism
    "Electromagnetism", "Maxwell's equations", "Electric field",
    "Magnetic field", "Electric charge", "Electric current", "Voltage",
    "Capacitance", "Inductance", "Faraday's law of induction",
    "Ohm's law", "Coulomb's law", "Lorentz force",
    "Electromagnetic radiation", "Magnetism",
    # Optics
    "Light", "Photon", "Optics", "Refraction", "Diffraction",
    "Reflection (physics)", "Lens", "Polarization (waves)",
    "Snell's law", "Spectroscopy", "Geometrical optics",
    # Waves & sound
    "Wave", "Sound", "Frequency", "Amplitude", "Wavelength",
    "Resonance", "Standing wave", "Doppler effect", "Interference (wave propagation)",
    "Wave equation",
    # Quantum mechanics
    "Quantum mechanics", "Schrödinger equation", "Wave function",
    "Uncertainty principle", "Quantum entanglement", "Spin (physics)",
    "Pauli exclusion principle", "Quantum field theory",
    "Quantum electrodynamics", "Wave-particle duality",
    "Quantum tunnelling", "Bra-ket notation",
    # Relativity
    "Theory of relativity", "Special relativity", "General relativity",
    "Time dilation", "Spacetime", "Gravitational wave",
    "Equivalence principle", "Length contraction", "Mass-energy equivalence",
    # Particle physics
    "Standard Model", "Elementary particle", "Quark", "Lepton",
    "Boson", "Higgs boson", "Neutrino", "Antimatter",
    "Particle accelerator", "Strong interaction", "Weak interaction",
    "Hadron", "Gluon",
    # Astrophysics
    "Star", "Galaxy", "Universe", "Black hole", "Big Bang",
    "Cosmology", "Dark matter", "Dark energy", "Nucleosynthesis",
    "Pulsar", "Neutron star", "Supernova", "White dwarf",
    "Stellar evolution", "Cosmic microwave background",
    "Inflation (cosmology)", "Hubble's law",
    # Nuclear physics
    "Atomic nucleus", "Radioactive decay", "Nuclear fission",
    "Nuclear fusion", "Half-life", "Nuclear reactor",
    "Alpha decay", "Beta decay", "Gamma ray",
    # Condensed matter
    "Solid-state physics", "Semiconductor", "Superconductivity",
    "Crystal", "Phonon", "Plasma (physics)", "Magnetism",
    "Ferromagnetism", "Superfluidity", "Bose-Einstein condensate",
    # Sub-fields
    "Plasma physics", "Geophysics", "Biophysics", "Mathematical physics",
    "Quantum chemistry", "Computational physics", "Atomic physics",
    "Molecular physics",
]


CANONICAL_MEDICINE_TOPICS = [
    # Anatomy
    "Human body", "Heart", "Lung", "Kidney", "Liver", "Brain",
    "Blood", "Skin", "Stomach", "Intestine", "Pancreas", "Spleen",
    "Eye", "Ear", "Bone", "Muscle", "Cell (biology)",
    "Circulatory system", "Digestive system", "Endocrine system",
    "Respiratory system", "Urinary system",
    # Major diseases
    "Cancer", "Cardiovascular disease", "Stroke", "Diabetes",
    "Hypertension", "Asthma", "Chronic obstructive pulmonary disease",
    "Alzheimer's disease", "Parkinson's disease", "Multiple sclerosis",
    "Tuberculosis", "Influenza", "HIV/AIDS", "COVID-19", "Malaria",
    "Dengue fever", "Ebola", "Coronavirus disease 2019", "Hepatitis",
    "Pneumonia", "Heart failure", "Myocardial infarction", "Atherosclerosis",
    "Obesity", "Depression (mood)", "Schizophrenia",
    # Specialties
    "Cardiology", "Oncology", "Pediatrics", "Geriatrics", "Neurology",
    "Surgery", "Radiology", "Pathology", "Pharmacology", "Psychiatry",
    "Endocrinology", "Hematology", "Dermatology", "Orthopedic surgery",
    "Ophthalmology", "Otorhinolaryngology", "Urology", "Gynecology",
    "Obstetrics", "Anesthesiology", "Immunology", "Nephrology",
    "Pulmonology", "Gastroenterology",
    # Diagnostics
    "Magnetic resonance imaging", "CT scan", "Medical ultrasound",
    "X-ray", "Electrocardiography", "Endoscopy", "Biopsy",
    "Blood test", "Electroencephalography", "Mammography",
    # Treatments
    "Antibiotic", "Vaccine", "Antiviral drug", "Chemotherapy",
    "Radiation therapy", "Insulin", "Anesthesia", "Surgery",
    "Organ transplantation", "Dialysis", "Physical therapy",
    "Psychotherapy", "Antidepressant", "Statin",
    # Public health
    "Epidemiology", "Quarantine", "Vaccination", "Pandemic",
    "Outbreak", "Public health", "Mortality rate", "Morbidity",
    "Disease surveillance", "Health care", "Global health",
    # Pharmacology
    "Aspirin", "Paracetamol", "Penicillin", "Morphine",
    "Ibuprofen", "Warfarin", "Drug discovery", "Pharmaceutical industry",
    "Clinical trial", "Pharmacokinetics", "Adverse drug reaction",
    # Disease mechanisms
    "Inflammation", "Infection", "Pathogen", "Immunity", "Allergy",
    "Autoimmune disease", "Apoptosis", "Cytokine",
    # Major events
    "Antibiotic resistance", "Antimicrobial resistance",
    "Mental health", "Cancer screening",
]


CANONICAL_COMPUTER_SCIENCE_TOPICS = [
    # Foundational
    "Algorithm", "Data structure", "Computer", "Computer program",
    "Programming language", "Software", "Hardware", "Operating system",
    "Compiler", "Interpreter (computing)", "Computer hardware",
    "Computer architecture", "Microprocessor", "Central processing unit",
    "Random-access memory",
    # Programming
    "Programming paradigm", "Object-oriented programming",
    "Functional programming", "Imperative programming",
    "Procedural programming", "Recursion (computer science)",
    "Sorting algorithm", "Search algorithm", "Hash table",
    "Linked list", "Binary tree", "Graph (abstract data type)",
    "Dynamic programming", "Greedy algorithm",
    # Theory
    "Computational complexity theory", "Turing machine",
    "P versus NP problem", "Big O notation", "Computability theory",
    "Lambda calculus", "Automata theory", "Formal language",
    "Context-free grammar", "Regular expression", "NP-completeness",
    "Halting problem",
    # AI/ML
    "Artificial intelligence", "Machine learning", "Deep learning",
    "Neural network", "Natural language processing", "Computer vision",
    "Reinforcement learning", "Transformer (deep learning architecture)",
    "Convolutional neural network", "Recurrent neural network",
    "Support vector machine", "Decision tree", "Random forest",
    "K-means clustering", "Gradient descent", "Backpropagation",
    "Large language model", "Generative adversarial network",
    # Networks
    "Computer network", "Internet", "World Wide Web", "HTTP",
    "Internet protocol suite", "IP address", "Domain Name System",
    "OSI model", "Router (computing)", "Network packet",
    "Wireless network", "Local area network",
    # Security
    "Computer security", "Cryptography", "Encryption", "Hash function",
    "Public-key cryptography", "Cryptographic hash function",
    "RSA (cryptosystem)", "Cybersecurity", "Malware", "Computer virus",
    "Firewall (computing)", "Authentication", "Digital signature",
    # Databases
    "Database", "Relational database", "SQL", "NoSQL",
    "Database management system", "Transaction processing", "ACID",
    "Database normalization", "Index (database)",
    # Software engineering
    "Software engineering", "Software development", "Version control",
    "Software testing", "Software design pattern",
    "Agile software development", "Continuous integration",
    "DevOps", "Refactoring (computer science)",
    # Systems
    "Distributed computing", "Cloud computing", "Parallel computing",
    "Concurrency (computer science)", "Process (computing)",
    "Thread (computing)", "Virtual machine", "Container (computing)",
    # Languages
    "C (programming language)", "Python (programming language)",
    "Java (programming language)", "JavaScript", "C++",
    "Lisp (programming language)", "Haskell (programming language)",
    "Rust (programming language)", "Go (programming language)",
    "SQL",
    # Graphics & other
    "Computer graphics", "3D rendering", "Ray tracing (graphics)",
    "Game engine", "Open-source software", "Free software",
    "Linux", "Unix", "Microsoft Windows", "MacOS",
    "Quantum computing", "Bioinformatics",
]


CANONICAL_MATERIALS_TOPICS = [
    # Categories
    "Material", "Metal", "Alloy", "Steel", "Aluminium", "Titanium",
    "Copper", "Iron", "Brass", "Bronze", "Stainless steel", "Ceramic",
    "Polymer", "Composite material", "Glass", "Concrete", "Wood",
    "Rubber", "Plastic", "Nylon", "Polyester", "Polystyrene",
    "Polyethylene", "Polypropylene", "Polyvinyl chloride",
    # Properties
    "Mechanical properties of materials", "Tensile strength", "Hardness",
    "Ductility", "Toughness", "Elasticity (physics)", "Plasticity (physics)",
    "Brittleness", "Fatigue (material)", "Creep (deformation)",
    "Stress (mechanics)", "Strain (materials science)", "Young's modulus",
    "Yield (engineering)", "Stress-strain curve", "Shear modulus",
    # Structure
    "Crystal structure", "Crystallography", "Crystallographic defect",
    "Grain boundary", "Phase diagram", "Microstructure",
    "Cubic crystal system", "Lattice (group)", "Dislocation",
    "Solid solution", "Eutectic system",
    # Manufacturing
    "Metallurgy", "Casting (metalworking)", "Forging", "Welding",
    "Sintering", "Annealing (metallurgy)", "Heat treating",
    "Thin film", "Powder metallurgy", "Extrusion", "Rolling (metalworking)",
    "Machining", "3D printing", "Additive manufacturing",
    # Modern materials
    "Semiconductor", "Silicon", "Gallium arsenide", "Superconductor",
    "Magnet", "Ferromagnetism", "Piezoelectricity", "Dielectric",
    "Nanomaterial", "Graphene", "Carbon nanotube", "Quantum dot",
    "Liquid crystal", "Optical fiber", "Photonic crystal",
    "Metamaterial",
    # Surface & coating
    "Corrosion", "Oxidation", "Surface science", "Adhesion",
    "Friction", "Wear", "Lubricant", "Tribology", "Galvanization",
    "Electroplating", "Paint",
    # Specialty
    "Biomaterial", "Smart material", "Shape-memory alloy",
    "Refractory", "Carbon fiber", "Fiberglass", "Aerogel",
    "Phase-change material",
    # Polymers
    "Polymerization", "Thermoplastic", "Thermoset", "Elastomer",
    "Vulcanization", "Copolymer", "Glass transition",
    # Energy materials
    "Battery (electricity)", "Lithium-ion battery", "Fuel cell",
    "Photovoltaics", "Solar cell", "Solid-state battery",
    "Energy storage",
    # Sub-fields
    "Materials science", "Solid mechanics", "Solid-state physics",
    "Mechanical engineering", "Chemical engineering",
    "Nanotechnology",
]


CANONICAL_GEOLOGY_TOPICS = [
    # Earth's structure
    "Earth", "Earth's crust", "Earth's mantle", "Earth's outer core",
    "Earth's inner core", "Lithosphere", "Asthenosphere",
    "Plate tectonics", "Continental drift", "Subduction",
    "Rift", "Mid-ocean ridge", "Transform fault", "Hotspot (geology)",
    "Convergent boundary", "Divergent boundary",
    # Rocks & minerals
    "Rock (geology)", "Igneous rock", "Sedimentary rock",
    "Metamorphic rock", "Mineral", "Granite", "Basalt", "Limestone",
    "Sandstone", "Shale", "Quartz", "Feldspar", "Mica", "Calcite",
    "Pyrite", "Olivine", "Pyroxene", "Amphibole", "Coal",
    "Petroleum", "Natural gas",
    # Surface processes
    "Erosion", "Weathering", "Sediment", "Sedimentation",
    "River", "Glacier", "Ocean", "Coast", "Beach", "Desert",
    "Wetland", "Karst", "Mass wasting", "Soil erosion",
    "Fluvial processes",
    # Hazards
    "Earthquake", "Volcano", "Volcanic eruption", "Tsunami",
    "Landslide", "Flood", "Lava", "Magma", "Fault (geology)",
    "Pyroclastic flow", "Volcanic ash", "Caldera", "Geyser",
    "Hot spring", "Volcanism",
    # Time & stratigraphy
    "Geologic time scale", "Stratigraphy", "Geochronology",
    "Era (geology)", "Period (geology)", "Epoch (geology)",
    "Fossil", "Paleontology", "Index fossil", "Radiometric dating",
    "Carbon-14", "Uranium-lead dating", "Cambrian explosion",
    "Mesozoic", "Cenozoic",
    # Climate
    "Climate", "Climate change", "Weather", "Atmosphere of Earth",
    "Greenhouse effect", "Ice age", "Glacial period",
    "Interglacial period", "Paleoclimatology", "Ocean current",
    "Thermohaline circulation",
    # Hydrology
    "Water cycle", "Groundwater", "Aquifer", "Hydrology",
    "Spring (hydrology)", "Marsh", "Swamp", "Estuary",
    "Watershed",
    # Mountains/Terrain
    "Mountain", "Hill", "Valley", "Plateau", "Canyon", "Cave",
    "Topography", "Geomorphology", "Mountain formation",
    "Orogeny",
    # Soil
    "Soil", "Pedogenesis", "Topsoil", "Loam", "Clay",
    "Sand", "Humus",
    # Sub-fields
    "Geology", "Geophysics", "Geochemistry", "Mineralogy",
    "Petrology", "Volcanology", "Seismology", "Hydrogeology",
    "Engineering geology", "Economic geology", "Structural geology",
    "Planetary geology", "Astrogeology", "Sedimentology",
    "Tectonics", "Geodesy",
]


TOPIC_REGISTRIES: dict[str, list[str]] = {
    "chemistry":        CANONICAL_CHEMISTRY_TOPICS,
    "biology":          CANONICAL_BIOLOGY_TOPICS,
    "physics":          CANONICAL_PHYSICS_TOPICS,
    "medicine":         CANONICAL_MEDICINE_TOPICS,
    "computer_science": CANONICAL_COMPUTER_SCIENCE_TOPICS,
    "materials":        CANONICAL_MATERIALS_TOPICS,
    "geology":          CANONICAL_GEOLOGY_TOPICS,
}


def _safe_paper_id(title: str) -> str:
    """Turn a Wikipedia title into a filesystem-safe slug."""
    s = re.sub(r"[^a-zA-Z0-9._-]", "_", title)
    return f"wiki_{s}"


async def fetch_wikipedia_extract(
    title: str, *, client: httpx.AsyncClient,
) -> tuple[str, str] | None:
    """Fetch one article's plain-text extract via the MediaWiki API.

    Returns ``(canonical_title, plain_text)`` on success, ``None`` on
    miss / disambiguation / failure. The ``extracts`` API returns the
    article body as plain text with sections separated by `\n\n` and
    headings stripped (we keep our own simple section tag).
    """
    params = {
        "action": "query",
        "format": "json",
        "titles": title,
        "prop": "extracts",
        "explaintext": "1",
        "exsectionformat": "plain",
        "redirects": "1",
    }
    try:
        r = await client.get(WIKIPEDIA_API, params=params, timeout=30)
        if r.status_code != 200:
            return None
        data = r.json()
    except Exception:  # noqa: BLE001
        return None

    pages = data.get("query", {}).get("pages") or {}
    for pid, page in pages.items():
        if pid == "-1":
            return None
        if "missing" in page or "extract" not in page:
            return None
        extract = page.get("extract", "")
        canonical = page.get("title", title)
        # Drop very short extracts (disambiguation / stub).
        if len(extract.strip()) < 600:
            return None
        # Drop disambiguation pages.
        if extract.strip().lower().startswith(
            ("may refer to", "is the name of", "can refer to")
        ):
            return None
        return canonical, extract
    return None


def segment_extract(text: str) -> list[tuple[str, str]]:
    """Split a Wikipedia plain-text extract into ``(section, paragraph)``.

    The ``exsectionformat=plain`` extract uses blank lines between
    paragraphs and a leading line of the form ``"== Section name =="``
    for section headers (in plain mode it shows as ``"== Name =="``).
    We strip Wikipedia "See also" / "References" / "External links" /
    "Further reading" sections wholesale — those are link lists with
    no real prose.
    """
    drop_sections = {
        "see also", "references", "external links", "further reading",
        "notes", "citations", "bibliography", "footnotes",
    }
    current_section = "Lead"
    out: list[tuple[str, str]] = []
    raw_paragraphs = re.split(r"\n\s*\n", text)
    for raw in raw_paragraphs:
        para = raw.strip()
        if not para:
            continue
        # Section header? "== Header ==" pattern in plain text.
        m = re.match(r"^=+\s*(.+?)\s*=+\s*$", para)
        if m:
            current_section = m.group(1).strip()
            continue
        if current_section.lower() in drop_sections:
            continue
        # Strip residual wiki markup that the extract endpoint sometimes
        # leaves in (rare): pipe-tables, file refs, citations.
        if para.startswith(("|", "{|", "File:", "[[Image:")):
            continue
        # Substantive paragraph guard: 60-1500 words.
        words = para.split()
        if len(words) < 60 or len(words) > 1500:
            continue
        out.append((current_section, para))
    return out


async def main_async(args, log) -> int:
    email = os.environ.get("OPENALEX_EMAIL", "research@example.com")
    ua = USER_AGENT.replace("OPENALEX_EMAIL", email)

    out_root = Path(os.path.expanduser(f"~/.vedix/corpus/{args.discipline}/en"))
    out_root.mkdir(parents=True, exist_ok=True)
    out_path = out_root / "popsci_negatives.jsonl"

    # Build the title list: per-discipline canonical + (optionally) categorymembers.
    canonical = TOPIC_REGISTRIES.get(args.discipline)
    if canonical is None:
        log.error("no canonical topic registry for discipline %r; available: %s",
                  args.discipline, sorted(TOPIC_REGISTRIES))
        return 1
    titles = list(canonical)
    if args.add_category_members:
        async with httpx.AsyncClient(
            timeout=30, headers={"User-Agent": ua}, follow_redirects=True,
        ) as client:
            for cat in args.add_category_members.split(","):
                cat = cat.strip()
                if not cat:
                    continue
                params = {
                    "action": "query", "format": "json", "list": "categorymembers",
                    "cmtitle": f"Category:{cat}", "cmlimit": "100", "cmtype": "page",
                }
                try:
                    r = await client.get(WIKIPEDIA_API, params=params)
                    members = r.json().get("query", {}).get("categorymembers", [])
                    new_titles = [
                        m["title"] for m in members
                        if m.get("ns") == 0 and ":" not in m.get("title", "")
                    ]
                    log.info("category %s -> %d new titles", cat, len(new_titles))
                    titles.extend(new_titles)
                except Exception as exc:  # noqa: BLE001
                    log.warning("category %s fetch failed: %s", cat, exc)

    # Dedup, cap to --target-articles
    seen: set[str] = set()
    unique_titles: list[str] = []
    for t in titles:
        key = t.lower()
        if key in seen:
            continue
        seen.add(key)
        unique_titles.append(t)
    if args.target_articles:
        unique_titles = unique_titles[: args.target_articles]
    log.info("queued %d Wikipedia chemistry articles to fetch", len(unique_titles))

    # Fetch + segment.
    written_paragraphs = 0
    written_articles = 0
    skipped_articles = 0
    failed_articles = 0

    out_path.unlink(missing_ok=True)
    async with httpx.AsyncClient(
        timeout=30, headers={"User-Agent": ua}, follow_redirects=True,
    ) as client:
        with out_path.open("a", encoding="utf-8") as out_fh:
            for i, title in enumerate(unique_titles, start=1):
                result = await fetch_wikipedia_extract(title, client=client)
                if result is None:
                    failed_articles += 1
                    if i % 10 == 0:
                        log.info(
                            "[%d/%d] skip %r (no extract / disambiguation / too short)",
                            i, len(unique_titles), title,
                        )
                    await asyncio.sleep(0.4)
                    continue
                canonical, extract = result
                paras = segment_extract(extract)
                if not paras:
                    skipped_articles += 1
                    await asyncio.sleep(0.4)
                    continue
                paper_id = _safe_paper_id(canonical)
                for idx, (section, para) in enumerate(paras):
                    entry = {
                        "paper_id": paper_id,
                        "para_idx": idx,
                        "text": para,
                        "n_words": len(para.split()),
                        "section": section,
                        "label": 0,
                        "label_source": "popsci_wikipedia",
                    }
                    out_fh.write(json.dumps(entry, ensure_ascii=False) + "\n")
                    written_paragraphs += 1
                written_articles += 1
                if i % 20 == 0 or i == len(unique_titles):
                    log.info(
                        "[%d/%d] %s -> %d paragraphs (running totals: "
                        "articles=%d paragraphs=%d skip=%d fail=%d)",
                        i, len(unique_titles), canonical, len(paras),
                        written_articles, written_paragraphs,
                        skipped_articles, failed_articles,
                    )
                # Polite delay so we don't hammer the API.
                await asyncio.sleep(0.4)

    print()
    print("Popsci Wikipedia scrape summary")
    print("-" * 50)
    print(f"  output:               {out_path}")
    print(f"  articles fetched:     {written_articles}")
    print(f"  articles skipped:     {skipped_articles + failed_articles}")
    print(f"  paragraphs written:   {written_paragraphs}")
    print()
    return 0


def main():
    import logging

    desc = (__doc__ or "").splitlines()[0] if __doc__ else "Popsci scraper"
    ap = argparse.ArgumentParser(description=desc)
    ap.add_argument("--discipline", default="chemistry",
                    choices=["chemistry", "biology", "physics", "medicine",
                             "computer_science", "materials", "geology"],
                    help="Discipline directory under ~/.vedix/corpus/")
    ap.add_argument("--target-articles", type=int, default=200,
                    help="Cap the number of Wikipedia articles to fetch.")
    ap.add_argument("--add-category-members", default="",
                    help="Comma-separated Wikipedia category names whose "
                         "direct page members get appended to the canonical "
                         "topic list. Example: "
                         "'Organic_compounds,Chemical_compounds_of_carbon'.")
    ap.add_argument("-v", "--verbose", action="count", default=0)
    args = ap.parse_args()

    level = logging.WARNING
    if args.verbose == 1:
        level = logging.INFO
    elif args.verbose >= 2:
        level = logging.DEBUG
    logging.basicConfig(
        level=level,
        format="%(asctime)s %(levelname)-5s %(name)s | %(message)s",
        datefmt="%H:%M:%S",
    )
    log = logging.getLogger("vedix.popsci")
    sys.exit(asyncio.run(main_async(args, log)))


if __name__ == "__main__":
    main()
