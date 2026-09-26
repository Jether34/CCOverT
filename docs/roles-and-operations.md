# Roles and operations

The API stores three roles: `user`, `researcher`, and `admin` (shown as Developer). Signup creates a `user`. An admin can create accounts, change roles, and disable access in the Developer dashboard. Role changes and disabling take effect on the next authenticated request.

| Capability | User | Researcher | Developer |
| --- | --- | --- | --- |
| Predictions, own history, AI reports, personal settings | Yes | Yes | Yes |
| Import SST/tourism data and estimate tourism growth | No | Yes | No |
| Publish, activate, and archive model versions | No | Yes | No |
| Account access, SMTP, announcement, backups, operational activity | No | No | Yes |

Researchers select the citywide SST and annual arrivals datasets in a model configuration version. Saving a version activates it for subsequent predictions by all roles. Existing predictions keep their original parameter and source snapshots. Model versions are immutable. Editing publishes a new version; removal archives an inactive version. The active version must be replaced before it can be archived.

The Researcher dashboard exports an `.xlsx` workbook with SST and Tourism sheets. The selected year interval is prefilled in each sheet. Fill `label`, `provider`, `sourceCitation`, and annual `value` cells before importing. The API reads the `kind` and `year` cells from each sheet, validates every sheet, and imports the completed series. An untouched sheet is skipped. Source values must be SST or citywide tourist arrivals, as appropriate.

The Developer dashboard records the last 200 request and change events in the running API process. It shows account status, non-secret provider settings, and the backup inventory. Activity history is process-local and resets on restart. SMTP credentials saved in the dashboard are encrypted with a key derived from `SESSION_SECRET`; keep that secret stable across restarts and backups. The API does not return stored SMTP passwords.

MongoDB backups are written as gzipped BSON Extended JSON under `BACKUP_DIR` (default `./backups` relative to the API process). They include every collection, including account hashes and encrypted settings. Protect that directory and retain the matching `SESSION_SECRET` for SMTP decryption. Backups are unavailable when `USE_MEMORY_DB=true`; memory data is not durable. The dashboard lists backup files but does not offer an in-app restore operation.
