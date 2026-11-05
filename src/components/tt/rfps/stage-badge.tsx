import {
  Circle,
  CircleDot,
  Layers,
  Clock,
  CircleCheck,
  Send,
  Trophy,
  CircleX,
  CircleSlash,
} from "lucide-react";
import { CmdStatusBadge } from "@/components/tt/cmd/status";
import { stageLabel, type Stage } from "@/domain/rfps";
const icons = {
  captured: Circle,
  qualifying: CircleDot,
  preparing: Layers,
  review: Clock,
  ready: CircleCheck,
  submitted: Send,
  awarded: Trophy,
  declined: CircleX,
  closed: CircleSlash,
};
export function RfpStageBadge({ stage }: { stage: Stage }) {
  return <CmdStatusBadge tone={stage} label={stageLabel[stage]} icon={icons[stage]} />;
}
