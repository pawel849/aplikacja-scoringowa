import { sql } from "drizzle-orm";
import { boolean, integer, jsonb, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const confidenceEnum = pgEnum("confidence", ["LOW", "MEDIUM", "HIGH"]);
export const qualificationEnum = pgEnum("qualification_status", ["UNQUALIFIED", "NEEDS_RESEARCH", "ICP_CONFIRMED", "DISQUALIFIED"]);

export const companies = pgTable("companies", {
  id: uuid("id").defaultRandom().primaryKey(), name: text("name").notNull(), normalizedName: text("normalized_name").notNull(),
  domain: text("domain"), website: text("website"), country: text("country").notNull().default("PL"), region: text("region"), city: text("city"),
  phone: text("phone"), normalizedPhone: text("normalized_phone"), publicEmail: text("public_email"), nip: text("nip"), krs: text("krs"),
  sourceNames: jsonb("source_names").$type<string[]>().notNull().default([]), sourceUrls: jsonb("source_urls").$type<string[]>().notNull().default([]),
  technologies: jsonb("technologies").$type<string[]>().notNull().default([]), partnershipLevels: jsonb("partnership_levels").$type<string[]>().notNull().default([]),
  serviceDescription: text("service_description"), portfolioUrls: jsonb("portfolio_urls").$type<string[]>().notNull().default([]),
  reviewCount: integer("review_count"), reviewSource: text("review_source"), publicJobPostings: jsonb("public_job_postings").$type<object[]>().notNull().default([]),
  decisionMakers: jsonb("decision_makers").$type<object[]>().notNull().default([]), checkedAt: timestamp("checked_at", { withTimezone: true }),
  score: integer("score").notNull().default(0), completeness: integer("completeness").notNull().default(0),
  recommendation: text("recommendation").notNull().default("NEEDS_MORE_RESEARCH"), classification: text("classification"),
  contactStatus: text("contact_status").notNull().default("NEW"), qualificationFinalStatus: qualificationEnum("qualification_final_status").notNull().default("UNQUALIFIED"),
  notes: text("notes"), manualOverrides: jsonb("manual_overrides").$type<Record<string, unknown>>().notNull().default({}),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [
  uniqueIndex("companies_domain_unique").on(t.domain), uniqueIndex("companies_nip_unique").on(t.nip), uniqueIndex("companies_krs_unique").on(t.krs),
  uniqueIndex("companies_normalized_phone_unique_idx").on(t.normalizedPhone).where(sql`${t.normalizedPhone} IS NOT NULL`),
  uniqueIndex("companies_normalized_name_unique_idx").on(t.normalizedName).where(sql`length(${t.normalizedName}) >= 8`)
]);

export const evidence = pgTable("evidence", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  scoringCategory: text("scoring_category").notNull(), awardedPoints: integer("awarded_points").notNull().default(0), context: text("context"),
  sourceUrl: text("source_url").notNull(), excerpt: text("excerpt").notNull(), foundAt: timestamp("found_at", { withTimezone: true }).notNull().defaultNow(),
  confidence: confidenceEnum("confidence").notNull(), evidenceType: text("evidence_type").notNull()
});
export const scoreBreakdowns = pgTable("score_breakdowns", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  category: text("category").notNull(), points: integer("points").notNull(), rationale: text("rationale").notNull(), evidenceIds: jsonb("evidence_ids").$type<string[]>().notNull().default([]),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
}, (t) => [uniqueIndex("breakdown_company_category").on(t.companyId, t.category)]);
export const qualificationAnswers = pgTable("qualification_answers", {
  id: uuid("id").defaultRandom().primaryKey(), companyId: uuid("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }).unique(),
  wantsMoreProjects: text("wants_more_projects"), capacityHiringPlan: text("capacity_hiring_plan"), inquiryOwner: text("inquiry_owner"),
  ownerBottleneck: text("owner_bottleneck"), desiredJobs: text("desired_jobs"), avoidedJobs: text("avoided_jobs"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow()
});
export const researchSources = pgTable("research_sources", {
  id: uuid("id").defaultRandom().primaryKey(), name: text("name").notNull().unique(), type: text("type").notNull(), enabled: boolean("enabled").notNull().default(false),
  config: jsonb("config").$type<Record<string, unknown>>().notNull().default({}), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
export const researchRuns = pgTable("research_runs", {
  id: uuid("id").defaultRandom().primaryKey(), type: text("type").notNull(), status: text("status").notNull().default("RUNNING"),
  startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
  stats: jsonb("stats").$type<Record<string, unknown>>().notNull().default({})
});
export const researchErrors = pgTable("research_errors", {
  id: uuid("id").defaultRandom().primaryKey(), runId: uuid("run_id").references(() => researchRuns.id, { onDelete: "set null" }),
  companyId: uuid("company_id").references(() => companies.id, { onDelete: "cascade" }), sourceName: text("source_name"), url: text("url"),
  code: text("code").notNull(), message: text("message").notNull(), retryable: boolean("retryable").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow()
});
export const fetchCache = pgTable("fetch_cache", {
  url: text("url").primaryKey(), status: integer("status").notNull(), content: text("content"), contentType: text("content_type"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
});
export const researchLocks = pgTable("research_locks", {
  companyId: uuid("company_id").primaryKey().references(() => companies.id, { onDelete: "cascade" }),
  token: uuid("token").notNull(), expiresAt: timestamp("expires_at", { withTimezone: true }).notNull()
});
export const loginAttempts = pgTable("login_attempts", {
  key: text("key").primaryKey(), attempts: integer("attempts").notNull().default(0),
  windowStartedAt: timestamp("window_started_at", { withTimezone: true }).notNull().defaultNow()
});
