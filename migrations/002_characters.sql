CREATE TABLE characters (save_id TEXT NOT NULL REFERENCES saves(id), id TEXT NOT NULL, turn_id TEXT NOT NULL REFERENCES turns(id), payload TEXT NOT NULL, PRIMARY KEY(save_id,id));
CREATE TABLE character_events (id TEXT PRIMARY KEY, save_id TEXT NOT NULL REFERENCES saves(id), turn_id TEXT NOT NULL REFERENCES turns(id), character_id TEXT NOT NULL, payload TEXT NOT NULL);
CREATE INDEX character_events_turn ON character_events(turn_id);
CREATE INDEX character_events_person ON character_events(save_id,character_id);
CREATE TABLE character_corrections (id TEXT PRIMARY KEY, save_id TEXT NOT NULL REFERENCES saves(id), turn_id TEXT NOT NULL REFERENCES turns(id), payload TEXT NOT NULL);
PRAGMA user_version=2;
