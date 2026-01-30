const fs = require('fs');
const path = require('path');
const { createEmbeddingsIndex } = require('./sqlite');
const { createEmbeddingQueue } = require('./embeddings');

/**
 * Scans log files and identifies entries that are missing from the embeddings index.
 * Returns a list of log entries that need to be enqueued for embedding generation.
 */
class ReconciliationJob {
  constructor(options = {}) {
    this.logsRoot = options.logsRoot;
    this.dbPath = options.dbPath;
    this.index = options.index || null;
    this.queue = options.queue || null;
    this.onProgress = options.onProgress || null;
    this.onMissingFound = options.onMissingFound || null;
    this.onEnqueued = options.onEnqueued || null;
    this.onComplete = options.onComplete || null;
    this.onError = options.onError || null;
  }

  async initialize() {
    if (!this.index) {
      this.index = createEmbeddingsIndex(this.dbPath);
      await this.index.open();
      await this.index.migrate();
    }
  }

  async close() {
    if (this.index && this.dbPath) {
      await this.index.close();
    }
  }

  /**
   * Parse a log file and extract all entries with their line numbers.
   * Returns an array of { path, line, timestamp, role, content, contextId } objects.
   */
  parseLogFile(filePath, contextId) {
    const entries = [];
    
    if (!fs.existsSync(filePath)) {
      return entries;
    }

    const content = fs.readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNumber = i + 1; // 1-indexed

      // Match log entry pattern: - **timestamp** [role] content (optional metadata)
      const match = line.match(/^-\s+\*\*([^*]+)\*\*\s+\[([^\]]+)\]\s+(.+)$/);
      if (!match) {
        continue;
      }

      const timestamp = match[1];
      const role = match[2];
      const messageContent = match[3];

      // Skip tool calls and results (they have metadata with tool=)
      // We only embed user and agent messages, not tool interactions
      if (role === 'tool' || role === 'tool_call') {
        continue;
      }

      entries.push({
        path: filePath,
        line: lineNumber,
        timestamp,
        role,
        content: messageContent.replace(/\s*\([^)]*\)$/, ''), // Remove metadata suffix if present
        contextId,
        text: messageContent.replace(/\s*\([^)]*\)$/, ''), // Text to embed
      });
    }

    return entries;
  }

  /**
   * Find all log files under the logs root directory.
   * Returns an array of { path, surface, contextId } objects.
   */
  findLogFiles() {
    const logFiles = [];

    if (!fs.existsSync(this.logsRoot)) {
      return logFiles;
    }

    const logsDir = path.join(this.logsRoot, 'logs');
    if (!fs.existsSync(logsDir)) {
      return logFiles;
    }

    // Walk the directory structure: logs/<surface>/<contextId>/<timestamp>_<seq>.md
    const surfaces = fs.readdirSync(logsDir, { withFileTypes: true })
      .filter(dirent => dirent.isDirectory())
      .map(dirent => dirent.name);

    for (const surface of surfaces) {
      const surfacePath = path.join(logsDir, surface);
      const contextIds = fs.readdirSync(surfacePath, { withFileTypes: true })
        .filter(dirent => dirent.isDirectory())
        .map(dirent => dirent.name);

      for (const contextId of contextIds) {
        const contextPath = path.join(surfacePath, contextId);
        const files = fs.readdirSync(contextPath, { withFileTypes: true })
          .filter(dirent => dirent.isFile() && dirent.name.endsWith('.md'))
          .map(dirent => dirent.name);

        for (const file of files) {
          logFiles.push({
            path: path.join(contextPath, file),
            surface,
            contextId,
          });
        }
      }
    }

    return logFiles;
  }

  /**
   * Check if an entry already has an embedding in the database.
   * We check by path and line number combination.
   */
  async hasEmbedding(filePath, lineNumber) {
    const entry = await this.index.getByPathAndLine(filePath, lineNumber);
    return entry !== null;
  }

  /**
   * Run the reconciliation job.
   * 1. Find all log files
   * 2. Parse each file and extract entries
   * 3. Check if each entry has an embedding
   * 4. Enqueue missing entries for embedding generation
   * 
   * Returns a report of what was found and enqueued.
   */
  async run() {
    await this.initialize();

    const report = {
      filesScanned: 0,
      entriesFound: 0,
      entriesMissing: 0,
      entriesEnqueued: 0,
      errors: [],
      missingEntries: [],
    };

    try {
      // Find all log files
      const logFiles = this.findLogFiles();
      
      if (this.onProgress) {
        this.onProgress({ phase: 'scanning', totalFiles: logFiles.length });
      }

      // Process each log file
      for (const logFile of logFiles) {
        try {
          report.filesScanned++;

          if (this.onProgress) {
            this.onProgress({ 
              phase: 'scanning', 
              currentFile: report.filesScanned, 
              totalFiles: logFiles.length,
              filePath: logFile.path 
            });
          }

          // Parse entries from the log file
          const entries = this.parseLogFile(logFile.path, logFile.contextId);
          report.entriesFound += entries.length;

          // Check each entry for missing embeddings
          for (const entry of entries) {
            try {
              const hasEmbedding = await this.hasEmbedding(entry.path, entry.line);
              
              if (!hasEmbedding) {
                report.entriesMissing++;
                report.missingEntries.push(entry);

                if (this.onMissingFound) {
                  this.onMissingFound(entry);
                }
              }
            } catch (error) {
              report.errors.push({
                phase: 'checking',
                path: entry.path,
                line: entry.line,
                error: error.message,
              });

              if (this.onError) {
                this.onError('checking', entry, error);
              }
            }
          }
        } catch (error) {
          report.errors.push({
            phase: 'parsing',
            path: logFile.path,
            error: error.message,
          });

          if (this.onError) {
            this.onError('parsing', logFile, error);
          }
        }
      }

      if (this.onProgress) {
        this.onProgress({ 
          phase: 'complete', 
          filesScanned: report.filesScanned,
          entriesFound: report.entriesFound,
          entriesMissing: report.entriesMissing,
        });
      }

      // Enqueue missing entries if a queue is provided
      if (this.queue && report.missingEntries.length > 0) {
        if (this.onProgress) {
          this.onProgress({ 
            phase: 'enqueueing', 
            totalToEnqueue: report.missingEntries.length 
          });
        }

        for (const entry of report.missingEntries) {
          try {
            const jobId = this.queue.enqueue({
              text: entry.text,
              path: entry.path,
              line: entry.line,
              timestamp: entry.timestamp,
              role: entry.role,
              contextId: entry.contextId,
              pinned: false,
            });

            report.entriesEnqueued++;

            if (this.onEnqueued) {
              this.onEnqueued(entry, jobId);
            }
          } catch (error) {
            report.errors.push({
              phase: 'enqueueing',
              path: entry.path,
              line: entry.line,
              error: error.message,
            });

            if (this.onError) {
              this.onError('enqueueing', entry, error);
            }
          }
        }
      }

      if (this.onComplete) {
        this.onComplete(report);
      }

      return report;
    } catch (error) {
      if (this.onError) {
        this.onError('running', null, error);
      }
      throw error;
    }
  }
}

/**
 * Factory function to create a reconciliation job.
 */
function createReconciliationJob(options = {}) {
  return new ReconciliationJob(options);
}

/**
 * Convenience function to run a reconciliation job with the given options.
 * Automatically initializes and closes the database connection.
 */
async function runReconciliation(options = {}) {
  const job = createReconciliationJob(options);
  
  try {
    const report = await job.run();
    await job.close();
    return report;
  } catch (error) {
    await job.close();
    throw error;
  }
}

module.exports = {
  ReconciliationJob,
  createReconciliationJob,
  runReconciliation,
};
