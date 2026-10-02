CREATE TABLE IF NOT EXISTS scenario_packages (package_id TEXT NOT NULL,version TEXT NOT NULL,hash TEXT NOT NULL,payload TEXT NOT NULL,built_in INTEGER NOT NULL,installed_at TEXT NOT NULL,PRIMARY KEY(package_id,version));
CREATE TABLE IF NOT EXISTS scenario_snapshots (hash TEXT PRIMARY KEY,package_id TEXT NOT NULL,version TEXT NOT NULL,payload TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scenario_previews (id TEXT PRIMARY KEY,hash TEXT NOT NULL,payload TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS character_stats (turn_id TEXT NOT NULL REFERENCES turns(id),character_id TEXT NOT NULL,stat_key TEXT NOT NULL,value REAL NOT NULL,PRIMARY KEY(turn_id,character_id,stat_key));
CREATE TABLE IF NOT EXISTS world_stats (turn_id TEXT NOT NULL REFERENCES turns(id),stat_key TEXT NOT NULL,value REAL NOT NULL,PRIMARY KEY(turn_id,stat_key));
PRAGMA user_version=3;
