# Checksums

Verify a **downloaded GitHub Release zip**, not a folder you zipped yourself and not `git archive` of a later commit.

Compare the hex digest to the GitHub Release notes for that tag. Polar buyers should also see the same digest in the delivery note once the maintainer pastes it. This file ships inside the zip, so the digest of that zip is not embedded in the packed copy (the bytes would no longer match). The Release notes are the published digest.

`v0.1.0` and `v0.1.1` below are grandfathered. Do not reseal them.

## 0.1.2

| | |
|---|---|
| Asset | `stripe-credit-ledger-kit-0.1.2.zip` |
| Tag | `v0.1.2` |
| SHA-256 | `401ed1a0f5c12c9a9c545bb4abaa8678a2087fc6897f347c0d2cd258def6796f` |

This digest is the GitHub Release asset for tag `v0.1.2` (commit `350f65e` (orphan tip)), also printed in those Release notes. The copy of this file inside that zip does not contain this hex line. It points at the Release notes, because a digest stored in the packed bytes would not match the zip. Verify the downloaded file:

```bash
sha256sum stripe-credit-ledger-kit-0.1.2.zip
```

The asset is `git archive` of tag `v0.1.2` with prefix `stripe-credit-ledger-kit-0.1.2/`. It omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`. The omitted paths are untracked or gitignored, so the archive leaves them out. `.env.example` is tracked and is included.

## 0.1.0

| | |
|---|---|
| Asset | `stripe-credit-ledger-kit-0.1.0.zip` |
| Tag | `v0.1.0` |
| SHA-256 | `aa558100add2a3585190656ab1eb4b217cda6fafe596eaafe0dd02f9a9a33d94` |

Recomputed from the GitHub Release asset. It matches that digest.

## 0.1.1

| | |
|---|---|
| Asset | `stripe-credit-ledger-kit-0.1.1.zip` |
| Tag | `v0.1.1` |
| SHA-256 | `a9bc28d82f673afc0eafbd1c3ad20c3047e95c7eb71ad70dd96f4b88473d41a8` |

This digest is the GitHub Release asset for tag `v0.1.1` (commit `c633584`), also printed in those Release notes. It replaces any earlier 0.1.1 digest. The copy of this file inside that zip does not contain this hex line. It points at the Release notes, because a digest stored in the packed bytes would not match the zip. Verify the downloaded file:

```bash
sha256sum stripe-credit-ledger-kit-0.1.1.zip
```

The asset is `git archive` of tag `v0.1.1` with prefix `stripe-credit-ledger-kit-0.1.1/`. It omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`. The omitted paths are untracked or gitignored, so the archive leaves them out. `.env.example` is tracked and is included. The maintainer pastes this same digest into the Polar delivery note.
