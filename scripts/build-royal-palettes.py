"""Build six isolated royal portrait routes and deterministic native-detail RGB.

No mesh, animation, UV, normal, properties or shader is rewritten. Recoloring
was explicitly authorized after generated atlas redraws were rejected.
"""
from pathlib import Path
import argparse
import hashlib
import json
import re
import struct
from collections import Counter

import numpy as np
from PIL import Image, ImageDraw, ImageFilter

ROOT = Path(__file__).resolve().parent.parent
NATIVE = Path(r'D:\SteamLibrary\steamapps\workshop\content\1158310\3811316052')
PATCH = ROOT / 'patches/wyvern-kings/mod'
ASC_PATCH = ROOT / 'patches/wyvern-ascension/mod'
ART = ROOT / 'artwork/dragon-kings/palettes-v132'
MODEL = 'gfx/models/portraits/myv_wyvern/'
FAMILIES = {'fire': 1, 'earth': 2, 'sea': 3, 'sky': 4, 'white': 5, 'black': 6}
SIZES = ['hatchling'] + [f'tier_{i:02}' for i in range(1, 11)]
SCALES = ['0.840336', '5.042017', '10.084034', '15.126050', '20.168067',
          '25.210084', '30.252101', '35.294118', '40.336134', '45.378151', '50.420168']
INPUTS = {}
OUTPUTS = set()


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(relative):
    path = NATIVE / relative
    INPUTS[relative] = sha(path)
    return path.read_text(encoding='utf-8-sig')


def write(relative, text, asc=False):
    path = (ASC_PATCH if asc else PATCH) / relative
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(text.rstrip() + '\n', encoding='utf8', newline='\n')
    OUTPUTS.add(path)


def native_block(text, start):
    """Return the balanced source block including its opening declaration."""
    begin = text.index('{', start)
    depth = 1
    end = begin + 1
    while depth:
        depth += (text[end] == '{') - (text[end] == '}')
        end += 1
    return text[start:end]


def gene_extension(relative, entries):
    original = read(relative)
    index = max(map(int, re.findall(r'\bindex\s*=\s*(\d+)', original)))
    insertion = original.rfind('}', 0, original.rfind('}'))
    additions = []
    for entry in entries:
        index += 1
        additions.append(f'\t\t{entry} = {{ index = {index} male = {{ 1 = {entry} }} female = male boy = male girl = female }}')
    write(relative, original[:insertion].rstrip() + '\n# 1.3.2: appended templates; all native indices retained.\n' + '\n'.join(additions) + '\n\t' + original[insertion:])


def selector(family, include_asc=False):
    number = FAMILIES[family]
    if family in ('black', 'white'):
        trait = 'mm_royal_black_emperor' if family == 'black' else 'mm_royal_white_empress'
        royal = f'portrait_has_trait_trigger = {{ TRAIT = {trait} }}'
    else:
        royal = ('AND = { OR = { portrait_has_trait_trigger = { TRAIT = mm_royal_dragon_king } '
                 'portrait_has_trait_trigger = { TRAIT = mm_royal_complete } } '
                 f'has_variable = mm_royal_throne var:mm_royal_throne = {number} }}')
    if not include_asc:
        return f'mm_royal_visual_{family} = {{ NOT = {{ has_character_flag = mm_wyvern_human_form }} {royal} }}'
    return (f'mm_royal_visual_{family} = {{\n'
            '  NOT = { has_character_flag = mm_wyvern_human_form }\n'
            '  OR = { AND = { NOT = { portrait_has_trait_trigger = { TRAIT = mm_asc_dragon_body } } '
            f'{royal} }}\n'
            '    AND = { portrait_has_trait_trigger = { TRAIT = mm_asc_dragon_body } '
            'has_character_flag = mm_asc_dragon_form has_variable = mm_asc_visual_family '
            f'var:mm_asc_visual_family = {number} }}\n  }}\n}}')


def definitions():
    write('common/scripted_triggers/mm_royal_visual_triggers.txt',
          '# Appearance only. Neither ordinary ancestry nor creator lineage authorizes a palette.\n' +
          '\n\n'.join(selector(f) for f in FAMILIES))
    write('common/scripted_triggers/zzzzzzzz_mm_asc_visual_triggers.txt',
          '# Ascension extends the public palette API without a kings -> ascension dependency.\n' +
          '\n\n'.join(selector(f, include_asc=True) for f in FAMILIES), asc=True)
    assets = []
    accessories = []
    templates = {kind: [] for kind in ['body', 'flying', 'running', 'mounted', 'wild_aerial', 'compact']}
    poses = ['mm_royal_wyvern_poses = {\n  usage = none\n  priority = 1400']
    normal = ['mm_royal_wyvern_color_and_size = {\n  usage = game\n  selection_behavior = weighted_random\n  priority = 1300']
    genes = {'body': 'gene_myv_wyvern', 'flying': 'gene_myv_wyvern_flying',
             'running': 'gene_myv_wyvern_running', 'mounted': 'gene_myv_mounted_wyvern',
             'wild_aerial': 'gene_myv_wyvern_wild_aerial_flying', 'compact': 'gene_myv_compact_head'}
    for family in FAMILIES:
        diffuse = f'mm_royal_{family}_diffuse.dds'
        for size, scale in zip(SIZES, SCALES):
            base = f'mm_royal_{family}_{size}'
            clips = {'idle': 'myv_wyvern_idle.anim', 'flying': 'myv_wyvern_flying.anim', 'running': 'myv_wyvern_running.anim'}
            for kind in ['body', 'mounted', 'wild_aerial']:
                name = base if kind == 'body' else f'mm_royal_{kind}_{family}_{size}'
                kind_clips = clips if kind == 'body' else {'idle': 'myv_wyvern_mounted_flying.anim' if kind == 'mounted' else f'myv_wyvern_wild_aerial_{size}.anim'}
                registrations = '\n'.join(f'  animation = {{ id = "{name}_{state}_animation" type = "{clip}" }}' for state, clip in kind_clips.items())
                assets.append(f'pdxmesh = {{\n  name = "{name}_mesh" file = "myv_wyvern.mesh" scale = {scale}\n{registrations}\n  meshsettings = {{ name = "myv_wyvern_mesh" index = 0 texture_diffuse = "{diffuse}" texture_normal = "myv_wyvern_normal.dds" texture_specular = "myv_wyvern_properties.dds" shader = "myv_wyvern_double_sided" shader_file = "gfx/FX/myv_wyvern_portrait.shader" }}\n}}')
                states = ['idle', 'static', 'myv_wyvern_idle', 'myv_wyvern_flying', 'myv_wyvern_running']
                def entity(entity_name, mesh_name, animation_kind=None):
                    lines = []
                    for state in states:
                        animation = animation_kind or (state.removeprefix('myv_wyvern_') if state.startswith('myv_wyvern_') else 'idle')
                        if kind != 'body':
                            animation = 'idle'
                        lines.append(f'  state = {{ name = "{state}" animation = "{name}_{animation}_animation" looping = yes animation_speed = 1.0 }}')
                    return f'entity = {{ name = "{entity_name}_entity" pdxmesh = "{mesh_name}_mesh" default_state = "idle" get_state_from_parent = no\n' + '\n'.join(lines) + '\n}'
                assets.append(entity(name, name))
                if kind == 'body':
                    for pose in ['flying', 'running']:
                        alias = f'mm_royal_{pose}_{family}_{size}'
                        assets.append(entity(alias, name, pose))
            for kind in ['body', 'flying', 'running', 'mounted', 'wild_aerial']:
                name = base if kind == 'body' else f'mm_royal_{kind}_{family}_{size}'
                templates[kind].append(name)
                node = 'node = ground_joint inherit_rotation = no' if kind == 'mounted' else 'node = "myv_wyvern_origin"'
                accessories.append(f'{name} = {{ entity = {{ required_tags = "" {node} entity = "{name}_entity" }} }}')
                replace = f'accessory = {{ mode = replace gene = {genes[kind]} template = {name} value = 1 }}'
                if kind not in ('body', 'mounted'):
                    replace = 'accessory = { mode = replace gene = gene_myv_wyvern template = no_myv_wyvern value = 1 } ' + replace
                poses.append(f'  {kind}_{family}_{size} = {{ dna_modifiers = {{ {replace} }} }}')
                if kind == 'body':
                    normal.append(f'  {family}_{size} = {{ dna_modifiers = {{ {replace} }} weight = {{ base = 0 modifier = {{ add = 1000 mm_royal_visual_{family} = yes has_character_flag = myv_wyvern_size_{size} }} }} }}')
        name = f'mm_royal_compact_{family}'
        templates['compact'].append(name)
        assets.append(f'pdxmesh = {{ name = "{name}_mesh" file = "myv_compact_head.mesh" scale = 1 meshsettings = {{ name = "myv_compact_head_mesh" index = 0 texture_diffuse = "{diffuse}" texture_normal = "myv_wyvern_normal.dds" texture_specular = "myv_wyvern_properties.dds" shader = "portrait_attachment" shader_file = "gfx/FX/jomini/portrait.shader" }} }}\nentity = {{ name = "{name}_entity" pdxmesh = "{name}_mesh" }}')
        accessories.append(f'{name} = {{ entity = {{ required_tags = "" node = "myv_wyvern_origin" entity = "{name}_entity" }} }}')
        poses.append(f'  compact_{family} = {{ dna_modifiers = {{ accessory = {{ mode = replace gene = gene_myv_wyvern template = no_myv_wyvern value = 1 }} accessory = {{ mode = replace gene = gene_myv_compact_head template = {name} value = 1 }} }} }}')
    write(MODEL + 'mm_royal_wyvern.asset', '# Generated isolated royal entities. Native binary dependencies remain in MYV.\n\n' + '\n\n'.join(assets))
    write('gfx/portraits/accessories/mm_royal_wyvern.txt', '\n'.join(accessories))
    normal.append('}')
    poses.append('}')
    write('gfx/portraits/portrait_modifiers/mm_royal_wyvern_portrait.txt', '\n'.join(normal + poses))
    gene_files = {'body': 'myv_wyvern_accessory_genes.txt', 'flying': 'myv_wyvern_flying_genes.txt',
                  'running': 'myv_wyvern_running_genes.txt', 'mounted': 'myv_wyvern_mounted_genes.txt',
                  'wild_aerial': 'myv_wyvern_wild_aerial_flying_genes.txt', 'compact': 'myv_compact_head_genes.txt'}
    for kind, filename in gene_files.items():
        gene_extension('common/genes/' + filename, templates[kind])
    animation_files = {'flying': 'myv_wyvern_flying.txt', 'running': 'myv_wyvern_running.txt',
                       'mounted': 'myv_wyvern_rider_flying.txt', 'wild_aerial': 'myv_wyvern_wild_aerial_flying.txt',
                       'compact': 'myv_compact_head.txt'}
    native_poses = ['mm_asc_native_poses = { usage = none priority = 1400']
    native_colors = ['red', 'green', 'black', 'grey', 'gold', 'nightmare']
    asc_zero = ('portrait_has_trait_trigger = { TRAIT = mm_asc_dragon_body } '
                'has_character_flag = mm_asc_dragon_form has_variable = mm_asc_visual_family '
                'var:mm_asc_visual_family = 0 NOT = { has_character_flag = mm_wyvern_human_form }')
    for kind, filename in animation_files.items():
        relative = 'gfx/portraits/portrait_animations/' + filename
        original = read(relative)
        routes = []
        for family in FAMILIES:
            sizes = [None] if kind == 'compact' else SIZES
            for size in sizes:
                condition = f'mm_royal_visual_{family} = yes' + (f' has_character_flag = myv_wyvern_size_{size}' if size else '')
                if kind == 'mounted':
                    condition = f'exists = var:myv_riding_portrait_wyvern var:myv_riding_portrait_wyvern = {{ {condition} }}'
                key = f'{kind}_{family}' + (f'_{size}' if size else '')
                rider = 'animations = no_cloak animations = fat_additive animations = dwarf_additive ' if kind == 'mounted' else ''
                routes.append(f'\t\tportrait_modifier = {{ trigger = {{ {condition} }} {rider}mm_royal_wyvern_poses = {key} }}\n')
        position = original.index('\t\tportrait_modifier')
        write(relative, original[:position] + '# Royal routes precede every native first-match fallback.\n' + ''.join(routes) + original[position:])
        for color in native_colors:
            sizes = [None] if kind == 'compact' else SIZES
            for size in sizes:
                condition = f'{asc_zero} has_character_flag = myv_wyvern_color_{color}' + (f' has_character_flag = myv_wyvern_size_{size}' if size else '')
                if kind == 'mounted':
                    condition = f'exists = var:myv_riding_portrait_wyvern var:myv_riding_portrait_wyvern = {{ {condition} }}'
                key = f'{kind}_{color}' + (f'_{size}' if size else '')
                prefix = {'compact': 'myv_compact_head', 'mounted': 'myv_mounted_wyvern', 'wild_aerial': 'myv_wyvern_wild_aerial_flying'}.get(kind, f'myv_wyvern_{kind}')
                template = f'{prefix}_{color}' + (f'_{size}' if size else '')
                modifiers = f'accessory = {{ mode = replace gene = {genes[kind]} template = {template} value = 1 }}'
                if kind != 'mounted':
                    modifiers = 'accessory = { mode = replace gene = gene_myv_wyvern template = no_myv_wyvern value = 1 } ' + modifiers
                native_poses.append(f'  {key} = {{ dna_modifiers = {{ {modifiers} }} }}')
                rider = 'animations = no_cloak animations = fat_additive animations = dwarf_additive ' if kind == 'mounted' else ''
                routes.append(f'\t\tportrait_modifier = {{ trigger = {{ {condition} }} {rider}mm_asc_native_poses = {key} }}\n')
        write(relative, original[:position] + '# Royal and active ascension routes precede native fallbacks.\n' + ''.join(routes) + original[position:], asc=True)
    native_poses.append('}')
    write('gfx/portraits/portrait_modifiers/mm_asc_native_poses.txt', '\n'.join(native_poses), asc=True)
    relative = 'gfx/portraits/portrait_animations/myv_wyvern_memorial.txt'
    original = read(relative)
    def memorial(match):
        header, number = match.group(1), int(match.group(2))
        size = SIZES[number]
        routes = ''.join(f'        portrait_modifier = {{ trigger = {{ mm_royal_visual_{f} = yes }} mm_royal_wyvern_poses = body_{f}_{size} }}\n' for f in FAMILIES)
        return header + routes
    original, count = re.subn(r'(myv_wyvern_memorial_\w+_(\d+)\s*=\s*\{\s*male\s*=\s*\{\s*force\s*=\s*yes\s*)', memorial, original)
    assert count == 66, f'Unexpected memorial layout: {count}'
    write(relative, original)
    write('gfx/portraits/trait_portrait_modifiers/mm_asc_dragon_body.txt', '''mm_asc_dragon_body = {
  mm_asc_dragon_body = {
    traits = { mm_asc_dragon_body }
    dna_modifiers = { human = {
      accessory = { mode = modify gene = gene_myv_wyvern template = myv_wyvern_body value = 1 }
      morph = { mode = replace gene = gene_myv_no_portrait template = no_portrait value = 1 }
    } }
  }
}''', asc=True)
    # Family zero retains the real source's original color, while still allowing
    # a player-controlled human to use the native dragon species body bridge.
    source_normal = read('gfx/portraits/portrait_modifiers/myv_wyvern_color_and_size.txt')
    original_entries = []
    for match in re.finditer(r'\tmyv_wyvern_visual_(red|green|black|grey|gold|nightmare)_(hatchling|tier_\d+)\s*=\s*\{', source_normal):
        block = native_block(source_normal, match.start())
        block = re.sub(r'OR = \{ portrait_has_trait_trigger = \{ TRAIT = myv_wyvern \} portrait_has_trait_trigger = \{ TRAIT = myv_wyvern_tamed \} portrait_has_trait_trigger = \{ TRAIT = myv_wyvern_legendary \} \}', 'portrait_has_trait_trigger = { TRAIT = mm_asc_dragon_body } has_character_flag = mm_asc_dragon_form has_variable = mm_asc_visual_family var:mm_asc_visual_family = 0 NOT = { has_character_flag = mm_wyvern_human_form }', block)
        original_entries.append(block)
    assert len(original_entries) == 66
    hidden = ' '.join(f'accessory = {{ mode = replace gene = {gene} template = {empty} value = 1 }}' for gene, empty in [
        ('gene_myv_wyvern', 'no_myv_wyvern'), ('gene_myv_wyvern_flying', 'no_myv_wyvern_flying'),
        ('gene_myv_wyvern_running', 'no_myv_wyvern_running'), ('gene_myv_mounted_wyvern', 'no_myv_mounted_wyvern'),
        ('gene_myv_wyvern_wild_aerial_flying', 'no_myv_wyvern_wild_aerial_flying'), ('gene_myv_compact_head', 'no_myv_compact_head')])
    # Own higher priority restores only the new ascension body's normal phenotype.
    asc_human = f'''mm_asc_native_color = {{ usage = game selection_behavior = weighted_random priority = 1300
{chr(10).join(original_entries)}
}}
mm_asc_human_portrait = {{ usage = game selection_behavior = weighted_random priority = 2200
  human = {{ dna_modifiers = {{ {hidden} morph = {{ mode = replace gene = gene_myv_no_portrait template = normal_portrait value = 1 }} }}
    weight = {{ base = 0 modifier = {{ add = 1000 portrait_has_trait_trigger = {{ TRAIT = mm_asc_dragon_body }} has_character_flag = mm_wyvern_human_form NOT = {{ has_character_flag = mm_asc_dragon_form }} }} }} }}
}}'''
    write('gfx/portraits/portrait_modifiers/mm_asc_dragon_portrait.txt', asc_human, asc=True)
    no_accessories = read('gfx/portraits/portrait_modifiers/zzz_myv_wyvern_no_human_accessories.txt')
    no_accessories = no_accessories.replace('myv_wyvern_no_human_accessories =', 'mm_asc_no_human_accessories =', 1)
    no_accessories, count = re.subn(r'OR = \{\s*portrait_has_trait_trigger = \{ TRAIT = myv_wyvern \}\s*portrait_has_trait_trigger = \{ TRAIT = myv_wyvern_tamed \}\s*portrait_has_trait_trigger = \{ TRAIT = myv_wyvern_legendary \}\s*\}', 'portrait_has_trait_trigger = { TRAIT = mm_asc_dragon_body } has_character_flag = mm_asc_dragon_form NOT = { has_character_flag = mm_wyvern_human_form }', no_accessories)
    assert count == 1
    write('gfx/portraits/portrait_modifiers/mm_asc_no_human_accessories.txt', no_accessories, asc=True)


def parse_native_mesh():
    """Read native PDX values, never re-encode geometry or skin."""
    data = (NATIVE / MODEL / 'myv_wyvern.mesh').read_bytes()
    offset, stack, nodes = 4, [], [('root', {})]
    while offset < len(data):
        if data[offset] == 91:
            depth = 0
            while data[offset] == 91:
                depth += 1
                offset += 1
            end = data.index(0, offset)
            stack = stack[:depth - 1] + [data[offset:end].decode()]
            nodes.append(('/'.join(stack), {}))
            offset = end + 1
        else:
            assert data[offset] == 33
            length = data[offset + 1]
            key = data[offset + 2:offset + 2 + length].decode()
            offset += length + 2
            kind = chr(data[offset])
            count = struct.unpack_from('<I', data, offset + 1)[0]
            offset += 5
            if kind in 'if':
                value = np.frombuffer(data, dtype='<i4' if kind == 'i' else '<f4', count=count, offset=offset).copy()
                offset += count * 4
            else:
                assert kind == 's'
                value = []
                for _ in range(count):
                    length = struct.unpack_from('<I', data, offset)[0]
                    offset += 4
                    value.append(data[offset:offset + length].decode().rstrip('\0'))
                    offset += length
            nodes[-1][1][key] = value
    mesh = next(v for n, v in nodes if n.endswith('/mesh'))
    skin = next(v for n, v in nodes if n.endswith('/skin'))
    bones = {int(v['ix'][0]): n.split('/')[-1] for n, v in nodes if '/skeleton/' in n}
    return mesh, skin, bones


def native_masks(rgb):
    mesh, skin, bones = parse_native_mesh()
    uv = mesh['u0'].reshape(-1, 2) * 2047
    skin_index = skin['ix'].reshape(-1, 4)
    weights = skin['w'].reshape(-1, 4)
    dominant = skin_index[np.arange(len(skin_index)), weights.argmax(axis=1)]
    names = [bones.get(int(i), '') for i in dominant]
    def category(name):
        if any(part in name.lower() for part in ['finger', 'wingflap', 'wrist', 'elbow', 'shoulder', 'carpal']):
            return 'wing_forelimb'
        if 'tail' in name.lower():
            return 'tail'
        if any(part in name.lower() for part in ['eye', 'lid', 'brow', 'nose']):
            return 'eye_face'
        if any(part in name.lower() for part in ['jaw', 'tongue']):
            return 'jaw_mouth'
        if any(part in name.lower() for part in ['neck', 'head']):
            return 'head_neck'
        if any(part in name.lower() for part in ['hip', 'knee', 'ankle', 'ball', 'toe', 'dewclaw']):
            return 'hindlimb'
        return 'torso'
    categories = [category(n) for n in names]
    colors = {'wing_forelimb': '#4e91b5', 'tail': '#8b70b4', 'eye_face': '#d99849',
              'jaw_mouth': '#bb7188', 'head_neck': '#77ac79', 'hindlimb': '#a69563', 'torso': '#ae856c'}
    regions = Image.new('RGB', (2048, 2048), '#16191a')
    coverage = Image.new('L', (2048, 2048))
    wing = Image.new('L', (2048, 2048))
    rd, cd, wd = ImageDraw.Draw(regions), ImageDraw.Draw(coverage), ImageDraw.Draw(wing)
    counts = Counter()
    for triangle in mesh['tri'].reshape(-1, 3):
        region = Counter(categories[int(i)] for i in triangle).most_common(1)[0][0]
        points = [tuple(uv[i]) for i in triangle]
        rd.polygon(points, fill=colors[region])
        cd.polygon(points, fill=255)
        wd.polygon(points, fill=255 if region == 'wing_forelimb' else 0)
        counts[region] += 1
    regions.save(ART / 'native-uv-bone-regions.png')
    coverage.save(ART / 'native-uv-coverage.png')
    wing = np.asarray(wing.filter(ImageFilter.GaussianBlur(6)), dtype=np.float32) / 255
    hsv = np.asarray(Image.fromarray(rgb).convert('HSV'), dtype=np.float32) / 255
    hue, saturation, value = hsv.transpose(2, 0, 1)
    base = rgb.astype(np.float32) / 255
    red_data = (NATIVE / MODEL / 'myv_wyvern_diffuse_red.dds').read_bytes()
    red = np.asarray(Image.frombytes('RGBA', (2048, 2048), red_data[128:], 'raw', 'BGRA'))[:, :, :3].astype(np.float32) / 255
    pigment = np.clip(np.max(np.abs(red - base), axis=2) / .12, 0, 1)
    eye = (hue < .17) & (saturation > .60) & (value > .40)
    mouth = (hue > .87) & (saturation > .16) & (base[:, :, 0] > base[:, :, 1] * 1.10)
    protected = eye | mouth
    wing *= pigment
    ridge = np.clip((hue - .47) * 10, 0, 1) * np.clip((.86 - hue) * 10, 0, 1) * np.clip(saturation * 3, 0, 1)
    pale = np.clip((.27 - saturation) * 5, 0, 1) * np.clip((value - .24) * 4, 0, 1)
    masks = {'ridge': ridge, 'wing': wing * (1 - ridge),
             'pale': pale * (1 - ridge) * (1 - wing)}
    masks['body'] = 1 - masks['ridge'] - masks['wing'] - masks['pale']
    for name, mask in masks.items():
        Image.fromarray(np.rint(mask * 255).astype(np.uint8)).save(ART / f'mask-{name}.png')
    Image.fromarray(protected.astype(np.uint8) * 255).save(ART / 'mask-protected-eye-mouth.png')
    evidence = {'method': 'Actual UV triangle coverage and dominant original skin-bone categories; original red/green pixel differences; native HSV landmarks',
                'categories': colors, 'trianglesPerDominantRegion': dict(counts),
                'warning': 'Bone influence groups are not exact anatomical material masks. Pale combines ventral and pale keratin; ridges use original blue chroma. Wing mask softening affects weights only, never source texture detail.',
                'uvOrigin': 'Native u0 direct top-left texture mapping; eye-weight UV range matches original amber-eye landmark.',
                'protectedPixels': int(protected.sum()), 'coveredPixels': int((np.asarray(coverage) > 0).sum())}
    (ART / 'mask-evidence.json').write_text(json.dumps(evidence, indent=2) + '\n', encoding='utf8', newline='\n')
    return masks, protected


def encode_albedos():
    native = NATIVE / MODEL / 'myv_wyvern_diffuse_green.dds'
    data = native.read_bytes()
    source = np.asarray(Image.frombytes('RGBA', (2048, 2048), data[128:], 'raw', 'BGRA')).copy()
    rgb = source[:, :, :3].astype(np.float32) / 255
    masks, protected = native_masks(source[:, :, :3])
    # Each local transfer is a positive monotonic luminance curve. No filtering,
    # texture resampling, generated pixels, UV transformation or detail painting.
    recipes = {
        'fire': {'body': ['#62503d', .90], 'wing': ['#61413c', .85], 'pale': ['#b3ab99', 1.08], 'ridge': ['#373b3d', .86]},
        'earth': {'body': ['#63654e', 1.00], 'wing': ['#625d50', .96], 'pale': ['#b4b1a1', 1.06], 'ridge': ['#45433b', .88]},
        'sea': {'body': ['#3e606e', .95], 'wing': ['#496c70', .94], 'pale': ['#a2afb5', 1.08], 'ridge': ['#2c4049', .88]},
        'sky': {'body': ['#84939e', 1.28], 'wing': ['#74858f', 1.14], 'pale': ['#c5ccd0', 1.23], 'ridge': ['#596671', 1.10]},
        'black': {'body': ['#303238', .52], 'wing': ['#39303e', .49], 'pale': ['#666369', .72], 'ridge': ['#252830', .63]},
        'white': {'body': ['#cbc8bd', 2.65], 'wing': ['#b6b8b5', 2.05], 'pale': ['#d5d4c9', 1.80], 'ridge': ['#afa07e', 1.70]}}
    recipe_record = {'authorization': '2026-10-27 user: 允许脚本精确配色，保留原纹理细节',
                     'formula': 'Y = Rec709 dot(native sRGB); Yprime = gain*Y/(1+(gain-1)*Y); RGB = Yprime*(targetRGB/targetY); blend using recorded masks; hue-preserving 0.98 ceiling; protected eye/mouth restore native RGB; native alpha unchanged',
                     'recipes': recipes, 'engineLighting': 'NOT_VERIFIED', 'rejectedImagegenUsedInProduction': False}
    (ART / 'recipes.json').write_text(json.dumps(recipe_record, ensure_ascii=False, indent=2) + '\n', encoding='utf8', newline='\n')
    luminance = rgb @ np.array([.2126, .7152, .0722], dtype=np.float32)
    contact = Image.new('RGB', (1536, 1088), '#24272a')
    draw = ImageDraw.Draw(contact)
    for index, family in enumerate(FAMILIES):
        result = np.zeros_like(rgb)
        for region, (color, gain) in recipes[family].items():
            tint = np.array([int(color[i:i + 2], 16) for i in [1, 3, 5]], dtype=np.float32) / 255
            tint /= tint @ np.array([.2126, .7152, .0722], dtype=np.float32)
            level = gain * luminance / (1 + (gain - 1) * luminance)
            result += masks[region][:, :, None] * level[:, :, None] * tint
        result *= np.minimum(1, .98 / np.maximum(result.max(axis=2), .000001))[:, :, None]
        pixels = source.copy()
        pixels[:, :, :3] = np.rint(np.clip(result, 0, 1) * 255).astype(np.uint8)
        pixels[protected, :3] = source[protected, :3]
        assert np.array_equal(pixels[:, :, 3], source[:, :, 3])
        image = Image.fromarray(pixels)
        image.save(ART / f'{family}-albedo.png')
        output = PATCH / MODEL / f'mm_royal_{family}_diffuse.dds'
        output.write_bytes(data[:128] + image.tobytes('raw', 'BGRA'))
        OUTPUTS.add(output)
        x, y = (index % 3) * 512, (index // 3) * 544
        contact.paste(image.convert('RGB').resize((512, 512)), (x, y + 28))
        draw.text((x + 8, y + 8), family, fill='white')
    contact.save(ART / 'deterministic-albedo-contact.png')


def manifest():
    ART.mkdir(parents=True, exist_ok=True)
    path = ART / 'manifest.json'
    previous = json.loads(path.read_text(encoding='utf8')) if path.exists() else {}
    for family in FAMILIES:
        texture = PATCH / MODEL / f'mm_royal_{family}_diffuse.dds'
        if texture.exists():
            OUTPUTS.add(texture)
    for dependency in sorted((NATIVE / MODEL).iterdir()):
        if dependency.suffix in ('.mesh', '.anim', '.dds'):
            INPUTS[dependency.relative_to(NATIVE).as_posix()] = sha(dependency)
    INPUTS['gfx/FX/myv_wyvern_portrait.shader'] = sha(NATIVE / 'gfx/FX/myv_wyvern_portrait.shader')
    result = dict(previous, version='1.3.2', method='User-authorized deterministic native-pixel RGB transfer; native alpha unchanged; ImageGen edits rejected',
                  nativeRoot=str(NATIVE), nativeInputs=INPUTS,
                  generator={'file': 'scripts/build-royal-palettes.py', 'sha256': sha(Path(__file__))},
                  families=FAMILIES, templates={f: [f'mm_royal_{f}_{s}' for s in SIZES] for f in FAMILIES},
                  outputs=[{'file': p.relative_to(ROOT).as_posix(), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(OUTPUTS)],
                  sources=[{'file': p.relative_to(ROOT).as_posix(), 'sha256': sha(p), 'bytes': p.stat().st_size} for p in sorted(ART.glob('*.png')) if not p.name.endswith('-imagegen.png')],
                  recipe={'file': (ART / 'recipes.json').relative_to(ROOT).as_posix(), 'sha256': sha(ART / 'recipes.json')} if (ART / 'recipes.json').exists() else None,
                  maskEvidence={'file': (ART / 'mask-evidence.json').relative_to(ROOT).as_posix(), 'sha256': sha(ART / 'mask-evidence.json')} if (ART / 'mask-evidence.json').exists() else None,
                  previewGenerator={'file': 'scripts/render-royal-palettes.py', 'sha256': sha(ROOT / 'scripts/render-royal-palettes.py')},
                  rejectedImagegen=[{'file': p.relative_to(ROOT).as_posix(), 'sha256': sha(p), 'status': 'REJECTED_NOT_USED_IN_PRODUCTION'} for p in sorted(ART.glob('*-imagegen.png'))],
                  engineVerification='NOT_RUN')
    path.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf8', newline='\n')


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--definitions-only', action='store_true')
    args = parser.parse_args()
    definitions()
    if not args.definitions_only:
        encode_albedos()
    manifest()
    print(f'Royal palette definitions built: {len(OUTPUTS)} files; engine verification NOT_RUN')
