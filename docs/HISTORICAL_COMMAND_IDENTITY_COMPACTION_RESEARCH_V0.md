# Historical Command Identity Compaction — Research v0

Date: 2026-09-15
Status: **RESEARCH / NO CANONICAL SEMANTICS CHANGE**

## Why this exists

Proof 022 exposed a specific remaining scaling boundary.

Partial receipt compaction successfully removes old accepted receipt envelopes from the live suffix, but the replay checkpoint still carries historical command-derived material inside Temporal State's `appliedCommands` map.

Current v0 behavior is effectively:

```text
appliedCommands[command.id] = canonical full command string
```

The canonical string includes:

- command ID;
- tick;
- command type;
- payload.

That representation provides exact local duplicate/conflict comparison, but its memory/checkpoint cost grows with both the number and size of historical commands.

Proof 022 therefore corrected an earlier overclaim: the current partial-compaction checkpoint is **receipt-history compacted**, not **historical-command-material compacted**.

## The actual problem

For an old command ID, the runtime currently wants to answer two different questions:

1. Is this exactly the same command that was already applied?
2. Is this the same ID reused for different command content?

With arbitrary command payloads, exact answers require enough retained information to distinguish every command value that may later be presented.

There is no magic fixed-size, collision-free summary for an unbounded arbitrary command domain. A bounded digest can make collisions negligibly unlikely, but cannot preserve mathematical exactness for every possible input unless the input domain itself is bounded/injective into that representation.

So "make the fingerprint smaller" is not one implementation choice. It is a policy/semantics choice.

## Modes worth keeping distinct

### A. `exact-inline` — current v0 semantics

Retain the canonical full command identity material in `appliedCommands`.

Properties:

- exact duplicate detection;
- exact conflicting-ID detection;
- no external archive required;
- synchronous local comparison;
- memory/checkpoint size can grow with historical payload size.

This is the current partial-compaction/replay-checkpoint behavior and should not be silently rewritten.

### B. `epoch-retired` — already proven by Proof 017/019/021

At a trusted full checkpoint, absorb all prior effects into state, retire historical command IDs, and move future proposals into a new epoch-qualified namespace.

Properties:

- strongest bound on old identity memory;
- no need to remember retired command payloads/fingerprints;
- old-epoch proposals reject rather than being compared forever;
- requires a trusted full-state checkpoint/epoch transition;
- changes lifetime ID semantics intentionally.

This is already the clean answer when a product can safely retire an entire history prefix.

### C. `digest-index` — bounded practical identity

Replace historical full command strings with a versioned digest such as:

```text
sha256-v0:<digest>
```

Properties:

- fixed-size identity evidence per historical command;
- duplicate/conflict decisions become dependent on collision resistance rather than mathematical exactness;
- still O(number of retained historical IDs);
- digest version/canonicalization must be explicit;
- Node and browser must produce identical bytes/digest;
- changing digest/canonicalization later needs migration semantics;
- a digest is integrity/identity evidence, not authentication/signature.

This can be a useful practical mode, but must never be described as collision-free exact identity.

### D. `external-witness` — compact local state, historical proof on demand

Keep a small authenticated commitment/root locally and move detailed old identity evidence into an archive/witness service or package.

On an old-ID retry, require a proof/witness before deciding duplicate vs conflict. If the witness is unavailable or invalid, fail closed rather than accepting the command as new.

Properties:

- much smaller hot checkpoint state;
- shifts historical storage/dependency elsewhere rather than eliminating it;
- requires a proof format / authenticated dictionary design;
- availability policy becomes part of behavior;
- cryptographic commitment assumptions remain explicit.

This is a materially different architecture and should not be smuggled into the current sequencer.

### E. `bounded-domain` — product contract supplies compact exact identity

A product may define a command domain where the complete identity-relevant tuple is itself small and bounded.

Example shape:

```text
{ type, objectId, operationCode, boundedValue }
```

If the product contract proves that this tuple completely determines command semantics, retaining that tuple can remain exact without storing an unrelated large payload.

Properties:

- can preserve exactness;
- product/domain-specific rather than universal;
- requires explicit canonical identity contract;
- unsafe if omitted payload fields can change effects.

Global State must not guess which payload fields are semantically irrelevant.

## What not to do

Do not silently replace current canonical strings with FNV-32 or another small checksum merely because the repository already uses FNV checksums for deterministic proof evidence.

Those existing FNV values are test/integrity evidence, not a suitable basis for silently downgrading lifetime command-conflict semantics.

Do not claim SHA-256 or another cryptographic digest is mathematically collision-free.

Do not delete old identity evidence while still promising lifetime duplicate/conflict behavior.

Do not make a remote archive mandatory for ordinary state reconstruction unless the architecture explicitly chooses that dependency.

Do not mix full-epoch retirement and partial-compaction semantics. They solve different continuity states.

## Recommended next proof

Do **not** change the Temporal State Kernel yet.

First prove one provider-neutral, versioned command-identity digest contract in isolation:

```text
canonical command
      |
      v
canonical identity bytes v0
      |
      v
SHA-256 digest
      |
      +--> Node
      +--> Chromium
            |
            v
     identical digest
```

Required evidence:

1. identical canonical bytes and SHA-256 digest in Node and real Chromium;
2. object key insertion order does not change identity;
3. semantically represented command-field change changes the digest in the test fixture;
4. payload-heavy command identity becomes fixed-size;
5. representation is explicitly tagged/versioned;
6. invalid/unsupported identity versions fail closed;
7. no authentication/signature claim;
8. no collision-free/exact-equivalence claim;
9. current `exact-inline` kernel behavior remains unchanged.

Only after that proof should we review whether an **opt-in** digest-backed historical identity mode belongs in Temporal State, checkpoint state, or a separate identity layer.

## Likely integration choices after the isolated proof

### Option 1 — keep kernel exact, compact only checkpoint transport

The live kernel keeps exact-inline strings. A checkpoint transport may carry digest identity evidence, but rehydration would need enough trusted material/proof to restore exact live semantics.

This does not automatically solve local memory growth.

### Option 2 — add a versioned identity-mode contract to Temporal State

State explicitly records which identity mode applies:

```text
exact-inline-v0
sha256-v0
```

Validation/apply paths understand both modes during migration.

This is the most direct memory reduction, but it intentionally changes the guarantee of the digest-backed mode from exact arbitrary equality to collision-resistant practical identity.

### Option 3 — prefer epoch retirement for strong bounds

Products that can create trusted full checkpoints may keep partial compaction conservative and periodically retire identity via full epoch transition.

This preserves exact semantics inside an epoch and bounds lifetime growth without introducing a digest-mode semantic downgrade.

This may remain the best default even if digest mode is later available.

## Research conclusion

The scaling problem is real, but it is no longer "how do we compress a JSON string?"

It is:

> What historical command-identity guarantee does a product need, and what retained evidence/dependency is it willing to pay for that guarantee?

Current AXM proofs already provide two honest ends of the spectrum:

- exact historical identity with retained material;
- full epoch retirement with bounded old identity memory.

A digest-backed middle ground is plausible and useful, but it must be introduced as a new explicit contract, not as an invisible optimization.
