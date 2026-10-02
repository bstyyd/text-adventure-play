#!/usr/bin/env bash
set -euo pipefail
release="$1"
[[ "$release" =~ ^[a-f0-9]{40}$ ]] || { echo "Invalid commit"; exit 1; }
root=/srv/fiction
[[ -f /etc/fiction.env ]] || { echo "Missing protected server environment"; exit 1; }
mkdir -p "$root/incoming" "$root/releases"
archive="$root/incoming/$release.tgz"
[[ ! -e "$archive" ]] || { echo "Release already received; use rollback or a new commit"; exit 1; }
cat > "$archive"
python3 - "$archive" <<'PY'
import sys, tarfile, pathlib
with tarfile.open(sys.argv[1]) as archive:
    for member in archive:
        p = pathlib.PurePosixPath(member.name)
        if p.is_absolute() or '..' in p.parts or not (member.isfile() or member.isdir()):
            raise SystemExit('Unsafe source archive')
PY
source="$root/releases/$release"
mkdir "$source"
tar -xzf "$archive" -C "$source"
docker build -t "fiction:$release" "$source"
previous=''
old=''
if docker container inspect fiction >/dev/null 2>&1; then
  previous="$(docker inspect -f '{{.Config.Image}}' fiction)"
  [[ "$previous" =~ ^fiction:[a-f0-9]{40}$ ]] || { echo "Unexpected existing container; refusing replacement"; exit 1; }
  docker exec fiction node -e 'fetch("http://127.0.0.1:3000/api/ops/drain",{method:"POST",headers:{host:new URL(process.env.APP_ORIGINS.split(",")[0]).host,authorization:"Bearer "+process.env.APP_DEPLOY_TOKEN}}).then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))'
  idle=false
  for attempt in $(seq 1 120); do
    if docker exec fiction node -e 'fetch("http://127.0.0.1:3000/api/ops/status",{headers:{host:new URL(process.env.APP_ORIGINS.split(",")[0]).host,authorization:"Bearer "+process.env.APP_DEPLOY_TOKEN}}).then(async r=>process.exit(r.ok&&(await r.json()).activeJobs===0?0:1)).catch(()=>process.exit(1))'; then idle=true; break; fi
    sleep 5
  done
  if [[ "$idle" != true ]]; then
    docker exec fiction node -e 'fetch("http://127.0.0.1:3000/api/ops/resume",{method:"POST",headers:{host:new URL(process.env.APP_ORIGINS.split(",")[0]).host,authorization:"Bearer "+process.env.APP_DEPLOY_TOKEN}})'
    echo "Generation still active; deployment cancelled"; exit 1
  fi
  if ! docker exec fiction node scripts/site-backup.mjs; then
    docker exec fiction node -e 'fetch("http://127.0.0.1:3000/api/ops/resume",{method:"POST",headers:{host:new URL(process.env.APP_ORIGINS.split(",")[0]).host,authorization:"Bearer "+process.env.APP_DEPLOY_TOKEN}})'
    echo "Backup failed; existing service resumed"; exit 1
  fi
  docker stop --time 30 fiction
  old="fiction-previous-$release"
  docker rename fiction "$old"
fi
restore_previous() {
  if docker container inspect fiction >/dev/null 2>&1; then
    docker stop --time 30 fiction || true
    docker rename fiction "fiction-failed-$release" || true
  fi
  if [[ -n "$old" ]]; then docker rename "$old" fiction; docker start fiction; fi
}
# Separate Compose projects prevent it from adopting or deleting the renamed
# previous container, which must remain available for health-check rollback.
if ! GAME_IMAGE="fiction:$release" docker compose --project-name "fiction-$release" -f "$source/deploy/compose.yml" up -d; then
  restore_previous
  echo "New container failed to start; previous container restored"; exit 1
fi
healthy=false
for attempt in $(seq 1 90); do
  if [[ "$(docker inspect -f '{{.State.Health.Status}}' fiction 2>/dev/null || true)" == healthy ]]; then healthy=true; break; fi
  sleep 2
done
if [[ "$healthy" != true ]]; then
  restore_previous
  echo "New release failed health check; previous container restored. Database untouched."
  exit 1
fi
printf '%s\n' "fiction:$release" > "$root/current-image"
printf '%s\n' "$previous" > "$root/previous-image"
echo "Release healthy: $release"
