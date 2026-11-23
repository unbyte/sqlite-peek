CREATE TABLE events (
  id INTEGER PRIMARY KEY,
  sensor INTEGER,
  observed_at INTEGER,
  reading REAL,
  label TEXT,
  note TEXT
);
WITH RECURSIVE seq(i) AS (VALUES(1) UNION ALL SELECT i+1 FROM seq WHERE i < 40000)
INSERT INTO events
  SELECT i, i%128, 1700000000000+i*1000, i/17.0,
         printf('Station 北-%03d', i%128),
         CASE WHEN i%4!=0 THEN printf('Observation %06d from the afternoon analysis run', i) END
    FROM seq;

CREATE TABLE samples (payload BLOB, event_id INTEGER PRIMARY KEY) WITHOUT ROWID;
INSERT INTO samples SELECT zeroblob(8192), id FROM events WHERE id%1000=0;
