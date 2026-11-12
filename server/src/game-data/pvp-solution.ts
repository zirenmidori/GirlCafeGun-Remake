import type { Player } from "../persistence/player-repository.js";
import { fieldBytes, fieldVarint } from "../protocol/protobuf.js";

// 客户端的创建队伍/更新编队请求不携带 PlayerBaseInfo（见
// OnlineProto.ApplyCreateTeamReq 只发 mapId/isPublic/activityId/isReady），
// 自己的房间资料必须由服务器从存档构建。这里把 FormationState + 背包投影成
// pvpproto.EquipSolution/PlayerBaseInfo：只填客户端房间 UI 实际读取的字段
// （卡牌 gdpl/等级、武器 gdpl、战力、头像少女），技能等级等省略为默认 0。

const MAX_SOLUTION_GROUPS = 3;
// nType==1 地图客户端会把 teampower>8000 的战力按非空卡组数均分，
// 空卡组会除零；无卡组时把战力压到阈值以下绕过该分支。
const EMPTY_SOLUTION_POWER_CAP = 8000;

interface InventoryCardLike {
  guid: number;
  genre: number;
  detail: number;
  particular: number;
  templateLevel: number;
  enhanceLevel: number;
  breakLevel: number;
}

function makePvpCardInfo(card: InventoryCardLike): Buffer {
  return Buffer.concat([
    fieldVarint(1, card.genre),
    fieldVarint(2, card.detail),
    fieldVarint(3, card.particular),
    fieldVarint(4, card.templateLevel),
    fieldVarint(5, card.enhanceLevel),
    fieldVarint(6, card.breakLevel),
  ]);
}

function makePvpWeaponInfo(weapon: InventoryCardLike): Buffer {
  return Buffer.concat([
    fieldVarint(1, weapon.genre),
    fieldVarint(2, weapon.detail),
    fieldVarint(3, weapon.particular),
    fieldVarint(4, weapon.templateLevel),
    fieldVarint(5, weapon.enhanceLevel),
    fieldVarint(6, weapon.breakLevel),
  ]);
}

export function buildPvpEquipSolution(player: Player): Buffer {
  const inventoryByGuid = new Map(player.inventory.map((item) => [item.guid, item]));
  const formation =
    player.formations.find((entry) => entry.fightCards.length > 0) ??
    player.formations[0];

  const groups: Buffer[] = [];
  let girl = 0;
  for (const fightCard of (formation?.fightCards ?? []).slice(0, MAX_SOLUTION_GROUPS)) {
    const mainCard = inventoryByGuid.get(fightCard.mainCardGuid);
    if (!mainCard) continue;
    if (girl === 0 && mainCard.genre === 1) girl = mainCard.detail;
    const weapon = inventoryByGuid.get(fightCard.weaponGuid);
    const deputies = fightCard.secondaryCardGuids
      .map((guid) => inventoryByGuid.get(guid))
      .filter((card): card is NonNullable<typeof card> => card !== undefined)
      .slice(0, 3);
    groups.push(
      Buffer.concat([
        fieldBytes(1, makePvpCardInfo(mainCard)),
        ...(weapon ? [fieldBytes(3, makePvpWeaponInfo(weapon))] : []),
        ...deputies.map((card, index) => fieldBytes(4 + index, makePvpCardInfo(card))),
      ]),
    );
  }

  const teampower =
    groups.length > 0
      ? player.fightPower
      : Math.min(player.fightPower, EMPTY_SOLUTION_POWER_CAP);

  return Buffer.concat([
    ...groups.map((group) => fieldBytes(1, group)),
    fieldVarint(2, teampower),
    fieldVarint(4, girl),
    fieldVarint(5, formation?.id ?? 0),
  ]);
}
