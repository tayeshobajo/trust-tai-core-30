/**
 * Which part of the canon a question is actually about.
 *
 * Without this, the strongest match in the whole canon gets attached to every
 * answer, so a question about delivery is answered with a sentence about the
 * pipeline. Retrieval is scoped to the domains the question names; when a
 * question names nothing in particular, the whole canon stays in scope.
 *
 * Deterministic and inspectable: plain phrase rules, no model, no weighting.
 */

import type { CanonDomain } from "@/domain/intelligence-canon";

interface DomainRule {
  domains: CanonDomain[];
  patterns: RegExp[];
}

const RULES: DomainRule[] = [
  {
    domains: ["delivery"],
    patterns: [
      /\bdeliver(y|ing)?\b/i,
      /\bproject(s)?\b/i,
      /\bship(ping|ped)?\b/i,
      /\bmilestone(s)?\b/i,
      /\blate\b/i,
      /\bblock(ed|er|ers)\b/i,
    ],
  },
  {
    domains: ["founder", "commitments"],
    patterns: [
      /\bbottleneck\b/i,
      /\bwaiting on me\b/i,
      /\bmy plate\b/i,
      /\bapprov(e|als?)\b/i,
      /\bdelegat/i,
      /\bpromise(s|d)?\b/i,
      /\bcommitment(s)?\b/i,
    ],
  },
  {
    domains: ["pipeline", "website"],
    patterns: [
      /\bpipeline\b/i,
      /\bprospect(s)?\b/i,
      /\blead(s)?\b/i,
      /\bsourcing\b/i,
      /\bnew business\b/i,
      /\binbound\b/i,
    ],
  },
  {
    domains: ["client"],
    patterns: [/\bclient(s)?\b/i, /\brelationship(s)?\b/i, /\brepl(y|ies)\b/i, /\bfollow up\b/i],
  },
  { domains: ["roadmap"], patterns: [/\broadmap\b/i, /\bdirection\b/i, /\bstrategy\b/i] },
  { domains: ["website"], patterns: [/\bwebsite\b/i, /\btrusttai\.com\b/i, /\bintake\b/i] },
];

/**
 * The domains a question is about, or undefined when it is a general read and
 * the whole canon should stay in scope.
 */
export function canonDomainsForQuestion(question: string): CanonDomain[] | undefined {
  const text = question.trim();
  if (text.length === 0) return undefined;

  const domains = new Set<CanonDomain>();
  for (const rule of RULES) {
    if (rule.patterns.some((entry) => entry.test(text))) {
      for (const domain of rule.domains) domains.add(domain);
    }
  }
  return domains.size > 0 ? [...domains] : undefined;
}
