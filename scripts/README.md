# scripts/: Python helpers

| File | What it does |
|:---|:---|
| `launch.py` | **Main script.** Starts the whole NovelHub project with Docker, adds sample data and checks that everything works. |
| `writer.py` | Old helper: decodes base64 from stdin and writes it to a file (`python writer.py <path>`). Not needed to run the project. |
| `update_backend.py`, `update_all_backend.py` | Old Windows helpers that only print a hard-coded `C:\Users\...` path. They do nothing useful. |

The rest of this guide is about `launch.py`.

---

## 1. Requirements

- **Docker** with the **docker compose** plugin (`docker compose version` must work)
- **Python 3.8+** (no extra packages to install, it only uses the standard library)
- The computer clock is correct (synced automatically). A clock that is behind breaks the Docker build, see section 6
- Your user can run Docker without `sudo` (you are in the `docker` group)
- These ports are free: **3000** (website), 5000 (API), 5432 (Postgres), 9201 (search), 15673 (RabbitMQ UI)

## 2. Start the project

Run from the project root (the folder containing `docker-compose.yml`):

```bash
python scripts/launch.py
```

> **Linux/macOS:** if `python` is not found, type `python3` instead in every command of this guide.
>
> **Windows:** use `python` (or `py`), never `python3`. `\` and `/` both work in the path:
>
> ```powershell
> cd C:\path\to\nmv          # the project root, NOT the scripts folder
> python scripts\launch.py
> ```
>
> On Windows, `python3` usually opens the Microsoft Store stub and prints
> `Python was not found; run without arguments to install from the Microsoft Store`.
> Either use `python`/`py`, or turn off the **python.exe** and **python3.exe** entries in
> *Settings → Apps → Advanced app settings → App execution aliases*.
> If you are already inside `scripts\`, run `python launch.py` (not `scripts/launch.py`).
>
> Docker Desktop must be running before you start the script.

This one command:

1. **Creates `.env`** from `.env.example` the first time, with a random `JWT_SECRET` and `RABBITMQ_PASSWORD`. If `.env` already exists, it is kept.
2. **Builds and starts** all 7 containers: `gateway`, `frontend`, `backend`, `worker`, `postgres`, `search`, `rabbitmq`. The first build takes a few minutes.
3. **Applies the SQL migrations** in `sql/migrations/`. They are safe to run many times.
4. **Seeds sample data** (runs every time by default, see section 4).
5. **Checks** that everything works and prints `[OK]`, `[WARN]` or `[FAIL]` for each check.

When it finishes you should see:

```
All checks passed. NovelHub is running at http://localhost:3000
```

Open **http://localhost:3000** and log in with **`admin` / `password123`**.

## 3. All commands

| Command | What it does |
|:---|:---|
| `python scripts/launch.py` | Build, start, seed, check (same as `up`) |
| `python scripts/launch.py --no-build` | Same, but reuse the images already built (faster) |
| `python scripts/launch.py --no-seed` | Same, but **do not** run the seeders |
| `python scripts/launch.py check` | Only run the checks on a stack that is already running (no seeding) |
| `python scripts/launch.py status` | Show the containers and their state |
| `python scripts/launch.py logs` | Follow the logs of all containers (Ctrl+C to exit) |
| `python scripts/launch.py logs backend` | Follow the logs of one container (`backend`, `frontend`, `postgres`...) |
| `python scripts/launch.py down` | Stop and remove the containers. **Data is kept** (Docker volumes) |
| `python scripts/launch.py --timeout 900` | Wait longer for slow machines (default 600 seconds) |

The script exits with code `0` if all checks pass and `1` if any fail, so you can use it in other scripts or CI.

## 4. Sample data (seeders)

On every launch the script runs these seeders from `backend/scripts/`, in order:

| Seeder | Result |
|:---|:---|
| `seed-passwords.js` | Sets the password of **every user** to `password123` |
| `seed-stories.ts` | Adds 8 sample stories (Light Novel and Manga) with volumes and chapters |
| `seed-fandom.ts` | Deletes and recreates the sample fandom posts |

Running them again does **not** create duplicate stories. After seeding, the backend is restarted so the search engine indexes the new stories.

> ⚠️ **Use `--no-seed` once real people use the site.** The password seeder resets *every* account (including real users) to `password123`, and the story seeder overwrites edits made to the sample stories.

## 5. What the checks mean

| Check | Meaning if it fails |
|:---|:---|
| `container <name>` | That container stopped or is unhealthy. Look at `logs <name>` |
| `backend GET /api/v1/health` | The API is not answering. `queue=up` means RabbitMQ is connected |
| `database migrations` | A SQL migration failed (the error is printed) |
| `sample data seeded` | A seeder failed (the error is printed) |
| `search GET /_cluster/health` | Elasticsearch is down (search falls back to plain SQL) |
| `gateway GET /` | The website does not load through nginx |
| `api GET /api/v1/stories` | The API cannot read from the database |
| `api POST /api/v1/auth/login` | `admin` / `password123` cannot log in (shown as `[WARN]`) |
| `gateway GET /kham-pha`, `/nhom-dich`, `/fandom` | Those pages do not load (shown as `[WARN]`) |

If a check fails, the script prints the last 30 log lines of every stopped container.

## 6. Common problems

| Problem | Fix |
|:---|:---|
| `docker daemon is not reachable` | Windows/macOS: open **Docker Desktop** and wait until it says *Engine running*. Linux: start Docker (`sudo systemctl start docker`) or add yourself to the group: `sudo usermod -aG docker $USER`, then log out and in |
| `ports already in use: gateway:3000` | Another program uses the port. Stop it, or set another port in `.env` (e.g. `GATEWAY_PORT=3001`) |
| `.env exists but these values are missing/placeholder` | Edit `.env` and set real values, or delete `.env` and run again to generate a new one |
| Code changed but the site did not | Run without `--no-build` so the images are rebuilt |
| `Python was not found; run without arguments to install from the Microsoft Store` (Windows) | Run `python scripts\launch.py` or `py scripts\launch.py` instead of `python3`. See the Windows note in section 2 |
| `can't open file '...\scripts\scripts\launch.py'` | You are inside `scripts\`. `cd ..` to the project root first, or run `python launch.py` |
| Build fails at `RUN apt-get update ... exit code: 100`, and the log shows `Release file ... is not valid yet` | The computer clock is behind. `backend/Dockerfile` already tolerates this, but sync the clock anyway (see below) |

### Fix the clock (Windows + Docker Desktop)

Run **PowerShell as Administrator**:

```powershell
Set-Service w32time -StartupType Automatic
Start-Service w32time
w32tm /resync /force
wsl --shutdown        # restarts the Docker Desktop VM so it picks up the new time
```

Then start Docker Desktop again and rerun `python scripts\launch.py`.
If `w32tm /resync` says "no time data was available", run `w32tm /config /manualpeerlist:time.windows.com /syncfromflags:manual /update` and try again.
Also check *Settings → Time & language → Date & time → Set time automatically* is **On**.

## 7. Start from zero (delete all data)

This **deletes the database, uploaded-image cache and search index**:

```bash
docker compose down -v
python scripts/launch.py
```

## 8. Useful addresses

| Service | Address |
|:---|:---|
| Website | http://localhost:3000 |
| API health | http://127.0.0.1:5000/api/v1/health |
| RabbitMQ admin | http://127.0.0.1:15673 (user `novel`, password = `RABBITMQ_PASSWORD` in `.env`) |
| PostgreSQL | `127.0.0.1:5432`, user `postgres`, database `novel_platform` |

## 9. Before going public

- Launch with `--no-seed` and change or delete the sample accounts (they all use `password123`).
- Change the default Postgres password `postgres`.
- Put HTTPS in front of port 3000 (for example a Cloudflare tunnel).
