/**
 * MOCKUP ONLY — Direction A, inbox-first.
 *
 * Two destinations: Inbox and People. Review, follow-ups and relationship
 * memory live inside the thread. Fixture data, local state, nothing sends.
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
  PersonThreads,
  PrototypeNote,
  RelationshipMemory,
  SearchField,
  SettingsSheet,
  Surface,
  ThreadList,
  ThreadPane,
  TopNav,
} from "./kit";

type View = "inbox" | "people";

export function DirectionA() {
  const [view, setView] = useState<View>("inbox");
  const [settings, setSettings] = useState(false);
  const [filter, setFilter] = useState<ThreadState | "all">("all");
  const [query, setQuery] = useState("");
  const [threadId, setThreadId] = useState(DEMO_THREADS[0]!.id);
  const [personId, setPersonId] = useState(DEMO_PEOPLE[0]!.id);

  const threads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return DEMO_THREADS.filter(
      (thread) =>
        (filter === "all" || thread.state === filter) &&
        (!needle ||
          `${thread.person} ${thread.company} ${thread.subject}`.toLowerCase().includes(needle)),
    );
  }, [filter, query]);

  const openThread = (id: string) => {
    setThreadId(id);
    setView("inbox");
  };

  return (
    <div className="mx-auto max-w-6xl">
      <PrototypeNote direction="Direction A, inbox-first" />
      <TopNav
        items={[
          { id: "inbox", label: "Inbox", badge: DEMO_FOLLOWUPS.length },
          { id: "people", label: "People" },
        ]}
        active={view}
        onChange={(next: View) => setView(next)}
        onSettings={() => setSettings((open) => !open)}
      />
      {settings ? <SettingsSheet onClose={() => setSettings(false)} /> : null}

      {view === "inbox" ? (
        <>
          <InlineSummary />
          <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
            <div className="space-y-3">
              <SearchField
                value={query}
                onChange={setQuery}
                placeholder="Search people, companies, subjects"
              />
              <FilterRow filter={filter} onChange={setFilter} threads={DEMO_THREADS} />
              <ThreadList threads={threads} selectedId={threadId} onSelect={setThreadId} />
              <FollowUpList onOpenThread={openThread} />
            </div>
            <div className="space-y-4">
              <ThreadPane
                thread={threadById(threadId)}
                onOpenPerson={(id) => {
                  setPersonId(id);
                  setView("people");
                }}
              />
              <Surface className="p-4 sm:p-5">
                <RelationshipMemory person={personById(threadById(threadId).personId)} />
              </Surface>
            </div>
          </div>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[340px_minmax(0,1fr)]">
          <Surface className="overflow-hidden">
            {DEMO_PEOPLE.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                selected={person.id === personId}
                onSelect={() => setPersonId(person.id)}
              />
            ))}
          </Surface>
          <Surface className="space-y-4 p-4 sm:p-5">
            <PersonHeader person={personById(personId)} />
            <RelationshipMemory person={personById(personId)} />
            <PersonThreads person={personById(personId)} onOpenThread={openThread} />
          </Surface>
        </div>
      )}
    </div>
  );
}
