# Checksums

Verify a **downloaded zip**, not a folder you zipped yourself and not `git archive` of a later commit.

The zip Polar sells now is **0.2.0**. Compare `sha256sum` of that file to the digest in the 0.2.0 section and to the GitHub Release notes for tag `v0.2.0`. `v0.1.2` is the prior sold file, withdrawn from the shelf. Anyone who already bought that zip keeps the rights for it. Do not reseal it. It is not the current Polar file. `v0.1.0` and `v0.1.1` further down are grandfathered history. Do not reseal them. They are not the current Polar file.

This file also ships inside the 0.2.0 zip. The packed copy does not contain the 0.2.0 hex line (those bytes would no longer match). This file points at the GitHub Release notes for tag `v0.2.0`, because a digest stored in the packed bytes would not match the zip. Do not recompute the 0.2.0 digest from a commit after `ed435e2`. The 0.1.2 zip follows the same rule. Its packed copy does not contain the 0.1.2 hex line. It points at the GitHub Release notes for tag `v0.1.2`. Do not recompute the 0.1.2 digest from a commit after `593a2d1`.

## 0.2.0 (current Polar file)

| | |
|---|---|
| Asset | `stripe-credit-ledger-kit-0.2.0.zip` |
| Tag | `v0.2.0` |
| Commit | `ed435e2` |
| SHA-256 | `2e6d6088f93a79c7b141982cb0c06e26eeb6ad28af5cc4135532a30677b734c5` |
| License | PolyForm Noncommercial 1.0.0 + Suthirth Commercial Grant. The public license is not MIT. |

This digest is the GitHub Release asset for tag `v0.2.0` (commit `ed435e2`), also printed in those Release notes. Polar delivers this file. The copy of this file inside the 0.2.0 zip does not contain this hex line. This section points at the Release notes, because a digest stored in the packed bytes would not match the zip. Verify the downloaded file:

```bash
sha256sum stripe-credit-ledger-kit-0.2.0.zip
```

The asset is `git archive` of tag `v0.2.0` with prefix `stripe-credit-ledger-kit-0.2.0/`. It omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`. The omitted paths are untracked or gitignored, so the archive leaves them out. `.env.example` is tracked and is included.

## 0.1.2 (prior sold file; withdrawn from the shelf)

| | |
|---|---|
| Asset | `stripe-credit-ledger-kit-0.1.2.zip` |
| Tag | `v0.1.2` |
| Commit | `593a2d1` |
| SHA-256 | `b63b1c834646030c0e201db9a0b2240cb1b8ac547fb1fb610794431491955832` |
| License | PolyForm Noncommercial 1.0.0 + Suthirth Commercial Grant. The public license is not MIT. |

This digest is the GitHub Release asset for tag `v0.1.2` (commit `593a2d1`), also printed in those Release notes. Polar no longer sells this file. Anyone who already bought it keeps the rights for that zip. Do not reseal it. It is not the current Polar file. The copy of this file inside that zip does not contain this hex line. It points at the Release notes, because a digest stored in the packed bytes would not match the zip. Verify the downloaded file:

```bash
sha256sum stripe-credit-ledger-kit-0.1.2.zip
```

The asset is `git archive` of tag `v0.1.2` with prefix `stripe-credit-ledger-kit-0.1.2/`. It omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`. The omitted paths are untracked or gitignored, so the archive leaves them out. `.env.example` is tracked and is included.

## 0.1.0 (grandfathered)

| | |
|---|---|
| Asset | `stripe-credit-ledger-kit-0.1.0.zip` |
| Tag | `v0.1.0` |
| SHA-256 | `aa558100add2a3585190656ab1eb4b217cda6fafe596eaafe0dd02f9a9a33d94` |

Recomputed from the GitHub Release asset. It matches that digest.

## 0.1.1 (grandfathered)

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
