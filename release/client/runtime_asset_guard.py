"""Reject mesh-particle CPU discard and native ParticleLOD type/ownership faults."""
import struct
import asset_tools as h
FLAGS=('m_IsReadable','m_KeepVertices','m_KeepIndices')
def validate_assetfile(af):
    """Raise ValueError on an invalid mesh renderer or known ParticleLOD payload."""
    issues=[];mesh_count=0;lod_count=0
    def tree(pid):return af.objects[pid].read_typetree(check_read=af.objects[pid].type.name!='MonoBehaviour')
    for pid,ob in af.objects.items():
        if ob.type.name=='ParticleSystemRenderer':
            t=tree(pid)
            if not t['m_Enabled'] or t['m_RenderMode']!=4:continue
            mesh_count+=1
            refs=[t[k] for k in ('m_Mesh','m_Mesh1','m_Mesh2','m_Mesh3') if t[k]['m_PathID']]
            if not refs:issues.append(f'Mesh renderer {pid} has no mesh')
            for ref in refs:
                mid=ref['m_PathID']
                if ref['m_FileID'] or mid not in af.objects or af.objects[mid].type.name!='Mesh':issues.append(f'Mesh renderer {pid} has unresolved/non-Mesh reference {ref}');continue
                m=tree(mid);bad=[k for k in FLAGS if not m[k]]
                if bad:issues.append(f'Mesh renderer {pid}, mesh {mid} {m["m_Name"]}: CPU-retention flags false: {bad}')
        elif ob.type.name=='MonoBehaviour':
            t=tree(pid);script=t['m_Script']
            if script['m_FileID'] or script['m_PathID'] not in af.objects:continue
            st=tree(script['m_PathID'])
            if st.get('m_ClassName')!='ParticleLOD':continue
            lod_count+=1;raw=ob.get_raw_data()
            if len(raw)!=56:issues.append(f'ParticleLOD {pid}: unexpected native payload length {len(raw)}');continue
            owner=t['m_GameObject']['m_PathID']
            if owner not in af.objects or af.objects[owner].type.name!='GameObject':issues.append(f'ParticleLOD {pid}: invalid owner GameObject');continue
            if h.ptr(pid) not in [r['component'] for r in tree(owner)['m_Component']]:issues.append(f'ParticleLOD {pid}: owner does not own this component')
            roots=[r['component']['m_PathID'] for r in tree(owner)['m_Component'] if af.objects[r['component']['m_PathID']].type.name=='Transform']
            if len(roots)!=1:issues.append(f'ParticleLOD {pid}: owner has no unique Transform');continue
            # Exact IL2CPP field order: LOD_M then LOD_H. The opaque tail stores
            # Transform references, not the corresponding GameObject references.
            for offset,expected_name in ((32,'LOD_M'),(44,'LOD_H')):
                fid,local=struct.unpack_from('<iq',raw,offset)
                if fid or local not in af.objects or af.objects[local].type.name!='Transform':issues.append(f'ParticleLOD {pid} offset {offset}: expected local Transform, got {fid}:{local} ({af.objects[local].type.name if local in af.objects else "missing"})');continue
                lt=tree(local);gid=lt['m_GameObject']['m_PathID']
                if gid not in af.objects or af.objects[gid].type.name!='GameObject' or tree(gid)['m_Name']!=expected_name:issues.append(f'ParticleLOD {pid} offset {offset}: Transform does not own {expected_name}')
                if lt['m_Father']!=h.ptr(roots[0]) or h.ptr(local) not in tree(roots[0])['m_Children']:issues.append(f'ParticleLOD {pid} offset {offset}: LOD Transform is not owned by root')
    if issues:raise ValueError('\n'.join(issues))
    return {'enabledMeshRenderersValidated':mesh_count,'nativeParticleLodComponentsValidated':lod_count,
        'meshCpuRetentionPassed':True,'nativeLodPointerTypesAndOwnershipPassed':True}
