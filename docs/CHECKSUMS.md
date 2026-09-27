# Checksums

Verify a **downloaded GitHub Release zip**, not a folder you zipped yourself and not `git archive` of a later commit.

Compare the hex digest to the GitHub Release notes for that tag. Polar buyers should also see the same digest in the delivery note once the maintainer pastes it. This file ships inside the zip, so the digest of that zip is not embedded in the packed copy (the bytes would no longer match). The Release notes are the published digest.

**0.1.2** is the license fence in this tree. It has no git tag and no Release zip. Do not invent a digest for it. `v0.1.0` and `v0.1.1` below are grandfathered. Do not reseal them.

## 0.1.2

| | |
|---|---|
| Asset | none |
| Tag | none |
| SHA-256 | none |

`package.json` is 0.1.2. Tag `v0.1.2` and `stripe-credit-ledger-kit-0.1.2.zip` are created only after the license fence lands. This section gains a digest when that zip exists.

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
