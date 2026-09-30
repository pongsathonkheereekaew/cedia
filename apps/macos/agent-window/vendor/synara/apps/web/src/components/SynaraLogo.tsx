// FILE: SynaraLogo.tsx
// Purpose: Render Cedia's currentColor D-terminal mark while retaining the upstream component API.
// Layer: Shared app branding primitive

import { useId, type SVGProps } from "react";
import { cn } from "~/lib/utils";
import { publicAssetUrl } from "~/lib/publicAssetUrl";

export function SynaraLogo({ className, ...props }: SVGProps<SVGSVGElement>) {
  const maskId = `cedia-terminal-d-${useId()}`;
  const suppliedAriaLabel = props["aria-label"] !== undefined;
  const { ["aria-label"]: _ignoredAriaLabel, ...svgProps } = props;

  return (
    <svg
      viewBox="0 0 1024 1024"
      xmlns="http://www.w3.org/2000/svg"
      {...svgProps}
      aria-hidden={suppliedAriaLabel ? undefined : true}
      aria-label={suppliedAriaLabel ? "Cedia" : undefined}
      className={cn("shrink-0 text-foreground", className)}
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" mask-type="alpha" x="0" y="0" width="1024" height="1024">
          <image href={publicAssetUrl("cedia-mask.png")} width="1024" height="1024" />
        </mask>
      </defs>
      <rect width="1024" height="1024" fill="currentColor" mask={`url(#${maskId})`} />
    </svg>
  );
}
