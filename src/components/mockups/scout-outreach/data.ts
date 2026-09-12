import type { DraftEmail, ReadyProspect, SentEmail } from "./types";

export const INITIAL_READY: ReadyProspect[] = [
  {
    id: "p-1",
    company: "Milestone Dental",
    contact: "Sarah Chen",
    title: "Founder & CEO",
    fitReason: "Founder-led, Murfreesboro, just opened second location",
    fitScore: "strong",
  },
  {
    id: "p-2",
    company: "Northside Orthodontics",
    contact: "David Park",
    title: "Managing Partner",
    fitReason: "Multi-location group, no operating partner yet",
    fitScore: "good",
  },
  {
    id: "p-3",
    company: "Riverbend Pediatric Dentistry",
    contact: "Aisha Williams",
    title: "Owner Dentist",
    fitReason: "Growing fast, founder still scheduling everything",
    fitScore: "strong",
  },
  {
    id: "p-4",
    company: "Cumberland Dental Studio",
    contact: "Mark Torres",
    title: "Founder",
    fitReason: "Second practice opening in Q4, systems stretched",
    fitScore: "medium",
  },
];

export const INITIAL_DRAFTS: DraftEmail[] = [
  {
    id: "d-1",
    prospectId: "p-5",
    recipient: "James Okonkwo",
    company: "Summit Family Dental",
    email: "james@summitfamilydental.com",
    template: "Roadmap opener",
    subject: "A quiet question about Summit's next chapter",
    body:
      "Hi James,\n\nI noticed Summit Family Dental has added a second location in the past year. That is the exact moment founder-led practices often feel the gap between growth and the operating system underneath it.\n\nI help founders build a decision and sequencing rhythm so the next stage does not depend on memory and instinct. No pitch. Just a question: when you look at the next 90 days, what is the one decision that keeps moving?\n\nTrust,\nTai",
  },
  {
    id: "d-2",
    prospectId: "p-6",
    recipient: "Lena Rossi",
    company: "Brightside Dental Co.",
    email: "lena@brightsidedental.co",
    template: "Roadmap opener",
    subject: "The operating system behind the next stage",
    body:
      "Hi Lena,\n\nBrightside Dental Co. looks like it is in the window where early momentum meets the complexity of coordinating people, patients, and priorities.\n\nI spend my time with founder-led practices that have outgrown the spreadsheet phase and need a calmer way to decide what matters next. I would welcome a short conversation about what is working and where the friction is showing up.\n\nTrust,\nTai",
  },
];

export const INITIAL_SENT: SentEmail[] = [
  {
    id: "s-1",
    prospectId: "p-7",
    recipient: "Michael Foster",
    company: "Foster Dental Group",
    email: "michael@fosterdental.com",
    sentDate: "Sep 11",
    statuses: ["sent", "opened"],
  },
  {
    id: "s-2",
    prospectId: "p-8",
    recipient: "Rachel Kim",
    company: "Hillside Orthodontics",
    email: "rachel@hillsideortho.com",
    sentDate: "Sep 10",
    statuses: ["sent", "opened", "replied"],
    highlight: "Replied 2h ago — view in Comms",
  },
  {
    id: "s-3",
    prospectId: "p-9",
    recipient: "Daniel Rivera",
    company: "Parkside Smiles",
    email: "daniel@parksidesmiles.com",
    sentDate: "Sep 9",
    statuses: ["sent"],
  },
];
