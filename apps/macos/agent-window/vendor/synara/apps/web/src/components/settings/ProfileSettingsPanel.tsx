// FILE: ProfileSettingsPanel.tsx
// Purpose: Local identity editor rendered inside Settings → Profile. Keeps the
// display name, @handle, and avatar (localStorage-only; no server stats here).
// Layer: web profile feature (settings panel body).

import { useState } from "react";
import { Button } from "~/components/ui/button";
import { CentralIcon } from "~/lib/central-icons";
import { EditProfileDialog } from "../profile/EditProfileDialog";
import { useProfileAvatarColor } from "../profile/useProfileAvatarColor";
import { useProfileAvatarImage } from "../profile/useProfileAvatarImage";
import { ProfileAvatar } from "../profile/ProfileAvatar";
import { useProfileHandle } from "../profile/useProfileHandle";
import { useProfileName } from "../profile/useProfileName";
import { deriveIdentity } from "../profile/localIdentity";

export function ProfileSettingsPanel() {
  const [editOpen, setEditOpen] = useState(false);

  // Cedia: no stats RPC here, so seed the identity from stable local values
  // instead of the server's home-dir basename/default handle.
  const identity = deriveIdentity();
  const { name, setName } = useProfileName(identity.name);
  const { handle, setHandle } = useProfileHandle(identity.handle);
  const { color: avatarColor, setColor: setAvatarColor } = useProfileAvatarColor();
  const { image: avatarImage, setImage: setAvatarImage } = useProfileAvatarImage();

  return (
    <div className="flex min-w-0 flex-col gap-7">
      {/* Action row */}
      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={() => setEditOpen(true)}>
          <CentralIcon name="pencil" />
          Edit
        </Button>
      </div>

      {/* Centered identity header */}
      <header className="flex flex-col items-center gap-3 text-center">
        <ProfileAvatar
          initials={identity.initials}
          color={avatarColor}
          image={avatarImage}
          className="size-16 shadow-sm"
          textClassName="text-xl"
        />
        <div className="flex flex-col items-center gap-1.5">
          <h2 className="text-2xl font-semibold tracking-tight">{name}</h2>
          <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
            <span>{handle}</span>
          </div>
        </div>
      </header>

      {/* Cedia §10 item 60: profile stats (lifetime tokens, heatmap, insights, model
          usage, share card) came from the Synara server's stats RPC, which this
          window never backs — a totals dashboard with no totals is cut outright. */}

      <EditProfileDialog
        open={editOpen}
        onOpenChange={setEditOpen}
        initials={identity.initials}
        name={name}
        handle={handle}
        avatarColor={avatarColor}
        avatarImage={avatarImage}
        onSave={({
          name: nextName,
          handle: nextHandle,
          avatarColor: nextColor,
          avatarImage: nextImage,
        }) => {
          setName(nextName);
          setHandle(nextHandle);
          setAvatarColor(nextColor);
          setAvatarImage(nextImage);
        }}
      />
    </div>
  );
}

