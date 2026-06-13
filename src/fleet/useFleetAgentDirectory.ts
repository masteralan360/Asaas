import { useMemo } from "react";

import { useAgents, useBusinessPartners } from "@/local-db";

export function useFleetAgentDirectory(workspaceId?: string) {
  const agents = useAgents(workspaceId);
  const partners = useBusinessPartners(workspaceId, {
    roles: ["agent"],
    includeAgentRoles: true,
  });

  const partnerByAgentId = useMemo(
    () =>
      new Map(
        partners
          .filter((partner) => partner.agentFacetId)
          .map((partner) => [partner.agentFacetId as string, partner]),
      ),
    [partners],
  );

  return {
    agents,
    partners,
    partnerByAgentId,
    getAgentName: (agentId: string) =>
      partnerByAgentId.get(agentId)?.name ?? "Unknown agent",
  };
}
