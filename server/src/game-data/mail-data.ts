import type { BaseAward } from "./chapter-config.js";
import { dailySignUpOperationalDate } from "./daily-sign-up-data.js";
import type { Gdpln } from "./gacha-data.js";
import {
  recruitmentPolicy,
  RECRUITMENT_ROTATION_POOL_ID,
} from "./recruitment-policy.js";

export interface MailMessage {
  id: number;
  operationalDate: string;
  receivedAt: number;
  read: boolean;
  title: string;
  sender: string;
  content: string;
  attachments: BaseAward[];
}

export interface MailboxState {
  deliveredCampaigns?: string[];
  lastDailyDate: string | null;
  nextId: number;
  messages: MailMessage[];
}

export const WELCOME_CAMPAIGN = "neptune-astral-welcome-v1";
export const WELCOME_AWARDS: readonly BaseAward[] = [
  [1, 27, 1, 1, 1],
  [2, 2, 28, 1, 1],
];
// The regular recruitment pools consume one of these tickets per ten draws.
export const WELCOME_RECRUITMENT_AWARDS: readonly BaseAward[] = [
  [9, 13, 1, 1, 20],
  [7, 10, 1, 4, 20],
];

/** Durable delivery marker survives claiming/deleting the message. */
export function reconcileWelcomeMail(
  mailbox: MailboxState,
  now: number,
  includeRecruitmentBonus = false,
): void {
  const campaigns = (mailbox.deliveredCampaigns ??= []);
  if (campaigns.includes(WELCOME_CAMPAIGN)) return;
  mailbox.messages.unshift({
    id: mailbox.nextId++,
    operationalDate: dailySignUpOperationalDate(now),
    receivedAt: Math.floor(now / 1000),
    read: false,
    title: "Welcome to Girl Cafe Gun",
    sender: "Cafe Staff",
    content:
      "Welcome, Manager! Neptune and Astral Covenant are ready to join your journey. Claim your gifts here." +
      (includeRecruitmentBonus
        ? " Your new-manager gift also includes 200 character draws and 200 weapon draws, supplied as twenty ten-pull tickets for each category."
        : ""),
    attachments: [
      ...WELCOME_AWARDS,
      ...(includeRecruitmentBonus ? WELCOME_RECRUITMENT_AWARDS : []),
    ].map((award) => [...award]),
  });
  campaigns.push(WELCOME_CAMPAIGN);
}

export type MailAction =
  | { kind: "list" }
  | { kind: "claim"; ids: number[]; autoDelete: boolean }
  | { kind: "read"; ids: number[]; read: boolean }
  | { kind: "delete"; ids: number[] };

export function makeMailbox(): MailboxState {
  return { lastDailyDate: null, nextId: 1, messages: [] };
}

export function dailyPullMailAwards(
  bannerIds: { character: number[]; weapon: number[] },
  characterCost: Gdpln | null | undefined,
  weaponCost: Gdpln | null | undefined,
): BaseAward[] {
  const awards: BaseAward[] = [];
  const categories = [
    { ids: bannerIds.character, cost: characterCost },
    { ids: bannerIds.weapon, cost: weaponCost },
  ];
  for (const { ids, cost } of categories) {
    if (ids.length === 0 || !cost) continue;
    const [genre, detail, particular, level, count] = cost;
    const policy = recruitmentPolicy();
    const draws = [...new Set(ids)].reduce(
      (sum, id) =>
        sum +
        (id === RECRUITMENT_ROTATION_POOL_ID
          ? policy.rotationDailyDraws
          : policy.otherBannerDailyDraws),
      0,
    );
    if (draws > 0)
      awards.push([genre, detail, particular, level, (count * draws) / 10]);
  }
  return awards;
}

export function reconcileDailyPullMail(
  mailbox: MailboxState,
  awards: readonly BaseAward[],
  now: number,
): void {
  const date = dailySignUpOperationalDate(now);
  if (awards.length === 0 || (mailbox.lastDailyDate && date <= mailbox.lastDailyDate))
    return;
  const daysMissed = mailbox.lastDailyDate
    ? (Date.parse(date) - Date.parse(mailbox.lastDailyDate)) / 86_400_000 - 1
    : 0;
  function deliver(title: string, content: string, days: number): void {
    mailbox.messages.unshift({
      id: mailbox.nextId++,
      operationalDate: date,
      receivedAt: Math.floor(now / 1000),
      read: false,
      title,
      sender: "Supply Office",
      content,
      attachments: awards.map(([g, d, p, l, count]) => [g, d, p, l, count * days]),
    });
  }
  if (daysMissed > 0) {
    deliver(
      "Missed Recruitment Tickets",
      `Here are your recruitment tickets for ${daysMissed} missed ${daysMissed === 1 ? "day" : "days"}.`,
      daysMissed,
    );
  }
  deliver(
    "Daily Recruitment Tickets",
    `Your daily supply includes ${recruitmentPolicy().rotationDailyDraws} draws for each available rotation and ${recruitmentPolicy().otherBannerDailyDraws} for each other regular banner. Tickets are shared between banners in the same category.`,
    1,
  );
  mailbox.lastDailyDate = date;
}

export function applyMailAction(
  mailbox: MailboxState,
  action: MailAction,
  grant: (awards: readonly BaseAward[]) => void,
): number[] {
  if (action.kind === "list") return [];
  const requested = new Set(action.ids);
  const accepted: number[] = [];
  for (const message of mailbox.messages) {
    if (!requested.has(message.id)) continue;
    if (action.kind === "read") {
      message.read = action.read;
    } else if (action.kind === "claim") {
      if (message.attachments.length === 0) continue;
      grant(message.attachments);
      message.attachments = [];
      message.read = true;
    } else if (message.attachments.length > 0) {
      continue;
    }
    accepted.push(message.id);
  }
  if (action.kind === "delete" || (action.kind === "claim" && action.autoDelete)) {
    const deleted = new Set(accepted);
    mailbox.messages = mailbox.messages.filter(({ id }) => !deleted.has(id));
  }
  return accepted;
}
