# Git hooks

`.git/hooks/` is not version controlled and is not copied by `git clone`, so the
hook that keeps the homepage stat tiles honest existed in exactly one place: the
working copy on n5claude. If that container were lost, so was the hook — and its
failure mode is silent, which is the whole reason it was rewritten in the first
place. The tracked copy here is the source of truth; `.git/hooks/pre-commit` is
the installed copy.

## Install (per clone)

    ln -sf ../../scripts/hooks/pre-commit .git/hooks/pre-commit

A symlink rather than a copy, so editing the tracked file updates the installed
hook and the two cannot drift.

## What pre-commit does

Reads the live container counts from n5ubuntu over ssh (override the host with
`N5_DOCKER_HOST`), rewrites the `data-stat` tiles in the pages that carry them,
and stages those files so the numbers ship with the commit.

It **aborts the commit** if ssh fails, the daemon is unreachable, or any count
comes back non-numeric or zero. A zero is treated as a broken query rather than
a real count, because publishing a zeroed dashboard is worse than publishing
nothing. Bypass deliberately with `SKIP_STAT_HOOK=1 git commit …`.
