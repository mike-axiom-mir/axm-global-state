# CI Consolidation v0

Date: 2026-09-15
Status: maintenance-only candidate

## Goal

Reduce redundant GitHub Actions work without changing any Global State semantics, proof contracts, or truth boundaries.

## Before

The repository accumulated 15 separate proof workflows. A single PR head could therefore fan out into many overlapping jobs that repeatedly:

- installed the same Node dependencies;
- installed Chromium multiple times;
- reran the same deterministic dependency proofs;
- occupied runner capacity while newer commits were already available.

This made multi-chat coordination slower and increased the chance that stale green runs were mistaken for evidence on a newer head.

## After

One workflow, `.github/workflows/global-state-regression.yml`, becomes the regression gate for pull requests and main.

It:

- uses one concurrency group per pull request/ref;
- cancels stale in-progress runs when a newer commit arrives on the same lane;
- installs Node dependencies once;
- runs deterministic/time-contract and durable-history proofs before browser setup, so cheap failures stop early;
- installs Chromium once;
- runs the browser, transport, reconnect, restart, cold-resume, and cold-time proofs against the same exact head.

The existing `package.json` test scripts remain authoritative. This maintenance change does not rewrite or weaken any proof.

## Historical evidence

Deleting the old workflow YAML files does not delete historical Actions runs or the Action Reports that cite them. Those runs remain evidence for the commits they tested.

## Truth boundary

This is CI orchestration only. It does not change:

- Temporal State Kernel semantics;
- mutation agreement;
- durable accepted-history behavior;
- browser continuity;
- logical-time evidence, admission, corroboration, or interval semantics;
- any claim from Proofs 001–016.

The consolidated workflow itself must pass the complete retained regression suite before this maintenance change is integrated.
