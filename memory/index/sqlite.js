const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const SCHEMA_VERSION = 1;

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS embeddings (
  id TEXT PRIMARY KEY,
  embedding BLOB NOT NULL,
  path TEXT NOT NULL,
  line INTEGER NOT NULL,
  timestamp TEXT NOT NULL,
  role TEXT NOT NULL,
  context_id TEXT NOT NULL,
  pinned INTEGER DEFAULT 0,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
`;

const CREATE_INDEXES_SQL = [
  'CREATE INDEX IF NOT EXISTS idx_embeddings_context ON embeddings(context_id);',
  'CREATE INDEX IF NOT EXISTS idx_embeddings_timestamp ON embeddings(timestamp);',
  'CREATE INDEX IF NOT EXISTS idx_embeddings_pinned ON embeddings(pinned);',
];

class EmbeddingsIndex {
  constructor(dbPath) {
    this.dbPath = dbPath;
    this.db = null;
  }

  async open() {
    if (this.db) {
      return;
    }

    const dir = path.dirname(this.dbPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    return new Promise((resolve, reject) => {
      this.db = new sqlite3.Database(this.dbPath, (err) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });
  }

  async close() {
    if (!this.db) {
      return;
    }

    return new Promise((resolve, reject) => {
      this.db.close((err) => {
        if (err) {
          reject(err);
        } else {
          this.db = null;
          resolve();
        }
      });
    });
  }

  async run(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.run(sql, params, function (err) {
        if (err) {
          reject(err);
        } else {
          resolve({ lastID: this.lastID, changes: this.changes });
        }
      });
    });
  }

  async get(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.get(sql, params, (err, row) => {
        if (err) {
          reject(err);
        } else {
          resolve(row);
        }
      });
    });
  }

  async all(sql, params = []) {
    return new Promise((resolve, reject) => {
      this.db.all(sql, params, (err, rows) => {
        if (err) {
          reject(err);
        } else {
          resolve(rows);
        }
      });
    });
  }

  async migrate() {
    await this.run(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `);

    const versionRow = await this.get('SELECT version FROM schema_version ORDER BY version DESC LIMIT 1');
    const currentVersion = versionRow ? versionRow.version : 0;

    if (currentVersion < 1) {
      await this.run(CREATE_TABLE_SQL);
      for (const indexSql of CREATE_INDEXES_SQL) {
        await this.run(indexSql);
      }
      await this.run('INSERT INTO schema_version (version) VALUES (1)');
    }

    return SCHEMA_VERSION;
  }

  serializeEmbedding(embedding) {
    const buffer = Buffer.alloc(embedding.length * 4);
    for (let i = 0; i < embedding.length; i++) {
      buffer.writeFloatLE(embedding[i], i * 4);
    }
    return buffer;
  }

  deserializeEmbedding(buffer) {
    const embedding = [];
    for (let i = 0; i < buffer.length; i += 4) {
      embedding.push(buffer.readFloatLE(i));
    }
    return embedding;
  }

  async insert(entry) {
    const sql = `
      INSERT INTO embeddings (id, embedding, path, line, timestamp, role, context_id, pinned)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `;
    const params = [
      entry.id,
      this.serializeEmbedding(entry.embedding),
      entry.path,
      entry.line,
      entry.timestamp,
      entry.role,
      entry.context_id,
      entry.pinned ? 1 : 0,
    ];

    const result = await this.run(sql, params);
    return result.lastID;
  }

  async getById(id) {
    const sql = 'SELECT * FROM embeddings WHERE id = ?';
    const row = await this.get(sql, [id]);

    if (!row) {
      return null;
    }

    return this._rowToEntry(row);
  }

  async getByContextId(contextId) {
    const sql = 'SELECT * FROM embeddings WHERE context_id = ? ORDER BY timestamp';
    const rows = await this.all(sql, [contextId]);
    return rows.map(row => this._rowToEntry(row));
  }

  async getAll() {
    const sql = 'SELECT * FROM embeddings ORDER BY timestamp';
    const rows = await this.all(sql);
    return rows.map(row => this._rowToEntry(row));
  }

  async updatePinned(id, pinned) {
    const sql = 'UPDATE embeddings SET pinned = ? WHERE id = ?';
    const result = await this.run(sql, [pinned ? 1 : 0, id]);
    return result.changes > 0;
  }

  async delete(id) {
    const sql = 'DELETE FROM embeddings WHERE id = ?';
    const result = await this.run(sql, [id]);
    return result.changes > 0;
  }

  async deleteByContextId(contextId) {
    const sql = 'DELETE FROM embeddings WHERE context_id = ?';
    const result = await this.run(sql, [contextId]);
    return result.changes;
  }

  async searchSimilar(queryEmbedding, options = {}) {
    const limit = options.limit || 10;
    const excludeContextId = options.excludeContextId || null;

    let sql = 'SELECT * FROM embeddings';
    const params = [];

    if (excludeContextId) {
      sql += ' WHERE context_id != ?';
      params.push(excludeContextId);
    }

    const rows = await this.all(sql, params);

    const scored = rows.map(row => {
      const entry = this._rowToEntry(row);
      const similarity = this.cosineSimilarity(queryEmbedding, entry.embedding);
      return { ...entry, similarity };
    });

    scored.sort((a, b) => b.similarity - a.similarity);
    return scored.slice(0, limit);
  }

  async getPinned() {
    const sql = 'SELECT * FROM embeddings WHERE pinned = 1 ORDER BY timestamp';
    const rows = await this.all(sql);
    return rows.map(row => this._rowToEntry(row));
  }

  async getRecent(count = 10) {
    const sql = 'SELECT * FROM embeddings ORDER BY timestamp DESC LIMIT ?';
    const rows = await this.all(sql, [count]);
    return rows.map(row => this._rowToEntry(row)).reverse();
  }

  cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }

    if (normA === 0 || normB === 0) {
      return 0;
    }

    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  _rowToEntry(row) {
    return {
      id: row.id,
      embedding: this.deserializeEmbedding(row.embedding),
      path: row.path,
      line: row.line,
      timestamp: row.timestamp,
      role: row.role,
      context_id: row.context_id,
      pinned: row.pinned === 1,
      created_at: row.created_at,
    };
  }
}

function createEmbeddingsIndex(dbPath) {
  return new EmbeddingsIndex(dbPath);
}

module.exports = {
  EmbeddingsIndex,
  createEmbeddingsIndex,
  SCHEMA_VERSION,
};
