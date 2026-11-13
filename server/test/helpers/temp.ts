import { mkdir, mkdtemp as createTemp } from "node:fs/promises";
import path from "node:path";

/** A fresh checkout need not contain the original asset-lab scratch parents. */
export async function mkdtemp(prefix: string): Promise<string> {
  await mkdir(path.dirname(prefix), { recursive: true });
  return createTemp(prefix);
}
