"""
Generate study.json from ClinicalKB vault data (data.json).

Auto-generates entries for: conditions, anatomy, medications, principles, presentations, drugs.
Preserves hand-authored codes (must follow AHA algorithms exactly).
Preserves hand-authored entries that already exist in study.json (by ID).

Usage: python generate_study.py
"""

import json
import re
from pathlib import Path

DATA_PATH = Path(r"C:\Users\stace\spaceport\ClinicalKB-Study\app\data.json")
STUDY_PATH = Path(r"C:\Users\stace\spaceport\ClinicalKB-Study\app\study.json")
OUTPUT_PATH = STUDY_PATH  # overwrite


def load_data():
    with open(DATA_PATH, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_existing_study():
    try:
        with open(STUDY_PATH, 'r', encoding='utf-8') as f:
            return json.load(f)
    except FileNotFoundError:
        return {}


def get_section(note, *keys):
    """Find the best matching section from a list of possible keys."""
    if not note or 'sections' not in note:
        return ''
    sections = note['sections']
    for key in keys:
        if key in sections:
            return sections[key]
        # Try partial match
        for sk in sections:
            if key in sk:
                return sections[sk]
    return ''


def truncate_section(text, max_chars=1500):
    """Truncate a section to reasonable length for study cards."""
    if not text or len(text) <= max_chars:
        return text
    # Try to cut at a paragraph or line break
    cut = text.rfind('\n', 0, max_chars)
    if cut < max_chars * 0.5:
        cut = text.rfind('. ', 0, max_chars)
    if cut < max_chars * 0.3:
        cut = max_chars
    return text[:cut].rstrip()


def find_system_for_condition(note, data):
    """Find the system ID for a condition via field or graph."""
    if note.get('system'):
        # Convert system name to ID
        for sid, snote in data['notes'].items():
            if snote['category'] == 'Systems' and snote['title'] == note['system']:
                return sid
        # Try slug match
        slug = note['system'].lower().replace(' ', '-')
        if slug in data['notes']:
            return slug
    # Fall back to graph links
    for linked in data['graph'].get(note['id'], []):
        linked_note = data['notes'].get(linked)
        if linked_note and linked_note['category'] == 'Systems':
            return linked
    return None


def find_medclass_for_condition(note, data):
    """Find the most relevant pharmacology note for a condition."""
    pharm_links = [lid for lid in data['graph'].get(note['id'], [])
                   if data['notes'].get(lid, {}).get('category') == 'Pharmacology']
    if not pharm_links:
        return None
    if len(pharm_links) == 1:
        return pharm_links[0]
    # Score by mentions in management section
    mgmt = get_section(note, 'management', 'ed-management').lower()
    best_id, best_score = pharm_links[0], 0
    for pid in pharm_links:
        pnote = data['notes'][pid]
        terms = [pnote['title'].lower()] + [a.lower() for a in pnote.get('aliases', [])]
        score = sum(mgmt.count(t) for t in terms if len(t) > 3)
        if score > best_score:
            best_id, best_score = pid, score
    return best_id


def generate_conditions(data, existing_ids):
    """Generate condition entries from vault Conditions notes."""
    conditions = []
    for note_id in sorted(data['categories'].get('Conditions', [])):
        if note_id in existing_ids:
            continue
        note = data['notes'][note_id]
        overview = get_section(note, 'definition', 'overview')
        pathophys = get_section(note, 'pathophysiology', 'mechanism')
        features = get_section(note, 'clinicalFeatures', 'clinical-features')
        mgmt = get_section(note, 'management', 'ed-management')
        nursing = get_section(note, 'nursingConsiderations', 'nursing-considerations')
        pearls = note.get('clinicalPearls', [])

        # Skip notes with very little content
        if len(overview) + len(pathophys) + len(features) < 100:
            continue

        system_id = find_system_for_condition(note, data)
        medclass_id = find_medclass_for_condition(note, data)

        entry = {
            'id': note_id,
            'title': note['title'],
            'system': system_id,
            'medClass': medclass_id,
            'overview': truncate_section(overview, 800),
            'pathophysiology': truncate_section(pathophys, 1500),
            'keyFeatures': truncate_section(features, 1500),
            'management': truncate_section(mgmt, 1500),
            'nursingPriorities': truncate_section(nursing, 1200),
            'pearls': pearls[:5]
        }
        conditions.append(entry)
    return conditions


def generate_anatomy(data, existing_ids):
    """Generate anatomy entries from vault Systems notes."""
    anatomy = []
    for note_id in sorted(data['categories'].get('Systems', [])):
        if note_id in existing_ids:
            continue
        note = data['notes'][note_id]
        entry = {
            'id': note_id,
            'title': note['title'],
            'keyStructures': truncate_section(get_section(note, 'anatomy', 'key-structures'), 1500),
            'normalPhysiology': truncate_section(get_section(note, 'physiology', 'normal-function'), 1500),
            'clinicalAssessment': truncate_section(get_section(note, 'assessment', 'physical-exam'), 1200),
            'labValues': truncate_section(get_section(note, 'key-lab-values', 'lab', 'diagnostics'), 800),
            'clinicalConnection': ''  # Leave blank for hand-authoring
        }
        # Skip if too sparse
        if len(entry['keyStructures']) + len(entry['normalPhysiology']) < 100:
            continue
        anatomy.append(entry)
    return anatomy


def generate_medications(data, existing_ids):
    """Generate medication class entries from vault Pharmacology notes."""
    medications = []
    for note_id in sorted(data['categories'].get('Pharmacology', [])):
        if note_id in existing_ids:
            continue
        note = data['notes'][note_id]
        moa = get_section(note, 'mechanism', 'mechanism-of-action')
        indications = get_section(note, 'indications')
        key_drugs = get_section(note, 'keyDrugs', 'key-drugs', 'key-agents')
        adverse = get_section(note, 'adverseEffects', 'adverse-effects')
        nursing = get_section(note, 'nursingConsiderations', 'nursing-considerations')
        contraindications = get_section(note, 'contraindications')

        if len(moa) < 50:
            continue

        # Parse FDA uses from indications section
        fda_uses = []
        if indications:
            for line in indications.split('\n'):
                line = line.strip()
                if line.startswith('- ') or line.startswith('* '):
                    use = line[2:].strip()
                    use = re.sub(r'\*\*(.+?)\*\*', r'\1', use)  # strip bold
                    if len(use) > 5 and len(use) < 200:
                        fda_uses.append(use)

        # Parse ED drugs from key drugs section (extract from table or list)
        ed_drugs = []
        if key_drugs:
            # Try to extract drug entries from the text
            lines = key_drugs.split('\n')
            for line in lines:
                line = line.strip()
                bold_match = re.match(r'\*\*(.+?)\*\*', line)
                if bold_match and '|' not in line:
                    drug_name = bold_match.group(1)
                    rest = line[bold_match.end():].strip(' :—-')
                    if len(drug_name) > 2 and len(drug_name) < 60:
                        ed_drugs.append({
                            'name': drug_name,
                            'dose': '',
                            'why': truncate_section(rest, 200) if rest else ''
                        })

        entry = {
            'id': note_id,
            'title': note['title'],
            'moa': truncate_section(moa, 1200),
            'fdaUses': fda_uses[:8] if fda_uses else [],
            'nonFdaUses': [],
            'edDrugs': ed_drugs[:6] if ed_drugs else [],
            'adverseEffects': truncate_section(adverse, 800),
            'nursingConsiderations': truncate_section(nursing, 1000)
        }
        medications.append(entry)
    return medications


def generate_principles(data, existing_ids):
    """Generate principle entries from vault Concepts notes."""
    principles = []
    for note_id in sorted(data['categories'].get('Concepts', [])):
        if note_id in existing_ids:
            continue
        note = data['notes'][note_id]
        definition = get_section(note, 'definition', 'the-core-concept', 'overview')
        detail = get_section(note, 'pathophysiology', 'mechanism', 'key-principles',
                             'physiology', 'the-system', 'the-framework')
        clinical = get_section(note, 'clinicalFeatures', 'clinical-significance',
                               'clinical-applications', 'when-it-breaks')
        pearls = note.get('clinicalPearls', [])

        if len(definition) < 50:
            continue

        # Find linked conditions and meds from graph
        linked_conditions = [lid for lid in data['graph'].get(note_id, [])
                           if data['notes'].get(lid, {}).get('category') == 'Conditions'][:5]
        linked_meds = [lid for lid in data['graph'].get(note_id, [])
                      if data['notes'].get(lid, {}).get('category') == 'Pharmacology'][:5]

        entry = {
            'id': note_id,
            'title': note['title'],
            'theCore': truncate_section(definition, 600),
            'howItWorks': truncate_section(detail, 1500),
            'clinicalConnection': truncate_section(clinical, 1200),
            'atTheBedside': '\n'.join(['- ' + p for p in pearls[:4]]) if pearls else '',
            'linkedConditions': linked_conditions,
            'linkedMeds': linked_meds
        }
        principles.append(entry)
    return principles


def generate_presentations(data, existing_ids):
    """Generate presentation entries from Chief Complaints notes."""
    presentations = []
    cc_ids = data['categories'].get('Chief Complaints', [])

    for note_id in sorted(cc_ids):
        if note_id in existing_ids:
            continue
        note = data['notes'][note_id]
        title = note['title']

        # Skip the triage note guide (it's a meta-note, not a CC)
        if 'triage note guide' in title.lower():
            continue

        # Find conditions linked from this CC note
        linked_condition_ids = [lid for lid in data['graph'].get(note_id, [])
                               if data['notes'].get(lid, {}).get('category') == 'Conditions']

        if not linked_condition_ids:
            continue

        # Build differentials from linked conditions
        differentials = []
        for cid in linked_condition_ids[:5]:  # Top 5 differentials
            cond = data['notes'][cid]
            diag_text = get_section(cond, 'diagnosis', 'diagnostics')
            features_text = get_section(cond, 'clinicalFeatures', 'clinical-features')
            mgmt_text = get_section(cond, 'management', 'ed-management')

            # Extract diagnostics (first few bullet points)
            diagnostics = []
            if diag_text:
                for line in diag_text.split('\n'):
                    line = line.strip()
                    if (line.startswith('- ') or line.startswith('* ')) and len(line) > 10:
                        test_text = line[2:].strip()
                        test_text = re.sub(r'\*\*(.+?)\*\*', r'\1', test_text)
                        test_text = re.sub(r'\[\[.*?\]\]', '', test_text)
                        if len(test_text) > 5:
                            diagnostics.append({
                                'test': test_text[:80],
                                'lookingFor': ''
                            })
                    if len(diagnostics) >= 3:
                        break

            # Extract treatments (first few from management)
            treatments = []
            if mgmt_text:
                for line in mgmt_text.split('\n'):
                    line = line.strip()
                    if (line.startswith('- ') or line.startswith('* ')) and len(line) > 10:
                        tx_text = line[2:].strip()
                        tx_text = re.sub(r'\*\*(.+?)\*\*', r'\1', tx_text)
                        tx_text = re.sub(r'\[\[.*?\]\]', '', tx_text)
                        if len(tx_text) > 5:
                            treatments.append({
                                'intervention': tx_text[:120],
                                'why': ''
                            })
                    if len(treatments) >= 3:
                        break

            # Build distinguishing text from first 2-3 features
            distinguishing_parts = []
            if features_text:
                for line in features_text.split('\n'):
                    line = line.strip()
                    if (line.startswith('- ') or line.startswith('* ')) and len(line) > 10:
                        feat = line[2:].strip()
                        feat = re.sub(r'\*\*(.+?)\*\*', r'\1', feat)
                        feat = re.sub(r'\[\[.*?\]\]', '', feat)
                        if len(feat) > 5:
                            distinguishing_parts.append(feat[:100])
                    if len(distinguishing_parts) >= 3:
                        break

            diff = {
                'diagnosis': cond['title'],
                'conditionId': cid,
                'diagnostics': diagnostics if diagnostics else [{'test': 'See full note', 'lookingFor': ''}],
                'distinguishing': '; '.join(distinguishing_parts) if distinguishing_parts else 'See full condition note for details',
                'treatments': treatments if treatments else [{'intervention': 'See full note', 'why': ''}]
            }
            differentials.append(diff)

        if not differentials:
            continue

        entry = {
            'id': note_id,
            'chiefComplaint': title,
            'arrival': '',  # Leave blank for hand-authoring
            'differentials': differentials
        }
        presentations.append(entry)
    return presentations


def generate_drugs(data, existing_ids):
    """Extract individual drug entries from Pharmacology notes' Key Drugs tables."""
    drugs = []
    seen_names = set()

    for note_id in sorted(data['categories'].get('Pharmacology', [])):
        note = data['notes'][note_id]
        key_drugs_text = get_section(note, 'keyDrugs', 'key-drugs', 'key-agents')
        if not key_drugs_text:
            continue

        # Try to parse table rows (| Drug | Route | Dose | ... |)
        lines = key_drugs_text.split('\n')
        headers = []
        for line in lines:
            line = line.strip()
            if not line.startswith('|'):
                continue
            cells = [c.strip() for c in line.split('|') if c.strip()]
            if not cells:
                continue
            # Skip separator rows
            if all(re.match(r'^[-:]+$', c) for c in cells):
                continue
            # First row with cells = headers
            if not headers:
                headers = [h.lower().replace('*', '') for h in cells]
                continue

            # Data row
            row = dict(zip(headers, cells))
            drug_name = row.get('drug', row.get('agent', row.get('medication', '')))
            drug_name = re.sub(r'\*\*(.+?)\*\*', r'\1', drug_name).strip()

            if not drug_name or len(drug_name) < 3 or drug_name.lower() in seen_names:
                continue

            # Extract brand name if in parentheses
            brand_match = re.search(r'\(([^)]+)\)', drug_name)
            brand = brand_match.group(1) if brand_match else ''
            clean_name = re.sub(r'\s*\([^)]+\)', '', drug_name).strip()

            if clean_name.lower() in seen_names:
                continue
            seen_names.add(clean_name.lower())

            dose = row.get('typical dose', row.get('dose', row.get('dosing', '')))
            dose = re.sub(r'\*\*(.+?)\*\*', r'\1', dose).strip()

            route = row.get('route', '')
            route = re.sub(r'\*\*(.+?)\*\*', r'\1', route).strip()

            key_points = row.get('key points', row.get('key differentiators',
                         row.get('notes', row.get('clinical pearls', ''))))
            key_points = re.sub(r'\*\*(.+?)\*\*', r'\1', key_points).strip() if key_points else ''

            best_for = row.get('best for', row.get('primary use', row.get('indication', '')))
            best_for = re.sub(r'\*\*(.+?)\*\*', r'\1', best_for).strip() if best_for else ''

            drug_entry = {
                'name': clean_name,
                'brand': brand,
                'class': note['title'],
                'classNoteId': note_id,
                'dose': dose,
                'route': route,
                'uses': best_for,
                'keyPoints': key_points
            }
            drugs.append(drug_entry)

    return drugs


def main():
    print("Generating study.json from vault data...\n")
    data = load_data()
    existing = load_existing_study()

    # Collect existing hand-authored IDs to preserve
    existing_condition_ids = {e['id'] for e in existing.get('conditions', [])}
    existing_anatomy_ids = {e['id'] for e in existing.get('anatomy', [])}
    existing_med_ids = {e['id'] for e in existing.get('medications', [])}
    existing_principle_ids = {e['id'] for e in existing.get('principles', [])}
    existing_presentation_ids = {e['id'] for e in existing.get('presentations', [])}
    existing_drug_names = {e['name'].lower() for e in existing.get('drugs', [])}

    # Generate new entries
    new_conditions = generate_conditions(data, existing_condition_ids)
    new_anatomy = generate_anatomy(data, existing_anatomy_ids)
    new_meds = generate_medications(data, existing_med_ids)
    new_principles = generate_principles(data, existing_principle_ids)
    new_presentations = generate_presentations(data, existing_presentation_ids)
    new_drugs = generate_drugs(data, existing_drug_names)

    # Filter out drugs that already exist by name
    new_drugs = [d for d in new_drugs if d['name'].lower() not in existing_drug_names]

    # Merge: hand-authored first, then auto-generated
    study = {
        'presentations': existing.get('presentations', []) + new_presentations,
        'conditions': existing.get('conditions', []) + new_conditions,
        'anatomy': existing.get('anatomy', []) + new_anatomy,
        'medications': existing.get('medications', []) + new_meds,
        'principles': existing.get('principles', []) + new_principles,
        'codes': existing.get('codes', []),  # NEVER auto-generate codes
        'drugs': existing.get('drugs', []) + new_drugs,
    }

    # Stats
    print(f"Presentations: {len(existing.get('presentations', []))} hand-authored + {len(new_presentations)} auto-generated = {len(study['presentations'])}")
    print(f"Conditions:    {len(existing.get('conditions', []))} hand-authored + {len(new_conditions)} auto-generated = {len(study['conditions'])}")
    print(f"Anatomy:       {len(existing.get('anatomy', []))} hand-authored + {len(new_anatomy)} auto-generated = {len(study['anatomy'])}")
    print(f"Med Classes:   {len(existing.get('medications', []))} hand-authored + {len(new_meds)} auto-generated = {len(study['medications'])}")
    print(f"Principles:    {len(existing.get('principles', []))} hand-authored + {len(new_principles)} auto-generated = {len(study['principles'])}")
    print(f"Codes:         {len(study['codes'])} (hand-authored only, never auto-generated)")
    print(f"Drugs:         {len(existing.get('drugs', []))} hand-authored + {len(new_drugs)} auto-generated = {len(study['drugs'])}")

    total = sum(len(v) for v in study.values())
    print(f"\nTotal entries: {total}")

    # Write output
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(study, f, ensure_ascii=False, indent=2)

    size_kb = OUTPUT_PATH.stat().st_size / 1024
    print(f"Written to {OUTPUT_PATH} ({size_kb:.0f} KB)")


if __name__ == '__main__':
    main()
