# Repo cleanup (audit finding M5)

Claude has no delete access to files on your machine, so this is a script for
you to run yourself in `C:\card-blocker` (PowerShell). It does two different
things to two different kinds of clutter, on purpose:

1. **Scratch/log files → deleted outright.** These are dev-server console
   dumps and manual QA run logs. Nothing reads them, nothing links to them,
   and the new `.gitignore` entries (delivered alongside this file) stop new
   ones from creeping back in. Two of them
   (`CUserszxis...scratchpad...server*.log`) have a Windows profile path
   flattened into the filename itself - that's the kind of thing worth
   getting off disk and out of git history, not just ignoring going forward.

2. **Overlapping status/deployment docs → moved to `_archive_pre_launch_docs\`,
   not deleted.** There are ~30 of these: multiple Razorpay setup guides that
   cover the same integration, several "deployment complete" / "deployment
   checklist" documents from different points in the project, etc. Claude
   hasn't read every one end-to-end to confirm none of them still has a
   unique fact worth keeping, so this moves them out of the way (via `git mv`,
   so git history follows them) rather than deleting - you can review
   `_archive_pre_launch_docs\` at your leisure and delete anything you
   confirm is redundant.

   Three specific reports are **not** in this list -
   `QA_AUDIT_FINAL_REPORT_20260811.md`, `PRODUCTION_AUDIT_REPORT.md`, and
   `DEPLOYMENT_CHECKLIST.md` - because those are the ones the real pre-launch
   audit found to be misleading (they gave the app a clean bill of health
   right before the audit found the 5 Critical / 5 High / 6 Medium issues
   fixed across the last three rounds). Those three get a correction banner
   added at the top instead of being moved, so anyone who opens them still
   sees them but immediately knows not to trust them as a launch gate.

## Run this in PowerShell, from `C:\card-blocker`

```powershell
# 1. Delete scratch/log files outright
$logFiles = @(
  "app-test.log",
  "direct-server.log",
  "fresh-server.log",
  "fresh-test.log",
  "fresh.log",
  "qa_results_20260811_223849.log",
  "qa_results_20260811_223924.log",
  "qa_results_20260811_223931.log",
  "server-foreground.log",
  "server-output.txt",
  "test-both.log",
  "test.log",
  "CUserszxisAppDataLocalTempclaudeC--card-blockerf5a30253-06b1-494d-a56a-82cf7c349503scratchpadserver_fixed.log",
  "CUserszxisAppDataLocalTempclaudeC--card-blockerf5a30253-06b1-494d-a56a-82cf7c349503scratchpadserver.log"
)
foreach ($f in $logFiles) {
  if (Test-Path $f) {
    # If it's tracked in git, untrack it too (git rm --cached is a no-op,
    # not an error, if the file was never committed).
    git rm --cached --ignore-unmatch -- "$f" | Out-Null
    Remove-Item -Force -- "$f"
    Write-Host "Deleted: $f"
  }
}

# 2. Archive overlapping status/deployment docs (git mv preserves history)
New-Item -ItemType Directory -Force -Path "_archive_pre_launch_docs" | Out-Null
$archiveFiles = @(
  "BUG_FIX_REPORT.md",
  "BUG_FIX_SUMMARY.txt",
  "CREATE_TABLE_MANUAL.md",
  "DEPLOYMENT_COMPLETE_GUIDE.md",
  "DEPLOYMENT-COMPLETE.md",
  "DEPLOYMENT-VERIFICATION.md",
  "EMAIL-SETUP.md",
  "FINAL_DEPLOY.bat",
  "PRODUCTION_LAUNCH_SUMMARY.txt",
  "QA_RETEST_SUITE.md",
  "QA-TEST-CASES.md",
  "QUICK_SUMMARY.md",
  "RAZORPAY-DEPLOYMENT-CHECKLIST.md",
  "RAZORPAY-FIX-SUMMARY.md",
  "RAZORPAY-INTEGRATION-SUMMARY.md",
  "RAZORPAY-QUICK-START.md",
  "RAZORPAY-SETUP.md",
  "RAZORPAY-TROUBLESHOOT.md",
  "razorpay-example.html",
  "razorpay_table.sql",
  "README-DEPLOY.txt",
  "run_all_tests.sh",
  "TEST_REPORT.html",
  "TEST_SUMMARY.md",
  "TWILIO-SETUP.md",
  "test_card_persistence_fix.js",
  "test_card_relogin_flow.js",
  "create-email-tables.js",
  "create-razorpay-table.js",
  "create-table-direct.js",
  "regenerate-html.js"
)
foreach ($f in $archiveFiles) {
  if (Test-Path $f) {
    git mv -- "$f" "_archive_pre_launch_docs/$f" 2>$null
    if ($LASTEXITCODE -ne 0) { Move-Item -Force -- "$f" "_archive_pre_launch_docs/$f" }
    Write-Host "Archived: $f"
  }
}

Write-Host ""
Write-Host "Done. Review _archive_pre_launch_docs\, then:"
Write-Host "  git add -A"
Write-Host "  git commit -m 'Clean up scratch logs and archive superseded status docs (audit M5)'"
```

If any filename above doesn't match exactly what's on disk (spacing, case),
the `Test-Path` check just skips it silently - nothing errors out.
