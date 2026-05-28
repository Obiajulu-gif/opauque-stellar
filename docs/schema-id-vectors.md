# Canonical Schema ID Format

## Algorithm

```
schema_id = SHA-256(authority_bytes || name_utf8 || version_be_u32)
```

| Input | Encoding |
|-------|----------|
| `authority_bytes` | 32-byte raw Ed25519 public key of the authority `Address` |
| `name_utf8` | UTF-8 bytes of the schema name (max 64 bytes) |
| `version_be_u32` | Schema version as 4-byte big-endian unsigned integer |

The three components are concatenated with no separators before hashing.

## Deriving `authority_bytes` from an address

On Stellar, a G... account address encodes a 32-byte Ed25519 public key via
strkey encoding. Strip the 1-byte version prefix and 2-byte checksum to obtain
the raw 32 bytes, or use the SDK's `Address::to_string` → strkey decode path.

In JavaScript:
```ts
import { StrKey } from '@stellar/stellar-sdk';
const authorityBytes = StrKey.decodeEd25519PublicKey(gAddress); // Uint8Array(32)
```

## Test vectors

All values below are hex-encoded.

### Vector 1

| Field | Value |
|-------|-------|
| `authority_bytes` | `2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a2a` (32 × `0x2a`) |
| `name_utf8` | `4d79536368656d61` (`"MySchema"`) |
| `version_be_u32` | `00000001` (1) |
| `schema_id` | computed by `derive_schema_id` test `derive_schema_id_is_deterministic` |

Run `cargo test -p schema-registry derive_schema_id_is_deterministic` to verify.

### Vector 2 — version change produces different ID

Same authority and name as Vector 1 but `version = 2`.  
Expected: output differs from Vector 1.  
Verified by test `derive_schema_id_differs_by_version`.

### Vector 3 — name change produces different ID

Same authority and version as Vector 1 but `name = "Bar"`.  
Expected: output differs from Vector 1.  
Verified by test `derive_schema_id_differs_by_name`.

## Migration plan

Schemas registered before this canonical format was defined used client-generated
IDs with no enforced derivation rule. To migrate:

1. **New schemas** — derive the ID off-chain using the formula above before
   calling `register_schema`. The contract does not re-derive the ID; it stores
   whatever the caller provides.
2. **Existing schemas** — re-register is not possible (`SchemaAlreadyExists`
   guard). Existing schemas can remain at their current IDs; the canonical formula
   applies only to schemas created after this change.
3. **Frontend** — update schema creation flows to compute the ID client-side
   using the JS snippet above before submitting the transaction.
