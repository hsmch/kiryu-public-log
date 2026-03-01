/**
 * Zod schemas for all data files in the KPL pipeline.
 *
 * These schemas validate data before writing to JSON files,
 * preventing malformed data from being saved.
 *
 * All schemas use .passthrough() where applicable to allow
 * unknown fields for forward compatibility.
 */

import { z } from "zod";

// --- population.json ---

const populationHistoryEntrySchema = z.object({
  year: z.number().int().min(1800).max(2100),
  population: z.number().int().nonnegative(),
  households: z.number().int().nonnegative(),
  source: z.string(),
}).passthrough();

export const populationSchema = z.object({
  city: z.literal("桐生市"),
  sourceUrl: z.string().url(),
  scrapedAt: z.string(),
  current: z.object({
    population: z.number().int().nonnegative().max(500000),
    households: z.number().int().nonnegative().max(500000),
    asOf: z.string(),
  }).passthrough(),
  history: z.array(populationHistoryEntrySchema),
}).passthrough();

export type PopulationData = z.infer<typeof populationSchema>;

// --- council-members.json ---

const councilMemberSchema = z.object({
  seatNumber: z.number().int().positive().nullable(),
  name: z.string().min(1),
  nameReading: z.string(),
  faction: z.string(),
  committee: z.string(),
  committeeRole: z.string().nullable(),
  role: z.string().nullable(),
  electionCount: z.number().int().nonnegative().nullable(),
  photoUrl: z.string().nullable(),
}).passthrough();

export const councilMembersSchema = z.object({
  sourceUrl: z.string().url(),
  scrapedAt: z.string(),
  officers: z.array(councilMemberSchema),
  members: z.array(councilMemberSchema).min(1),
}).passthrough();

export type CouncilMembersData = z.infer<typeof councilMembersSchema>;

// --- sessions/*.json ---

const billSchema = z.object({
  number: z.string().min(1),
  title: z.string().min(1),
  result: z.string(),
  category: z.string(),
}).passthrough();

export const sessionSchema = z.object({
  session: z.string().min(1),
  sourceUrls: z.array(z.string()),
  scrapedAt: z.string(),
  dates: z.array(z.string()),
  bills: z.array(billSchema),
  votingRecordPdfUrl: z.string().nullable(),
}).passthrough();

export type SessionData = z.infer<typeof sessionSchema>;

// --- voting/*.json ---

const voteSchema = z.object({
  memberName: z.string().min(1),
  vote: z.enum(["賛成", "反対", "欠席", "議長", "退席"]),
}).passthrough();

const voteRecordSchema = z.object({
  billNumber: z.string(),
  billTitle: z.string(),
  result: z.string(),
  votes: z.array(voteSchema),
}).passthrough();

export const votingSchema = z.object({
  session: z.string().min(1),
  sessionSlug: z.string().min(1),
  sourceUrl: z.string(),
  scrapedAt: z.string(),
  records: z.array(voteRecordSchema),
}).passthrough();

export type VotingData = z.infer<typeof votingSchema>;

// --- questions/*.json ---

const questionItemSchema = z.object({
  title: z.string(),
  details: z.array(z.string()),
}).passthrough();

const memberQuestionSchema = z.object({
  memberName: z.string().min(1),
  order: z.number().int().positive(),
  items: z.array(questionItemSchema),
}).passthrough();

export const questionsSchema = z.object({
  session: z.string().min(1),
  sessionSlug: z.string().min(1),
  sourceUrl: z.string(),
  pdfUrl: z.string(),
  scrapedAt: z.string(),
  questions: z.array(memberQuestionSchema),
}).passthrough();

export type QuestionsData = z.infer<typeof questionsSchema>;

// --- schedule.json ---

const scheduleEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  type: z.string().min(1),
  session: z.string().min(1),
  description: z.string(),
}).passthrough();

export const scheduleSchema = z.object({
  sourceUrl: z.string(),
  scrapedAt: z.string(),
  entries: z.array(scheduleEntrySchema),
}).passthrough();

export type ScheduleData = z.infer<typeof scheduleSchema>;

// --- updates.json ---

const updateEntrySchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  label: z.string(),
  title: z.string().min(1),
  url: z.string(),
  firstSeenAt: z.string(),
}).passthrough();

export const updatesSchema = z.object({
  sourceUrl: z.string(),
  lastCheckedAt: z.string(),
  entries: z.array(updateEntrySchema),
}).passthrough();

export type UpdatesData = z.infer<typeof updatesSchema>;

// --- finance/funds.json ---

const fundSchema = z.object({
  name: z.string().min(1),
  balance: z.number().int(),
  category: z.enum(["一般会計", "特別会計等"]),
}).passthrough();

export const fundsSchema = z.object({
  sourceUrl: z.string(),
  scrapedAt: z.string(),
  asOf: z.string(),
  funds: z.array(fundSchema),
  generalTotal: z.number().int(),
  specialTotal: z.number().int(),
  grandTotal: z.number().int(),
}).passthrough();

export type FundsData = z.infer<typeof fundsSchema>;

// --- finance/budget-history.json ---

const budgetHistoryEntrySchema = z.object({
  fiscalYear: z.string().min(1),
  fiscalYearLabel: z.string().min(1),
  revenue: z.number(),
  expenditure: z.number(),
  ordinaryBalanceRatio: z.number(),
  fiscalStrengthIndex: z.number(),
  debtServiceRatio: z.number(),
  fundBalance: z.number(),
}).passthrough();

export const budgetHistorySchema = z.object({
  sourceUrl: z.string(),
  scrapedAt: z.string(),
  note: z.string(),
  entries: z.array(budgetHistoryEntrySchema),
}).passthrough();

export type BudgetHistoryData = z.infer<typeof budgetHistorySchema>;

// --- voting-analysis.json ---

const factionCohesionSchema = z.object({
  faction: z.string().min(1),
  memberCount: z.number().int().nonnegative(),
  cohesionRate: z.number(),
  splitBillCount: z.number().int().nonnegative(),
  totalBillCount: z.number().int().nonnegative(),
}).passthrough();

const dissenterProfileSchema = z.object({
  memberName: z.string().min(1),
  faction: z.string(),
  totalVotes: z.number().int().nonnegative(),
  oppositionCount: z.number().int().nonnegative(),
  oppositionRate: z.number(),
  themeDistribution: z.array(z.object({
    tag: z.string(),
    count: z.number().int().positive(),
  }).passthrough()),
}).passthrough();

export const votingAnalysisSchema = z.object({
  meta: z.object({
    generatedAt: z.string(),
    totalBills: z.number().int().nonnegative(),
    splitBills: z.number().int().nonnegative(),
    sessionRange: z.string(),
  }).passthrough(),
  agreementMatrix: z.object({
    members: z.array(z.string()),
    factions: z.array(z.string()),
    matrix: z.array(z.array(z.number())),
  }).passthrough(),
  factionCohesion: z.array(factionCohesionSchema),
  dissenterProfiles: z.array(dissenterProfileSchema),
}).passthrough();

export type VotingAnalysisData = z.infer<typeof votingAnalysisSchema>;

// --- tags.json ---

const tagEntrySchema = z.object({
  type: z.enum(["bill", "question"]),
  sessionSlug: z.string().min(1),
  session: z.string().min(1),
  tags: z.array(z.string()),
}).passthrough();

export const tagsSchema = z.object({
  generatedAt: z.string(),
  method: z.enum(["claude-api", "rule-based"]),
  entries: z.array(tagEntrySchema),
}).passthrough();

export type TagsData = z.infer<typeof tagsSchema>;
