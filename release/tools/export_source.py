"""Create a reviewable source-only tree; never walk private data or artifacts."""
from pathlib import Path
import argparse,hashlib,json,re,shutil,ast
ROOT=Path(__file__).resolve().parents[2];RELEASE=ROOT/'release'
SERVER_FILES={'package.json','pnpm-lock.yaml','tsconfig.json','tsconfig.build.json','eslint.config.js','.prettierrc.json','.prettierignore','.gitignore','LICENSE','README.md'}
TOOLS={'android_manifest.py','build_android_release.py','build-server-payload.py','payload_codec.py','release_crypto.py','make_update.py','make_data_packs.py','export_source.py','cloudflare.ps1'}
BAD=re.compile(rb'(?:C:[/\\]Users[/\\][^/\\\r\n]+|R5[A-Z0-9]{9}|-----BEGIN (?:RSA |EC )?PRIVATE KEY-----|gh[pousr]_[A-Za-z0-9]{24,})')
def collect():
    result={}
    def add(src,dest):
        if src.is_symlink():raise ValueError('Symlink source forbidden: '+str(src))
        body=src.read_bytes()
        if BAD.search(body):raise ValueError('Private identifier/credential pattern in '+str(src))
        if src.suffix=='.py':ast.parse(body.decode('utf8'),filename=str(src))
        result[dest]=body
    for name in SERVER_FILES:add(ROOT/'server'/name,'server/'+name)
    for folder,extensions in [('src',{'.ts'}),('test',{'.ts','.json'}),('docs',{'.md'}),('LICENSES',{'.txt'})]:
        for p in sorted((ROOT/'server'/folder).rglob('*')):
            if p.is_file() and p.suffix in extensions:add(p,p.relative_to(ROOT).as_posix())
    for p in sorted((ROOT/'server/resources').rglob('*')):
        name=p.relative_to(ROOT/'server/resources').as_posix()
        if p.is_file() and (p.suffix=='.txt' or name in {'custom-cards.json','custom-weapons.json','rune/progression.json'}):add(p,p.relative_to(ROOT).as_posix())
    for name in ('default.json','release.json'):add(ROOT/'server/config'/name,'server/config/'+name)
    for folder,extensions in [('android',{'.java','.der'}),('client',{'.py','.lua','.txt'}),('tests',{'.java','.py','.mjs'}),('hosting',{'.mjs','.md','.jsonc'})]:
        for p in sorted((RELEASE/folder).rglob('*')):
            if p.is_file() and (p.suffix in extensions or p.name=='LICENSE') and '__pycache__' not in p.parts:add(p,p.relative_to(ROOT).as_posix())
    for p in sorted((RELEASE/'tools').rglob('*')):
        if p.is_file() and (p.parent==RELEASE/'tools' and p.name in TOOLS or p.parent==RELEASE/'tools/java' and p.suffix=='.java'):add(p,p.relative_to(ROOT).as_posix())
    for p in sorted((RELEASE/'docs').glob('*.md')):add(p,'docs/'+p.name);add(p,'release/docs/'+p.name)
    for name in ('README.md','THIRD_PARTY_NOTICES.md'):add(RELEASE/name,name);add(RELEASE/name,'release/'+name)
    add(RELEASE/'LICENSE','release/LICENSE');add(RELEASE/'LICENSE','LICENSE')
    result['.gitignore']=b'**/node_modules/\n**/__pycache__/\nrelease/artifacts/\nrelease/private/\nrelease/work/\nrelease/reports/\nserver/data/\nserver/logs/\nserver/dist/\n*.apk\n*.gcgupdate\n*.zip\n*.p12\n*.jks\n*.keystore\n.env\n'
    return result
def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--output',type=Path,default=RELEASE/'publish/source');a=p.parse_args();files=collect()
    a.output.mkdir(parents=True,exist_ok=True)
    existing={p.relative_to(a.output).as_posix() for p in a.output.rglob('*') if p.is_file() and '.git' not in p.parts}
    if existing-set(files):raise ValueError('Unexpected files in export; review before replacing')
    for name,body in files.items():
        dest=a.output/name;dest.parent.mkdir(parents=True,exist_ok=True);dest.write_bytes(body)
        if dest.read_bytes()!=body:raise ValueError('Source readback differs')
    report={'files':len(files),'bytes':sum(map(len,files.values())),'personalDataPatternsFound':False,'apkDataKeysBackupsIncluded':False,'allowlist':{n:hashlib.sha256(b).hexdigest() for n,b in sorted(files.items())}}
    (RELEASE/'reports/source-export.json').write_text(json.dumps(report,indent=2)+'\n',encoding='utf8');print(json.dumps({k:v for k,v in report.items() if k!='allowlist'}))
if __name__=='__main__':main()
