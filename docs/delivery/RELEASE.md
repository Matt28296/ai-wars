# Release

**There is no release and no deploy without Matthew's word** (D-003: no public deploy or visibility change without his yes; $0). This file is the procedure for when there is one.

1. **Freeze:** a named commit on `main`, `checks` green on it, every requirement the release claims at `verified` in `REQUIREMENTS.md` with its `VERIFICATION-LOG.md` entry.
2. **Database:** any migration ships in its own PR and runs as a named step against a backup, never as a side effect of a build (builds run with `DATABASE_URL` unset).
3. **Publish** to the target Matthew names (private by default).
4. **Measure the live copy:** `/api/version` returns the frozen sha; the browser smoke tests pass against the live URL. A push is not a deploy, and a green build is not a live check.
5. **Record:** add the release to `RELEASES.md` with the sha, date, what was verified live, and what was not.
