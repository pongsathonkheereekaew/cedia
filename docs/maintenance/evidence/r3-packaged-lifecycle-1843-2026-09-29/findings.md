# Packaged lifecycle re-proof on the 18.4.3 build (2026-09-29)

## Result

`bun run smoke:lifecycle-packaged` green against a scratch-staged copy of the
fresh 18.4.3-build `Cedia.app` (`CEDIA_LIFECYCLE_APP_PATH` under the system temp
dir, `/var/...` literal prefix so the proof's `resolve(tmpdir())` prefix check
passes — `/tmp`/`$REAL_TMP` forms fail it on this Mac's `/var→/private/var`
symlink). `dist/packaged-lifecycle-proof/result.json`: `ok: true`, 3 boots,
graceful SIGTERM teardown with zero surviving scratch-owned processes, SIGKILL
crash → relaunch adoption, `errors: []`, screenshots `boot-1/2/3.png`.

Login Item behavior stays simulated: the scratch-only shim intercepted the
setter calls (`intercept-set-login-item`) and reported `simulated-login-state`
packaged/non-login. Not a real login cycle — unchanged.

## Scope note

Single-client lifecycle (boot/quit/relaunch/crash-adoption) is the D row;
it is green on the new pin. Paired-client repeats are a W/N row per plan
§11.1 and stay open (external prerequisites: second device / tailnet).
