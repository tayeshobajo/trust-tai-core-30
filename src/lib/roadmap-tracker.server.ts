import { trackerBaseline } from "@/data/roadmap-tracker/baseline.server";
import {
  authorizeTracker,
  trackerErrorResponse,
  trackerHeaders,
} from "./roadmap-tracker-access.server";

// This verified workbook belongs to this existing workspace only.
const SOURCE_ORGANIZATION = "ee683a64-e045-4226-a8ff-4ae6590d6789";
export async function readTrackerBaseline(request: Request): Promise<Response> {
  const organizationId = new URL(request.url).searchParams.get("organizationId");
  if (!request.headers.get("Authorization"))
    return Response.json(
      { error: "Sign in to review the tracker." },
      { status: 401, headers: trackerHeaders },
    );
  if (organizationId !== SOURCE_ORGANIZATION)
    return Response.json(
      { error: "This source is not available in this workspace." },
      { status: 403, headers: trackerHeaders },
    );
  try {
    await authorizeTracker(request, organizationId);
    return Response.json(trackerBaseline, { headers: trackerHeaders });
  } catch (error) {
    return trackerErrorResponse(error);
  }
}
