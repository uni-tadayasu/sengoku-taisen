CREATE TABLE promotion_daily (
  day text NOT NULL CHECK(length(day)=10 AND day GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  source text NOT NULL CHECK(source IN ('direct','x','line','youtube','press','friend','discord','copy_link','share_text','native_share','english','other')),
  event text NOT NULL CHECK(event IN ('landing','play_click')),
  count integer NOT NULL DEFAULT 0 CHECK(count>=0),
  PRIMARY KEY(day,source,event)
) WITHOUT ROWID;
