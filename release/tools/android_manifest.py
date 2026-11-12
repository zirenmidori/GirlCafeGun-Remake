"""Patch only the reviewed Astral APK manifest launcher and add a private service."""
import struct

STRING_POOL = 0x0001
RESOURCE_MAP = 0x0180
START = 0x0102
END = 0x0103
NO_INDEX = 0xFFFFFFFF
ANDROID = "http://schemas.android.com/apk/res/android"
UNITY = "com.unity3d.player.UnityPlayerActivity"
BOOT = "com.yricky.gcg2.embedded.BootActivity"
SERVICE = "com.yricky.gcg2.embedded.GcgServerService"


def make_chunk(kind, header_size, body):
    return struct.pack("<HHI", kind, header_size, 8 + len(body)) + body


def split_chunks(data):
    assert struct.unpack_from("<HHI", data) == (3, 8, len(data))
    chunks = []
    position = 8
    while position < len(data):
        kind, header, size = struct.unpack_from("<HHI", data, position)
        assert 8 <= header <= size <= len(data) - position
        chunks.append((kind, data[position:position + size]))
        position += size
    assert position == len(data)
    return chunks


class StringPool:
    def __init__(self, data, resource_map):
        _, header, size, count, styles, flags, start, style_start = struct.unpack_from("<HH6I", data)
        assert header == 28 and size == len(data) and not (styles or flags or style_start)
        assert start == header + 4 * count
        self.offsets = list(struct.unpack_from(f"<{count}I", data, header))
        self.data = bytearray(data[start:])
        self.values = []
        for offset in self.offsets:
            length, = struct.unpack_from("<H", self.data, offset)
            assert length < 0x8000 and self.data[offset + 2 + 2 * length:offset + 4 + 2 * length] == b"\0\0"
            self.values.append(self.data[offset + 2:offset + 2 + 2 * length].decode("utf-16-le"))
        assert struct.unpack_from("<HHI", resource_map) == (RESOURCE_MAP, 8, len(resource_map))
        self.ids = list(struct.unpack_from(f"<{(len(resource_map) - 8) // 4}I", resource_map, 8))

    def index(self, value, resource_id=0):
        for index, text in enumerate(self.values):
            mapped = self.ids[index] if index < len(self.ids) else 0
            if value == text and mapped == resource_id:
                return index
        index = len(self.values)
        self.values.append(value)
        self.offsets.append(len(self.data))
        encoded = value.encode("utf-16-le")
        self.data += struct.pack("<H", len(encoded) // 2) + encoded + b"\0\0"
        if resource_id:
            self.ids.extend([0] * (index + 1 - len(self.ids)))
            self.ids[index] = resource_id
        return index

    def chunks(self):
        offsets = struct.pack(f"<{len(self.offsets)}I", *self.offsets)
        payload = self.data + bytes((-len(self.data)) % 4)
        pool = struct.pack("<5I", len(self.offsets), 0, 0, 28 + len(offsets), 0)
        return (
            make_chunk(STRING_POOL, 28, pool + offsets + payload),
            make_chunk(RESOURCE_MAP, 8, struct.pack(f"<{len(self.ids)}I", *self.ids)),
        )


def patch(data):
    chunks = split_chunks(data)
    assert [kind for kind, _ in chunks[:2]] == [STRING_POOL, RESOURCE_MAP]
    pool = StringPool(chunks[0][1], chunks[1][1])
    android = pool.index(ANDROID)
    # Locate the sole Unity activity and its MAIN launcher filter by structure.
    stack = []
    unity_open = filter_open = filter_end = None
    for index, (kind, raw) in enumerate(chunks[2:], 2):
        if kind not in {START, END}:
            continue
        name = pool.values[struct.unpack_from("<I", raw, 20)[0]]
        if kind == START:
            if name == "activity":
                attribute_start, attribute_size, count = struct.unpack_from("<HHH", raw, 24)
                assert attribute_start == attribute_size == 20
                attrs = [struct.unpack_from("<3IHBBI", raw, 36 + n * 20) for n in range(count)]
                if any(pool.values[attr[1]] == "name" and attr[4:6] == (0, 3)
                       and pool.values[attr[6]] == UNITY for attr in attrs):
                    assert unity_open is None and stack[-1][0] == "application"
                    unity_open = index
            elif name == "intent-filter" and stack[-1] == ("activity", unity_open):
                assert filter_open is None
                filter_open = index
            stack.append((name, index))
        else:
            opened, start_index = stack.pop()
            assert name == opened
            if start_index == filter_open:
                filter_end = index
    assert not stack and unity_open is not None and filter_open is not None and filter_end is not None

    def string_attr(name, resource_id, value):
        key = pool.index(name, resource_id)
        val = pool.index(value)
        return struct.pack("<3IHBBI", android, key, val, 8, 0, 3, val)

    def scalar_attr(name, resource_id, kind, value, raw):
        key = pool.index(name, resource_id)
        return struct.pack("<3IHBBI", android, key, pool.index(raw), 8, 0, kind, value)

    def element(name, attrs):
        index = pool.index(name)
        start = struct.pack("<4I6H", 0, NO_INDEX, NO_INDEX, index, 20, 20, len(attrs), 0, 0, 0)
        end = struct.pack("<4I", 0, NO_INDEX, NO_INDEX, index)
        return make_chunk(START, 16, start + b"".join(attrs)), make_chunk(END, 16, end)

    boot_open, boot_end = element("activity", [
        string_attr("name", 0x01010003, BOOT),
        scalar_attr("exported", 0x01010010, 0x12, NO_INDEX, "true"),
        scalar_attr("launchMode", 0x0101001D, 0x10, 1, "singleTop"),
        scalar_attr("screenOrientation", 0x0101001E, 0x10, 0, "landscape"),
    ])
    service_open, service_end = element("service", [
        string_attr("name", 0x01010003, SERVICE),
        scalar_attr("exported", 0x01010010, 0x12, 0, "false"),
        string_attr("process", 0x01010011, ":gcgserver"),
    ])
    original_filter = [raw for _, raw in chunks[filter_open:filter_end + 1]]
    inserted = [boot_open, *original_filter, boot_end, service_open, service_end]
    original_nodes = [raw for _, raw in chunks[2:unity_open]]
    retained_nodes = [raw for _, raw in chunks[unity_open:filter_open] + chunks[filter_end + 1:]]
    return make_chunk(3, 8, b"".join([*pool.chunks(), *original_nodes, *inserted, *retained_nodes]))

