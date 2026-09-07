/**
 * The project workroom: one project's operating surface.
 *
 * It answers four things without scrolling: what we are building, why we are
 * building it, what is happening now, and what is stopping it from moving.
 * The chain Company → Roadmap → Milestone → Project → Delivery → Outcome stays
 * visible, because execution without lineage is just activity.
 *
 * It renders in two places and owns no truth of its own: the standalone
 * Projects room, and embedded inside a Client workspace. Embedding hides the
 * Projects breadcrumb and lets the host own the selected surface, so a person
 * serving one company never has to leave that company.
 */

import { Link } from "@tanstack/react-router";

