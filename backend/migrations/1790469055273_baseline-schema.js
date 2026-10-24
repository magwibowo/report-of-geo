exports.up = pgm => {
  pgm.sql('CREATE EXTENSION IF NOT EXISTS postgis');

  pgm.createTable('reports', {
    id: 'id',
    title: { type: 'varchar(150)', notNull: true },
    description: { type: 'text' },
    category: { type: 'varchar(50)', notNull: true },
    status: { type: 'varchar(20)', notNull: true, default: 'pending' },
    photo_url: { type: 'varchar(255)' },
    geom: { type: 'geometry(Point, 4326)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  pgm.sql('CREATE INDEX IF NOT EXISTS idx_reports_geom ON reports USING GIST (geom)');
  pgm.sql('CREATE INDEX IF NOT EXISTS idx_reports_geog ON reports USING GIST ((geom::geography))');

  pgm.createTable('zones', {
    id: 'id',
    name: { type: 'varchar(100)', notNull: true },
    description: { type: 'text' },
    level: { type: 'varchar(20)', notNull: true, default: 'rawan' },
    geom: { type: 'geometry(Polygon, 4326)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });

  pgm.sql('CREATE INDEX IF NOT EXISTS idx_zones_geom ON zones USING GIST (geom)');

  pgm.createTable('admins', {
    id: 'id',
    username: { type: 'varchar(50)', notNull: true, unique: true },
    password_hash: { type: 'varchar(100)', notNull: true },
    created_at: { type: 'timestamptz', notNull: true, default: pgm.func('now()') },
  }, { ifNotExists: true });
};

exports.down = pgm => {
  pgm.dropTable('admins');
  pgm.dropTable('zones');
  pgm.dropTable('reports');
};