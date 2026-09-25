import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

/** Model aliases Claude Code accepts in agent frontmatter, besides full model ids. */
export const MODEL_ALIASES = ['opus', 'sonnet', 'haiku', 'fable', 'inherit'] as const;
export const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max'] as const;
export const CACHE_TTLS = ['5m', '1h'] as const;

const FULL_MODEL_ID = /^claude-[a-z0-9.-]+$/;

export const isValidModel = (value: string): boolean =>
  (MODEL_ALIASES as readonly string[]).includes(value) || FULL_MODEL_ID.test(value);
export const isValidEffort = (value: string): boolean =>
  (EFFORTS as readonly string[]).includes(value);
export const isValidCacheTtl = (value: string): boolean =>
  (CACHE_TTLS as readonly string[]).includes(value);

/** A pinned model: any valid model except `inherit` (the policy exists to prevent silent inheritance). */
const pinnedModel = z
  .string()
  .refine(
    (m) => m !== 'inherit' && isValidModel(m),
    'must be opus|sonnet|haiku|fable or a full id',
  );

export const agentPolicySchema = z.object({
  model: pinnedModel,
  effort: z.enum(EFFORTS),
  maxTurns: z.number().int().positive(),
  cacheTtl: z.enum(CACHE_TTLS),
  mcpServers: z.array(z.string()),
});

export const loopPolicySchema = z.object({
  agents: z.record(z.string(), agentPolicySchema),
  subagentDefaultModel: pinnedModel,
  escalation: z.object({
    agent: z.string(),
    model: pinnedModel,
    complexityMarker: z.string().min(1),
    repeatedBlockingRounds: z.number().int().min(2),
  }),
});

export type AgentPolicy = z.infer<typeof agentPolicySchema>;
export type LoopPolicy = z.infer<typeof loopPolicySchema>;

export const POLICY_PATH = '.claude/loop-policy.json';

export function loadPolicy(root: string): LoopPolicy {
  const raw: unknown = JSON.parse(readFileSync(join(root, POLICY_PATH), 'utf8'));
  return loopPolicySchema.parse(raw);
}
