export interface ReadyProspect {
  id: string;
  company: string;
  contact: string;
  title: string;
  fitReason: string;
  fitScore: "strong" | "good" | "medium";
}

export interface DraftEmail {
  id: string;
  prospectId: string;
  recipient: string;
  company: string;
  email: string;
  template: string;
  subject: string;
  body: string;
}

export interface SentEmail {
  id: string;
  prospectId: string;
  recipient: string;
  company: string;
  email: string;
  sentDate: string;
  statuses: ("sent" | "opened" | "replied")[];
  highlight?: string;
}
