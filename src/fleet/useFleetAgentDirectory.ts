import { useMemo } from "react";
import { useTranslation } from "react-i18next";

import { useAgents, useBusinessPartners, useWorkspaceUsers } from "@/local-db";

export function useFleetAgentDirectory(workspaceId?: string) {
  const { t } = useTranslation();
  const agents = useAgents(workspaceId);
  const workspaceUsers = useWorkspaceUsers(workspaceId);
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
  const agentById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent])),
    [agents],
  );
  const workspaceUserById = useMemo(
    () => new Map(workspaceUsers.map((user) => [user.id, user])),
    [workspaceUsers],
  );

  return {
    agents,
    partners,
    partnerByAgentId,
    getAgentName: (agentId: string) =>
      partnerByAgentId.get(agentId)?.name ?? t("fleet.unknownAgent"),
    getAgentProfileUrl: (agentId: string) => {
      const linkedUserId = agentById.get(agentId)?.linkedUserId;
      return linkedUserId
        ? workspaceUserById.get(linkedUserId)?.profileUrl
        : undefined;
    },
  };
}
