import { rm } from "node:fs/promises";
import path from "node:path";
import { expect, it } from "vitest";
import { mkdtemp } from "./helpers/temp.js";
import { GachaCatalog } from "../src/game-data/gacha-data.js";
import {
  applyMailAction,
  makeMailbox,
  reconcileWelcomeMail,
  WELCOME_AWARDS,
  WELCOME_RECRUITMENT_AWARDS,
} from "../src/game-data/mail-data.js";
import type { Logger } from "../src/logger.js";
import { JsonStore } from "../src/persistence/json-store.js";
import {
  makeInitialState,
  PlayerRepository,
  type Player,
} from "../src/persistence/player-repository.js";

const now = Date.UTC(2026, 10, 13, 12);
const logger: Logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  async close() {},
};
const defaults = {
  name: "",
  level: 1,
  exp: 0,
  fightPower: 0,
  serverZone: 8,
  firstLevelComplete: false,
};

async function fixture(
  run: (context: {
    open: (welcomeGifts: boolean) => Promise<{
      store: JsonStore<ReturnType<typeof makeInitialState>>;
      players: PlayerRepository;
    }>;
  }) => Promise<void>,
) {
  const dir = await mkdtemp(path.resolve("../release/work/welcome-draws-"));
  const filePath = path.join(dir, "state.json");
  try {
    await run({
      open: async (welcomeGifts) => {
        const store = new JsonStore({
          filePath,
          initialState: makeInitialState(),
          logger,
        });
        await store.initialize();
        return {
          store,
          players: new PlayerRepository({ store, defaults, logger, welcomeGifts }),
        };
      },
    });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

function ticketCounts(player: Player): number[] {
  return WELCOME_RECRUITMENT_AWARDS.map(
    ([genre, detail, particular, templateLevel]) =>
      player.inventory.find(
        (item) =>
          item.genre === genre &&
          item.detail === detail &&
          item.particular === particular &&
          item.templateLevel === templateLevel,
      )?.count ?? 0,
  );
}

it("mails a new manager exactly 200 usable draws of each kind, once, across restart and claim retries", async () => {
  await fixture(async ({ open }) => {
    let { players } = await open(true);
    const account = "new-manager";
    const fresh = await players.getOrCreate(account, now);
    expect(fresh.level).toBe(1);
    expect(ticketCounts(fresh)).toEqual([0, 0]);
    expect(fresh.mail?.messages).toHaveLength(1);
    const welcome = fresh.mail!.messages[0]!;
    expect(welcome.attachments).toEqual([
      ...WELCOME_AWARDS,
      ...WELCOME_RECRUITMENT_AWARDS,
    ]);
    expect(welcome.content).toContain("200 character draws and 200 weapon draws");

    const cards = GachaCatalog.loadDefault();
    const weapons = GachaCatalog.loadDefault(0);
    const pools = [cards.get(1)!, weapons.get(1)!];
    for (const [index, pool] of pools.entries()) {
      const award = WELCOME_RECRUITMENT_AWARDS[index]!;
      expect(award.slice(0, 4)).toEqual(pool.costTen!.slice(0, 4));
      expect((award[4] / pool.costTen![4]) * 10).toBe(200);
    }
    const claims = await Promise.all([
      players.updateMailbox(
        account,
        { kind: "claim", ids: [welcome.id, welcome.id], autoDelete: true },
        [],
        now,
      ),
      players.updateMailbox(
        account,
        { kind: "claim", ids: [welcome.id], autoDelete: false },
        [],
        now,
      ),
    ]);
    expect(claims.map((claim) => claim.acceptedIds)).toEqual([[welcome.id], []]);
    expect(ticketCounts(players.get(account)!)).toEqual([20, 20]);

    ({ players } = await open(true));
    const restarted = await players.getOrCreate(account, now);
    expect(restarted.mail?.messages).toEqual([]);
    expect(ticketCounts(restarted)).toEqual([20, 20]);
    expect(
      (
        await players.updateMailbox(
          account,
          { kind: "claim", ids: [welcome.id], autoDelete: false },
          [],
          now,
        )
      ).acceptedIds,
    ).toEqual([]);

    // Spend the mailed tickets through the real transaction path: twenty
    // ten-pulls per category, with no premium currency supplied by the fixture.
    for (const [index, catalog] of [cards, weapons].entries()) {
      const pool = pools[index]!;
      let counters = { pity: 0, upPity: 0, total: 0 };
      let draws = 0;
      for (let batch = 0; batch < 20; batch++) {
        const roll = catalog.rollPool(pool, true, counters, new Set(), [], () => 0);
        const result = await players.performGacha(
          account,
          pool,
          true,
          roll,
          false,
          index === 0 ? "card" : "weapon",
        );
        draws += result.awards.length;
        counters = roll.counters;
      }
      expect(draws).toBe(200);
      expect(ticketCounts(players.get(account)!)[index]).toBe(0);
      const extra = catalog.rollPool(pool, true, counters, new Set(), [], () => 0);
      await expect(
        players.performGacha(
          account,
          pool,
          true,
          extra,
          false,
          index === 0 ? "card" : "weapon",
        ),
      ).rejects.toThrow();
    }
    const spent = await (await open(true)).players.getOrCreate(account, now);
    expect(ticketCounts(spent)).toEqual([0, 0]);
    expect(spent.mail?.messages).toEqual([]);
  });
});

it("does not add the recruitment bonus to existing players, old welcome mail, or GM profiles", async () => {
  await fixture(async ({ open }) => {
    const old = await open(false);
    for (const account of ["unclaimed-old", "claimed-old", "GM", "legacy"])
      await old.players.getOrCreate(account, now);
    await old.store.update((state) => {
      for (const account of ["unclaimed-old", "claimed-old"]) {
        const mailbox = (state.players[account]!.mail = makeMailbox());
        reconcileWelcomeMail(mailbox, now);
        if (account === "claimed-old")
          applyMailAction(
            mailbox,
            { kind: "claim", ids: [mailbox.messages[0]!.id], autoDelete: true },
            () => {},
          );
      }
    });
    const oldMessages = old.players.get("unclaimed-old")!.mail!.messages;
    let upgraded = (await open(true)).players;
    for (const account of ["unclaimed-old", "claimed-old", "GM", "legacy"]) {
      const player = await upgraded.getOrCreate(account, now);
      expect(ticketCounts(player)).toEqual([0, 0]);
      for (const message of player.mail?.messages ?? [])
        expect(message.attachments).toEqual(WELCOME_AWARDS);
    }
    expect(upgraded.get("unclaimed-old")!.mail!.messages).toEqual(oldMessages);
    expect(upgraded.get("claimed-old")!.mail!.messages).toEqual([]);
    upgraded = (await open(true)).players;
    for (const account of ["unclaimed-old", "claimed-old", "GM", "legacy"])
      expect(ticketCounts(await upgraded.getOrCreate(account, now))).toEqual([0, 0]);
  });
});
