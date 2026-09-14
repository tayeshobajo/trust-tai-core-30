/**
 * MOCKUP ONLY — Direction C, relationship-first.
 *
 * Three destinations: People, Inbox, Follow-ups. A person opens with their
 * whole history and the conversation in place. Fixture data, nothing sends.
 */

import { useMemo, useState } from "react";

import {
  DEMO_FOLLOWUPS,
  DEMO_PEOPLE,
  DEMO_THREADS,
  personById,
  threadById,
  type ThreadState,
} from "@/data/mockups/comms-familiar";
import {
  FilterRow,
  FollowUpList,
  InlineSummary,
  PersonHeader,
  PersonRow,
  PrototypeNote,
  RelationshipMemory,
  SearchField,
  SettingsSheet,
  Surface,
  ThreadList,
  ThreadPane,
  TopNav,
  Chip,
  stateTone,
} from "./kit";
import { THREAD_STATE_LABEL } from "@/data/mockups/comms-familiar";

type View = "people" | "inbox" | "followups";

export function DirectionC() {
  const [view, setView] = useState<View>("people");
  const [settings, setSettings] = useState(false);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<ThreadState | "all">("all");
  const [personId, setPersonId] = useState(DEMO_PEOPLE[0]!.id);
  const [threadId, setThreadId] = useState(DEMO_THREADS[0]!.id);

  const person = personById(personId);
  const personThreads = DEMO_THREADS.filter((thread) => thread.personId === person.id);
  const activeThread = threadById(
    personThreads.some((thread) => thread.id === threadId)
      ? threadId
      : (personThreads[0]?.id ?? DEMO_THREADS[0]!.id),
  );

  const people = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return DEMO_PEOPLE;
    return DEMO_PEOPLE.filter((entry) =>
      `${entry.name} ${entry.company} ${entry.email}`.toLowerCase().includes(needle),
    );
  }, [query]);

  const inboxThreads = DEMO_THREADS.filter(
    (thread) => filter === "all" || thread.state === filter,
  );

  const openThread = (id: string) => {
    const thread = threadById(id);
    setPersonId(thread.personId);
    setThreadId(id);
    setView("people");
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PrototypeNote direction="Direction C, relationship-first" />
      <TopNav
        items={[
          { id: "people", label: "People" },
          { id: "inbox", label: "Inbox", badge: 2 },
          { id: "followups", label: "Follow-ups", badge: DEMO_FOLLOWUPS.length },
        ]}
        active={view}
        onChange={(next: View) => setView(next)}
        onSettings={() => setSettings((open) => !open)}
      />
      {settings ? <SettingsSheet onClose={() => setSettings(false)} /> : null}

      {view === "people" ? (
        <>
          <InlineSummary />
          <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
            <div className="space-y-3">
              <SearchField value={query} onChange={setQuery} placeholder="Search people" />
              <Surface className="overflow-hidden">
                {people.map((entry) => (
                  <PersonRow
                    key={entry.id}
                    person={entry}
                    selected={entry.id === person.id}
                    onSelect={() => {
                      setPersonId(entry.id);
                      const first = DEMO_THREADS.find((thread) => thread.personId === entry.id);
                      if (first) setThreadId(first.id);
                    }}
                  />
                ))}
              </Surface>
            </div>
            <div className="space-y-4">
              <Surface className="space-y-4 p-4 sm:p-5">
                <PersonHeader person={person} />
                <RelationshipMemory person={person} />
                {personThreads.length > 1 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {personThreads.map((thread) => (
                      <button
                        key={thread.id}
                        type="button"
                        onClick={() => setThreadId(thread.id)}
                        aria-pressed={thread.id === activeThread.id}
                        className="inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-[13px] text-foreground hover:bg-secondary"
                      >
                        {thread.subject}
                        <Chip tone={stateTone(thread.state)}>
                          {THREAD_STATE_LABEL[thread.state]}
                        </Chip>
                      </button>
                    ))}
                  </div>
                ) : null}
              </Surface>
              <ThreadPane thread={activeThread} />
            </div>
          </div>
        </>
      ) : null}

      {view === "inbox" ? (
        <div className="grid gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
          <div className="space-y-3">
            <FilterRow filter={filter} onChange={setFilter} threads={DEMO_THREADS} />
            <ThreadList threads={inboxThreads} selectedId={activeThread.id} onSelect={openThread} />
          </div>
          <ThreadPane thread={activeThread} onOpenPerson={(id) => {
            setPersonId(id);
            setView("people");
          }} />
        </div>
      ) : null}

      {view === "followups" ? (
        <div className="max-w-3xl">
          <FollowUpList
            onOpenThread={openThread}
            heading="Follow-ups"
            note="Promises made and reminders set. Opening one takes you to the person, not to another list."
          />
        </div>
      ) : null}
    </div>
  );
}
