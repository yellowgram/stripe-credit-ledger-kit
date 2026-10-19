# Checksums (historical releases)

Digests of the GitHub Release zips for tags before 0.3.0. Those zips were published under the previous license and are kept as shipped. Do not reseal them. 0.3.0 and later are MIT and are not shipped as zips.

Verify a **downloaded zip**, not a folder you zipped yourself and not `git archive` of a later commit. The copy of this file inside each zip does not contain that zip's own hex line (a digest stored in the packed bytes would not match the zip); the GitHub Release notes for each tag carry it too.

## 0.2.0

| | |
|---|---|
| Asset | `stripe-credit-ledger-kit-0.2.0.zip` |
| Tag | `v0.2.0` |
| Commit | `ed435e2` |
| SHA-256 | `2e6d6088f93a79c7b141982cb0c06e26eeb6ad28af5cc4135532a30677b734c5` |
| License | Previous license (pre-MIT). |

This digest is the GitHub Release asset for tag `v0.2.0` (commit `ed435e2`), also printed in those Release notes. The copy of this file inside the 0.2.0 zip does not contain this hex line. This section points at the Release notes, because a digest stored in the packed bytes would not match the zip. Verify the downloaded file:

```bash
sha256sum stripe-credit-ledger-kit-0.2.0.zip
```

The asset is `git archive` of tag `v0.2.0` with prefix `stripe-credit-ledger-kit-0.2.0/`. It omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`. The omitted paths are untracked or gitignored, so the archive leaves them out. `.env.example` is tracked and is included.

## 0.1.2

| | |
|---|---|
| Asset | `stripe-credit-ledger-kit-0.1.2.zip` |
| Tag | `v0.1.2` |
| Commit | `593a2d1` |
| SHA-256 | `b63b1c834646030c0e201db9a0b2240cb1b8ac547fb1fb610794431491955832` |
| License | Previous license (pre-MIT). |

This digest is the GitHub Release asset for tag `v0.1.2` (commit `593a2d1`), also printed in those Release notes. Do not reseal it. The copy of this file inside that zip does not contain this hex line. It points at the Release notes, because a digest stored in the packed bytes would not match the zip. Verify the downloaded file:

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

The asset is `git archive` of tag `v0.1.1` with prefix `stripe-credit-ledger-kit-0.1.1/`. It omits `node_modules`, secret env files (`.env`, `.env.local`), SQLite databases, and `.git`. It includes `.env.example`. The omitted paths are untracked or gitignored, so the archive leaves them out. `.env.example` is tracked and is included.
