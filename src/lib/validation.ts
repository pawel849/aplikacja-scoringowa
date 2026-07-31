import { z } from "zod";
export const urlInput = z.object({ url: z.string().url().max(2048), name: z.string().trim().min(2).max(200).optional() });
export const companyUpdate = z.object({
  notes: z.string().max(10_000).optional(), contactStatus: z.enum(["NEW", "TO_CONTACT", "CONTACTED", "PAUSED", "CLOSED"]).optional(),
  qualificationFinalStatus: z.enum(["UNQUALIFIED", "NEEDS_RESEARCH", "ICP_CONFIRMED", "DISQUALIFIED"]).optional(),
  answers: z.object({ wantsMoreProjects: z.string().max(2000).optional(), capacityHiringPlan: z.string().max(2000).optional(), inquiryOwner: z.string().max(2000).optional(), ownerBottleneck: z.string().max(2000).optional(), desiredJobs: z.string().max(2000).optional(), avoidedJobs: z.string().max(2000).optional() }).optional(),
  manual: z.object({
    name: z.string().trim().min(2).max(200), website: z.string().url().max(2048).nullable(), country: z.string().trim().min(2).max(80),
    region: z.string().trim().max(120).nullable(), city: z.string().trim().max(120).nullable(), phone: z.string().trim().max(80).nullable(),
    publicEmail: z.string().email().max(254).nullable(), nip: z.string().regex(/^\d{10}$/).nullable(), krs: z.string().regex(/^\d{10}$/).nullable(),
    technologies: z.array(z.string().trim().min(1).max(80)).max(50), partnershipLevels: z.array(z.string().trim().min(1).max(120)).max(30),
    serviceDescription: z.string().trim().max(2000).nullable(), portfolioUrls: z.array(z.string().url().max(2048)).max(100),
    reviewCount: z.number().int().min(0).max(10_000_000).nullable(), reviewSource: z.string().trim().max(2048).nullable(),
    decisionMakers: z.array(z.object({ name: z.string().trim().min(2).max(200), role: z.string().trim().max(200).optional(), sourceUrl: z.string().url().optional() })).max(50),
    publicJobPostings: z.array(z.object({ title: z.string().trim().min(2).max(200), url: z.string().url(), date: z.string().max(40).optional() })).max(50)
  }).partial().optional()
});
export const sourceInput = z.object({ name: z.string().trim().min(2).max(150), url: z.string().url().max(2048), enabled: z.boolean().default(true) });
export const companyFilters = z.object({
  q: z.string().max(100).optional().default(""), country: z.string().max(80).optional(), region: z.string().max(120).optional(),
  tech: z.string().max(80).optional(), source: z.string().max(150).optional(), minScore: z.coerce.number().int().min(0).max(10).optional(),
  best: z.enum(["0", "1"]).optional(), sort: z.enum(["asc", "desc"]).optional().default("desc"), queue: z.enum(["contact"]).optional()
});
export function formulaSafe(value: unknown) {
  const text = String(value ?? "");
  return /^[=+\-@]/.test(text) ? `'${text}` : text;
}
export function csvCell(value: unknown) { return `"${formulaSafe(value).replaceAll('"', '""')}"`; }
