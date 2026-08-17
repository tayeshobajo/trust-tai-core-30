import { SuiteRoomCard } from "@/components/tt/home/suite-room-card";
import { APP_REGISTRY } from "@/domain/registry";

/** The heart of Home: every room in the suite, as a place you can walk into. */
export function SuiteRoomsGrid() {
  const rooms = APP_REGISTRY.filter((app) => app.id !== "home");

  return (
    <section aria-labelledby="rooms-heading">
      <h2 id="rooms-heading" className="font-display text-2xl text-foreground">
        Rooms in the suite
      </h2>
      <p className="mt-1 text-sm text-muted-foreground">Choose where to work.</p>

      <ul className="mt-6 grid gap-6 lg:grid-cols-2">
        {rooms.map((app) => (
          <li key={app.id}>
            <SuiteRoomCard app={app} />
          </li>
        ))}
      </ul>
    </section>
  );
}
