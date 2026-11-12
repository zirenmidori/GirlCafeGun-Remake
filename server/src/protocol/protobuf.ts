export interface DecodedField {
  fieldNumber: number;
  wireType: number;
  value: bigint | Buffer;
}

interface VarintResult {
  value: bigint;
  offset: number;
}

export function encodeVarint(value: number | bigint): Buffer {
  const bytes: number[] = [];
  let remaining = BigInt(value);
  if (remaining < 0n) {
    remaining = BigInt.asUintN(64, remaining);
  }
  do {
    let byte = Number(remaining & 0x7fn);
    remaining >>= 7n;
    if (remaining !== 0n) byte |= 0x80;
    bytes.push(byte);
  } while (remaining !== 0n);
  return Buffer.from(bytes);
}

export function fieldVarint(fieldNumber: number, value: number | bigint): Buffer {
  return Buffer.concat([encodeVarint(fieldNumber << 3), encodeVarint(value)]);
}

export function fieldBytes(fieldNumber: number, value: string | Buffer): Buffer {
  const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
  return Buffer.concat([
    encodeVarint((fieldNumber << 3) | 2),
    encodeVarint(bytes.length),
    bytes,
  ]);
}

export function readVarint(buffer: Buffer, startOffset = 0): VarintResult {
  let value = 0n;
  let shift = 0n;
  let offset = startOffset;
  while (offset < buffer.length && shift < 70n) {
    const byte = buffer[offset++];
    if (byte === undefined) {
      throw new Error(`Truncated protobuf varint at offset ${startOffset}`);
    }
    value |= BigInt(byte & 0x7f) << shift;
    if ((byte & 0x80) === 0) return { value, offset };
    shift += 7n;
  }
  throw new Error(`Invalid protobuf varint at offset ${startOffset}`);
}

export function decodeFields(buffer: Buffer): DecodedField[] {
  const fields: DecodedField[] = [];
  let offset = 0;
  while (offset < buffer.length) {
    const tag = readVarint(buffer, offset);
    offset = tag.offset;
    const fieldNumber = Number(tag.value >> 3n);
    const wireType = Number(tag.value & 7n);
    if (fieldNumber === 0) throw new Error("Invalid protobuf field 0");

    if (wireType === 0) {
      const item = readVarint(buffer, offset);
      offset = item.offset;
      fields.push({ fieldNumber, wireType, value: item.value });
    } else if (wireType === 1) {
      if (offset + 8 > buffer.length) throw new Error("Truncated fixed64");
      fields.push({
        fieldNumber,
        wireType,
        value: buffer.subarray(offset, offset + 8),
      });
      offset += 8;
    } else if (wireType === 2) {
      const length = readVarint(buffer, offset);
      offset = length.offset;
      const end = offset + Number(length.value);
      if (end > buffer.length) throw new Error("Truncated bytes field");
      fields.push({
        fieldNumber,
        wireType,
        value: buffer.subarray(offset, end),
      });
      offset = end;
    } else if (wireType === 5) {
      if (offset + 4 > buffer.length) throw new Error("Truncated fixed32");
      fields.push({
        fieldNumber,
        wireType,
        value: buffer.subarray(offset, offset + 4),
      });
      offset += 4;
    } else {
      throw new Error(`Unsupported protobuf wire type ${wireType}`);
    }
  }
  return fields;
}

export function firstBytes(
  fields: readonly DecodedField[],
  fieldNumber: number,
): Buffer | undefined {
  const value = fields.find(
    (field) => field.fieldNumber === fieldNumber && field.wireType === 2,
  )?.value;
  return Buffer.isBuffer(value) ? value : undefined;
}

export function firstString(
  fields: readonly DecodedField[],
  fieldNumber: number,
  fallback = "",
): string {
  return firstBytes(fields, fieldNumber)?.toString("utf8") ?? fallback;
}

export function firstNumber(
  fields: readonly DecodedField[],
  fieldNumber: number,
  fallback = 0,
): number {
  const value = fields.find(
    (field) => field.fieldNumber === fieldNumber && field.wireType === 0,
  )?.value;
  return typeof value === "bigint" ? Number(value) : fallback;
}
