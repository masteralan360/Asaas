import { UserRound } from "lucide-react";

import { cn } from "@/lib/utils";
import { platformService } from "@/services/platformService";

interface FleetAgentAvatarProps {
  profileUrl?: string;
  name?: string;
  className?: string;
}

export function FleetAgentAvatar({
  profileUrl,
  name = "Agent",
  className,
}: FleetAgentAvatarProps) {
  return (
    <div
      className={cn(
        "flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-muted",
        className,
      )}
    >
      {profileUrl ? (
        <img
          src={platformService.convertFileSrc(profileUrl)}
          alt={`${name} profile`}
          className="h-full w-full object-cover"
        />
      ) : (
        <UserRound className="h-4 w-4 text-muted-foreground" />
      )}
    </div>
  );
}
