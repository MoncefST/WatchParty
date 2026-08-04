CREATE TABLE IF NOT EXISTS rooms (
  code TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  host_name TEXT,
  host_picture TEXT,
  guest_name TEXT,
  guest_picture TEXT
);

CREATE TABLE IF NOT EXISTS room_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  room_code TEXT NOT NULL,
  participant_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS room_events_room_id ON room_events (room_code, id);
