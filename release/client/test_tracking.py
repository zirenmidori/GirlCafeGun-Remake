"""Check the UAutoSDK and Unity analytics blocks of data.unity3d on the real file.

run_data() takes the stock data.unity3d (a few MB, so the real file is used, not a synthetic one) and reads the
result of patch_tracking.build back with UnityPy, independently of the recipe: exactly four unpacked bytes
differ, the GameObject u3dautosdk is inactive, the analytics switches are off, and a second build is refused.

Run alone: python release/client/test_tracking.py [--apk client.apk]
"""
from pathlib import Path
import argparse,hashlib,json,sys,zipfile

ROOT=Path(__file__).resolve().parents[2]
sys.path[:0]=[str(Path(__file__).resolve().parent)]

def run_data(source):
    import asset_tools as w
    import patch_tracking as data_patch
    out,proof=data_patch.build(source)
    _,before=w.unityfs(source);_,after=w.unityfs(out)
    diff=[i for i in range(len(before)) if before[i]!=after[i]]
    assert len(before)==len(after) and len(diff)==4 and all(before[i]==1 and after[i]==0 for i in diff),diff
    files=w.UnityPy.load(out).file.files
    obj,=[o for o in files['level0'].objects.values() if o.type.name=='GameObject' and o.read().m_Name=='u3dautosdk']
    assert obj.read_typetree()['m_IsActive'] is False
    trees={o.type.name:o.read_typetree() for o in files['globalgamemanagers'].objects.values()
           if o.type.name in ('UnityConnectSettings','PlayerSettings')}
    connect,player=trees['UnityConnectSettings'],trees['PlayerSettings']
    assert connect['m_Enabled'] is False and connect['UnityAnalyticsSettings']['m_InitializeOnStartup'] is False
    assert player['submitAnalytics'] is False and player['cloudEnabled'] is False
    assert all(connect[k]['m_Enabled'] is False for k in ('CrashReportingSettings','UnityAnalyticsSettings',
               'PerformanceReportingSettings','UnityAdsSettings','UnityPurchasingSettings'))
    try:data_patch.build(out);raise SystemExit('second build was not refused')
    except AssertionError:pass
    return out,{'unpackedBytesChanged':4,'u3dautosdkInactive':True,'unityConnectOff':True,'submitAnalyticsOff':True,
                'otherUnityServicesOff':True,'refusesPatchedInput':True,'recipe':proof}

if __name__=='__main__':
    ap=argparse.ArgumentParser(description=__doc__,formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--apk',type=Path,default=ROOT/'client/GCG-Neptune-Nep-Note-Sequence-Fix-Test.apk')
    args=ap.parse_args()
    with zipfile.ZipFile(args.apk) as apk:raw=apk.read('assets/bin/Data/data.unity3d')
    print(json.dumps({'apkSha256':hashlib.sha256(args.apk.read_bytes()).hexdigest(),'data':run_data(raw)[1]},indent=2))
