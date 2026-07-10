import { Badge } from "@astryxdesign/core";

type Status = "new" | "approved" | "passed";

const VARIANT: Record<Status, "info" | "success" | "error"> = {
  new: "info",
  approved: "success",
  passed: "error",
};

export default function StatusBadge({ status }: { status: Status }) {
  return <Badge label={status} variant={VARIANT[status]} />;
}
