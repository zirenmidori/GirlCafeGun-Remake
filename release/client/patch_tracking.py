"""Switch off the two network parts of data.unity3d: the UAutoSDK listener and Unity's own analytics.

UAutoSDK is a test-automation kit. Its component UAutoSDK.UAutoSdkInit on the GameObject u3dautosdk of level0
opens a TCP listener on port 13000 in Awake. Disabling only the component is not enough (Unity still calls Awake
on a disabled component of an active object), so the GameObject is set inactive: m_IsActive is the last field of a
GameObject, one byte of the unpacked container.

Unity analytics: globalgamemanagers holds UnityConnectSettings with m_Enabled true and the URLs
cdp.cloud.unity3d.com/v1/events, api.uca.cloud.unity3d.com/v1/events and config.uca.cloud.unity3d.com, and
PlayerSettings.submitAnalytics true. Three boolean bytes go to false in place; the other Unity service switches
must already be false. Nothing else in the file moves.
"""
import asset_tools as w

DATA='assets/bin/Data/data.unity3d'
SCENE,OBJECT='level0','u3dautosdk'
MANAGERS='globalgamemanagers'
OFF={'UnityConnectSettings':[('m_Enabled',),('UnityAnalyticsSettings','m_InitializeOnStartup')],
     'PlayerSettings':[('submitAnalytics',)]}
ALREADY_OFF={'UnityConnectSettings':[('CrashReportingSettings','m_Enabled'),('UnityAnalyticsSettings','m_Enabled'),
                                     ('PerformanceReportingSettings','m_Enabled'),('UnityAdsSettings','m_Enabled'),
                                     ('UnityPurchasingSettings','m_Enabled')],
             'PlayerSettings':[('cloudEnabled',)]}

def get(tree,path):
    for key in path:tree=tree[key]
    return tree

def put(tree,path,value):
    for key in path[:-1]:tree=tree[key]
    tree[path[-1]]=value

def objects(raw):
    env=w.UnityPy.load(raw)
    return env,{(f,p):o for f,sf in env.file.files.items() if hasattr(sf,'objects') for p,o in sf.objects.items()}

def flips(raw):
    """Unpacked container offsets of the bytes to set from 1 to 0, with a proof per byte."""
    meta,data=w.unityfs(raw);nodes={name:offset for offset,_,_,name in meta['nodes']}
    env,_=objects(raw);result=[]
    scene=env.file.files[SCENE]
    found=[o for o in scene.objects.values() if o.type.name=='GameObject' and o.read().m_Name==OBJECT]
    assert len(found)==1,len(found);obj=found[0];tree=obj.read_typetree();body=obj.get_raw_data()
    assert list(tree)[-1]=='m_IsActive' and tree['m_IsActive'] is True and body[-1]==1,'u3dautosdk is not an active GameObject'
    at=nodes[SCENE]+obj.byte_start;assert data[at:at+len(body)]==body,'GameObject bytes not where the file says'
    result.append((at+len(body)-1,{'file':SCENE,'gameObject':OBJECT,'pathId':obj.path_id,'field':'m_IsActive'}))
    managers=env.file.files[MANAGERS];by_type={}
    for o in managers.objects.values():by_type.setdefault(o.type.name,[]).append(o)
    for type_name,paths in OFF.items():
        assert len(by_type.get(type_name,[]))==1,type_name;obj=by_type[type_name][0];tree=obj.read_typetree()
        for path in ALREADY_OFF[type_name]:assert get(tree,path) is False,(type_name,path)
        old=obj.get_raw_data();start=nodes[MANAGERS]+obj.byte_start
        assert data[start:start+len(old)]==old,'object bytes not where the file says'
        for path in paths:
            assert get(tree,path) is True,(type_name,path)
            # Serialise with one more switch flipped and find its byte.
            put(tree,path,False);flipped=obj.save_typetree(tree)
            assert len(flipped)==len(old),'serialised size changed'
            diff=[i for i in range(len(old)) if old[i]!=flipped[i]]
            assert len(diff)==1 and old[diff[0]]==1 and flipped[diff[0]]==0,(type_name,path,diff)
            result.append((start+diff[0],{'file':MANAGERS,'object':type_name,'pathId':obj.path_id,'field':'.'.join(path)}))
            old=flipped
    return meta,data,result

def build(source):
    """data.unity3d with u3dautosdk inactive and Unity analytics off. Returns (data.unity3d, proof)."""
    meta,data,targets=flips(source)
    assert len(targets)==1+sum(map(len,OFF.values())) and len({at for at,_ in targets})==len(targets)
    patched=bytearray(data)
    for at,_ in targets:assert patched[at]==1;patched[at]=0
    out=w.pack(meta,bytes(patched))
    check_meta,check=w.unityfs(out);assert check==bytes(patched) and check_meta['nodes']==meta['nodes']
    assert [i for i in range(len(data)) if data[i]!=check[i]]==sorted(at for at,_ in targets)
    _,before=objects(source);env,after=objects(out)
    assert before.keys()==after.keys()
    changed=sorted(k for k in before if before[k].get_raw_data()!=after[k].get_raw_data())
    assert changed==sorted({(p['file'],p['pathId']) for _,p in targets}),changed
    assert after[(SCENE,targets[0][1]['pathId'])].read_typetree()['m_IsActive'] is False
    for at,p in targets[1:]:
        tree=after[(MANAGERS,p['pathId'])].read_typetree()
        assert get(tree,tuple(p['field'].split('.'))) is False
        assert all(get(tree,q) is False for q in ALREADY_OFF[p['object']])
    return out,{'sourceSha256':w.sha(source),'resultSha256':w.sha(out),
                'changedBytes':[dict(p,unpackedOffset=at,before=1,after=0) for at,p in targets],
                'checkedAlreadyOff':['.'.join((t,)+q) for t,qs in ALREADY_OFF.items() for q in qs],
                'onlyChangedObjects':[list(k) for k in changed],'containerNodesUnchanged':True}
