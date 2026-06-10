"""
ClinicalKB Export Script
Parses the Obsidian vault into structured JSON for the study PWA.
Usage: python export_kb.py
"""

import os
import re
import json
from datetime import datetime
from pathlib import Path

VAULT_PATH = Path(r"C:\Users\stace\spaceport\ClinicalKB")
OUTPUT_PATH = Path(r"C:\Users\stace\spaceport\ClinicalKB-Study\app\data.json")
CATEGORIES = ["Systems", "Concepts", "Pharmacology", "Conditions", "Procedures", "Diagnostics", "Chief Complaints"]


def slugify(name):
    """Convert note title to URL-friendly slug."""
    s = name.lower().strip()
    s = re.sub(r'[^a-z0-9\s-]', '', s)
    s = re.sub(r'[\s]+', '-', s)
    return s.strip('-')


def extract_wikilinks(text):
    """Extract all [[wikilink]] targets from text."""
    links = set()
    for match in re.finditer(r'\[\[([^\]|#]+)[^\]]*\]\]', text):
        links.add(match.group(1).strip())
    return sorted(links)


def extract_tags(text):
    """Extract #tags from the bottom of a note."""
    tags = set()
    for match in re.finditer(r'(?:^|\s)#([a-zA-Z][a-zA-Z0-9_-]*)', text):
        tags.add(match.group(1).lower())
    return sorted(tags)


def parse_yaml_frontmatter(lines):
    """Parse YAML frontmatter between --- delimiters."""
    fm = {}
    if not lines or lines[0].strip() != '---':
        return fm, lines

    end = -1
    for i in range(1, len(lines)):
        if lines[i].strip() == '---':
            end = i
            break
    if end == -1:
        return fm, lines

    for line in lines[1:end]:
        line = line.strip()
        if ':' in line:
            key, val = line.split(':', 1)
            key = key.strip()
            val = val.strip()
            # Handle YAML arrays like [tag1, tag2]
            if val.startswith('[') and val.endswith(']'):
                val = [v.strip().strip('"').strip("'") for v in val[1:-1].split(',')]
            fm[key] = val
    return fm, lines[end + 1:]


def parse_inline_frontmatter(lines):
    """Parse inline frontmatter like **System:** [[Lymphatic...]]"""
    fm = {}
    content_start = 0
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith('**') and ':**' in stripped:
            match = re.match(r'\*\*(.+?):\*\*\s*(.*)', stripped)
            if match:
                key = match.group(1).strip()
                val = match.group(2).strip()
                fm[key] = val
                content_start = i + 1
        elif stripped == '---':
            content_start = i + 1
            break
        elif stripped.startswith('#') and not stripped.startswith('##'):
            content_start = i + 1
        elif stripped == '':
            continue
        else:
            break
    return fm, content_start


def parse_sections(lines):
    """Parse markdown into sections by H2 headings."""
    sections = {}
    current_heading = None
    current_content = []

    for line in lines:
        stripped = line.strip()
        if stripped.startswith('## '):
            if current_heading:
                sections[current_heading] = '\n'.join(current_content).strip()
            current_heading = stripped[3:].strip()
            current_content = []
        elif current_heading is not None:
            current_content.append(line)

    if current_heading:
        sections[current_heading] = '\n'.join(current_content).strip()

    return sections


def extract_clinical_pearls(sections):
    """Extract clinical pearls from the Clinical Pearls section."""
    pearls = []
    pearl_text = sections.get('Clinical Pearls', '')
    if not pearl_text:
        return pearls

    # Three formats observed:
    # 1. Bullet list: "- **Bold** — context" (most common)
    # 2. Blockquote: "> **Bold** — context"
    # 3. Paragraph: "**Bold** — context" separated by blank lines

    lines = pearl_text.split('\n')
    current_pearl = []

    for line in lines:
        stripped = line.strip()

        # Skip empty lines (flush current pearl)
        if stripped == '' or stripped == '---':
            if current_pearl:
                pearls.append(' '.join(current_pearl).strip())
                current_pearl = []
            continue

        # New bullet point = new pearl
        if stripped.startswith('- ') or stripped.startswith('* '):
            if current_pearl:
                pearls.append(' '.join(current_pearl).strip())
                current_pearl = []
            current_pearl.append(stripped[2:].strip())

        # New blockquote = new pearl
        elif stripped.startswith('> '):
            if current_pearl:
                pearls.append(' '.join(current_pearl).strip())
                current_pearl = []
            current_pearl.append(stripped[2:].strip())

        # Line starting with bold = new pearl (paragraph style)
        elif stripped.startswith('**') and current_pearl:
            pearls.append(' '.join(current_pearl).strip())
            current_pearl = [stripped]

        # Continuation of current pearl
        else:
            current_pearl.append(stripped)

    if current_pearl:
        pearls.append(' '.join(current_pearl).strip())

    # Clean up empty or tiny entries, remove "First principles:" cross-refs and placeholders
    placeholders = ['add from daily practice', 'add from clinical', 'todo', 'placeholder']
    pearls = [p for p in pearls
              if len(p) > 20
              and not p.startswith('*First principles')
              and not any(ph in p.lower() for ph in placeholders)]
    return pearls


def extract_scenario_hints(sections):
    """For condition notes, extract data useful for building scenarios."""
    hints = {
        'signs': [],
        'symptoms': [],
        'keyLabs': [],
        'redFlags': [],
    }

    # Extract from Clinical Features
    clinical = sections.get('Clinical Features', '')
    if clinical:
        # Look for bullet points with clinical signs
        for line in clinical.split('\n'):
            stripped = line.strip()
            if stripped.startswith('- ') or stripped.startswith('* '):
                item = stripped[2:].strip()
                # Remove wikilinks for display
                item = re.sub(r'\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]', r'\1', item)
                if item and len(item) > 3:
                    hints['signs'].append(item)

    # Extract red flags
    if '🚩' in clinical or 'RED FLAG' in clinical.upper():
        in_red_flags = False
        for line in clinical.split('\n'):
            if '🚩' in line or 'RED FLAG' in line.upper():
                in_red_flags = True
                continue
            if in_red_flags:
                if line.strip().startswith('#'):
                    break
                if line.strip().startswith('- '):
                    item = line.strip()[2:]
                    item = re.sub(r'\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]', r'\1', item)
                    hints['redFlags'].append(item)

    # Extract key labs from Diagnosis section
    diagnosis = sections.get('Diagnosis', '')
    if diagnosis:
        for line in diagnosis.split('\n'):
            if '|' in line and not line.strip().startswith('|--'):
                parts = [p.strip() for p in line.split('|') if p.strip()]
                if len(parts) >= 2 and parts[0] != 'Test' and parts[0] != 'SIRS Criterion':
                    lab = re.sub(r'\*\*(.+?)\*\*', r'\1', parts[0])
                    hints['keyLabs'].append(lab)

    return hints


def parse_note(filepath, category):
    """Parse a single markdown note into structured data."""
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()

    lines = content.split('\n')

    # Extract title from first H1
    title = filepath.stem
    for line in lines:
        if line.strip().startswith('# ') and not line.strip().startswith('## '):
            title = line.strip()[2:].strip()
            break

    # Parse frontmatter (YAML or inline)
    yaml_fm, remaining_lines = parse_yaml_frontmatter(lines)
    if yaml_fm:
        # Skip to content after frontmatter, find H1
        body_lines = []
        past_title = False
        for line in remaining_lines:
            if not past_title and line.strip().startswith('# '):
                past_title = True
                continue
            if past_title:
                body_lines.append(line)
        if not past_title:
            body_lines = list(remaining_lines)
        frontmatter = yaml_fm
    else:
        # Find H1, skip it, parse inline frontmatter
        h1_idx = 0
        for i, line in enumerate(lines):
            if line.strip().startswith('# ') and not line.strip().startswith('## '):
                h1_idx = i
                break
        inline_fm, offset = parse_inline_frontmatter(lines[h1_idx + 1:])
        frontmatter = inline_fm
        body_lines = lines[h1_idx + 1 + offset:]

    # Parse sections
    sections = parse_sections(body_lines)

    # Extract metadata
    aliases_raw = frontmatter.get('Aliases', frontmatter.get('aliases', ''))
    if isinstance(aliases_raw, str):
        aliases = [a.strip() for a in aliases_raw.split(',') if a.strip()]
    else:
        aliases = aliases_raw if isinstance(aliases_raw, list) else []

    system_raw = frontmatter.get('System', '')
    system = re.sub(r'\[\[([^\]|]+?)(?:\|[^\]]+)?\]\]', r'\1', system_raw)

    note = {
        'id': slugify(title),
        'title': title,
        'category': category,
        'aliases': aliases,
        'tags': extract_tags(content),
        'system': system if system else None,
        'edTriage': frontmatter.get('ED Triage', frontmatter.get('edTriage', None)),
        'drugClass': frontmatter.get('Drug Class', None),
        'prototypeDrug': frontmatter.get('Prototype Drug', None),
        'sections': {},
        'clinicalPearls': extract_clinical_pearls(sections),
        'relatedNotes': extract_wikilinks(content),
    }

    # Map sections to standardized keys
    section_map = {
        'Definition': 'definition',
        'Overview': 'definition',
        'The Core Concept': 'definition',
        'Epidemiology': 'epidemiology',
        'Pathophysiology': 'pathophysiology',
        'Mechanism of Action': 'mechanism',
        'Clinical Features': 'clinicalFeatures',
        'Diagnosis': 'diagnosis',
        'Screening': 'diagnosis',
        'Management': 'management',
        'Indications': 'indications',
        'Key Drugs in Class': 'keyDrugs',
        'Adverse Effects': 'adverseEffects',
        'Contraindications': 'contraindications',
        'Nursing Considerations': 'nursingConsiderations',
        'Key Points': 'keyPoints',
        'Clinical Pearls': 'clinicalPearlsRaw',
        'Related Notes': 'relatedNotesRaw',
        'Sources': 'sources',
        'Anatomy': 'anatomy',
        'Physiology': 'physiology',
        'Assessment': 'assessment',
        'Receptor Profiles': 'receptorProfiles',
        'Pharmacokinetics': 'pharmacokinetics',
    }

    for heading, content_text in sections.items():
        key = section_map.get(heading)
        if key and key not in ('clinicalPearlsRaw', 'relatedNotesRaw', 'sources'):
            # Strip wikilink syntax for display but preserve the text
            display_text = re.sub(r'\[\[([^\]|]+?)\|([^\]]+)\]\]', r'\2', content_text)
            display_text = re.sub(r'\[\[([^\]|]+?)(#[^\]]+)?\]\]', r'\1', display_text)
            note['sections'][key] = display_text
        elif key is None:
            # Store non-standard sections too
            safe_key = slugify(heading) or heading.lower().replace(' ', '-')
            display_text = re.sub(r'\[\[([^\]|]+?)\|([^\]]+)\]\]', r'\2', content_text)
            display_text = re.sub(r'\[\[([^\]|]+?)(#[^\]]+)?\]\]', r'\1', display_text)
            note['sections'][safe_key] = display_text

    # For conditions, extract scenario hints
    if category == 'Conditions':
        note['scenarioHints'] = extract_scenario_hints(sections)

    return note


def build_export():
    """Build the full JSON export from the vault."""
    data = {
        'meta': {
            'exportDate': datetime.now().isoformat(),
            'vaultPath': str(VAULT_PATH),
        },
        'notes': {},
        'categories': {},
        'graph': {},
    }

    total = 0
    for category in CATEGORIES:
        cat_path = VAULT_PATH / category
        if not cat_path.exists():
            print(f"  Warning: {cat_path} not found, skipping")
            continue

        cat_notes = []
        for filepath in sorted(cat_path.glob('*.md')):
            try:
                note = parse_note(filepath, category)
                data['notes'][note['id']] = note
                cat_notes.append(note['id'])
                total += 1
            except Exception as e:
                print(f"  Error parsing {filepath.name}: {e}")

        data['categories'][category] = cat_notes
        print(f"  {category}: {len(cat_notes)} notes")

    # Build relationship graph
    id_lookup = {}
    for note_id, note in data['notes'].items():
        id_lookup[note['title']] = note_id
        for alias in note.get('aliases', []):
            id_lookup[alias] = note_id

    for note_id, note in data['notes'].items():
        resolved_links = set()
        for link_name in note.get('relatedNotes', []):
            target_id = id_lookup.get(link_name)
            if target_id and target_id != note_id:
                resolved_links.add(target_id)
        data['graph'][note_id] = sorted(resolved_links)

    data['meta']['noteCount'] = total
    print(f"\nTotal: {total} notes exported")

    # Write output
    OUTPUT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with open(OUTPUT_PATH, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"Written to {OUTPUT_PATH}")
    print(f"File size: {OUTPUT_PATH.stat().st_size / 1024:.0f} KB")


if __name__ == '__main__':
    print("ClinicalKB Export")
    print(f"Vault: {VAULT_PATH}")
    print(f"Output: {OUTPUT_PATH}\n")
    build_export()
