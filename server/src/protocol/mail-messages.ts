import type { MailAction, MailMessage } from "../game-data/mail-data.js";
import { COMMAND } from "./commands.js";
import {
  decodeFields,
  fieldBytes,
  fieldVarint,
  firstNumber,
  readVarint,
} from "./protobuf.js";

// gsproto CMailInfo and CMailItem. Expiry is optional; daily mail persists until deleted.
function makeMailMessage(mail: MailMessage): Buffer {
  return Buffer.concat([
    fieldVarint(1, mail.id),
    fieldVarint(2, mail.read ? 1 : 0),
    fieldVarint(3, 0),
    fieldVarint(4, mail.receivedAt),
    fieldBytes(5, mail.title),
    fieldBytes(6, mail.sender),
    fieldBytes(7, mail.content),
    ...mail.attachments.map((item) =>
      fieldBytes(8, Buffer.concat(item.map((value, i) => fieldVarint(i + 1, value)))),
    ),
  ]);
}

export function makeMailListResponse(mail: readonly MailMessage[]): Buffer {
  const list = Buffer.concat(
    mail.map((message) => fieldBytes(1, makeMailMessage(message))),
  );
  // The client's LoadMailInfo uses bit 0 to clear and bit 1 to notify the UI.
  return Buffer.concat([fieldBytes(1, list), fieldVarint(2, 3)]);
}

export function makeAddMailNotification(mail: MailMessage): Buffer {
  return fieldBytes(1, makeMailMessage(mail));
}

export function parseMailAction(command: number, payload: Buffer): MailAction {
  if (command === COMMAND.GET_MAIL_REQ) return { kind: "list" };
  const fields = decodeFields(payload);
  const ids: number[] = [];
  function append(value: bigint): void {
    if (value > 0n && value <= 0x7fff_ffffn) ids.push(Number(value));
  }
  for (const { fieldNumber, wireType, value } of fields) {
    if (fieldNumber !== 1) continue;
    if (wireType === 0 && typeof value === "bigint") append(value);
    if (wireType === 2 && Buffer.isBuffer(value)) {
      let offset = 0;
      while (offset < value.length) {
        const entry = readVarint(value, offset);
        append(entry.value);
        offset = entry.offset;
      }
    }
  }
  switch (command) {
    case COMMAND.GET_MAIL_ITEM_REQ:
      return { kind: "claim", ids, autoDelete: firstNumber(fields, 2) > 0 };
    case COMMAND.SET_MAIL_READ_REQ:
      return { kind: "read", ids, read: firstNumber(fields, 2, 1) > 0 };
    case COMMAND.DEL_MAIL_REQ:
      return { kind: "delete", ids };
    default:
      throw new Error(`Unknown mail command: ${command}`);
  }
}

export function makeMailMutationResponse(
  action: Exclude<MailAction, { kind: "list" }>,
  ids: readonly number[],
): Buffer {
  const fields = ids.map((id) => fieldVarint(1, id));
  if (action.kind === "read") fields.push(fieldVarint(2, action.read ? 1 : 0));
  if (action.kind === "claim") fields.push(fieldVarint(2, action.autoDelete ? 1 : 0));
  return Buffer.concat(fields);
}
