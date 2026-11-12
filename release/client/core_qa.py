"""Read-only Android Cubism Core ABI regression checks with Unicorn."""
from collections import Counter
import hashlib,math,struct,sys
from unicorn import Uc,UC_ARCH_ARM,UC_ARCH_ARM64,UC_MODE_ARM,UC_HOOK_CODE
from unicorn import arm_const,arm64_const
IMAGE,STUBS,STACK,HEAP=0x10000000,0x20000000,0x30000000,0x40000000
STACK_SIZE,HEAP_SIZE=0x400000,0x8000000
LOG,ONCE_RETURN,RETURN=STUBS+0x800,STUBS+0x810,STUBS+0xf00
ABIS=('arm64-v8a','armeabi-v7a')
SORT_RETURN=STUBS+0x820
MATH={'sinf':math.sin,'cosf':math.cos,'atan2f':math.atan2,'powf':math.pow,'floorf':math.floor,'sqrtf':math.sqrt,'ceilf':math.ceil,'fmodf':math.fmod}
def align(value, alignment):
    return (value + alignment - 1) & -alignment

class StockCore:
    def __init__(self, elf, dependency_dir):
        sys.path.insert(0, str(dependency_dir))
        from unicorn import Uc, UC_ARCH_ARM64, UC_MODE_ARM, UC_HOOK_CODE
        from unicorn import arm64_const as regs

        self.regs = regs
        self.args = [getattr(regs, f"UC_ARM64_REG_X{i}") for i in range(8)]
        self.cpu = Uc(UC_ARCH_ARM64, UC_MODE_ARM)
        self.exports = {}
        self.imports = {}
        self.import_calls = {}
        self.logs = []
        self.once_returns = []
        self.heap_cursor = HEAP
        self.cpu.mem_map(STUBS, 0x1000)
        self.cpu.mem_map(STACK, STACK_SIZE)
        self.cpu.mem_map(HEAP, HEAP_SIZE)
        self.errno = self.allocate(8)
        self.map_elf(elf)
        self.cpu.hook_add(UC_HOOK_CODE, self.call_import, begin=STUBS, end=STUBS + 0xfff)

    def map_elf(self, elf):
        if elf[:6] != b"\x7fELF\x02\x01" or struct.unpack_from("<H", elf, 18)[0] != 183:
            raise ValueError("Expected a little-endian AArch64 ELF64 Core")
        phoff, shoff = struct.unpack_from("<QQ", elf, 32)
        phsize, phcount, shsize, shcount = struct.unpack_from("<HHHH", elf, 54)
        loads = []
        for i in range(phcount):
            kind, _, offset, address, _, filesz, memsz, _ = struct.unpack_from(
                "<IIQQQQQQ", elf, phoff + i * phsize)
            if kind == 1:
                loads.append((offset, address, filesz, memsz))
        self.cpu.mem_map(IMAGE, align(max(address + size for _, address, _, size in loads), 0x1000))
        for offset, address, size, _ in loads:
            self.cpu.mem_write(IMAGE + address, elf[offset:offset + size])
        sections = [struct.unpack_from("<IIQQQQIIQQ", elf, shoff + i * shsize) for i in range(shcount)]
        symbol_tables = {}
        for i, section in enumerate(sections):
            _, kind, _, _, offset, size, link, _, _, _ = section
            if kind != 11:
                continue
            start = sections[link][4]
            entries = []
            for name_offset, _, _, location, value, _ in struct.iter_unpack(
                "<IBBHQQ", elf[offset:offset + size]):
                name_start = start + name_offset
                name = elf[name_start:elf.index(0, name_start)].decode()
                entries.append((name, location, value))
                if location and name.startswith("csm"):
                    self.exports[name] = IMAGE + value
            symbol_tables[i] = entries
        for _, kind, _, _, offset, size, link, _, _, _ in sections:
            if kind != 4:
                continue
            for target, info, addend in struct.iter_unpack("<QQq", elf[offset:offset + size]):
                relocation = info & 0xffffffff
                if relocation == 1027:  # R_AARCH64_RELATIVE
                    value = IMAGE + addend
                elif relocation in (1025, 1026):  # GLOB_DAT / JUMP_SLOT
                    name, location, symbol_value = symbol_tables[link][info >> 32]
                    if location:
                        value = IMAGE + symbol_value + addend
                    else:
                        value = next((addr for addr, key in self.imports.items() if key == name), None)
                        if value is None:
                            value = STUBS + len(self.imports) * 16
                            self.imports[value] = name
                else:
                    raise ValueError(f"Unexpected AArch64 relocation {relocation}")
                self.cpu.mem_write(IMAGE + target, struct.pack("<Q", value))

    def allocate(self, size, alignment=64):
        address = align(self.heap_cursor, alignment)
        self.heap_cursor = address + size
        if self.heap_cursor > HEAP + HEAP_SIZE:
            raise MemoryError("Stock Core exceeded emulated heap")
        return address

    def string(self, address, limit=1024):
        chunks = bytearray()
        while len(chunks) < limit:
            size = min(limit - len(chunks), 0x1000 - address % 0x1000)
            data = bytes(self.cpu.mem_read(address, size))
            end = data.find(b"\0")
            if end != -1:
                chunks.extend(data[:end])
                break
            chunks.extend(data)
            address += size
        return chunks.decode(errors="replace")

    def array(self, address, code, count):
        if not count:
            return ()
        fmt = f"<{count}{code}"
        return struct.unpack(fmt, self.cpu.mem_read(address, struct.calcsize(fmt)))

    def read_s(self, index):
        reg = getattr(self.regs, f"UC_ARM64_REG_S{index}")
        return struct.unpack("<f", struct.pack("<I", self.cpu.reg_read(reg)))[0]

    def call_import(self, cpu, address, _size, _data):
        if address == LOG:
            self.logs.append(self.string(cpu.reg_read(self.args[0])))
            cpu.reg_write(self.regs.UC_ARM64_REG_PC, cpu.reg_read(self.regs.UC_ARM64_REG_LR))
            return
        if address == ONCE_RETURN:
            target = self.once_returns.pop()
            cpu.reg_write(self.args[0], 0)
            cpu.reg_write(self.regs.UC_ARM64_REG_LR, target)
            cpu.reg_write(self.regs.UC_ARM64_REG_PC, target)
            return
        name = self.imports[address]
        self.import_calls[name] = self.import_calls.get(name, 0) + 1
        a, b, c, d = (cpu.reg_read(reg) for reg in self.args[:4])
        result = 0
        if name == "memcpy":
            cpu.mem_write(a, bytes(cpu.mem_read(b, c)))
            result = a
        elif name == "memset":
            cpu.mem_write(a, bytes([b & 255]) * c)
            result = a
        elif name == "memchr":
            offset = bytes(cpu.mem_read(a, c)).find(bytes([b & 255]))
            result = a + offset if offset >= 0 else 0
        elif name == "strncmp":
            left = bytes(cpu.mem_read(a, c)).split(b"\0", 1)[0]
            right = bytes(cpu.mem_read(b, c)).split(b"\0", 1)[0]
            result = (left > right) - (left < right)
        elif name == "vsnprintf":
            # Log formatting does not affect model computation. Keep the
            # original template even if its variadic values are unavailable.
            payload = self.string(c).encode()
            self.logs.append(payload.decode())
            if b:
                cpu.mem_write(a, payload[:b - 1] + b"\0")
            result = len(payload)
        elif name == "fprintf":
            message = self.string(b)
            self.logs.append(message.rstrip())
            result = len(message)
        elif name == "malloc":
            result = self.allocate(a)
        elif name == "pthread_once":
            if not self.array(a, "I", 1)[0]:
                cpu.mem_write(a, struct.pack("<I", 1))
                self.once_returns.append(cpu.reg_read(self.regs.UC_ARM64_REG_LR))
                cpu.reg_write(self.regs.UC_ARM64_REG_LR, ONCE_RETURN)
                cpu.reg_write(self.regs.UC_ARM64_REG_PC, b)
                return
        elif name in {"open", "read", "close"}:
            result = -1
        elif name in {"dlopen", "dlsym", "dlerror", "dlclose"}:
            pass
        elif name == "__errno":
            result = self.errno
        elif name in {"free", "__cxa_atexit", "__cxa_finalize", "__android_log_print"}:
            pass
        elif name in {"sinf", "cosf", "atan2f", "powf"}:
            operation = {"sinf": math.sin, "cosf": math.cos, "atan2f": math.atan2, "powf": math.pow}[name]
            x = self.read_s(0)
            value = operation(x, self.read_s(1)) if name in {"atan2f", "powf"} else operation(x)
            bits, = struct.unpack("<I", struct.pack("<f", value))
            cpu.reg_write(self.regs.UC_ARM64_REG_S0, bits)
        else:
            raise RuntimeError(f"Unhandled import {name} at LR {cpu.reg_read(self.regs.UC_ARM64_REG_LR):#x}")
        cpu.reg_write(self.args[0], result & 0xffffffffffffffff)
        cpu.reg_write(self.regs.UC_ARM64_REG_PC, cpu.reg_read(self.regs.UC_ARM64_REG_LR))

    def call(self, name, *values):
        for register, value in zip(self.args, values):
            self.cpu.reg_write(register, value)
        self.cpu.reg_write(self.regs.UC_ARM64_REG_SP, STACK + STACK_SIZE - 16)
        self.cpu.reg_write(self.regs.UC_ARM64_REG_LR, RETURN)
        try:
            self.cpu.emu_start(self.exports[name], RETURN, timeout=15_000_000, count=150_000_000)
        except Exception as exc:
            pc = self.cpu.reg_read(self.regs.UC_ARM64_REG_PC)
            raise RuntimeError(f"{name} at {pc:#x}: {exc}, Core logs: {self.logs}") from exc
        if self.cpu.reg_read(self.regs.UC_ARM64_REG_PC) != RETURN:
            raise RuntimeError(f"{name} exceeded its emulation budget")
        return self.cpu.reg_read(self.args[0])

    def load(self, data):
        self.call("csmSetLogFunction", LOG)
        address = self.allocate(len(data))
        self.cpu.mem_write(address, data)
        version = self.call("csmGetMocVersion", address, len(data))
        moc = self.call("csmReviveMocInPlace", address, len(data))
        if not moc:
            raise ValueError(f"Stock Core rejected MOC v{version}, Core logs: {self.logs}")
        size = self.call("csmGetSizeofModel", moc)
        if not 64 <= size <= 0x4000000:
            raise ValueError(f"Invalid Core model size {size}")
        model = self.call("csmInitializeModelInPlace", moc, self.allocate(size, 16), size)
        if not model:
            raise ValueError(f"Stock Core did not initialize model, Core logs: {self.logs}")
        return model, version

def snapshot(core, model, overrides):
    def get(field):
        return core.call("csmGet" + field, model)

    parameter_count = get("ParameterCount")
    parameter_ids = [core.string(ptr, 64) for ptr in core.array(get("ParameterIds"), "Q", parameter_count)]
    low = core.array(get("ParameterMinimumValues"), "f", parameter_count)
    high = core.array(get("ParameterMaximumValues"), "f", parameter_count)
    defaults = core.array(get("ParameterDefaultValues"), "f", parameter_count)
    value_buffer = get("ParameterValues")
    for name, value in overrides.items():
        index = parameter_ids.index(name)
        if not low[index] <= value <= high[index]:
            raise ValueError(f"{name}={value} outside [{low[index]}, {high[index]}]")
        core.cpu.mem_write(value_buffer + index * 4, struct.pack("<f", value))
    values = core.array(value_buffer, "f", parameter_count)
    core.call("csmUpdateModel", model)

    canvas = core.allocate(32)
    core.call("csmReadCanvasInfo", model, canvas, canvas + 8, canvas + 16)
    width, height, origin_x, origin_y, ppu = core.array(canvas, "f", 5)
    count = get("DrawableCount")
    if not 0 < count < 10000:
        raise ValueError(f"Invalid drawable count {count}")
    fields = {
        "id": ("Ids", "Q"), "texture": ("TextureIndices", "i"),
        "opacity": ("Opacities", "f"), "drawOrder": ("DrawOrders", "i"),
        "renderOrder": ("RenderOrders", "i"), "constantFlags": ("ConstantFlags", "B"),
        "dynamicFlags": ("DynamicFlags", "B"), "positions": ("VertexPositions", "Q"),
        "uvs": ("VertexUvs", "Q"), "indices": ("Indices", "Q"), "masks": ("Masks", "Q"),
        "vertexCount": ("VertexCounts", "i"), "indexCount": ("IndexCounts", "i"),
        "maskCount": ("MaskCounts", "i"),
    }
    columns = {key: core.array(get("Drawable" + suffix), fmt, count)
               for key, (suffix, fmt) in fields.items()}
    drawables = []
    for i in range(count):
        row = {key: column[i] for key, column in columns.items()}
        row["id"] = core.string(row["id"], 64)
        vertex_count = row.pop("vertexCount")
        row["positions"] = core.array(row["positions"], "f", vertex_count * 2)
        row["uvs"] = core.array(row["uvs"], "f", vertex_count * 2)
        row["indices"] = core.array(row["indices"], "H", row.pop("indexCount"))
        row["masks"] = core.array(row["masks"], "i", row.pop("maskCount"))
        row["visible"] = bool(row["dynamicFlags"] & 1)
        row["invalidTriangleCount"] = sum(
            any(index >= vertex_count for index in row["indices"][start:start + 3])
            for start in range(0, len(row["indices"]), 3)
        )
        drawables.append(row)
    return {
        "canvas": {"width": width, "height": height, "originX": origin_x, "originY": origin_y,
                   "pixelsPerUnit": ppu},
        "parameters": [{"id": name, "min": lo, "max": hi, "default": start, "value": val}
                       for name, lo, hi, start, val in zip(parameter_ids, low, high, defaults, values)],
        "drawables": drawables,
    }
def sort_indices(lo, hi):
    """Stable ordering using the real comparator in the emulated library."""
    if hi - lo <= 1:
        return list(range(lo, hi))
    mid = (lo + hi) // 2
    left = yield from sort_indices(lo, mid)
    right = yield from sort_indices(mid, hi)
    result = []
    i = j = 0
    while i < len(left) and j < len(right):
        comparison = yield left[i], right[j]
        if comparison <= 0:
            result.append(left[i])
            i += 1
        else:
            result.append(right[j])
            j += 1
    return result + left[i:] + right[j:]

class AndroidCore(StockCore):
    def __init__(self, elf, abi):
        self.arm32 = abi == ABIS[1]
        self.ptr = "I" if self.arm32 else "Q"
        self.regs = arm_const if self.arm32 else arm64_const
        prefix = "UC_ARM_REG_" if self.arm32 else "UC_ARM64_REG_"
        self.pc, self.sp, self.lr = (getattr(self.regs, prefix + suffix) for suffix in ("PC", "SP", "LR"))
        self.args = [getattr(self.regs, prefix + ("R" if self.arm32 else "X") + str(i))
                     for i in range(4 if self.arm32 else 8)]
        self.cpu = Uc(UC_ARCH_ARM if self.arm32 else UC_ARCH_ARM64, UC_MODE_ARM)
        if self.arm32:
            self.cpu.reg_write(arm_const.UC_ARM_REG_FPEXC, 1 << 30)
        self.exports = {}
        self.imports = {}
        self.symbol_addresses = {}
        self.import_calls = Counter()
        self.relocations = Counter()
        self.logs = []
        self.once_returns = []
        self.sort_frames = []
        self.heap_cursor = HEAP
        self.cpu.mem_map(STUBS, 0x1000)
        self.cpu.mem_map(STACK, STACK_SIZE)
        self.cpu.mem_map(HEAP, HEAP_SIZE)
        self.errno = self.allocate(8)
        if not self.arm32:
            tls = self.allocate(256)
            self.cpu.mem_write(tls + 0x28, struct.pack("<Q", 0x5c0b10675c0b1067))
            self.cpu.reg_write(arm64_const.UC_ARM64_REG_TPIDR_EL0, tls)
        self.map_elf(elf)
        self.cpu.hook_add(UC_HOOK_CODE, self.call_import, begin=STUBS, end=STUBS + 0xfff)

    def map_elf(self, elf):
        read = lambda fmt, offset: struct.unpack_from("<" + fmt, elf, offset)
        machine, = read("H", 18)
        expected = (b"\x7fELF\x01\x01", 40) if self.arm32 else (b"\x7fELF\x02\x01", 183)
        if (elf[:6], machine) != expected:
            raise ValueError("Unexpected ELF class, byte order or machine")
        phoff, shoff = read(self.ptr * 2, 28 if self.arm32 else 32)
        phsize, phcount, shsize, shcount = read("HHHH", 42 if self.arm32 else 54)
        self.elf_flags, = read("I", 36 if self.arm32 else 48)
        if self.arm32 and self.elf_flags & 0x400:
            raise ValueError("ARM32 hard-float ABI requires a different shim")
        loads = []
        for i in range(phcount):
            at = phoff + i * phsize
            if self.arm32:
                kind, offset, address, _, filesz, memsz, _, boundary = read("IIIIIIII", at)
            else:
                kind, _, offset, address, _, filesz, memsz, boundary = read("IIQQQQQQ", at)
            if kind == 1:
                loads.append((offset, address, filesz, memsz, boundary))
        self.load_segments = [{"offset": o, "vaddr": v, "alignment": a} for o, v, _, _, a in loads]
        self.cpu.mem_map(IMAGE, align(max(address + size for _, address, _, size, _ in loads), 0x1000))
        for offset, address, size, _, _ in loads:
            self.cpu.mem_write(IMAGE + address, elf[offset:offset + size])

        section_fmt = "IIIIIIIIII" if self.arm32 else "IIQQQQIIQQ"
        sections = [read(section_fmt, shoff + i * shsize) for i in range(shcount)]

        def text(section, start):
            at = sections[section][4] + start
            return elf[at:elf.index(0, at)].decode("ascii")

        tables = {}
        self.needed = []
        self.soname = None
        self.android_api = None
        for i, (_, kind, _, _, offset, size, link, _, _, _) in enumerate(sections):
            raw = elf[offset:offset + size]
            if kind == 11:  # SHT_DYNSYM
                entries = []
                symbol_fmt = "<IIIBBH" if self.arm32 else "<IBBHQQ"
                for fields in struct.iter_unpack(symbol_fmt, raw):
                    if self.arm32:
                        name, value, _, info, _, location = fields
                    else:
                        name, info, _, location, value, _ = fields
                    name = text(link, name)
                    entries.append((name, location, value, info & 15))
                    if location and name.startswith("csm"):
                        self.exports[name] = IMAGE + value
                tables[i] = entries
            elif kind == 6:  # SHT_DYNAMIC
                for tag, value in struct.iter_unpack("<" + self.ptr * 2, raw):
                    if tag == 1:
                        self.needed.append(text(link, value))
                    elif tag == 14:
                        self.soname = text(link, value)
                    elif tag in (35, 36, 37, 0x6000000f, 0x60000011, 0x6fffe000):
                        raise ValueError(f"Unhandled packed relocations, DT tag {tag:#x}")
            elif kind == 7:  # SHT_NOTE
                cursor = 0
                while cursor + 12 <= len(raw):
                    namesize, descsize, note_type = struct.unpack_from("<III", raw, cursor)
                    cursor += 12
                    name = raw[cursor:cursor + namesize].rstrip(b"\0")
                    cursor += align(namesize, 4)
                    if name == b"Android" and note_type == 1 and descsize >= 4:
                        self.android_api, = struct.unpack_from("<I", raw, cursor)
                    cursor += align(descsize, 4)
        self.import_symbols = sorted({name for entries in tables.values()
                                      for name, location, _, _ in entries if name and not location})
        for _, kind, _, _, offset, size, link, _, _, _ in sections:
            if kind not in (4, 9):  # SHT_RELA / SHT_REL
                continue
            fmt = "<" + self.ptr * 2 + (("i" if self.arm32 else "q") if kind == 4 else "")
            bits = 8 if self.arm32 else 32
            for target, info, *explicit in struct.iter_unpack(fmt, elf[offset:offset + size]):
                code, index = info & ((1 << bits) - 1), info >> bits
                self.relocations[code] += 1
                addend = explicit[0] if explicit else self.array(IMAGE + target, self.ptr, 1)[0]
                if code == (23 if self.arm32 else 1027):
                    value = IMAGE + addend
                elif code in ((2, 21, 22) if self.arm32 else (257, 1025, 1026)):
                    name, location, relative, symbol_type = tables[link][index]
                    value = IMAGE + relative if location else self.import_address(name, symbol_type)
                    if not self.arm32 or code == 2:
                        value += addend
                else:
                    raise ValueError(f"Unhandled relocation {code} at {target:#x}")
                self.cpu.mem_write(IMAGE + target, struct.pack("<" + self.ptr, value))

    def import_address(self, name, symbol_type):
        if name in self.symbol_addresses:
            return self.symbol_addresses[name]
        if name in {"__sF", "__stack_chk_guard", "stderr", "stdout"} or symbol_type == 1:
            if name not in {"__sF", "__stack_chk_guard", "stderr", "stdout"}:
                raise ValueError(f"Unhandled ELF data import {name}")
            address = self.allocate(1024)
            value = 0x5c0b1067 if name == "__stack_chk_guard" else address + 64
            if name != "__sF":
                self.cpu.mem_write(address, struct.pack("<" + self.ptr, value))
        else:
            address = STUBS + 16 * len(self.imports)
            if address >= LOG:
                raise RuntimeError("Core exceeded import stub address budget")
            self.imports[address] = name
            if self.arm32:
                address |= 1
        self.symbol_addresses[name] = address
        return address

    def array(self, address, code, count):
        return super().array(address, self.ptr if code == "Q" else code, count)

    def advance_sort(self, comparison):
        base, size, callback, return_address, ordering = self.sort_frames[-1]
        try:
            i, j = ordering.send(comparison)
        except StopIteration as complete:
            reordered = b"".join(bytes(self.cpu.mem_read(base + i * size, size)) for i in complete.value)
            self.cpu.mem_write(base, reordered)
            self.sort_frames.pop()
            self.cpu.reg_write(self.lr, return_address)
            self.cpu.reg_write(self.pc, return_address)
            return
        self.cpu.reg_write(self.args[0], base + i * size)
        self.cpu.reg_write(self.args[1], base + j * size)
        self.cpu.reg_write(self.lr, SORT_RETURN | self.arm32)
        self.cpu.reg_write(self.pc, callback)

    def call_import(self, cpu, address, _size, _data):
        ret = cpu.reg_read(self.lr)
        if address == LOG:
            self.logs.append(self.string(cpu.reg_read(self.args[0])))
        elif address == SORT_RETURN:
            comparison, = struct.unpack("<i", struct.pack("<I", cpu.reg_read(self.args[0]) & 0xffffffff))
            self.advance_sort(comparison)
            return
        elif address == ONCE_RETURN:
            ret = self.once_returns.pop()
            cpu.reg_write(self.lr, ret)
            cpu.reg_write(self.args[0], 0)
        else:
            name = self.imports[address]
            self.import_calls[name] += 1
            a, b, c, d = (cpu.reg_read(reg) for reg in self.args[:4])
            result = 0
            if name == "qsort":
                self.sort_frames.append((a, c, d, ret, sort_indices(0, b)))
                self.advance_sort(None)
                return
            if name == "sincosf":
                if self.arm32:
                    x, = struct.unpack("<f", struct.pack("<I", a))
                    sine, cosine = b, c
                else:
                    x, sine, cosine = self.read_s(0), a, b
                cpu.mem_write(sine, struct.pack("<f", math.sin(x)))
                cpu.mem_write(cosine, struct.pack("<f", math.cos(x)))
            elif name in MATH:
                two = name in {"atan2f", "powf", "fmodf"}
                if self.arm32:  # Android ARMv7 uses AAPCS softfp for the libm calls.
                    x, y = struct.unpack("<ff", struct.pack("<II", a, b))
                else:
                    x, y = self.read_s(0), self.read_s(1)
                value = MATH[name](x, y) if two else MATH[name](x)
                result, = struct.unpack("<I", struct.pack("<f", value))
                if not self.arm32:
                    cpu.reg_write(self.regs.UC_ARM64_REG_S0, result)
            elif name in {"memcpy", "memmove", "__aeabi_memcpy", "__aeabi_memcpy4", "__aeabi_memcpy8"}:
                cpu.mem_write(a, bytes(cpu.mem_read(b, c)))
                result = a
            elif name in {"memset", "__aeabi_memclr", "__aeabi_memclr4", "__aeabi_memclr8"}:
                byte, count = (b, c) if name == "memset" else (0, b)
                cpu.mem_write(a, bytes([byte & 255]) * count)
                result = a
            elif name in {"strncmp", "strcmp", "memcmp"}:
                if name == "strcmp":
                    left, right = self.string(a), self.string(b)
                else:
                    left, right = (bytes(cpu.mem_read(p, c)) for p in (a, b))
                    if name == "strncmp":
                        left, right = (v.split(b"\0", 1)[0] for v in (left, right))
                result = (left > right) - (left < right)
            elif name == "memchr":
                offset = bytes(cpu.mem_read(a, c)).find(bytes([b & 255]))
                result = a + offset if offset >= 0 else 0
            elif name == "strlen":
                result = len(self.string(a).encode())
            elif name == "vsnprintf":
                message = self.string(c).encode()
                self.logs.append(message.decode())
                if b:
                    cpu.mem_write(a, message[:b - 1] + b"\0")
                result = len(message)
            elif name == "fprintf":
                message = self.string(b)
                self.logs.append(message.rstrip())
                result = len(message)
            elif name == "malloc":
                result = self.allocate(a)
            elif name == "pthread_once":
                if not self.array(a, "I", 1)[0]:
                    cpu.mem_write(a, struct.pack("<I", 1))
                    self.once_returns.append(ret)
                    cpu.reg_write(self.lr, ONCE_RETURN | self.arm32)
                    cpu.reg_write(self.pc, b)
                    return
            elif name in {"open", "read", "close"}:
                result = -1
            elif name == "__errno":
                result = self.errno
            elif name not in {"free", "__cxa_atexit", "__cxa_finalize", "__android_log_print",
                               "dlopen", "dlsym", "dlerror", "dlclose"}:
                raise RuntimeError(f"Unhandled executed import {name}, return address {ret:#x}")
            cpu.reg_write(self.args[0], result & (0xffffffff if self.arm32 else 0xffffffffffffffff))
        cpu.reg_write(self.pc, ret)

    def call(self, name, *values):
        for register, value in zip(self.args, values):
            self.cpu.reg_write(register, value)
        self.cpu.reg_write(self.sp, STACK + STACK_SIZE - 16)
        self.cpu.reg_write(self.lr, RETURN | self.arm32)
        try:
            self.cpu.emu_start(self.exports[name], RETURN, timeout=20_000_000, count=200_000_000)
        except Exception as error:
            at = self.cpu.reg_read(self.pc)
            raise RuntimeError(f"{name} at {at:#x}: {error}, Core logs: {self.logs}") from error
        if self.cpu.reg_read(self.pc) != RETURN:
            raise RuntimeError(f"{name} exceeded emulation budget")
        return self.cpu.reg_read(self.args[0])

    def receipt(self, elf):
        return {
            "sha256": hashlib.sha256(elf).hexdigest(), "bytes": len(elf),
            "coreVersion": f"0x{self.call('csmGetVersion'):08x}",
            "latestMocVersion": self.call("csmGetLatestMocVersion"),
            "soname": self.soname, "needed": self.needed, "androidApiNote": self.android_api,
            "loadSegments": self.load_segments, "elfFlags": hex(self.elf_flags),
            "16KiBLoadAlignment": all(s["alignment"] >= 16384 and (s["offset"] - s["vaddr"]) % 16384 == 0
                                     for s in self.load_segments),
            "exports": sorted(self.exports), "undefinedImports": self.import_symbols,
            "relocations": self.relocations,
        }

def pose_snapshot(core, model, overrides):
    core.call("csmResetDrawableDynamicFlags", model)
    result = snapshot(core, model, overrides)
    count = core.call("csmGetPartCount", model)
    part_ids = core.array(core.call("csmGetPartIds", model), "Q", count)
    opacities = core.array(core.call("csmGetPartOpacities", model), "f", count)
    parents = core.array(core.call("csmGetPartParentPartIndices", model), "i", count)
    result["parts"] = [(core.string(pointer, 64), alpha, parent)
                       for pointer, alpha, parent in zip(part_ids, opacities, parents)]
    return result
