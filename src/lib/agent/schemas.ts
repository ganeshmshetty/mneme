import { z } from "zod";

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");

export const standaloneQuestionSchema = z.object({
  isFollowUp: z.boolean(),
  question: z.string().trim().min(1).max(1_000),
});

export type StandaloneQuestion = z.infer<typeof standaloneQuestionSchema>;

export const recallControlSchema = z.object({
  query: z.string().trim().min(1).max(240).optional(),
});

export const searchControlSchema = z.object({
  queries: z.array(z.string().trim().min(2).max(240)).min(1).max(4),
  openPages: z.boolean().optional().default(false),
  recall: z.boolean().optional().default(false),
  recheck: z.boolean().optional().default(false),
});

export type RecallControl = z.infer<typeof recallControlSchema>;
export type SearchControl = z.infer<typeof searchControlSchema>;

export const extractedClaimSchema = z.object({
  text: z.string().trim().min(1).max(600),
  sourceUrl: z.string().url(),
  sourceTitle: z.string().trim().min(1).max(200).optional(),
  sourcePublishedAt: dateString.optional(),
  validFrom: dateString.optional(),
  supersedesClaimId: z.string().trim().min(1).max(200).optional(),
});

export const extractedClaimsSchema = z.object({
  claims: z.array(extractedClaimSchema).max(8),
});

export type ExtractedClaim = z.infer<typeof extractedClaimSchema>;
export type ExtractedClaims = z.infer<typeof extractedClaimsSchema>;
