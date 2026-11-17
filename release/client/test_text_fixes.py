"""Checks for the error-literal text fixes: the rule, and the roundtrip on a real text table."""
from pathlib import Path
import argparse
import json
import re
import zipfile

import patch_text_fixes as p
import asset_tools as w

ERROR_LITERAL = re.compile(r'#N/A|#VALUE!|#REF!|#NAME\?|#DIV/0!|#NULL!|#NUM!')
NON_LATIN = re.compile(r'[ᄀ-ᇿ⺀-鿿가-힯豈-﫿]')


def run(source_apk=None, source_lang=None):
    assert len(p.FIXES) == 37
    for key, text in p.FIXES.items():
        assert text == text.strip() and text
        assert not ERROR_LITERAL.search(text) and not NON_LATIN.search(text), key
        assert all(32 <= ord(c) < 127 for c in text), key  # glyphs every game font has
        assert p.fix(key, '#N/A') == text and p.fix(key, '#VALUE!') == text
        assert p.fix(key, text) == text  # a second run changes nothing
    assert p.fix('ui.some.other.key', '#N/A') == '#N/A'  # only the listed keys change
    try:
        p.fix('ui.UI_emoji0', 'Common')
        raise AssertionError('a real value was replaced')
    except ValueError:
        pass
    result = {'onlyListedKeysChange': True, 'onlyErrorLiteralsAreReplaced': True, 'idempotent': True}
    if source_apk:
        source_apk = Path(source_apk)
        w.configure(source_apk)
        if source_lang:
            source = Path(source_lang).read_bytes()
        else:
            with zipfile.ZipFile(source_apk) as apk:
                source = apk.read('assets/lang.u')
        output, proof = p.build_language(source)
        _, raw, _, _ = w.decode(source)
        before = w.typed_tables(raw, {'zh_CN'})['zh_CN']['value']
        _, raw, _, _ = w.decode(output)
        after = w.typed_tables(raw, {'zh_CN'})['zh_CN']['value']
        assert before['keys'] == after['keys']
        differ = {k: (a, b) for k, a, b in zip(before['keys'], before['values'], after['values']) if a != b}
        assert set(differ) == set(proof['changedKeys']) and set(differ) <= set(p.FIXES)
        assert all(a in p.ERROR_LITERALS and b == p.FIXES[k] for k, (a, b) in differ.items())
        d = dict(zip(after['keys'], after['values']))
        assert all(d[k] == text for k, text in p.FIXES.items())
        assert not [k for k, v in d.items() if ERROR_LITERAL.search(v)]
        again, proof2 = p.build_language(output)
        assert proof2['errorLiteralValuesReplaced'] == 0 and again == output
        result.update(actualLocaleRoundtrip=proof, valuesThatDiffer=len(differ),
                      errorLiteralsBefore=sum(1 for v in before['values'] if ERROR_LITERAL.search(v)),
                      errorLiteralsAfter=0, secondRunByteEqual=True)
    return result


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source-apk', type=Path, help='APK for the type metadata; its assets/lang.u is the table')
    parser.add_argument('--source-lang', type=Path, help='a lang.u to use in place of the one in the APK')
    parser.add_argument('--report', type=Path)
    args = parser.parse_args()
    result = run(args.source_apk, args.source_lang)
    text = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(text, encoding='utf8')
    print(json.dumps({k: v for k, v in result.items() if k != 'actualLocaleRoundtrip'}, ensure_ascii=False))
