# Profile

Profile is the folder-local identity reused by communication, assignment, review, and future collaboration surfaces. Settings stores an optional display name, full name, and profile picture. The display name is the primary visible identity. Surfaces that require a visible label fall back to localized contextual copy such as `You`.

The profile picture picker accepts PNG, JPEG, and WebP files up to 3 MB. Ganbaru copies the selected image into `assets/profile/` using a content-derived name and stores only its managed relative path in `config.json`. Replacing or removing the picture deletes the previous managed file. SVG is not accepted because it can contain interactive or external content.

Without an image, the avatar shows the first character of each of the first two display-name words. The same renderer is used by Chat messages and local Projects assignee or reviewer placeholders so identity remains visually consistent.

Chat stores the local person as a stable participant ID and resolves that participant through the current folder-local Profile whenever it renders a name or avatar. Changing the display name or picture therefore updates old messages, reply participants, member avatars, and message search results without rewriting message content or history. Participant label snapshots embedded in sent mentions remain unchanged because they preserve the text and context that were sent at that time. AI teammates and future human collaborators resolve through their own participant identities and are never overridden by the local Profile.

The local profile represents a human participant. User-created AI teammates have distinct Agent-labeled identities, and provider accounts or models are execution metadata rather than people. The base system seeds no AI teammate. The UI must not let a teammate impersonate the local person or a future collaborator.

Future collaboration adds participant and device identity, invitations, membership, and resource grants without turning the local profile into a global hosted Ganbaru account. A collaborator can expose a display identity to authorized rooms and projects while keeping unrelated personal profile data private. Identity visibility follows the same channel, project, Notes, task-discussion, and working-folder access boundaries as content.
