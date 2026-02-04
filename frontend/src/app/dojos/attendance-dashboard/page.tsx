import React from "react";
import AttendanceDashboardClient from "./AttendanceDashboardClient";

export default function Page({ params }: { params: { dojoId: string } }) {
  return <AttendanceDashboardClient dojoId={params.dojoId} />;
}
