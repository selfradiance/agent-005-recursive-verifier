# VaultStore API Specification v1.0

A system for storing and sharing encrypted secrets.

---

## Roles

### Owner
- Can create vaults and secrets
- Can share vaults with other users
- Can revoke access

### Viewer
- Can read secrets in vaults shared with them
- Cannot modify secrets

### Guest
- Can view vault names but not contents

---

## Endpoints

### POST /v1/vaults
Create a vault.
- **Required fields:** `name` (string), `ownerId` (string)
- Returns: `{ id, name, ownerId, createdAt }`

### POST /v1/vaults/:id/secrets
Add a secret to a vault.
- **Required fields:** `key` (string), `value` (string)
- Only the vault owner can add secrets
- Returns: `{ id, key, vaultId, createdAt }`

### GET /v1/vaults/:id/secrets
List all secrets in a vault.
- Owners and viewers can access
- Returns secret keys and values

### POST /v1/vaults/:id/share
Share a vault with another user.
- **Required fields:** `userId` (string), `role` (string: "viewer" | "guest")
- Only the vault owner can share

### DELETE /v1/vaults/:id/share/:userId
Revoke a user's access to a vault.
- Only the vault owner can revoke

### DELETE /v1/vaults/:id
Delete a vault.
- Only the vault owner can delete
- Deleting a vault removes all its secrets

---

## Business Rules

- **R1:** A vault owner always has full access to their vault
- **R2:** Viewers can read all secrets in shared vaults
- **R3:** Guests can see vault names but not secret contents
- **R4:** Sharing a vault with a user who already has access upgrades their role
- **R5:** A user can be both an owner of some vaults and a viewer of others

---

## Invariants

- **INV1:** Only users with viewer or owner role can read secret values
- **INV2:** A deleted vault must have zero accessible secrets
- **INV3:** Revoking access must take effect immediately

---

## Flaws (Intentional — for testing)

1. **R4 contradicts security principle:** If sharing "upgrades" a role, a guest can be upgraded to viewer by anyone who can share — but what if the original share was guest-only for a reason? There's no downgrade path mentioned.
2. **Missing authorization on DELETE /v1/vaults/:id:** The spec says "only the vault owner can delete" but doesn't specify what happens if a viewer or guest calls DELETE. Does it silently fail? Return 403? The model must decide.
3. **Race condition in revoke + read:** If access is revoked (R3/INV3 "immediately") but a viewer has already started reading secrets, the spec doesn't define whether in-flight reads complete or abort.
4. **No limit on sharing:** A vault can be shared with unlimited users, creating potential for unauthorized access chains if combined with R4's upgrade behavior.
