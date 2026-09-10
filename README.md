# Trust Tai Core (30)

Create a new internal Trust Tai product called **Trust Tai OS Foundation**. This is not one of the business apps yet. It is the shared foundation that future Trust Tai apps will inherit.

Use the workspace skill `trust-tai-brand-system` as the design and product source of truth. The product should visually feel like trusttai.com and the existing Trust Tai Ops experience: calm, editorial, premium, restrained, highly clear, with warm paper surfaces, deep ink structure, royal blue only as a meaningful signal, Cormorant Garamond for major editorial statements, Inter for interface copy, and JetBrains Mono for metadata/status.

Core product principle: **Small input. Deep intelligence. Clear output.** Do not create a generic SaaS dashboard. Do not overbuild. Do not create Scout, Comms, Roadmap, Projects, Studio, or Pulse yet.

The job of this project is to establish the shared shell and shared product contract for the Trust Tai internal ecosystem.

Build the smallest coherent v1 with:

1. A simple Trust Tai OS home shell that can later host multiple internal apps.
2. A left navigation / app switcher showing the planned suite as clearly labeled modules: Home, Scout, Comms, Roadmap, Projects, Ops, Studio, Pulse. Only Home is fully active for now; the others should be lightweight placeholders or clearly marked upcoming. Ops may link conceptually to the existing maintenance product but do not duplicate or reimplement Ops.
3. A clear home page that answers: Where am I? What matters now? Where am I going? What is the next move? Who carries it?
4. A small `Needs your decision` area that demonstrates the decision-first pattern without inventing complicated workflows.
5. A shared core-entity model represented in code/types for: organizations, users, clients, contacts, projects, websites, conversations, activities, tasks, decisions, and app registrations. Keep this simple and extensible. Do not create unnecessary tables or abstractions yet.
6. A shared application registry model so each future app can have: id, name, slug, description, status, route, icon, and capability tags.
7. A shared activity/event contract for cross-app intelligence, with a small typed model such as `entity.action` events and provenance metadata. Do not build a message bus or microservice architecture. Just establish the contract.
8. A shared intelligence context contract that can eventually retrieve authorized context across apps with provenance. For now, create clean interfaces/types and a simple mocked home example. Do not pretend live AI orchestration exists yet.
9. Auth boundary: structure the app so production requires authenticated Trust Tai users and fails closed. Do not introduce demo access in production. If auth/backend is not yet configured, show a clear signed-out/configuration state instead of a fake usable workspace.
10. Shared design tokens/components for Trust Tai buttons, inputs, status pills, cards, navigation, page headers, empty states, decision cards, and context panels.
11. Responsive behavior at 375px, 768px, and 1440px. Include accessible focus states and reduced motion support.
12. A short internal README / architecture note explaining the Trust Tai OS product contract: one identity, one organization model, shared core entities, app registry, activity stream contract, intelligence context contract, and the rule that apps should share data rather than duplicate entities.

For the home screen, keep the content simple and real. Suggested structure:

Eyebrow: TRUST TAI OS
Headline: `One operating system for how Trust Tai works.`
Short supporting line: `A shared foundation for clients, projects, communication, operations, and intelligence.`

Then show only a few meaningful areas:
- Needs your decision
- What is active now
- The Trust Tai suite
- Next move

Avoid dense KPI dashboards, charts for decoration, large card grids, or excessive settings.

Architecture principle: start with one app and one codebase. Do not introduce microservices. Use TypeScript-first domain contracts. Keep persistence behind a small repository/service boundary so we can later connect a shared Supabase backend without rewriting the product shell.

Before making choices that add complexity, prefer the simplest option that preserves future interoperability. At completion, report: information architecture, screen map, domain contracts created, components created, files changed, build/typecheck results, and any intentionally deferred decisions.

This project was built with [Lovable](https://lovable.dev).

## Build with Lovable

Continue developing this project in the [Lovable editor](https://lovable.dev/projects/65944e34-ede5-4757-befb-870e1ff97444).

- **Ship faster**: describe what you want to build and Lovable handles the code.
- **Stay in sync**: every change made in Lovable is committed straight to this repository.
- **Full ownership**: this code is yours. Push to `main` on GitHub and your changes sync back into Lovable, ready for your next prompt.

## Development

Prefer working locally? You need Node.js and npm, [install with nvm](https://github.com/nvm-sh/nvm#installing-and-updating).

```sh
git clone <this-repository-url>
cd <repository-name>
npm i
npm run dev
```
