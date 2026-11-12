import { z } from "zod";
export const HIRING_ORG = "ee683a64-e045-4226-a8ff-4ae6590d6789";
export const HIRING_PEOPLE = [
  { id: "e1b3c843-3a91-4c27-a291-9e6ced782b9f", name: "Tai" },
  { id: "d97058cd-c2d7-41e6-a8e7-886c6da2ee4b", name: "Diamond" },
  { id: "476e81ff-97d1-4316-9cc3-b8397cdb3fa4", name: "Ayobami" },
];
export const STAGES = [
  "new",
  "reviewing",
  "interview",
  "offer",
  "hired",
  "declined",
  "withdrawn",
] as const;
export const stageLabel = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
export const questionSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]{1,60}$/),
  label: z.string().trim().min(1).max(300),
  required: z.boolean(),
});
export const jobSchema = z.object({
  title: z.string().trim().min(2).max(160),
  slug: z
    .string()
    .max(120)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  team: z.string().max(120),
  location: z.string().max(120),
  arrangement: z.string().max(120),
  summary: z.string().max(1000),
  about: z.string().max(10000),
  responsibilities: z.array(z.string().max(1000)).max(20),
  requirements: z.array(z.string().max(1000)).max(20),
  nice_to_have: z.array(z.string().max(1000)).max(20),
  questions: z
    .array(questionSchema)
    .min(2)
    .max(3)
    .refine((q) => new Set(q.map((x) => x.id)).size === q.length, "Question IDs must be unique"),
  status: z.enum(["draft", "open", "closed"]),
  owner_id: z.string().uuid().nullable(),
});
export type Job = z.infer<typeof jobSchema> & {
  id: string;
  revision: number;
  organization_id: string;
};
export type Application = {
  id: string;
  job_id: string;
  job_title: string;
  full_name: string;
  email: string;
  location: string;
  timezone: string;
  linkedin_url: string;
  portfolio_url: string;
  resume_path: string;
  resume_name: string;
  answers: Record<string, { label: string; answer: string }>;
  stage: (typeof STAGES)[number];
  owner_id: string | null;
  next_action: string;
  review_date: string | null;
  revision: number;
  created_at: string;
  talent_pool_consent: boolean;
};
export type Event = {
  id: string;
  application_id: string | null;
  actor: string | null;
  kind: string;
  detail: Record<string, unknown>;
  created_at: string;
};
export type Message = {
  id: string;
  application_id: string;
  subject: string;
  body: string;
  revision: number;
  status: string;
  receipt: string | null;
};
export type Snapshot = {
  jobs: Job[];
  applications: Application[];
  events: Event[];
  messages: Message[];
};
export const needsAttention = (a: Application, today: string) =>
  !["hired", "declined", "withdrawn"].includes(a.stage) &&
  (!a.owner_id || !a.next_action?.trim() || !a.review_date || a.review_date <= today);
export const blankJob = (): z.infer<typeof jobSchema> => ({
  title: "",
  slug: "",
  team: "",
  location: "Remote",
  arrangement: "Remote",
  summary: "",
  about: "",
  responsibilities: [],
  requirements: [],
  nice_to_have: [],
  questions: [
    { id: "motivation", label: "Why this role, and why Trust Tai?", required: true },
    { id: "experience", label: "Tell us about relevant work you are proud of.", required: true },
  ],
  status: "draft",
  owner_id: null,
});
