# BondGate API Specification v1.0

A minimal trust-and-bond system for managing digital identities, bonds, and actions.

---

## Roles

### Admin
- Can create and suspend identities
- Can view all bonds and actions
- Cannot create bonds (only identity holders can bond)

### Identity Holder
- Can create bonds against their own identity
- Can execute actions using their bonds as collateral
- Can view their own bonds and actions

### Observer
- Can view public identity information
- Cannot create identities, bonds, or execute actions

---

## Endpoints

### POST /v1/identities
Create a new identity.
- **Required fields:** `publicKey` (string), `role` (string: "holder" | "observer")
- **Only admins** can create identities
- Returns: `{ id, publicKey, role, status: "active", createdAt }`
- Identity IDs are unique and auto-generated

### GET /v1/identities/:id
Retrieve identity details.
- Admins see full details
- Observers see only `id`, `publicKey`, and `status`
- Identity holders see their own full details

### POST /v1/identities/:id/suspend
Suspend an identity. Only admins can suspend.
- Suspended identities cannot create new bonds or execute actions
- Existing bonds remain but cannot be used for new actions
- Returns: `{ id, status: "suspended" }`

### POST /v1/bonds
Create a bond.
- **Required fields:** `identityId` (string), `amount` (number > 0)
- Only the identity holder themselves can create a bond for their identity
- The identity must be active (not suspended)
- Returns: `{ id, identityId, amount, usedAmount: 0, status: "active", createdAt }`
- Bond IDs are unique and auto-generated

### GET /v1/bonds/:id
Retrieve bond details.
- Only the bond owner or an admin can view bond details

### POST /v1/execute
Execute an action using a bond as collateral.
- **Required fields:** `bondId` (string), `action` (string), `exposure` (number > 0)
- The bond must be active
- The bond's identity must be active (not suspended)
- The exposure must not exceed the bond's remaining capacity: `amount - usedAmount`
- On success, `usedAmount` is increased by the exposure amount
- Returns: `{ id, bondId, action, exposure, status: "executed", createdAt }`

### GET /v1/actions
List actions.
- Admins see all actions
- Identity holders see only their own actions (via their bonds)
- Observers cannot access this endpoint

---

## Business Rules

- **R1:** Total exposure across all bonds for a single identity must never exceed that identity's total bonded amount
- **R2:** A suspended identity's existing bonds remain valid but cannot be used for new execute actions
- **R3:** Bond amounts are immutable after creation — they cannot be increased or decreased
- **R4:** An identity can have multiple bonds, and each bond tracks its own usedAmount independently
- **R5:** Only the identity holder can create bonds for their own identity — not admins, not other holders

---

## Invariants

- **INV1:** For every identity, the sum of `usedAmount` across all their bonds must never exceed the sum of `amount` across all their bonds
- **INV2:** No action can exist referencing a bond that does not exist
- **INV3:** Every bond must reference an existing identity
- **INV4:** `usedAmount` must always be >= 0 and <= `amount` for every bond
- **INV5:** A suspended identity must have zero new actions created after suspension

---

## Ambiguities (Intentional)

1. **What happens if an admin tries to create a bond?** The spec says "only the identity holder themselves can create a bond" but does not specify the error behavior for admin attempts.
2. **Can a suspended identity be reactivated?** The spec describes suspension but says nothing about un-suspending.
