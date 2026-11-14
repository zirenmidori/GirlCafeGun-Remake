"""Build a clean release server from canonical source, excluding all profiles/tools."""
from pathlib import Path
import hashlib
import importlib.util
import io
import json
import os
import shutil
import subprocess
from zipfile import ZipFile

ROOT = Path(__file__).resolve().parents[2]
SERVER = ROOT / 'server'
OUT = ROOT / 'release/work/server'
OUT.mkdir(parents=True, exist_ok=True)
import payload_codec as b


def sha(body):
    return hashlib.sha256(body).hexdigest()


def normalized(body):
    return '\n'.join(line for line in body.decode('utf8').replace('\r\n', '\n').splitlines()
                     if not line.startswith('//# sourceMappingURL=')).strip()


sources = b.collect(SERVER/'src', 'src', lambda p: p.suffix == '.ts' and p.parts[0] != 'tools')
subprocess.run([shutil.which('node'), str(SERVER/'node_modules/typescript/bin/tsc'), '-p', 'tsconfig.build.json',
    '--outDir', str(OUT/'compiled'), '--declaration', 'false', '--declarationMap', 'false', '--sourceMap', 'false'],
    cwd=SERVER, env=dict(os.environ, TEMP=str(OUT), TMP=str(OUT)), check=True)
runtime = b.collect(OUT/'compiled', 'dist', lambda p: p.suffix == '.js' and p.parts[0] != 'tools')
assert set(runtime) == {'dist/'+name.removeprefix('src/').removesuffix('.ts')+'.js' for name in sources}
assert all(normalized(body) == normalized((SERVER/name).read_bytes()) for name, body in runtime.items())
assert sources == b.collect(SERVER/'src', 'src', lambda p: p.suffix == '.ts' and p.parts[0] != 'tools')
config = json.loads((SERVER/'config/release.json').read_text(encoding='utf8'))
assert config['release'] == {'singlePlayerAccount': 'gcg-offline-player-v1', 'welcomeGift': True}
assert config['http'] == {'host':'127.0.0.1', 'port':28080}
assert config['gateway']['port'] == 31400 and config['pvp']['fightPort'] == 31402
assert config['persistence']['file'] == 'data/state.json'
assert config['playerDefaults']['level'] == 1 and not config['playerDefaults']['firstLevelComplete']
resources = b.collect(SERVER/'resources', 'resources', lambda p: p.suffix == '.txt' or p.parts[0] == 'web' or
    p.as_posix() in {'custom-cards.json', 'custom-weapons.json', 'rune/progression.json',
                    'gacha/recruitment-policy.json', 'gacha/rotation-selectors.json'})
zod = (SERVER/'node_modules/zod').resolve(strict=True)
assert zod.is_relative_to((SERVER/'node_modules').resolve())
deps = b.collect(zod, 'node_modules/zod', lambda p: 'src' not in p.parts and
    (p.suffix in {'.js','.cjs','.json'} or p.name == 'LICENSE'))
members = {**runtime, **resources, **deps,
    'bootstrap.mjs': (ROOT/'release/tools/server-bootstrap.mjs').read_bytes(),
    'config/default.json': b.json_bytes(config),
    'LICENSE': (SERVER/'LICENSE').read_bytes(),
    'LICENSES/SssjServer-MIT.txt': (SERVER/'LICENSES/SssjServer-MIT.txt').read_bytes(),
    'package.json': b.json_bytes({'name':'gcg-offline-release-server','version':'0.1.0','private':True,
        'type':'module','dependencies':{'zod':json.loads((zod/'package.json').read_text(encoding='utf8'))['version']}})}
assert all(not name.startswith(('data/', 'logs/', 'test/', 'src/', 'dist/tools/')) for name in members)
assert not any('profile' in name.lower() or 'neptune-test' in name.lower() for name in members)
assert 'ensureNeptuneTrialRoster' not in members['dist/persistence/player-repository.js'].decode('utf8')
assert 'copyFile' not in members['bootstrap.mjs'].decode('utf8')
blob = b.archive(members)
b.write_verified(OUT/'payload.zip', blob)
with ZipFile(ROOT/'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.apk') as apk:
    baseline_blob = apk.read('assets/gcg-server/payload.zip')
with ZipFile(io.BytesIO(baseline_blob)) as old_zip:
    old = {n:old_zip.read(n) for n in old_zip.namelist()}
shared = sorted(set(old) & set(members))
changed = [n for n in shared if normalized(old[n]) != normalized(members[n])]
proof = {'schemaVersion':1, 'payload':str(OUT/'payload.zip'), 'sha256':sha(blob), 'bytes':len(blob),
    'entries':len(members), 'unpackedBytes':sum(map(len,members.values())), 'runtimeModules':len(runtime),
    'resourceFiles':len(resources), 'sourceParity':True, 'allRuntimeModulesBuiltFromCanonicalTypeScript':True,
    'noSavesLogsTestProfilesOrDevelopmentTools':True, 'noTrialStateCopyOrAutomaticRosterGrants':True,
    'config':config, 'sourceSha256':sha(b.json_bytes({n:sha(body) for n,body in sources.items()})),
    'baselinePayloadSha256':sha(baseline_blob), 'changedBaselineFiles':changed,
    'addedFiles':sorted(set(members)-set(old)), 'removedFiles':sorted(set(old)-set(members)),
    'allEntries':{name:{'sha256':sha(body),'bytes':len(body)} for name,body in sorted(members.items())}}
b.write_verified(OUT/'payload-proof.json', b.json_bytes(proof))
print(json.dumps({k:v for k,v in proof.items() if k not in {'allEntries','config'}}))
