#!/usr/bin/env python3
"""Repairs the integer tables of a Live2D moc3 file (format version 3.0).

The model files of the game hold a few values per file that cannot be right: a flag that is 14, a begin index that
points outside its table, a triangle index beyond the mesh. The current Live2D Cubism Core crashes or hangs on them.
Most of these tables are redundant (a begin index is the sum of the counts before it, a count is the distance to the
next begin), so the right value can be worked out. Float tables are not touched.

  python tools/story-editor/moc3_repair.py <in.moc3> [<out.moc3>] [--textures N]     prints what it changed
"""
import struct
import sys

VERSION = 4   # raise when the rules change: the extracted models are made again


def repair_moc(data, ntex=1):
    """-> (bytes, [notes])"""
    d = bytearray(data)
    if d[:4] != b"MOC3":
        return bytes(d), ["not a moc3 file"]
    offs = struct.unpack_from("<160I", d, 0x40)
    c = struct.unpack_from("<23I", d, offs[0])
    (nparts, ndef, nwarp, nrot, nart, npar, npartkf, nwarpkf, nrotkf, nartkf, nkfpos, npbidx, nkfbind, nparbind,
     nkeys, nuvs, nposidx, nmask, ndog, ndogobj) = c[:20]
    notes = []

    def I(sec, n):
        return list(struct.unpack_from("<%di" % n, d, offs[sec])) if n else []

    def put(sec, i, v, what):
        old = struct.unpack_from("<i", d, offs[sec] + 4 * i)[0]
        if old != v:
            struct.pack_into("<i", d, offs[sec] + 4 * i, v)
            notes.append("%s[%d]: %d -> %d" % (what, i, old, v))

    def flags(sec, n, what, default=1):
        for i, x in enumerate(I(sec, n)):
            if x not in (0, 1):
                put(sec, i, default, what)

    def bounded(sec, n, lo, hi, what, default):
        for i, x in enumerate(I(sec, n)):
            if not lo <= x < hi:
                y = x & 0xFF00FFFF if x > 0 else x      # the bad values often differ only in their third byte
                put(sec, i, y if lo <= y < hi else default, what)

    def slices(bsec, n, total, what, counts=None, csec=None, unit=1, every=False):
        """begin[i] must be the end of the slice before it. counts come from csec, or from `counts` (not writable)."""
        b = I(bsec, n)
        k = I(csec, n) if csec is not None else list(counts)
        live = [i for i in range(n) if every or k[i] != 0]
        for pos, i in enumerate(live):
            prev = live[pos - 1] if pos else None
            nxt = live[pos + 1] if pos + 1 < len(live) else None
            exp = b[prev] + k[prev] * unit if prev is not None else 0
            end_ok = (b[nxt] == b[i] + k[i] * unit) if nxt is not None else (b[i] + k[i] * unit == total)
            if b[i] != exp and not end_ok:
                # is the count right for the expected begin?
                if (nxt is not None and b[nxt] == exp + k[i] * unit) or (nxt is None and exp + k[i] * unit == total) or k[i] > 0:
                    put(bsec, i, exp, what + ".begin")
                    b[i] = exp
                    end_ok = (b[nxt] == b[i] + k[i] * unit) if nxt is not None else (b[i] + k[i] * unit == total)
            if not end_ok and csec is not None:
                # the begin is right; the count is wrong when the slice after the next one fits the next one
                limit = b[nxt] if nxt is not None else total
                after = live[pos + 2] if pos + 2 < len(live) else None
                next_fits = nxt is None or (b[after] == b[nxt] + k[nxt] * unit if after is not None
                                            else b[nxt] + k[nxt] * unit == total)
                want = (limit - b[i]) // unit
                if next_fits and limit >= b[i] and want * unit == limit - b[i] and want != k[i]:
                    put(csec, i, want, what + ".count")
                    k[i] = want
        return b, k

    # ---- flags and parents
    flags(7, nparts, "part.visible"); flags(8, nparts, "part.enabled")
    flags(13, ndef, "deformer.visible"); flags(14, ndef, "deformer.enabled")
    flags(37, nart, "art.visible"); flags(38, nart, "art.enabled")
    flags(54, npar, "param.repeat", 0)
    bounded(9, nparts, -1, nparts, "part.parent", -1)
    bounded(15, ndef, -1, nparts, "deformer.parentPart", -1)
    bounded(16, ndef, -1, ndef, "deformer.parentDeformer", -1)
    bounded(39, nart, -1, nparts, "art.parentPart", 0)
    bounded(40, nart, -1, ndef, "art.parentDeformer", -1)
    bounded(41, nart, 0, ntex, "art.texture", 0)
    for sec, n, what in ((4, nparts, "part"), (12, ndef, "deformer"), (19, nwarp, "warp"), (25, nrot, "rot"), (34, nart, "art")):
        bounded(sec, n, 0, max(nkfbind, 1), what + ".keyformBinding", 0)
    bounded(72, npbidx, 0, max(nparbind, 1), "parameterBindingIndex", 0)
    bounded(80, nmask, -1, nart, "mask.artMesh", -1)

    # ---- deformer type and its index into the warp or rotation table
    types = I(17, ndef)
    for i, t in enumerate(types):
        if t not in (0, 1):
            types[i] = 0 if types.count(0) < nwarp else 1
            put(17, i, types[i], "deformer.type")
    spec = I(18, ndef)
    for t, lim in ((0, nwarp), (1, nrot)):
        mine = [i for i in range(ndef) if types[i] == t]
        seen, wrong = set(), []
        for i in mine:
            if 0 <= spec[i] < lim and spec[i] not in seen:
                seen.add(spec[i])
            else:
                wrong.append(i)
        missing = [x for x in range(lim) if x not in seen]
        if wrong and len(wrong) == len(missing):
            for i, x in zip(wrong, missing):
                put(18, i, x, "deformer.specific")

    # ---- slices
    slices(73, nkfbind, npbidx, "keyformBinding.indices", csec=74)
    slices(75, nparbind, nkeys, "parameterBinding.keys", csec=76)
    slices(56, npar, nparbind, "param.bindings", csec=57)
    # an object has one keyform for every combination of the keys of its parameters
    kb_b, kb_c, pbi, keys_c = I(73, nkfbind), I(74, nkfbind), I(72, npbidx), I(76, nparbind)
    prod = []
    for x in range(nkfbind):
        v = 1
        for j in range(kb_b[x], kb_b[x] + max(kb_c[x], 0)):
            if 0 <= j < npbidx and 0 <= pbi[j] < nparbind:
                v *= max(keys_c[pbi[j]], 1)
        prod.append(v)
    for what, kbsec, bsec, csec, n, total in (("part", 4, 5, 6, nparts, npartkf), ("warp", 19, 20, 21, nwarp, nwarpkf),
                                              ("rot", 25, 26, 27, nrot, nrotkf), ("art", 34, 35, 36, nart, nartkf)):
        kb, b, k = I(kbsec, n), I(bsec, n), I(csec, n)
        for i in range(n):          # the count is wrong and the binding says what it is
            e = prod[kb[i]] if 0 <= kb[i] < nkfbind else None
            end = b[i + 1] if i + 1 < n else total
            if e is not None and k[i] != e and end - b[i] == e:
                put(csec, i, e, what + ".keyforms.count")
        slices(bsec, n, total, what + ".keyforms", csec=csec, every=True)
        kb, b, k = I(kbsec, n), I(bsec, n), I(csec, n)
        for i in range(n):          # the count fits its slice, so the binding index is wrong
            if 0 <= kb[i] < nkfbind and prod[kb[i]] == k[i]:
                continue
            cands = [x for x in range(nkfbind) if prod[x] == k[i]]
            if cands:
                near = kb[i - 1] if i else kb[i]
                pick = min(cands, key=lambda x: (0 if (x ^ kb[i]) < 256 else 1, abs(x - near)))
                put(kbsec, i, pick, what + ".keyformBinding")
                kb[i] = pick
    # the deformer table repeats the binding of its warp or rotation entry
    dkb, types2, spec2 = I(12, ndef), I(17, ndef), I(18, ndef)
    wkb, rkb = I(19, nwarp), I(25, nrot)
    for i in range(ndef):
        src = wkb if types2[i] == 0 else rkb
        if 0 <= spec2[i] < len(src) and dkb[i] != src[spec2[i]]:
            put(12, i, src[spec2[i]], "deformer.keyformBinding")
    pb, pk = slices(45, nart, nposidx, "art.positionIndices", csec=46)
    # uv begin: every mesh has vertexCount * 2 floats
    slices(44, nart, nuvs, "art.uvs", csec=43, unit=2)
    vc = I(43, nart)
    for i in range(nart):
        if vc[i] < 1:
            put(43, i, 1, "art.vertexCount")
            vc[i] = 1

    # ---- masks: a count that runs into the next slice
    mb, mk = I(47, nart), I(48, nart)
    used = sorted((mb[i], i) for i in range(nart) if mk[i] > 0)
    for n, (b, i) in enumerate(used):
        limit = next((x for x, _ in used[n + 1:] if x > b), nmask)   # slices may share a start
        if b < 0 or b >= nmask:
            put(48, i, 0, "art.maskCount")
        elif b + mk[i] > limit:
            put(48, i, limit - b, "art.maskCount")
    for i in range(nart):
        if mk[i] < 0:
            put(48, i, 0, "art.maskCount")

    # ---- warp grids: vertices = (rows + 1) * (columns + 1)
    wv, rows, cols = I(22, nwarp), I(23, nwarp), I(24, nwarp)
    for i in range(nwarp):
        r, k, v = rows[i], cols[i], wv[i]
        if r >= 1 and k >= 1 and v == (r + 1) * (k + 1):
            continue
        sane = lambda x: 1 <= x <= 64
        if sane(r) and sane(k) and not (v > 0 and v % (r + 1) == 0 and sane(v // (r + 1) - 1)) \
                and not (v > 0 and v % (k + 1) == 0 and sane(v // (k + 1) - 1)):
            put(22, i, (r + 1) * (k + 1), "warp.vertexCount")
        elif sane(k) and v > 0 and v % (k + 1) == 0 and sane(v // (k + 1) - 1):
            put(23, i, v // (k + 1) - 1, "warp.rows")
        elif sane(r) and v > 0 and v % (r + 1) == 0 and sane(v // (r + 1) - 1):
            put(24, i, v // (r + 1) - 1, "warp.columns")
        elif sane(r) and sane(k):
            put(22, i, (r + 1) * (k + 1), "warp.vertexCount")

    # ---- keyform positions: begin indexes must stay inside the table and grow
    for sec, n, what in ((60, nwarpkf, "warpKeyform.positions"), (70, nartkf, "artKeyform.positions")):
        v = I(sec, n)
        for i, x in enumerate(v):
            if not 0 <= x < max(nkfpos * 2, 1):
                # the bad values keep their low 16 bits: take the first such value after the entry before
                prev = v[i - 1] if i else 0
                fix = (prev & ~0xFFFF) | (x & 0xFFFF)
                if fix < prev:
                    fix += 0x10000
                if not 0 <= fix < max(nkfpos * 2, 1):
                    fix = prev
                put(sec, i, fix, what)
                v[i] = fix

    # ---- triangle indexes beyond the mesh
    if nposidx:
        idx = list(struct.unpack_from("<%dh" % nposidx, d, offs[79]))
        changed = 0
        for i in range(nart):
            if pk[i] <= 0 or pb[i] < 0 or pb[i] + pk[i] > nposidx:
                continue
            for j in range(pb[i], pb[i] + pk[i]):
                if not 0 <= idx[j] < vc[i]:
                    tri = pb[i] + (j - pb[i]) // 3 * 3
                    good = next((idx[t] for t in range(tri, min(tri + 3, pb[i] + pk[i])) if 0 <= idx[t] < vc[i]), 0)
                    struct.pack_into("<h", d, offs[79] + 2 * j, good)
                    idx[j] = good
                    changed += 1
        if changed:
            notes.append("triangle indexes beyond their mesh: %d set to a corner of the same triangle" % changed)

    # ---- draw order groups
    slices(81, ndog, ndogobj, "drawOrderGroup.objects", csec=82)
    dt, di = I(86, ndogobj), I(87, ndogobj)
    for i in range(ndogobj):
        if dt[i] not in (0, 1):
            dt[i] = 0 if 0 <= di[i] < nart else 1
            put(86, i, dt[i], "drawOrderObject.type")
        lim = nart if dt[i] == 0 else nparts
        if not 0 <= di[i] < lim:
            put(87, i, 0, "drawOrderObject.index")
    return bytes(d), notes


if __name__ == "__main__":
    argv = sys.argv[1:]
    ntex = 1
    if "--textures" in argv:
        i = argv.index("--textures")
        ntex = int(argv[i + 1])
        del argv[i:i + 2]
    if not argv:
        sys.exit(__doc__)
    out, notes = repair_moc(open(argv[0], "rb").read(), ntex)
    if len(argv) > 1:
        with open(argv[1], "wb") as f:
            f.write(out)
    print(argv[0], "-", len(notes), "changes")
    for n in notes:
        print("  ", n)
