-- Original PDF extractions remain in text_segments. Reviewed reading text is separate.
CREATE TABLE text_reviews (
  document_id TEXT PRIMARY KEY REFERENCES documents(id),
  source_sha256 TEXT,
  raw_json TEXT NOT NULL CHECK(json_valid(raw_json)),
  cleaned_json TEXT NOT NULL CHECK(json_valid(cleaned_json)),
  revision INTEGER NOT NULL DEFAULT 1,
  reviewed_at TEXT NOT NULL,
  reviewed_by TEXT NOT NULL
);
CREATE TABLE text_review_history (
  document_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  source_sha256 TEXT,
  raw_json TEXT NOT NULL,
  cleaned_json TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  reviewed_by TEXT NOT NULL,
  PRIMARY KEY(document_id,revision)
);
CREATE TRIGGER preserve_text_review BEFORE UPDATE ON text_reviews BEGIN
  SELECT CASE WHEN NEW.revision != OLD.revision+1 THEN RAISE(ABORT,'Review revision conflict') END;
  INSERT INTO text_review_history VALUES(OLD.document_id,OLD.revision,OLD.source_sha256,OLD.raw_json,OLD.cleaned_json,OLD.reviewed_at,OLD.reviewed_by);
END;
CREATE VIEW text_review_status AS
SELECT e.document_id,
  (e.source_sha256 IS d.sha256 AND e.raw_json=(
    SELECT json_group_array(json_object('ordinal',ordinal,'locator',locator,'content',content))
    FROM (SELECT ordinal,locator,content FROM text_segments WHERE document_id=e.document_id ORDER BY ordinal)
  )) AS valid
FROM text_reviews e JOIN documents d ON d.id=e.document_id;
CREATE VIEW search_text_segments AS
SELECT t.document_id,t.ordinal,t.locator,t.content FROM text_segments t
WHERE NOT EXISTS(SELECT 1 FROM text_reviews e WHERE e.document_id=t.document_id)
UNION ALL
SELECT e.document_id,json_extract(j.value,'$.ordinal'),json_extract(j.value,'$.locator'),json_extract(j.value,'$.content')
FROM text_reviews e JOIN text_review_status s ON s.document_id=e.document_id AND s.valid=1, json_each(e.cleaned_json) j;
